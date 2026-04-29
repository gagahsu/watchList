"""
One-time migration: copy all data from local watchlist.db (SQLite) to Supabase (PostgreSQL).

Usage:
    DATABASE_URL="postgresql://..." python migrate_to_supabase.py
"""
import sqlite3
import os
import sys
import psycopg2
import psycopg2.extras

DB_PATH = os.path.join(os.path.dirname(__file__), "watchlist.db")
DATABASE_URL = os.environ.get("DATABASE_URL", "")

if not DATABASE_URL:
    print("ERROR: set DATABASE_URL environment variable first")
    sys.exit(1)

if not os.path.exists(DB_PATH):
    print(f"ERROR: SQLite file not found: {DB_PATH}")
    sys.exit(1)


def rows_as_dicts(cur, table):
    cur.execute(f"SELECT * FROM {table}")
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


src = sqlite3.connect(DB_PATH)
src.row_factory = sqlite3.Row
sc = src.cursor()

pg = psycopg2.connect(DATABASE_URL, sslmode="require")
pc = pg.cursor()

print("Connected to both databases.")

# ── notes ─────────────────────────────────────────────────────────────────────
notes = rows_as_dicts(sc, "notes")
for r in notes:
    pc.execute(
        "INSERT INTO notes(id, title, description, created_at) VALUES (%s,%s,%s,%s)"
        " ON CONFLICT(id) DO NOTHING",
        (r["id"], r["title"], r["description"], r["created_at"]),
    )
print(f"notes: {len(notes)}")

# ── rows ──────────────────────────────────────────────────────────────────────
rows = rows_as_dicts(sc, "rows")
for r in rows:
    pc.execute(
        "INSERT INTO rows(id, note_id, category, position) VALUES (%s,%s,%s,%s)"
        " ON CONFLICT(id) DO NOTHING",
        (r["id"], r["note_id"], r["category"], r["position"]),
    )
print(f"rows: {len(rows)}")

# ── entries ───────────────────────────────────────────────────────────────────
entries = rows_as_dicts(sc, "entries")
for r in entries:
    pc.execute(
        "INSERT INTO entries(id, row_id, code, name, status, thesis, memo, position)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING",
        (r["id"], r["row_id"], r["code"], r["name"], r["status"],
         r["thesis"], r["memo"], r["position"]),
    )
print(f"entries: {len(entries)}")

# ── signals ───────────────────────────────────────────────────────────────────
signals = rows_as_dicts(sc, "signals")
for r in signals:
    pc.execute(
        "INSERT INTO signals(id, code, date, direction, source, condition_text, price, status, invalid_reason)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING",
        (r["id"], r["code"], r["date"], r["direction"], r["source"],
         r["condition_text"], r["price"], r["status"], r["invalid_reason"]),
    )
print(f"signals: {len(signals)}")

# ── trades ────────────────────────────────────────────────────────────────────
trades = rows_as_dicts(sc, "trades")
for r in trades:
    pc.execute(
        "INSERT INTO trades(id, code, date, type, shares, price, fee, sig_ref)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING",
        (r["id"], r["code"], r["date"], r["type"], r["shares"],
         r["price"], r["fee"], r["sig_ref"]),
    )
print(f"trades: {len(trades)}")

# ── sources ───────────────────────────────────────────────────────────────────
sources = rows_as_dicts(sc, "sources")
for r in sources:
    pc.execute(
        "INSERT INTO sources(name) VALUES (%s) ON CONFLICT DO NOTHING",
        (r["name"],),
    )
print(f"sources: {len(sources)}")

# ── trade_markets ─────────────────────────────────────────────────────────────
try:
    markets = rows_as_dicts(sc, "trade_markets")
    for r in markets:
        pc.execute(
            "INSERT INTO trade_markets(code, market) VALUES (%s,%s) ON CONFLICT DO NOTHING",
            (r["code"], r["market"]),
        )
    print(f"trade_markets: {len(markets)}")
except Exception as e:
    print(f"trade_markets: skipped ({e})")

# ── tracked_stocks ────────────────────────────────────────────────────────────
try:
    tracked = rows_as_dicts(sc, "tracked_stocks")
    for r in tracked:
        pc.execute(
            "INSERT INTO tracked_stocks(code, status, thesis, memo, added_at)"
            " VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            (r["code"], r["status"], r["thesis"], r["memo"], r["added_at"]),
        )
    print(f"tracked_stocks: {len(tracked)}")
except Exception as e:
    print(f"tracked_stocks: skipped ({e})")

# ── stocks ────────────────────────────────────────────────────────────────────
try:
    stocks = rows_as_dicts(sc, "stocks")
    for r in stocks:
        pc.execute(
            "INSERT INTO stocks(code, name, industry, close, updated_at)"
            " VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            (r["code"], r["name"], r["industry"], r["close"], r["updated_at"]),
        )
    print(f"stocks: {len(stocks)}")
except Exception as e:
    print(f"stocks: skipped ({e})")

pg.commit()
src.close()
pg.close()
print("Migration complete.")
