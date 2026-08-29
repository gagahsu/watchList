"""One-time: point the ATR grid's US cash check at the Firstrade account.

The grid engine keeps the US cash pool (`Settings.us_cash`, see
grid/adapter.py::build_settings) completely separate from the TW one, but it
still needs a `grid_us_cash_account_id` setting telling it *which* row in
`accounts` holds that USD balance — same mechanism as the existing
`grid_cash_account_id` (see scripts/seed_grid.py). Without it, US buy
decisions were never checked against real cash at all.

Run once from `backend/`:  python scripts/set_us_cash_account.py
Idempotent (UPSERT), safe to re-run.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import get_db
from grid.adapter import set_grid_setting

ACCOUNT_NAME = "Firstrade"


def main() -> None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, balance FROM accounts WHERE name=%s", (ACCOUNT_NAME,)
        ).fetchone()
    if row is None:
        print(f"找不到帳戶「{ACCOUNT_NAME}」，請確認帳戶管理裡的名稱完全一致。")
        sys.exit(1)

    set_grid_setting("us_cash_account_id", row["id"])
    print(f"已將 grid_us_cash_account_id 設為「{ACCOUNT_NAME}」（id={row['id']}，目前餘額 ${row['balance']:,.2f}）")


if __name__ == "__main__":
    main()
