"""
Sync products.json <-> Google Sheet.

Sheet columns (A-M = scraper-owned, N-O = user-owned, never overwritten on push):
    url | title | sku | categories | tags | short_description | full_description |
    stock_status | weight | dimensions | attributes | images | local_images |
    shopify_id | notes

Usage:
    python sheets_sync.py --push                          # products.json -> Sheet
    python sheets_sync.py --pull                          # Sheet -> products.json
    python sheets_sync.py --push --file ./throws/products.json   # custom file
    python sheets_sync.py --pull --file ./throws/products.json
"""

import json
import argparse
from pathlib import Path

import gspread

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SHEET_ID   = "1m1wTt1BGPdmhtFXrgyE1Kw1hJVesDiL6POGnmi7lQ_I"
CREDS_FILE = "service_account.json"

# Columns owned by the scraper — always overwritten on push
SCRAPER_COLS = [
    "url", "title", "sku", "categories", "tags",
    "short_description", "full_description", "stock_status",
    "weight", "dimensions", "attributes", "images", "local_images",
]

# Columns owned by the user — never touched on push
USER_COLS = ["shopify_id", "notes"]

ALL_COLS = SCRAPER_COLS + USER_COLS   # A through O

# Columns A-M are scraper-owned (1-indexed: 1-13)
SCRAPER_RANGE_END = chr(ord("A") + len(SCRAPER_COLS) - 1)   # "M"


# ---------------------------------------------------------------------------
# Serialise / deserialise helpers
# ---------------------------------------------------------------------------

def _pack(value) -> str:
    """Python value -> sheet cell string."""
    if isinstance(value, list):
        return " | ".join(str(v) for v in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return str(value) if value is not None else ""


def _unpack_list(cell: str) -> list[str]:
    if not cell.strip():
        return []
    return [v.strip() for v in cell.split("|")]


def _unpack_dict(cell: str) -> dict:
    if not cell.strip():
        return {}
    try:
        return json.loads(cell)
    except json.JSONDecodeError:
        return {}


def product_to_row(p: dict) -> list[str]:
    """Return a list of cell values in SCRAPER_COLS order."""
    return [_pack(p.get(col, "")) for col in SCRAPER_COLS]


def row_to_product(row: list[str]) -> dict:
    """Parse a full sheet row (ALL_COLS) back into a product dict."""
    # Pad short rows
    row = list(row) + [""] * (len(ALL_COLS) - len(row))
    p = {col: row[i] for i, col in enumerate(ALL_COLS)}

    # Deserialise multi-value fields
    for col in ("categories", "tags", "images", "local_images"):
        p[col] = _unpack_list(p[col])
    p["attributes"] = _unpack_dict(p["attributes"])

    return p


# ---------------------------------------------------------------------------
# Sheet connection
# ---------------------------------------------------------------------------

def open_worksheet() -> gspread.Worksheet:
    gc = gspread.service_account(filename=CREDS_FILE)
    return gc.open_by_key(SHEET_ID).sheet1


def ensure_headers(ws: gspread.Worksheet) -> dict[str, int]:
    """Write headers if missing. Returns {url: row_number} for existing data rows."""
    existing = ws.get_all_values()

    # Prefix check — sheet may have extra cols (price/quantity/variant_id) beyond ALL_COLS
    if not existing or existing[0][:len(ALL_COLS)] != ALL_COLS:
        ws.update("A1", [ALL_COLS])   # only writes A1:O1, leaves P:R untouched
        return {}   # treat as fresh — no data rows

    # Build url -> 1-based row number map (row 1 = header, data starts at 2)
    url_col_idx = ALL_COLS.index("url")
    return {
        row[url_col_idx]: row_num
        for row_num, row in enumerate(existing[1:], start=2)
        if row and len(row) > url_col_idx and row[url_col_idx]
    }


# ---------------------------------------------------------------------------
# Push: products.json -> Sheet
# ---------------------------------------------------------------------------

def push(products_file: Path) -> None:
    if not products_file.exists():
        print(f"File not found: {products_file}")
        return

    products: list[dict] = json.loads(products_file.read_text(encoding="utf-8"))
    if not products:
        print("products.json is empty — nothing to push.")
        return

    print(f"Connecting to sheet...")
    ws = open_worksheet()
    url_to_row = ensure_headers(ws)

    updates: list[dict] = []
    new_rows: list[list[str]] = []

    for p in products:
        url = p.get("url", "")
        if not url:
            continue

        scraper_values = product_to_row(p)

        if url in url_to_row:
            row_num = url_to_row[url]
            updates.append({
                "range": f"A{row_num}:{SCRAPER_RANGE_END}{row_num}",
                "values": [scraper_values],
            })
        else:
            # New row: scraper cols + empty shopify_id + empty notes
            new_rows.append(scraper_values + ["", ""])

    updated = 0
    if updates:
        ws.batch_update(updates, value_input_option="RAW")
        updated = len(updates)

    appended = 0
    if new_rows:
        ws.append_rows(new_rows, value_input_option="RAW")
        appended = len(new_rows)

    print(f"Push complete: {updated} updated, {appended} new rows added.")


# ---------------------------------------------------------------------------
# Pull: Sheet -> products.json
# ---------------------------------------------------------------------------

def pull(products_file: Path) -> None:
    print("Connecting to sheet...")
    ws = open_worksheet()
    all_values = ws.get_all_values()

    if not all_values or all_values[0] != ALL_COLS:
        print("Sheet has no data or wrong headers — nothing to pull.")
        return

    rows = all_values[1:]   # skip header
    pulled: list[dict] = [row_to_product(row) for row in rows if any(row)]

    if not pulled:
        print("Sheet has no data rows.")
        return

    # Merge: pulled rows take precedence; preserve any local-only fields
    existing: dict[str, dict] = {}
    if products_file.exists():
        try:
            loaded = json.loads(products_file.read_text(encoding="utf-8"))
            existing = {p["url"]: p for p in loaded}
        except Exception:
            pass

    merged: list[dict] = []
    for p in pulled:
        url = p["url"]
        if url in existing:
            base = existing[url].copy()
            base.update(p)          # sheet values win
            merged.append(base)
        else:
            merged.append(p)

    products_file.parent.mkdir(parents=True, exist_ok=True)
    products_file.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Pull complete: {len(merged)} products written to {products_file}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Sync products.json with Google Sheets"
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--push", action="store_true", help="Push products.json -> Sheet")
    mode.add_argument("--pull", action="store_true", help="Pull Sheet -> products.json")

    parser.add_argument(
        "--file", metavar="PATH", default="products.json",
        help="Path to products.json (default: ./products.json)"
    )

    args = parser.parse_args()
    products_file = Path(args.file)

    if args.push:
        push(products_file)
    else:
        pull(products_file)


if __name__ == "__main__":
    main()


# ---------------------------------------------------------------------------
# Status helper — writes scrape/error state to col S (STATUS_COL)
# Matches COL.STATUS = 19 in apps_script.js
# ---------------------------------------------------------------------------

STATUS_COL = 19


def set_status(url: str, status: str) -> None:
    """Write status to STATUS_COL for the row matching url. No-op if URL not found."""
    ws    = open_worksheet()
    col_a = ws.col_values(1)   # 0-indexed; index 0 = row 1 (header)
    try:
        row_num = col_a.index(url) + 1
    except ValueError:
        return
    if row_num <= 1:
        return
    ws.update_cell(row_num, STATUS_COL, status)
