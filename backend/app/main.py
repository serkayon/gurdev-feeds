from __future__ import annotations

# Allow both:
# 1) package execution: `uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`
# 2) direct script execution inside backend/app: `python main.py`
if __package__ in (None, ""):
    import sys
    from pathlib import Path

    import uvicorn

    sys.path.append(str(Path(__file__).resolve().parents[1]))
    from app.factory import create_app
else:
    import uvicorn

    from .factory import create_app

app = create_app()


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=True)
