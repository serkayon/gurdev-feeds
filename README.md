# Poultry ERP - Local Development

Poultry ERP for feed processing with:
- Dashboard
- Raw Material
- Dispatch
- Production
- Stock
- PDF/Excel/CSV exports

This project is configured for **local VS Code development** (no Docker required).

## Tech Stack

- Frontend: React 18, Vite, Tailwind CSS, Recharts
- Backend: FastAPI, SQLAlchemy, PostgreSQL
- Exports: ReportLab, OpenPyXL

## Backend Architecture

```text
backend/
  app/
    api/
      common.py           # shared request/response/session helpers
      routes/             # feature-wise API route modules
        auth.py
        config.py
        dispatch.py
        health.py
        plc.py
        production.py
        raw_material.py
        stock.py
    models/               # SQLAlchemy models
    services/             # business services (auth, stock updates)
    utils/                # export utilities (PDF/Excel/CSV)
    factory.py            # FastAPI app factory + router registration
    main.py               # ASGI runtime entrypoint
    database.py           # engine/session/init_db
    config.py             # environment settings
```

## Local Run

### 1. Backend (FastAPI)

```bash
cd backend\app
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
# Set this to your local PostgreSQL credentials
$env:DATABASE_URL="postgresql+psycopg://YOUR_USER:YOUR_PASSWORD@localhost:5432/poultry"
uvicorn main:app --reload --host 127.0.0.1 --port 8007
```

Backend URL:
- http://127.0.0.1:8007
- Health: http://127.0.0.1:8007/health

PostgreSQL database:
- `poultry` (local PostgreSQL)

### 2. Frontend (Vite)

```bash
cd frontend
npm install
npm run dev
```

Frontend URL:
- http://127.0.0.1:5173

Vite proxy is configured to forward `/api` requests to:
- `http://127.0.0.1:8007`

## Backend Notes

- DB tables are created automatically on first start.
- Default data is seeded automatically:
  - Raw material types
  - Product types
  - Demo vendor/customer users
- Stock ledgers update automatically when:
  - Raw material entry is created (RM received)
  - Production batch is created (feed produced)
  - Dispatch entry is created (feed dispatched)

## Environment Variables (optional)

- `DATABASE_URL` (defaults to `postgresql+psycopg://postgres@localhost:5432/poultry`)
- `SECRET_KEY`
- `DEBUG`
