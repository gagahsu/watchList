"""One-time fix: move grid's asset_class out of the shared `asset_classes`
table (which belongs to the balance-sheet view's Chinese portfolio-allocation
labels) into grid_positions.asset_class, its own column. Run once from
`backend/`: python scripts/migrate_grid_asset_class.py

Idempotent: codes already migrated (asset_classes row absent) are no-ops.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import get_db, init_db


def main() -> None:
    init_db()  # ensures grid_positions.asset_class column exists
    with get_db() as conn:
        rows = conn.execute(
            "SELECT ac.code, ac.asset_class FROM asset_classes ac"
            " JOIN grid_positions gp ON gp.code = ac.code"
        ).fetchall()
        for r in rows:
            conn.execute(
                "UPDATE grid_positions SET asset_class=%s WHERE code=%s",
                (r["asset_class"], r["code"]),
            )
            print(f"{r['code']:8s} -> grid_positions.asset_class = {r['asset_class']}")
        codes = [r["code"] for r in rows]
        if codes:
            conn.execute("DELETE FROM asset_classes WHERE code = ANY(%s)", (codes,))
            print(f"\nDeleted {len(codes)} row(s) from asset_classes (now free for balance-sheet labels again)")
        else:
            print("Nothing to migrate.")


if __name__ == "__main__":
    main()
