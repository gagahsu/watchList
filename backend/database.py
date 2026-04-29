import sqlite3
import contextlib
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "watchlist.db")

DEFAULT_SOURCES = ["口袋證券", "股癌", "方格子", "XQ全球贏家", "理財達人秀", "其他"]


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextlib.contextmanager
def get_db():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


DDL = """
CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rows (
    id       TEXT PRIMARY KEY,
    note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    category TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS entries (
    id       TEXT PRIMARY KEY,
    row_id   TEXT NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
    code     TEXT NOT NULL,
    name     TEXT NOT NULL DEFAULT '',
    status   TEXT NOT NULL DEFAULT 'watching'
             CHECK(status IN ('holding','tracking','watching')),
    thesis   TEXT NOT NULL DEFAULT '',
    memo     TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS signals (
    id             TEXT PRIMARY KEY,
    code           TEXT NOT NULL,
    date           INTEGER NOT NULL,
    direction      TEXT NOT NULL CHECK(direction IN ('enter','exit','watch')),
    source         TEXT NOT NULL DEFAULT '',
    condition_text TEXT NOT NULL DEFAULT '',
    price          TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'active'
                   CHECK(status IN ('active','triggered','invalid','expired')),
    invalid_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_signals_code ON signals(code);

CREATE TABLE IF NOT EXISTS trades (
    id      TEXT PRIMARY KEY,
    code    TEXT NOT NULL,
    date    TEXT NOT NULL,
    type    TEXT NOT NULL CHECK(type IN ('buy','sell')),
    shares  REAL NOT NULL,
    price   REAL NOT NULL,
    fee     REAL NOT NULL DEFAULT 0,
    sig_ref TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_trades_code ON trades(code);

CREATE TABLE IF NOT EXISTS sources (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS trade_markets (
    code   TEXT PRIMARY KEY,
    market TEXT NOT NULL DEFAULT 'tw' CHECK(market IN ('tw','us'))
);

CREATE TABLE IF NOT EXISTS stocks (
    code       TEXT PRIMARY KEY,
    name       TEXT NOT NULL DEFAULT '',
    industry   TEXT NOT NULL DEFAULT '',
    close      REAL,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS tracked_stocks (
    code     TEXT PRIMARY KEY,
    status   TEXT NOT NULL DEFAULT 'watching'
             CHECK(status IN ('holding','tracking','watching')),
    thesis   TEXT NOT NULL DEFAULT '',
    memo     TEXT NOT NULL DEFAULT '',
    added_at INTEGER NOT NULL
);
"""


def init_db():
    with get_db() as conn:
        conn.executescript(DDL)
        # migrate existing databases that predate the description column
        cols = {r[1] for r in conn.execute("PRAGMA table_info(notes)").fetchall()}
        if "description" not in cols:
            conn.execute("ALTER TABLE notes ADD COLUMN description TEXT NOT NULL DEFAULT ''")
        stock_cols = {r[1] for r in conn.execute("PRAGMA table_info(stocks)").fetchall()}
        if "industry" not in stock_cols:
            conn.execute("ALTER TABLE stocks ADD COLUMN industry TEXT NOT NULL DEFAULT ''")
        for src in DEFAULT_SOURCES:
            conn.execute("INSERT OR IGNORE INTO sources(name) VALUES (?)", (src,))
