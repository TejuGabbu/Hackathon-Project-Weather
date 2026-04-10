# AI-Powered Environmental Sentinel

An intelligent geospatial monitoring system that **detects, prioritizes, and explains environmental anomalies** using AI.

## What this MVP includes
 
- **Multi-source ingestion**: `/ingest` accepts geo + time-series observations (satellite/air/weather style signals).
- **Spatio-temporal anomaly detection**:
  - Isolation Forest scoring
  - Rolling z-score deviation vs recent baseline
- **Intelligent anomaly prioritization**:
  - severity + confidence + recency
  - **signal convergence boost** (multiple signals in same time window)
  - **suppression** via per-region `min_confidence` threshold
- **Adaptive self-learning loop**:
  - `/feedback` stores labels in SQLite
  - thresholds auto-adjust per region to reduce false positives
- **Context-aware query interface**:
  - `/ask` turns questions into ranked, explainable insights
- **Hackathon UI dashboard**:
  - interactive map + prioritized alerts + explanations + feedback buttons
  - trend snapshot chart + NL “Ask” panel

## Quickstart (Windows)

### Backend (FastAPI)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

Open API docs at `http://localhost:8000/docs`.

### Frontend (Vite + React + Tailwind)

```powershell
cd frontend
npm install
npm run dev
```

Open the dashboard at `http://localhost:5173`.

## Demo flow (recommended)

1. Start backend + frontend
2. In the UI click **Seed demo data**
3. Explore:
   - **Map markers** (size/color = priority)
   - **Prioritized alerts** (ranked list)
   - **Explainability panel** (baseline + reasons + supporting signals)
   - **Feedback buttons** (true/false positive, investigating)
   - Ask: **“What needs attention right now?”** / **“Which region is most at risk?”**

## Notes for hackathon judges

- The scoring intentionally blends **statistical deviation** and **isolation-based outlier detection**, then boosts confidence when **multiple signals converge**.
- The feedback loop shows how the system can become **region-adaptive** (different noise levels, different thresholds).

