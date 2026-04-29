from fastapi import APIRouter, HTTPException
from database import get_db
from models import SourceIn

router = APIRouter()


@router.get("/sources")
def get_sources():
    with get_db() as conn:
        rows = conn.execute("SELECT name FROM sources ORDER BY id ASC").fetchall()
    return [r["name"] for r in rows]


@router.post("/sources", status_code=201)
def add_source(body: SourceIn):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO sources(name) VALUES (%s) ON CONFLICT DO NOTHING", (body.name,)
        )
        rows = conn.execute("SELECT name FROM sources ORDER BY id ASC").fetchall()
    return [r["name"] for r in rows]


@router.delete("/sources/{name}")
def delete_source(name: str):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM sources WHERE name=%s", (name,)).fetchone():
            raise HTTPException(404, "Source not found")
        conn.execute("DELETE FROM sources WHERE name=%s", (name,))
    return {"ok": True}
