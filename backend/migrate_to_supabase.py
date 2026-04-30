"""
One-time migration: copy all data from local watchlist.db (SQLite) to Supabase (PostgreSQL).

Usage:
    $env:DATABASE_URL = "postgresql://..."
    python migrate_to_supabase.py
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


def sqlite_rows(cur, table):
    cur.execute(f"SELECT * FROM {table}")
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def pg_connect():
    pg = psycopg2.connect(DATABASE_URL, sslmode="require")
    pc = pg.cursor()
    return pg, pc


src = sqlite3.connect(DB_PATH)
sc = src.cursor()
print("Reading SQLite data...")

# ── notes ─────────────────────────────────────────────────────────────────────
pg, pc = pg_connect()
notes = sqlite_rows(sc, "notes")
for r in notes:
    pc.execute(
        "INSERT INTO notes(id, title, description, created_at) VALUES (%s,%s,%s,%s)"
        " ON CONFLICT(id) DO NOTHING",
        (r["id"], r["title"], r["description"], r["created_at"]),
    )
pg.commit(); pg.close()
print(f"notes: {len(notes)} ✓")

# ── rows ──────────────────────────────────────────────────────────────────────
pg, pc = pg_connect()
rows = sqlite_rows(sc, "rows")
for r in rows:
    pc.execute(
        "INSERT INTO rows(id, note_id, category, position) VALUES (%s,%s,%s,%s)"
        " ON CONFLICT(id) DO NOTHING",
        (r["id"], r["note_id"], r["category"], r["position"]),
    )
pg.commit(); pg.close()
print(f"rows: {len(rows)} ✓")

# ── entries ───────────────────────────────────────────────────────────────────
pg, pc = pg_connect()
entries = sqlite_rows(sc, "entries")
for r in entries:
    pc.execute(
        "INSERT INTO entries(id, row_id, code, name, status, thesis, memo, position)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING",
        (r["id"], r["row_id"], r["code"], r["name"], r["status"],
         r["thesis"], r["memo"], r["position"]),
    )
pg.commit(); pg.close()
print(f"entries: {len(entries)} ✓")

# ── signals ───────────────────────────────────────────────────────────────────
pg, pc = pg_connect()
signals = sqlite_rows(sc, "signals")
for r in signals:
    pc.execute(
        "INSERT INTO signals(id, code, date, direction, source, condition_text, price, status, invalid_reason)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING",
        (r["id"], r["code"], r["date"], r["direction"], r["source"],
         r["condition_text"], r["price"], r["status"], r["invalid_reason"]),
    )
pg.commit(); pg.close()
print(f"signals: {len(signals)} ✓")

# ── trades ────────────────────────────────────────────────────────────────────
pg, pc = pg_connect()
trades = sqlite_rows(sc, "trades")
for r in trades:
    pc.execute(
        "INSERT INTO trades(id, code, date, type, shares, price, fee, sig_ref)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING",
        (r["id"], r["code"], r["date"], r["type"], r["shares"],
         r["price"], r["fee"], r["sig_ref"]),
    )
pg.commit(); pg.close()
print(f"trades: {len(trades)} ✓")

# ── sources ───────────────────────────────────────────────────────────────────
pg, pc = pg_connect()
sources = sqlite_rows(sc, "sources")
for r in sources:
    pc.execute(
        "INSERT INTO sources(name) VALUES (%s) ON CONFLICT DO NOTHING",
        (r["name"],),
    )
pg.commit(); pg.close()
print(f"sources: {len(sources)} ✓")

# ── trade_markets ─────────────────────────────────────────────────────────────
try:
    pg, pc = pg_connect()
    markets = sqlite_rows(sc, "trade_markets")
    for r in markets:
        pc.execute(
            "INSERT INTO trade_markets(code, market) VALUES (%s,%s) ON CONFLICT DO NOTHING",
            (r["code"], r["market"]),
        )
    pg.commit(); pg.close()
    print(f"trade_markets: {len(markets)} ✓")
except Exception as e:
    print(f"trade_markets: skipped ({e})")

# ── tracked_stocks ────────────────────────────────────────────────────────────
try:
    pg, pc = pg_connect()
    tracked = sqlite_rows(sc, "tracked_stocks")
    for r in tracked:
        pc.execute(
            "INSERT INTO tracked_stocks(code, status, thesis, memo, added_at)"
            " VALUES (%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
            (r["code"], r["status"], r["thesis"], r["memo"], r["added_at"]),
        )
    pg.commit(); pg.close()
    print(f"tracked_stocks: {len(tracked)} ✓")
except Exception as e:
    print(f"tracked_stocks: skipped ({e})")

# ── stocks (skipped — re-sync from UI after deployment) ──────────────────────
print("stocks: skipped (re-sync from UI after deployment)")

src.close()
print("\nMigration complete.")
