# Manual Startup Guide (Windows)

Use two terminals: one for backend, one for frontend.

## Prerequisites

- Python 3.10+ installed
- Node.js + npm installed

## 1) Start Backend

Open Terminal 1 in project root:

```bat
cd backend\app
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
set DATABASE_URL=postgresql+psycopg://YOUR_USER:YOUR_PASSWORD@localhost:5432/poultry
uvicorn main:app --reload --host 127.0.0.1 --port 8007
```

Backend runs at:
- http://127.0.0.1:8007

## 2) Start Frontend

Open Terminal 2 in project root:

```bat
cd frontend
npm install
npm run dev
```

Frontend runs at:
- http://localhost:5173/

## 3) Open in Browser

Open Chrome (or any browser) and go to:

- http://localhost:5173/

## Optional (Auto Start)

You can also run:

```bat
start_project.bat
```

LOGIN CREDENTIALS :::::::::

gmail = client@gmail.com
pass  = open@123
