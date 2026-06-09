"""
Pipeline orchestrator: scrape product URL -> save locally -> push to Google Sheet.

Usage:
    python runner.py --url https://tradestarexports.com/product/some-product/
    python runner.py --url <URL> --output ./throws
"""

import argparse
import sys
import time
from pathlib import Path

from scraper import scrape_url
from sheets_sync import push


def main():
    parser = argparse.ArgumentParser(
        description="Scrape product + push to Google Sheet in one step"
    )
    parser.add_argument(
        "--url", metavar="URL", required=True,
        help="Product URL to scrape"
    )
    parser.add_argument(
        "--output", metavar="DIR", default=".",
        help="Output directory for assets/ and products.json (default: current dir)"
    )
    args = parser.parse_args()

    output_dir   = Path(args.output)
    products_file = output_dir / "products.json"

    # ---- Step 1: Scrape ----
    print("=" * 50)
    print(f"[1/2] Scraping: {args.url}")
    print("=" * 50)
    try:
        scrape_url(args.url, output_dir)
    except Exception as e:
        print(f"\n[FAIL] Scrape failed: {e}")
        sys.exit(1)

    # ---- Step 2: Push to Sheet ----
    print()
    print("=" * 50)
    print(f"[2/2] Pushing to Google Sheet...")
    print("=" * 50)
    try:
        push(products_file)
    except Exception as e:
        print(f"\n[FAIL] Sheet push failed: {e}")
        print("       products.json saved locally — run sheets_sync.py --push to retry.")
        sys.exit(1)

    print()
    print("[OK] Done. Product scraped and synced to Sheet.")


if __name__ == "__main__":
    main()
