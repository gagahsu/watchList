import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from database import init_db
from routers import notes, signals, trades, sources, stocks

app = FastAPI(title="WatchList API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(notes.router,   prefix="/api")
app.include_router(signals.router, prefix="/api")
app.include_router(trades.router,  prefix="/api")
app.include_router(sources.router, prefix="/api")
app.include_router(stocks.router,  prefix="/api")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static", "browser")
INDEX_HTML  = os.path.join(STATIC_DIR, "index.html")

# Serve Angular static assets (JS, CSS, etc.) if the build exists
if os.path.isdir(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

# Fallback: serve index.html for any non-API route (Angular client-side routing)
@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend(full_path: str):
    # Serve specific static files that exist
    candidate = os.path.join(STATIC_DIR, full_path)
    if os.path.isfile(candidate):
        return FileResponse(candidate)
    # Fall back to index.html
    if os.path.isfile(INDEX_HTML):
        return FileResponse(INDEX_HTML)
    return {"error": "Angular build not found. Run: cd frontend && ng build"}


@app.on_event("startup")
def startup():
    init_db()
