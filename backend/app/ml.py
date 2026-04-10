from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest


@dataclass(frozen=True)
class ScoredPoint:
    is_anomaly: bool
    score: float  # 0..1 (higher = more anomalous)
    z_score: float | None
    baseline_mean: float | None
    baseline_std: float | None


def _hash_alert_id(region_id: str, signal: str, ts: datetime) -> str:
    base = f"{region_id}|{signal}|{ts.isoformat()}"
    return hashlib.sha1(base.encode("utf-8")).hexdigest()[:16]


def _to_utc(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        return ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc)


def build_alert_id(region_id: str, signal: str, timestamp: datetime) -> str:
    return _hash_alert_id(region_id, signal, _to_utc(timestamp))


def isolation_forest_scores(values: np.ndarray) -> np.ndarray:
    if len(values) < 12:
        # too little data: return neutral
        return np.full(shape=(len(values),), fill_value=0.0, dtype=float)

    X = values.reshape(-1, 1)
    clf = IsolationForest(
        n_estimators=200,
        contamination="auto",
        random_state=42,
    )
    clf.fit(X)
    raw = -clf.score_samples(X)  # higher = more anomalous
    # normalize 0..1
    mn, mx = float(np.min(raw)), float(np.max(raw))
    if math.isclose(mx, mn):
        return np.zeros_like(raw)
    return (raw - mn) / (mx - mn)


def rolling_zscore(values: np.ndarray, window: int = 24) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    s = pd.Series(values)
    mean = s.rolling(window=window, min_periods=max(6, window // 4)).mean()
    std = s.rolling(window=window, min_periods=max(6, window // 4)).std(ddof=0)
    z = (s - mean) / std.replace(0, np.nan)
    return z.to_numpy(), mean.to_numpy(), std.to_numpy()


def score_series(df: pd.DataFrame) -> pd.DataFrame:
    """
    Input df columns: timestamp(datetime), value(float)
    Output adds: iso_score, z_score, baseline_mean, baseline_std, anomaly_score
    """
    df = df.sort_values("timestamp").reset_index(drop=True)
    values = df["value"].to_numpy(dtype=float)

    iso = isolation_forest_scores(values)
    z, mean, std = rolling_zscore(values, window=24)

    z_abs = np.nan_to_num(np.abs(z), nan=0.0)
    z_norm = np.clip(z_abs / 4.0, 0.0, 1.0)  # 4-sigma ~= 1.0

    anomaly = np.clip(0.6 * iso + 0.4 * z_norm, 0.0, 1.0)

    df["iso_score"] = iso
    df["z_score"] = z
    df["baseline_mean"] = mean
    df["baseline_std"] = std
    df["anomaly_score"] = anomaly
    return df


def prioritize(
    anomaly_score: float,
    timestamp: datetime,
    now: datetime,
    multi_signal_boost: float,
    historical_rate: float,
) -> tuple[float, float, float]:
    """
    Returns severity, confidence, priority in 0..1.
    - severity: mostly anomaly_score
    - confidence: anomaly_score + multi-signal convergence - historical 'noisiness'
    - priority: severity * recency * confidence
    """
    severity = float(np.clip(anomaly_score, 0.0, 1.0))

    age_hours = max(0.0, (now - _to_utc(timestamp)).total_seconds() / 3600.0)
    recency = float(np.exp(-age_hours / 24.0))  # 1.0 now, ~0.37 after 24h

    noise_penalty = float(np.clip(historical_rate, 0.0, 1.0)) * 0.2
    # Make confidence slightly easier to reach for demo-friendly alerting,
    # while still requiring meaningful severity or convergence.
    confidence = float(np.clip(0.55 * severity + 0.45 * multi_signal_boost + 0.12 - noise_penalty, 0.0, 1.0))

    priority = float(np.clip(severity * recency * (0.4 + 0.6 * confidence), 0.0, 1.0))
    return severity, confidence, priority


def multi_signal_convergence(signal_scores: list[float]) -> float:
    """
    0..1: boosts if multiple moderately-high scores occur together.
    """
    if not signal_scores:
        return 0.0
    s = np.array(signal_scores, dtype=float)
    strong = float(np.mean(s > 0.6))
    avg = float(np.mean(s))
    return float(np.clip(0.55 * avg + 0.45 * strong, 0.0, 1.0))


def window_start(now: datetime, hours: int) -> datetime:
    return _to_utc(now) - timedelta(hours=hours)

