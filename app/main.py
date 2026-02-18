from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from pathlib import Path

#app setup
app = FastAPI(title="SWLP Prototype App", version="0.1.0")
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR   = BASE_DIR / "data"
STATIC_DIR = BASE_DIR / "static"
app.mount("/", StaticFiles(directory=str(BASE_DIR), html=True), name="root")
app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

#index get
@app.get("/")
def index():
    return FileResponse("index.html")