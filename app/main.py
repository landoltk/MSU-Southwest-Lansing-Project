from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="SWLP Prototype App", version="0.2.0")

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
STATIC_DIR = BASE_DIR / "static"

# Serve the entire repo directory as the site root (index.html at "/")
app.mount("/", StaticFiles(directory=str(BASE_DIR), html=True), name="root")
app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")