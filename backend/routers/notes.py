from fastapi import APIRouter, HTTPException
from database import get_db
from models import NoteIn, NotePatch, NoteOut, RowIn, RowPatch, RowOut, EntryIn, EntryPatch, EntryOut

router = APIRouter()


def _fetch_full_tree(conn) -> list[dict]:
    notes_rows = conn.execute(
        "SELECT id, title, description, created_at FROM notes ORDER BY created_at DESC"
    ).fetchall()
    rows_rows = conn.execute(
        "SELECT id, note_id, category, position FROM rows ORDER BY position ASC"
    ).fetchall()
    entries_rows = conn.execute(
        "SELECT id, row_id, code, name, status, thesis, memo, position FROM entries ORDER BY position ASC"
    ).fetchall()

    # entries grouped by row_id
    entry_map: dict[str, list] = {}
    for e in entries_rows:
        entry_map.setdefault(e["row_id"], []).append({
            "id": e["id"], "code": e["code"], "name": e["name"],
            "status": e["status"], "thesis": e["thesis"], "memo": e["memo"],
        })

    # rows grouped by note_id
    row_map: dict[str, list] = {}
    for r in rows_rows:
        row_map.setdefault(r["note_id"], []).append({
            "id": r["id"], "category": r["category"],
            "entries": entry_map.get(r["id"], []),
        })

    return [
        {
            "id": n["id"], "title": n["title"], "description": n["description"],
            "createdAt": n["created_at"], "rows": row_map.get(n["id"], []),
        }
        for n in notes_rows
    ]


def _insert_note_tree(conn, note: NoteIn):
    conn.execute(
        "INSERT OR REPLACE INTO notes(id, title, description, created_at) VALUES (?,?,?,?)",
        (note.id, note.title, note.description, note.createdAt),
    )
    for pos, row in enumerate(note.rows):
        conn.execute(
            "INSERT OR REPLACE INTO rows(id, note_id, category, position) VALUES (?,?,?,?)",
            (row.id, note.id, row.category, pos),
        )
        for epos, entry in enumerate(row.entries):
            conn.execute(
                "INSERT OR REPLACE INTO entries(id, row_id, code, name, status, thesis, memo, position) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (entry.id, row.id, entry.code, entry.name, entry.status,
                 entry.thesis, entry.memo, epos),
            )


# ── Notes ────────────────────────────────────────────────────────────────────

@router.get("/notes", response_model=list[NoteOut])
def get_notes():
    with get_db() as conn:
        return _fetch_full_tree(conn)


@router.post("/notes", response_model=NoteOut, status_code=201)
def create_note(note: NoteIn):
    with get_db() as conn:
        _insert_note_tree(conn, note)
        tree = _fetch_full_tree(conn)
    result = next((n for n in tree if n["id"] == note.id), None)
    if not result:
        raise HTTPException(500, "Failed to retrieve created note")
    return result


@router.patch("/notes/{note_id}")
def patch_note(note_id: str, body: NotePatch):
    with get_db() as conn:
        row = conn.execute("SELECT id FROM notes WHERE id=?", (note_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Note not found")
        if body.title is not None:
            conn.execute("UPDATE notes SET title=? WHERE id=?", (body.title, note_id))
        if body.description is not None:
            conn.execute("UPDATE notes SET description=? WHERE id=?", (body.description, note_id))
        note = conn.execute(
            "SELECT id, title, description, created_at FROM notes WHERE id=?", (note_id,)
        ).fetchone()
    return {"id": note["id"], "title": note["title"], "description": note["description"],
            "createdAt": note["created_at"]}


@router.delete("/notes/{note_id}")
def delete_note(note_id: str):
    with get_db() as conn:
        row = conn.execute("SELECT id FROM notes WHERE id=?", (note_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Note not found")
        conn.execute("DELETE FROM notes WHERE id=?", (note_id,))
    return {"ok": True}


# ── Rows ─────────────────────────────────────────────────────────────────────

@router.post("/notes/{note_id}/rows", response_model=RowOut, status_code=201)
def create_row(note_id: str, row: RowIn):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM notes WHERE id=?", (note_id,)).fetchone():
            raise HTTPException(404, "Note not found")
        pos = conn.execute(
            "SELECT COALESCE(MAX(position)+1, 0) FROM rows WHERE note_id=?", (note_id,)
        ).fetchone()[0]
        conn.execute(
            "INSERT OR REPLACE INTO rows(id, note_id, category, position) VALUES (?,?,?,?)",
            (row.id, note_id, row.category, pos),
        )
        for epos, entry in enumerate(row.entries):
            conn.execute(
                "INSERT OR REPLACE INTO entries(id, row_id, code, name, status, thesis, memo, position) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (entry.id, row.id, entry.code, entry.name, entry.status,
                 entry.thesis, entry.memo, epos),
            )
    return RowOut(id=row.id, category=row.category, entries=[
        EntryOut(id=e.id, code=e.code, name=e.name, status=e.status,
                 thesis=e.thesis, memo=e.memo)
        for e in row.entries
    ])


@router.patch("/rows/{row_id}")
def patch_row(row_id: str, body: RowPatch):
    with get_db() as conn:
        row = conn.execute("SELECT id, category FROM rows WHERE id=?", (row_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Row not found")
        if body.category is not None:
            conn.execute("UPDATE rows SET category=? WHERE id=?", (body.category, row_id))
        updated = conn.execute("SELECT id, category FROM rows WHERE id=?", (row_id,)).fetchone()
    return {"id": updated["id"], "category": updated["category"]}


@router.delete("/rows/{row_id}")
def delete_row(row_id: str):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM rows WHERE id=?", (row_id,)).fetchone():
            raise HTTPException(404, "Row not found")
        conn.execute("DELETE FROM rows WHERE id=?", (row_id,))
    return {"ok": True}


# ── Entries ───────────────────────────────────────────────────────────────────

@router.post("/rows/{row_id}/entries", response_model=EntryOut, status_code=201)
def create_entry(row_id: str, entry: EntryIn):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM rows WHERE id=?", (row_id,)).fetchone():
            raise HTTPException(404, "Row not found")
        pos = conn.execute(
            "SELECT COALESCE(MAX(position)+1, 0) FROM entries WHERE row_id=?", (row_id,)
        ).fetchone()[0]
        conn.execute(
            "INSERT OR REPLACE INTO entries(id, row_id, code, name, status, thesis, memo, position) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (entry.id, row_id, entry.code, entry.name, entry.status,
             entry.thesis, entry.memo, pos),
        )
    return EntryOut(id=entry.id, code=entry.code, name=entry.name,
                    status=entry.status, thesis=entry.thesis, memo=entry.memo)


@router.patch("/entries/{entry_id}", response_model=EntryOut)
def patch_entry(entry_id: str, body: EntryPatch):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, code, name, status, thesis, memo FROM entries WHERE id=?", (entry_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Entry not found")
        updates = {
            "code":   body.code   if body.code   is not None else row["code"],
            "name":   body.name   if body.name   is not None else row["name"],
            "status": body.status if body.status is not None else row["status"],
            "thesis": body.thesis if body.thesis is not None else row["thesis"],
            "memo":   body.memo   if body.memo   is not None else row["memo"],
        }
        conn.execute(
            "UPDATE entries SET code=?, name=?, status=?, thesis=?, memo=? WHERE id=?",
            (updates["code"], updates["name"], updates["status"],
             updates["thesis"], updates["memo"], entry_id),
        )
    return EntryOut(id=entry_id, **updates)


@router.delete("/entries/{entry_id}")
def delete_entry(entry_id: str):
    with get_db() as conn:
        if not conn.execute("SELECT id FROM entries WHERE id=?", (entry_id,)).fetchone():
            raise HTTPException(404, "Entry not found")
        conn.execute("DELETE FROM entries WHERE id=?", (entry_id,))
    return {"ok": True}
