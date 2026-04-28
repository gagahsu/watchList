"""
One-time migration: import existing localStorage data into the SQLite database.

Usage:
  1. Open your browser's DevTools console (F12) while on the WatchList page
  2. Run this command to export all data as JSON:

     copy(JSON.stringify({
       notes:   JSON.parse(localStorage.getItem('watchlist_v3')   || '[]'),
       signals: JSON.parse(localStorage.getItem('watchlist_signals_v2') || '{}'),
       trades:  JSON.parse(localStorage.getItem('watchlist_trades_v1')  || '{}'),
       sources: JSON.parse(localStorage.getItem('watchlist_sources')    || '[]'),
     }))

  3. Paste the copied JSON into a file called export.json in this directory
  4. Run: python migrate_localstorage.py export.json
"""

import json
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))
from database import init_db, get_db

DEFAULT_SOURCES = ["口袋證券", "股癌", "方格子", "XQ全球贏家", "理財達人秀", "其他"]


def migrate(path: str):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    init_db()

    notes   = data.get("notes",   [])
    signals = data.get("signals", {})
    trades  = data.get("trades",  {})
    sources = data.get("sources", [])

    with get_db() as conn:
        # Sources
        all_sources = list(dict.fromkeys(DEFAULT_SOURCES + sources))
        for src in all_sources:
            conn.execute("INSERT OR IGNORE INTO sources(name) VALUES (?)", (src,))

        # Notes → Rows → Entries
        for note in notes:
            conn.execute(
                "INSERT OR REPLACE INTO notes(id, title, created_at) VALUES (?,?,?)",
                (note["id"], note.get("title", ""), note.get("createdAt", 0)),
            )
            for pos, row in enumerate(note.get("rows", [])):
                conn.execute(
                    "INSERT OR REPLACE INTO rows(id, note_id, category, position) VALUES (?,?,?,?)",
                    (row["id"], note["id"], row.get("category", ""), pos),
                )
                for epos, entry in enumerate(row.get("entries", [])):
                    conn.execute(
                        "INSERT OR REPLACE INTO entries"
                        "(id, row_id, code, name, status, thesis, memo, position)"
                        " VALUES (?,?,?,?,?,?,?,?)",
                        (entry["id"], row["id"], entry.get("code",""),
                         entry.get("name",""), entry.get("status","watching"),
                         entry.get("thesis",""), entry.get("memo",""), epos),
                    )

        # Signals
        for code, sigs in signals.items():
            for sig in sigs:
                conn.execute(
                    "INSERT OR REPLACE INTO signals"
                    "(id, code, date, direction, source, condition_text, price, status, invalid_reason)"
                    " VALUES (?,?,?,?,?,?,?,?,?)",
                    (sig["id"], code, sig.get("date", 0),
                     sig.get("direction","watch"), sig.get("source",""),
                     sig.get("condition",""), sig.get("price",""),
                     sig.get("status","active"), sig.get("invalidReason","")),
                )

        # Trades
        for code, trs in trades.items():
            for t in trs:
                conn.execute(
                    "INSERT OR REPLACE INTO trades(id, code, date, type, shares, price, fee, sig_ref)"
                    " VALUES (?,?,?,?,?,?,?,?)",
                    (t["id"], code, t.get("date",""), t.get("type","buy"),
                     t.get("shares",0), t.get("price",0),
                     t.get("fee",0), t.get("sigRef","")),
                )

    notes_count   = sum(1 for _ in notes)
    entries_count = sum(len(r.get("entries",[])) for n in notes for r in n.get("rows",[]))
    sig_count     = sum(len(v) for v in signals.values())
    trade_count   = sum(len(v) for v in trades.values())

    print(f"遷移完成！")
    print(f"  筆記：{notes_count} 份")
    print(f"  個股：{entries_count} 筆")
    print(f"  訊號：{sig_count} 筆")
    print(f"  交易：{trade_count} 筆")
    print(f"  來源：{len(all_sources)} 筆")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    migrate(sys.argv[1])
