import psycopg2
import psycopg2.extras
import contextlib
import os

DATABASE_URL = os.environ.get("DATABASE_URL", "")

DEFAULT_SOURCES = ["口袋證券", "股癌", "方格子", "XQ全球贏家", "理財達人秀", "其他"]

DDL = [
    """
    CREATE TABLE IF NOT EXISTS notes (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        created_at  BIGINT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS rows (
        id       TEXT PRIMARY KEY,
        note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        category TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0
    )
    """,
    """
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
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS signals (
        id             TEXT PRIMARY KEY,
        code           TEXT NOT NULL,
        date           BIGINT NOT NULL,
        direction      TEXT NOT NULL CHECK(direction IN ('enter','exit','watch')),
        source         TEXT NOT NULL DEFAULT '',
        condition_text TEXT NOT NULL DEFAULT '',
        price          TEXT NOT NULL DEFAULT '',
        status         TEXT NOT NULL DEFAULT 'active'
                       CHECK(status IN ('active','triggered','invalid','expired')),
        invalid_reason TEXT NOT NULL DEFAULT ''
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_signals_code ON signals(code)",
    """
    CREATE TABLE IF NOT EXISTS trades (
        id      TEXT PRIMARY KEY,
        code    TEXT NOT NULL,
        date    TEXT NOT NULL,
        type    TEXT NOT NULL CHECK(type IN ('buy','sell')),
        shares  DOUBLE PRECISION NOT NULL,
        price   DOUBLE PRECISION NOT NULL,
        fee     DOUBLE PRECISION NOT NULL DEFAULT 0,
        sig_ref TEXT NOT NULL DEFAULT ''
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_trades_code ON trades(code)",
    """
    CREATE TABLE IF NOT EXISTS sources (
        id   SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS trade_markets (
        code   TEXT PRIMARY KEY,
        market TEXT NOT NULL DEFAULT 'tw' CHECK(market IN ('tw','us'))
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS stocks (
        code       TEXT PRIMARY KEY,
        name       TEXT NOT NULL DEFAULT '',
        industry   TEXT NOT NULL DEFAULT '',
        close      DOUBLE PRECISION,
        updated_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS tracked_stocks (
        code     TEXT PRIMARY KEY,
        status   TEXT NOT NULL DEFAULT 'watching'
                 CHECK(status IN ('holding','tracking','watching')),
        thesis   TEXT NOT NULL DEFAULT '',
        memo     TEXT NOT NULL DEFAULT '',
        added_at BIGINT NOT NULL
    )
    """,
]


class _Conn:
    """Wraps psycopg2 to expose the same conn.execute() interface as sqlite3."""

    def __init__(self, pgconn):
        self._conn = pgconn
        self._cur = pgconn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    def execute(self, sql, params=()):
        self._cur.execute(sql, params or ())
        return self._cur

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._cur.close()
        self._conn.close()


@contextlib.contextmanager
def get_db():
    pgconn = psycopg2.connect(DATABASE_URL, sslmode="require")
    conn = _Conn(pgconn)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        for stmt in DDL:
            conn.execute(stmt)
        for src in DEFAULT_SOURCES:
            conn.execute(
                "INSERT INTO sources(name) VALUES (%s) ON CONFLICT DO NOTHING",
                (src,),
            )
