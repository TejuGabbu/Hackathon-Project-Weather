from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class GeoPoint(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


class Observation(BaseModel):
    source: str = Field(..., examples=["satellite_ndvi", "air_quality", "weather", "hydrology"])
    region_id: str = Field(..., examples=["LK-11", "zone_07"])
    location: GeoPoint
    timestamp: datetime
    signal: str = Field(..., examples=["ndvi", "pm25", "rain_mm", "water_level_m"])
    value: float
    unit: str | None = None


class IngestRequest(BaseModel):
    observations: list[Observation]


class IngestResponse(BaseModel):
    received: int


class AlertExplanation(BaseModel):
    reason: str
    supporting_signals: list[str] = []
    baseline: dict[str, float] | None = None


class Alert(BaseModel):
    alert_id: str
    region_id: str
    location: GeoPoint
    timestamp: datetime
    severity: float = Field(..., ge=0, le=1)
    confidence: float = Field(..., ge=0, le=1)
    priority: float = Field(..., ge=0, le=1)
    signals: list[str]
    headline: str
    explanation: AlertExplanation


class AlertsResponse(BaseModel):
    alerts: list[Alert]


FeedbackLabel = Literal["true_positive", "false_positive", "investigating"]


class FeedbackRequest(BaseModel):
    alert_id: str
    region_id: str
    signal: str
    timestamp: datetime
    label: FeedbackLabel
    notes: str | None = None


class FeedbackResponse(BaseModel):
    ok: bool


class AskRequest(BaseModel):
    query: str = Field(..., examples=["What needs attention right now?", "Which region is most at risk?"])


class AskInsight(BaseModel):
    title: str
    bullets: list[str]
    related_alert_ids: list[str] = []


class AskResponse(BaseModel):
    insights: list[AskInsight]

