"""
WooCommerce product scraper for tradestarexports.com.
Respects robots.txt — only scrapes allowed paths.

Folder output structure (inside --output dir):
    assets/          <- downloaded product images
    products.json    <- all scraped products, one entry per URL

Usage:
    python scraper.py --url https://tradestarexports.com/product/some-product/
    python scraper.py --url https://tradestarexports.com/product/some-product/ --output ./my_dir
"""

import sys
import time
import json
import argparse
from dataclasses import dataclass, field, asdict
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REQUEST_DELAY = 1.5      # seconds between page requests
IMAGE_DELAY   = 0.5      # seconds between image downloads

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; ShopifyImportBot/1.0; "
        "+https://github.com/your-repo)"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

# Paths blocked by robots.txt
DISALLOWED_PREFIXES = [
    "/wp-content/uploads/wc-logs/",
    "/wp-content/uploads/woocommerce_transient_files/",
    "/wp-content/uploads/woocommerce_uploads/",
    "/wp-admin/",
]
DISALLOWED_PARAMS = ["add-to-cart"]


# ---------------------------------------------------------------------------
# Data model — maps cleanly to Shopify product fields later
# ---------------------------------------------------------------------------

@dataclass
class Product:
    url: str
    title: str = ""
    sku: str = ""
    price: str = ""
    regular_price: str = ""
    sale_price: str = ""
    currency: str = "INR"
    short_description: str = ""
    full_description: str = ""
    categories: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    images: list[str] = field(default_factory=list)         # original URLs
    local_images: list[str] = field(default_factory=list)   # paths relative to output dir
    stock_status: str = ""
    weight: str = ""
    dimensions: str = ""
    attributes: dict[str, str] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Robots.txt guard
# ---------------------------------------------------------------------------

def is_allowed(url: str) -> bool:
    parsed = urlparse(url)
    for prefix in DISALLOWED_PREFIXES:
        if parsed.path.startswith(prefix):
            return False
    for param in DISALLOWED_PARAMS:
        if param in parsed.query:
            return False
    return True


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

_session = requests.Session()
_session.headers.update(HEADERS)


def fetch(url: str, *, retries: int = 3) -> BeautifulSoup:
    if not is_allowed(url):
        raise ValueError(f"Blocked by robots.txt: {url}")
    for attempt in range(1, retries + 1):
        try:
            resp = _session.get(url, timeout=15)
            resp.raise_for_status()
            resp.encoding = "utf-8"
            return BeautifulSoup(resp.text, "lxml")
        except requests.RequestException as exc:
            if attempt == retries:
                raise
            wait = attempt * 2
            print(f"  [retry {attempt}/{retries}] {exc} — waiting {wait}s")
            time.sleep(wait)


def fetch_bytes(url: str, *, retries: int = 3) -> bytes:
    for attempt in range(1, retries + 1):
        try:
            resp = _session.get(url, timeout=30)
            resp.raise_for_status()
            return resp.content
        except requests.RequestException as exc:
            if attempt == retries:
                raise
            time.sleep(attempt * 2)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def slug_from_url(url: str) -> str:
    return urlparse(url).path.strip("/").split("/")[-1]


def _text(tag) -> str:
    return tag.get_text(strip=True) if tag else ""


def _price_text(container) -> str:
    if not container:
        return ""
    bdi = container.find("bdi")
    if bdi:
        symbol = bdi.find("span", class_="woocommerce-Price-currencySymbol")
        if symbol:
            symbol.extract()
        return bdi.get_text(strip=True)
    return _text(container)


# ---------------------------------------------------------------------------
# Product page parser
# ---------------------------------------------------------------------------

def parse_product(url: str) -> Product:
    soup = fetch(url)
    product = Product(url=url)

    # Title
    product.title = _text(soup.find("h1", class_="product_title"))

    # SKU
    product.sku = _text(soup.find("span", class_="sku"))

    # Price
    price_wrap = soup.find("p", class_="price")
    if price_wrap:
        del_tag = price_wrap.find("del")
        ins_tag = price_wrap.find("ins")
        if del_tag and ins_tag:
            product.regular_price = _price_text(del_tag)
            product.sale_price    = _price_text(ins_tag)
            product.price         = product.sale_price
        else:
            product.price         = _price_text(price_wrap)
            product.regular_price = product.price
        symbol = price_wrap.find("span", class_="woocommerce-Price-currencySymbol")
        if symbol:
            product.currency = _text(symbol)

    # Short description
    short = soup.find("div", class_="woocommerce-product-details__short-description")
    product.short_description = short.get_text(separator="\n", strip=True) if short else ""

    # Full description
    full = soup.find("div", id="tab-description")
    product.full_description = full.get_text(separator="\n", strip=True) if full else ""

    # Categories & tags
    posted_in = soup.find("span", class_="posted_in")
    if posted_in:
        product.categories = [a.get_text(strip=True) for a in posted_in.find_all("a")]

    tagged_as = soup.find("span", class_="tagged_as")
    if tagged_as:
        product.tags = [a.get_text(strip=True) for a in tagged_as.find_all("a")]

    # Images — prefer data-large_image for full resolution
    gallery = soup.find("div", class_="woocommerce-product-gallery")
    if gallery:
        seen = set()
        for wrap in gallery.find_all("div", class_="woocommerce-product-gallery__image"):
            a_tag = wrap.find("a")
            src = (a_tag.get("href") if a_tag else None) or ""
            if not src:
                img = wrap.find("img")
                src = (img.get("data-large_image") or img.get("src", "")) if img else ""
            if src and src not in seen:
                seen.add(src)
                product.images.append(src)

    # Stock status
    stock = soup.find("p", class_="stock")
    product.stock_status = _text(stock)

    # Attributes table (weight, dimensions, material, etc.)
    attr_table = soup.find("table", class_="woocommerce-product-attributes")
    if attr_table:
        for row in attr_table.find_all("tr"):
            label = row.find("th")
            value = row.find("td")
            if label and value:
                key = _text(label).lower().rstrip(":")
                val = _text(value)
                if key == "weight":
                    product.weight = val
                elif key in ("dimensions", "dimension"):
                    product.dimensions = val
                else:
                    product.attributes[key] = val

    return product


# ---------------------------------------------------------------------------
# Image downloader
# ---------------------------------------------------------------------------

def download_images(product: Product, assets_dir: Path) -> None:
    """Download all images for a product into assets_dir.
    Populates product.local_images with relative paths (assets/<filename>).
    Skips files that already exist.
    """
    assets_dir.mkdir(parents=True, exist_ok=True)
    slug = slug_from_url(product.url)

    for idx, img_url in enumerate(product.images):
        ext = img_url.rsplit(".", 1)[-1].split("?")[0].lower()
        if ext not in ("jpg", "jpeg", "png", "webp", "gif"):
            ext = "jpg"
        filename = f"{slug}_{idx}.{ext}"
        filepath = assets_dir / filename

        if filepath.exists():
            print(f"    [skip] {filename} already downloaded")
        else:
            try:
                data = fetch_bytes(img_url)
                filepath.write_bytes(data)
                print(f"    [img]  {filename}")
                time.sleep(IMAGE_DELAY)
            except Exception as exc:
                print(f"    [img-err] {filename}: {exc}")
                filename = ""

        if filename:
            product.local_images.append(f"assets/{filename}")


# ---------------------------------------------------------------------------
# Single-URL scrape + save
# ---------------------------------------------------------------------------

def scrape_url(url: str, output_dir: Path) -> None:
    assets_dir = output_dir / "assets"
    json_path  = output_dir / "products.json"

    output_dir.mkdir(parents=True, exist_ok=True)

    # Load existing products (keyed by URL) so re-running the same URL updates in place
    existing: dict[str, dict] = {}
    if json_path.exists():
        try:
            loaded = json.loads(json_path.read_text(encoding="utf-8"))
            existing = {p["url"]: p for p in loaded}
        except Exception:
            pass

    if url in existing:
        print(f"Already scraped — refreshing: {url}")

    print(f"Fetching: {url}")
    product = parse_product(url)
    download_images(product, assets_dir)

    existing[url] = asdict(product)

    json_path.write_text(
        json.dumps(list(existing.values()), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"\nTitle  : {product.title}")
    print(f"SKU    : {product.sku}")
    print(f"Images : {len(product.local_images)} downloaded")
    print(f"Saved  -> {json_path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Scrape a WooCommerce product page from tradestarexports.com"
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
    scrape_url(args.url, Path(args.output))


if __name__ == "__main__":
    main()
