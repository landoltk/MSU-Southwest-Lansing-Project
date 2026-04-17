from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from pathlib import Path

# app setup
app = FastAPI(title="SWLP Prototype App", version="0.1.0")

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app.mount("/", StaticFiles(directory=str(BASE_DIR), html=True), name="root")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")