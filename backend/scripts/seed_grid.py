"""One-time import of the atrgrid pilot's 19 holdings into watchList.

Run once from `backend/`:  python scripts/seed_grid.py

Idempotent (every write is an UPSERT), so re-running after fixing a mistake
is safe.

Source data (all read manually from the standalone atrgrid repo before
writing this script — see the migration review in conversation history):

- Anchors/rungs/drift dates: trading-strategy/state/state.json (as of
  2026-08-24, after several days of live drift adjustments — this is why we
  use these instead of the older static values in portfolio.yaml).
- Asset class + grid overrides: trading-strategy/config/portfolio.yaml.
- Per-asset-class grid parameters: trading-strategy/config/settings.yaml.
- baseline_shares: NOT copied from portfolio.yaml/state.json — both are
  stale (portfolio.yaml predates several large lot purchases already in
  watchList's own `trades` table; e.g. 00878/00933B/00937B/00725B are each
  off by tens of thousands of shares). Recomputed here from watchList's own
  FIFO trade history instead, since baseline_shares isn't otherwise
  load-bearing for grid math (grid/engine.py never reads it — it's informational
  metadata only) and every position currently has rung=0 anyway (no grid
  trade has ever actually been committed), so today's real share count is a
  correct fresh baseline.
- 00735 (國泰臺韓科技) was fully sold on 2026-08-20 (per watchList's own
  `trades` table) after portfolio.yaml/state.json were last touched — seeded
  as enabled=False rather than silently dropped, so it stays visible/auditable.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import get_db, init_db
from fifo import calc_fifo
from grid.adapter import set_grid_setting

CASH_ACCOUNT_ID = "g27mw0c"  # 國泰證券

# code -> asset_class, straight from trading-strategy/config/portfolio.yaml
ASSET_CLASSES = {
    "0052": "equity", "00735": "equity", "00757": "equity", "00878": "equity",
    "00910": "equity", "00947": "equity", "00954": "equity", "00955": "equity",
    "00965": "equity", "009805": "equity", "00981A": "equity", "00988A": "equity",
    "00990A": "equity", "00997A": "equity",
    "00725B": "bond", "00933B": "bond", "00937B": "bond", "00981D": "bond",
    "00685L": "leveraged",
}

# code -> (anchor, rung, last_drift_date), from state/state.json
GRID_STATE = {
    "0052":    (60.9,     0, None),
    "00685L":  (11.44,    0, None),
    "00725B":  (33.68,    0, None),
    "00735":   (102.0,    0, None),
    "00757":   (137.45,   0, None),
    "00878":   (32.38,    0, None),
    "00910":   (63.15,    0, None),
    "00933B":  (15.53,    0, None),
    "00937B":  (14.18,    0, None),
    "00947":   (36.48,    0, None),
    "00954":   (19.14,    0, None),
    "00955":   (15.33,    0, None),
    "00965":   (26.95,    0, None),
    "009805":  (16.25,    0, None),
    "00981A":  (29.61,    0, None),
    "00981D":  (10.35,    0, None),
    "00988A":  (17.3664,  0, "2026-08-24"),
    "00990A":  (16.5456,  0, "2026-08-24"),
    "00997A":  (11.7684,  0, "2026-08-24"),
}

DISABLED = {"00735"}  # fully sold 2026-08-20

# code -> GridParams override dict, from portfolio.yaml's per-ticker `grid:` blocks
GRID_OVERRIDES = {
    "00757": {"atr_multiplier": 1.0, "max_sell_rungs": 3},
    "00981D": {"min_step_pct": 0.60},
}

# from trading-strategy/config/settings.yaml `defaults:`
GRID_PARAMS = {
    "equity": {
        "atr_period": 14, "atr_multiplier": 0.8, "min_step_pct": 1.0, "max_step_pct": 5.0,
        "max_buy_rungs": 5, "max_sell_rungs": 5, "max_rungs_per_day": 2, "gap_atr_limit": 3.0,
        "drift_mode": "up_only", "drift_beta": 0.02, "trend_ema_period": 60, "allow_loss_sell": False,
    },
    "bond": {
        "atr_period": 14, "atr_multiplier": 1.0, "min_step_pct": 0.40, "max_step_pct": 2.0,
        "max_buy_rungs": 8, "max_sell_rungs": 5, "max_rungs_per_day": 2, "gap_atr_limit": 3.0,
        "drift_mode": "up_only", "drift_beta": 0.015, "trend_ema_period": 60, "allow_loss_sell": False,
    },
    "leveraged": {
        "atr_period": 14, "atr_multiplier": 0.7, "min_step_pct": 1.8, "max_step_pct": 8.0,
        "max_buy_rungs": 2, "max_sell_rungs": 6, "max_rungs_per_day": 1, "gap_atr_limit": 3.0,
        "drift_mode": "off", "drift_beta": 0.0, "trend_ema_period": 60, "allow_loss_sell": False,
    },
    "stock": {
        "atr_period": 14, "atr_multiplier": 0.8, "min_step_pct": 1.5, "max_step_pct": 6.0,
        "max_buy_rungs": 3, "max_sell_rungs": 5, "max_rungs_per_day": 2, "gap_atr_limit": 3.0,
        "drift_mode": "up_only", "drift_beta": 0.02, "trend_ema_period": 60, "allow_loss_sell": False,
    },
}

CREATED_AT_MS = 1787529600000  # 2026-08-24T00:00:00Z


def current_shares(conn, code: str) -> int:
    rows = conn.execute(
        "SELECT id, date, type, shares, price, fee FROM trades WHERE code=%s ORDER BY date ASC", (code,)
    ).fetchall()
    result = calc_fifo([dict(r) for r in rows])
    return int(result["holdingShares"])


def main() -> None:
    init_db()  # creates grid_positions/grid_params if this is the first run since the DDL was added
    with get_db() as conn:
        for asset_class, params in GRID_PARAMS.items():
            conn.execute(
                "INSERT INTO grid_params(asset_class, params) VALUES (%s,%s)"
                " ON CONFLICT(asset_class) DO UPDATE SET params=EXCLUDED.params",
                (asset_class, __import__("json").dumps(params)),
            )

        for code, (anchor, rung, last_drift_date) in GRID_STATE.items():
            baseline = current_shares(conn, code)
            enabled = code not in DISABLED
            overrides = GRID_OVERRIDES.get(code, {})
            conn.execute(
                """
                INSERT INTO grid_positions
                    (code, enabled, anchor, rung, baseline_shares, last_drift_date,
                     applied_ex_dividends, grid_overrides, created_at, asset_class)
                VALUES (%s,%s,%s,%s,%s,%s, '[]', %s, %s, %s)
                ON CONFLICT(code) DO UPDATE SET
                    enabled=EXCLUDED.enabled, anchor=EXCLUDED.anchor, rung=EXCLUDED.rung,
                    baseline_shares=EXCLUDED.baseline_shares,
                    last_drift_date=EXCLUDED.last_drift_date,
                    grid_overrides=EXCLUDED.grid_overrides, created_at=EXCLUDED.created_at,
                    asset_class=EXCLUDED.asset_class
                """,
                (code, enabled, anchor, rung, baseline, last_drift_date,
                 __import__("json").dumps(overrides), CREATED_AT_MS, ASSET_CLASSES[code]),
            )
            print(f"{code:8s} asset_class={ASSET_CLASSES[code]:10s} enabled={enabled!s:5s} "
                  f"anchor={anchor:>10.4f} baseline_shares={baseline}")

    set_grid_setting("cash_account_id", CASH_ACCOUNT_ID)
    set_grid_setting("fee_discount", "0.28")
    set_grid_setting("fee_minimum", "1")
    set_grid_setting("cash_floor", "0")
    set_grid_setting("max_data_staleness_days", "5")
    set_grid_setting("min_step_cost_multiple", "3.0")
    set_grid_setting("decision_time", "13:00")
    set_grid_setting("timezone", "Asia/Taipei")
    print("\ngrid settings seeded (cash_account_id=國泰證券, fee_discount=0.28, fee_minimum=1)")


if __name__ == "__main__":
    main()
