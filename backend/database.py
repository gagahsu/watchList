import psycopg2
import psycopg2.extras
import contextlib
import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"), override=True)

DATABASE_URL = os.environ.get("DATABASE_URL", "")

DEFAULT_SOURCES = ["口袋證券", "股癌", "方格子", "XQ全球贏家", "理財達人秀", "其他"]

DDL = [
    """
    CREATE TABLE IF NOT EXISTS accounts (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        balance       DOUBLE PRECISION NOT NULL DEFAULT 0,
        interest_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
        note          TEXT NOT NULL DEFAULT ''
    )
    """,
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
        status   TEXT NOT NULL DEFAULT 'tracking'
                 CHECK(status IN ('holding','tracking','locked')),
        thesis   TEXT NOT NULL DEFAULT '',
        memo     TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0
    )
    """,
    # migration: widen entries status CHECK to include 'locked'
    """
    DO $$ BEGIN
      ALTER TABLE entries DROP CONSTRAINT IF EXISTS entries_status_check;
      ALTER TABLE entries ADD CONSTRAINT entries_status_check
        CHECK(status IN ('holding','tracking','locked'));
    EXCEPTION WHEN OTHERS THEN NULL; END $$
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
        id         TEXT PRIMARY KEY,
        code       TEXT NOT NULL,
        date       TEXT NOT NULL,
        type       TEXT NOT NULL CHECK(type IN ('buy','sell')),
        shares     DOUBLE PRECISION NOT NULL,
        price      DOUBLE PRECISION NOT NULL,
        fee        DOUBLE PRECISION NOT NULL DEFAULT 0,
        sig_ref    TEXT NOT NULL DEFAULT '',
        note       TEXT NOT NULL DEFAULT '',
        account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL
    )
    """,
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL",
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
    CREATE TABLE IF NOT EXISTS brokers (
        id       TEXT PRIMARY KEY,
        name     TEXT NOT NULL,
        discount DOUBLE PRECISION NOT NULL DEFAULT 0.6,
        min_fee  INTEGER NOT NULL DEFAULT 20,
        rounding TEXT NOT NULL DEFAULT 'floor'
                 CHECK(rounding IN ('floor','round','ceil'))
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
        status   TEXT NOT NULL DEFAULT 'tracking'
                 CHECK(status IN ('holding','tracking','locked')),
        thesis      TEXT NOT NULL DEFAULT '',
        memo        TEXT NOT NULL DEFAULT '',
        stop_loss   TEXT NOT NULL DEFAULT '',
        take_profit TEXT NOT NULL DEFAULT '',
        added_at    BIGINT NOT NULL
    )
    """,
    # migration: widen the status CHECK to include 'locked'
    """
    DO $$ BEGIN
      ALTER TABLE tracked_stocks DROP CONSTRAINT IF EXISTS tracked_stocks_status_check;
      ALTER TABLE tracked_stocks ADD CONSTRAINT tracked_stocks_status_check
        CHECK(status IN ('holding','tracking','locked'));
    EXCEPTION WHEN OTHERS THEN NULL; END $$
    """,
    """
    CREATE TABLE IF NOT EXISTS liabilities (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL,
        type             TEXT NOT NULL DEFAULT '其他',
        amount           DOUBLE PRECISION NOT NULL DEFAULT 0,
        reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        reminder_day     INTEGER,
        note             TEXT NOT NULL DEFAULT ''
    )
    """,
    # migrate: replace reminder_date (TEXT) with reminder_day (INTEGER)
    "ALTER TABLE liabilities ADD COLUMN IF NOT EXISTS reminder_day INTEGER",
    "ALTER TABLE liabilities DROP COLUMN IF EXISTS reminder_date",
    # replace chip_cache blob with structured tables
    "DROP TABLE IF EXISTS chip_cache",
    """
    CREATE TABLE IF NOT EXISTS institutional_daily (
        code             TEXT    NOT NULL,
        date             TEXT    NOT NULL,
        foreign_net      INTEGER NOT NULL DEFAULT 0,
        trust_net        INTEGER NOT NULL DEFAULT 0,
        dealer_net       INTEGER NOT NULL DEFAULT 0,
        dealer_hedge_net INTEGER NOT NULL DEFAULT 0,
        total_net        INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (code, date)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS margin_daily (
        code           TEXT             NOT NULL,
        date           TEXT             NOT NULL,
        margin_balance INTEGER          NOT NULL DEFAULT 0,
        margin_usage   DOUBLE PRECISION NOT NULL DEFAULT 0,
        short_balance  INTEGER          NOT NULL DEFAULT 0,
        short_ratio    DOUBLE PRECISION NOT NULL DEFAULT 0,
        PRIMARY KEY (code, date)
    )
    """,
    # migrate: add loan detail columns
    "ALTER TABLE liabilities ADD COLUMN IF NOT EXISTS total_amount DOUBLE PRECISION",
    "ALTER TABLE liabilities ADD COLUMN IF NOT EXISTS periods INTEGER",
    "ALTER TABLE liabilities ADD COLUMN IF NOT EXISTS paid_periods INTEGER",
    "ALTER TABLE liabilities ADD COLUMN IF NOT EXISTS interest_rate DOUBLE PRECISION",
    "ALTER TABLE liabilities ADD COLUMN IF NOT EXISTS monthly_payment DOUBLE PRECISION",
    """
    CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS account_transactions (
        id            TEXT PRIMARY KEY,
        date          TEXT NOT NULL,
        type          TEXT NOT NULL CHECK(type IN ('deposit','withdrawal','transfer')),
        amount        DOUBLE PRECISION NOT NULL,
        account_id    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        to_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        note          TEXT NOT NULL DEFAULT ''
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_acctxn_account ON account_transactions(account_id)",
]


class _Conn:
    """Wraps psycopg2 to expose the same conn.execute() interface as sqlite3."""

    def __init__(self, pgconn):
        self._conn = pgconn
        self._cur = pgconn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    def execute(self, sql, params=()):
        self._cur.execute(sql, params or ())
        return self._cur

    def execute_values(self, sql, values, page_size=500):
        psycopg2.extras.execute_values(self._cur, sql, values, page_size=page_size)

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


def get_setting(key: str) -> str | None:
    with get_db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=%s", (key,)).fetchone()
    return row["value"] if row else None


def set_setting(key: str, value: str):
    with get_db() as conn:
        conn.execute(
            "INSERT INTO settings(key,value) VALUES(%s,%s) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
            (key, value),
        )


def init_db():
    with get_db() as conn:
        for stmt in DDL:
            conn.execute(stmt)
        for src in DEFAULT_SOURCES:
            conn.execute(
                "INSERT INTO sources(name) VALUES (%s) ON CONFLICT DO NOTHING",
                (src,),
            )
