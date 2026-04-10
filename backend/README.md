# AI-Powered Environmental Sentinel (Backend)

## Run locally

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Then open the API docs at `http://localhost:8000/docs`.

