from __future__ import annotations

from datetime import timezone

import numpy as np
import pandas as pd

from app.schemas import Observation


class InMemoryStore:
    """
    Hackathon-friendly store for recent observations.
    Keeps a rolling history in-memory; feedback/thresholds go to SQLite.
    """

    def __init__(self) -> None:
        self._obs: list[Observation] = []

    def add(self, observations: list[Observation]) -> None:
        self._obs.extend(observations)

    def as_frame(self) -> pd.DataFrame:
        if not self._obs:
            return pd.DataFrame(columns=["source", "region_id", "lat", "lon", "timestamp", "signal", "value", "unit"])
        rows = []
        for o in self._obs:
            ts = o.timestamp
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            else:
                ts = ts.astimezone(timezone.utc)
            rows.append(
                {
                    "source": o.source,
                    "region_id": o.region_id,
                    "lat": o.location.lat,
                    "lon": o.location.lon,
                    "timestamp": ts,
                    "signal": o.signal,
                    "value": float(o.value),
                    "unit": o.unit,
                }
            )
        df = pd.DataFrame(rows)
        return df

    def recent_region_locations(self) -> dict[str, tuple[float, float]]:
        # last known lat/lon per region
        loc: dict[str, tuple[float, float]] = {}
        for o in self._obs:
            loc[o.region_id] = (o.location.lat, o.location.lon)
        return loc

    def historical_anomaly_rate(self) -> dict[tuple[str, str], float]:
        """
        Approximate noisiness: fraction of points that were 'high-ish' by simple heuristics.
        """
        df = self.as_frame()
        if df.empty:
            return {}

        out: dict[tuple[str, str], float] = {}
        for (region_id, signal), g in df.groupby(["region_id", "signal"]):
            vals = g["value"].to_numpy()
            if len(vals) < 8:
                out[(region_id, signal)] = 0.0
                continue
            med = float(np.median(vals))
            mad = float(np.median(np.abs(vals - med)))  # median absolute deviation
            scale = mad if mad > 1e-9 else float(np.std(vals, ddof=0) + 1e-9)
            highish = (np.abs(vals - med) / scale) > 3.0
            out[(region_id, signal)] = float(highish.mean())
        return out


store = InMemoryStore()

