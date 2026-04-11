from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import engine, get_session
from app.ml import build_alert_id, multi_signal_convergence, prioritize, score_series, window_start
from app.models import Base, Feedback, RegionThreshold
from app.schemas import (
    AlertsResponse,
    AskRequest,
    AskResponse,
    FeedbackRequest,
    FeedbackResponse,
    IngestRequest,
    IngestResponse,
)
from app.store import store

app = FastAPI(title="AI-Powered Environmental Sentinel API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/ingest", response_model=IngestResponse)
async def ingest(payload: IngestRequest) -> IngestResponse:
    store.add(payload.observations)
    return IngestResponse(received=len(payload.observations))


async def _get_region_threshold(session: AsyncSession, region_id: str) -> float:
    row = await session.get(RegionThreshold, region_id)
    if row is None:
        row = RegionThreshold(region_id=region_id, min_confidence=0.5)
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return float(row.min_confidence)


@app.get("/alerts", response_model=AlertsResponse)
async def alerts(session: AsyncSession = Depends(get_session)) -> AlertsResponse:
    now = datetime.now(timezone.utc)
    df = store.as_frame()
    if df.empty:
        return AlertsResponse(alerts=[])

    # Focus on last 7 days for alerts; use full history for baselines via rolling windows
    df = df.sort_values("timestamp")
    recent = df[df["timestamp"] >= window_start(now, hours=24 * 7)]
    if recent.empty:
        return AlertsResponse(alerts=[])

    historical_rate = store.historical_anomaly_rate()
    region_loc = store.recent_region_locations()

    alerts_out = []
    for (region_id, signal), g in df.groupby(["region_id", "signal"]):
        scored = score_series(g[["timestamp", "value"]].copy())
        # take candidate points in the last 7 days
        scored_recent = scored[scored["timestamp"] >= window_start(now, hours=24 * 7)]
        if scored_recent.empty:
            continue

        # pick top N recent anomalies
        top = scored_recent.sort_values("anomaly_score", ascending=False).head(3)

        # multi-signal: compare this timestamp's neighborhood across signals in the same region
        region_df = df[df["region_id"] == region_id]
        for _, row in top.iterrows():
            ts = row["timestamp"]
            # neighborhood: +/- 3 hours
            w = region_df[(region_df["timestamp"] >= ts - pd.Timedelta(hours=3)) & (region_df["timestamp"] <= ts + pd.Timedelta(hours=3))]
            neighbor_scores = []
            for sig2, g2 in w.groupby("signal"):
                scored2 = score_series(g2[["timestamp", "value"]].copy())
                # nearest timestamp
                idx = (scored2["timestamp"] - ts).abs().idxmin()
                neighbor_scores.append(float(scored2.loc[idx, "anomaly_score"]))

            convergence = multi_signal_convergence(neighbor_scores)
            sev, conf, prio = prioritize(
                anomaly_score=float(row["anomaly_score"]),
                timestamp=ts.to_pydatetime() if hasattr(ts, "to_pydatetime") else ts,
                now=now,
                multi_signal_boost=convergence,
                historical_rate=float(historical_rate.get((region_id, signal), 0.0)),
            )

            min_conf = await _get_region_threshold(session, region_id)
            if conf < min_conf:
                continue

            lat, lon = region_loc.get(region_id, (float(g["lat"].iloc[-1]), float(g["lon"].iloc[-1])))
            alert_id = build_alert_id(region_id, signal, ts.to_pydatetime() if hasattr(ts, "to_pydatetime") else ts)

            baseline_mean = row.get("baseline_mean")
            baseline_std = row.get("baseline_std")
            z = row.get("z_score")

            headline = f"{signal.upper()} anomaly in {region_id}"
            reason = "Detected statistically significant deviation and isolation-based outlier behavior."
            if not pd.isna(z) and abs(float(z)) >= 3.0:
                reason = f"Deviation is ~{abs(float(z)):.1f}σ from recent baseline; converging signals increased confidence."

            alerts_out.append(
                {
                    "alert_id": alert_id,
                    "region_id": region_id,
                    "location": {"lat": float(lat), "lon": float(lon)},
                    "timestamp": ts.to_pydatetime() if hasattr(ts, "to_pydatetime") else ts,
                    "severity": sev,
                    "confidence": conf,
                    "priority": prio,
                    "signals": sorted(list({signal} | set(w["signal"].unique().tolist()))),
                    "headline": headline,
                    "explanation": {
                        "reason": reason,
                        "supporting_signals": sorted(list(set(w["signal"].unique().tolist()))),
                        "baseline": (
                            None
                            if pd.isna(baseline_mean) or pd.isna(baseline_std)
                            else {"mean": float(baseline_mean), "std": float(baseline_std)}
                        ),
                    },
                }
            )

    # Return globally prioritized
    alerts_out.sort(key=lambda a: a["priority"], reverse=True)
    return AlertsResponse(alerts=alerts_out[:50])


@app.post("/feedback", response_model=FeedbackResponse)
async def feedback(payload: FeedbackRequest, session: AsyncSession = Depends(get_session)) -> FeedbackResponse:
    row = Feedback(
        alert_id=payload.alert_id,
        region_id=payload.region_id,
        signal=payload.signal,
        timestamp=payload.timestamp,
        label=payload.label,
        notes=payload.notes,
    )
    session.add(row)

    # Adaptive threshold tweak: if many false positives recently for a region, raise min_confidence
    since = datetime.now(timezone.utc) - timedelta(days=14)
    q = select(Feedback.label).where(Feedback.region_id == payload.region_id, Feedback.created_at >= since)
    res = (await session.execute(q)).scalars().all()
    fp = sum(1 for x in res if x == "false_positive")
    tp = sum(1 for x in res if x == "true_positive")
    total = max(1, fp + tp)
    fp_rate = fp / total

    thresh = await session.get(RegionThreshold, payload.region_id)
    if thresh is None:
        thresh = RegionThreshold(region_id=payload.region_id, min_confidence=0.65)
        session.add(thresh)

    # Move within [0.45, 0.9]
    if fp_rate >= 0.6 and total >= 5:
        thresh.min_confidence = float(min(0.9, thresh.min_confidence + 0.05))
    elif fp_rate <= 0.2 and total >= 5:
        thresh.min_confidence = float(max(0.45, thresh.min_confidence - 0.03))

    await session.commit()
    return FeedbackResponse(ok=True)


@app.post("/seed")
async def seed(session: AsyncSession = Depends(get_session)) -> dict[str, int]:
    """
    Generate synthetic multi-signal geo time-series data so the UI has something to show.
    """
    now = datetime.now(timezone.utc)
    regions = [
        ("LK-11", 6.9271, 79.8612),  # Colombo-ish
        ("LK-21", 7.2906, 80.6337),  # Kandy-ish
        ("LK-31", 8.3114, 80.4037),  # Anuradhapura-ish
        ("LK-41", 6.0535, 80.2210),  # Galle-ish
    ]

    # Demo-friendly: reset region thresholds so alerts render immediately
    for region_id, _, _ in regions:
        row = await session.get(RegionThreshold, region_id)
        if row is None:
            session.add(RegionThreshold(region_id=region_id, min_confidence=0.5))
        else:
            row.min_confidence = 0.5
    await session.commit()

    obs = []
    rng = pd.Series(range(0, 24 * 21))  # 21 days hourly
    for region_id, lat, lon in regions:
        # Baselines
        ndvi_base = 0.62
        pm25_base = 22.0
        rain_base = 2.0

        for h in rng:
            ts = now - timedelta(hours=int(24 * 21 - h))
            # Seasonal-ish oscillations
            ndvi = ndvi_base + 0.06 * float(np.sin(2 * np.pi * (float(h) / (24 * 14))))
            pm25 = pm25_base + 6.0 * float(np.sin(2 * np.pi * (float(h) / (24 * 7))))
            rain = rain_base + 1.5 * float(np.sin(2 * np.pi * (float(h) / 24)))  # daily pattern

            # Inject a few anomalies per region
            if region_id == "LK-21" and int(h) in {24 * 18 + 4, 24 * 18 + 5, 24 * 18 + 6}:
                pm25 += 45.0  # pollution spike
            if region_id == "LK-31" and int(h) in {24 * 16 + 12, 24 * 16 + 13}:
                ndvi -= 0.22  # vegetation drop
            if region_id == "LK-41" and int(h) in {24 * 19 + 1, 24 * 19 + 2, 24 * 19 + 3}:
                rain += 22.0  # heavy rain

            obs.extend(
                [
                    {
                        "source": "satellite_ndvi",
                        "region_id": region_id,
                        "location": {"lat": lat, "lon": lon},
                        "timestamp": ts,
                        "signal": "ndvi",
                        "value": float(ndvi),
                        "unit": "index",
                    },
                    {
                        "source": "air_quality",
                        "region_id": region_id,
                        "location": {"lat": lat, "lon": lon},
                        "timestamp": ts,
                        "signal": "pm25",
                        "value": float(max(0.0, pm25)),
                        "unit": "µg/m³",
                    },
                    {
                        "source": "weather",
                        "region_id": region_id,
                        "location": {"lat": lat, "lon": lon},
                        "timestamp": ts,
                        "signal": "rain_mm",
                        "value": float(max(0.0, rain)),
                        "unit": "mm",
                    },
                ]
            )

    # Use same ingest path
    from app.schemas import IngestRequest, Observation  # local import to avoid circulars

    payload = IngestRequest(observations=[Observation.model_validate(o) for o in obs])
    store.add(payload.observations)
    return {"seeded": len(obs)}


@app.post("/ask", response_model=AskResponse)
async def ask(payload: AskRequest, session: AsyncSession = Depends(get_session)) -> AskResponse:
    q = payload.query.strip().lower()
    alerts_resp = await alerts(session=session)
    alerts_list = alerts_resp.alerts

    insights = []
    if "attention" in q or "right now" in q or "urgent" in q:
        top = alerts_list[:5]
        bullets = [f"{a.headline} (priority={a.priority:.2f}, confidence={a.confidence:.2f})" for a in top]
        insights.append(
            {
                "title": "Top priorities right now",
                "bullets": bullets if bullets else ["No high-confidence alerts right now."],
                "related_alert_ids": [a.alert_id for a in top],
            }
        )
    elif "most at risk" in q or "which region" in q or "region" in q:
        # Aggregate max priority by region
        by_region: dict[str, float] = {}
        for a in alerts_list:
            by_region[a.region_id] = max(by_region.get(a.region_id, 0.0), float(a.priority))
        ranked = sorted(by_region.items(), key=lambda x: x[1], reverse=True)[:5]
        bullets = [f"{rid}: risk score {score:.2f}" for rid, score in ranked]
        rel = [a.alert_id for a in alerts_list if a.region_id in dict(ranked)]
        insights.append(
            {
                "title": "Regions most at risk",
                "bullets": bullets if bullets else ["No region stands out as high risk right now."],
                "related_alert_ids": rel[:10],
            }
        )
    else:
        insights.append(
            {
                "title": "Try asking",
                "bullets": [
                    "“What needs attention right now?”",
                    "“Which region is most at risk?”",
                    "“Show me high confidence alerts”",
                ],
                "related_alert_ids": [],
            }
        )

    return AskResponse(insights=insights)

