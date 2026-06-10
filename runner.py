"""
Pipeline orchestrator: scrape product URL(s) -> save locally -> push to Google Sheet.

Usage:
    python runner.py --url https://tradestarexports.com/product/some-product/
    python runner.py --urls "url1,url2,url3" --output ./throws
"""

import argparse
import sys
import time
from pathlib import Path

from scraper import scrape_url
from sheets_sync import push, set_status


def _try_set_status(url: str, status: str) -> None:
    try:
        set_status(url, status)
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser(
        description="Scrape product(s) + push to Google Sheet in one step"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--url",  metavar="URL",  help="Single product URL")
    group.add_argument("--urls", metavar="URLS", help="Comma-separated product URLs")
    parser.add_argument(
        "--output", metavar="DIR", default=".",
        help="Output directory for assets/ and products.json (default: current dir)"
    )
    args = parser.parse_args()

    if args.urls:
        urls = [u.strip() for u in args.urls.split(",") if u.strip()]
    else:
        urls = [args.url.strip()]

    output_dir    = Path(args.output)
    products_file = output_dir / "products.json"
    total         = len(urls)
    failed        = []

    for idx, url in enumerate(urls, 1):
        print("=" * 55)
        print(f"[{idx}/{total}] Scraping: {url}")
        print("=" * 55)

        try:
            scrape_url(url, output_dir)
        except Exception as e:
            print(f"\n[FAIL] Scrape failed: {e}")
            _try_set_status(url, "error")
            failed.append(url)
            continue

        print(f"\n  Pushing to Google Sheet...")
        try:
            push(products_file)
            _try_set_status(url, "scraped")
            print(f"  [OK] Synced to Sheet.")
        except Exception as e:
            print(f"\n[FAIL] Sheet push failed: {e}")
            print("       products.json saved locally — run sheets_sync.py --push to retry.")
            _try_set_status(url, "error")
            failed.append(url)
            continue

        if idx < total:
            time.sleep(1.5)

    print()
    print("=" * 55)
    if not failed:
        print(f"[OK] All {total} product(s) scraped and synced.")
    else:
        print(f"[PARTIAL] {total - len(failed)}/{total} succeeded.")
        for u in failed:
            print(f"  FAILED: {u}")
        sys.exit(1)


if __name__ == "__main__":
    main()
