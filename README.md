# Heimora Product Import Pipeline

Scrape products from [tradestarexports.com](https://tradestarexports.com) → stage in Google Sheet → push to Shopify ([heimora.co.in](https://heimora.co.in)).

```
tradestarexports.com
        │
        │  scraper.py (via GitHub Actions)
        ▼
  products.json  ──→  Google Sheet  (sheets_sync.py)
                            │
                            │  apps_script.js (Apps Script menu)
                            ▼
                     Shopify Admin API
                     (heimora.co.in)
```

---

## Repository Structure

```
.
├── scraper.py            # WooCommerce product scraper
├── sheets_sync.py        # Google Sheet ↔ products.json sync
├── runner.py             # Orchestrator: scrape → push to Sheet
├── apps_script.js        # Google Apps Script (paste into Sheet manually)
├── requirements.txt      # Python dependencies
├── robots.txt            # tradestarexports.com robots rules (reference)
├── .github/
│   └── workflows/
│       └── scrape.yml    # GitHub Actions: manual workflow_dispatch
├── USER_GUIDE.md         # Non-technical user guide
└── README.md             # This file
```

---

## Architecture

| Component | Role |
|-----------|------|
| `scraper.py` | Fetches product page, parses HTML (BeautifulSoup + lxml), saves to `products.json` |
| `sheets_sync.py` | Reads `products.json`, writes rows A–M to Google Sheet. Pull direction reads Sheet back to JSON. |
| `runner.py` | Called by GitHub Actions. Runs `scrape_url()` then `push()`. On scrape fail: exits. On Sheet fail: local JSON preserved. |
| `apps_script.js` | Runs inside Google Sheet. Triggers GitHub Actions workflow via API. Pushes rows to Shopify Admin API. Handles token refresh. |
| GitHub Actions | Cloud compute for scraping. Free tier (2000 min/month). Triggered manually via Apps Script. |
| Google Sheet | Human control center. Columns A–M auto-filled. P/Q/T user-managed. |
| Shopify Admin API | Product create/update via REST. Version `2026-04`. |

---

## Setup

### 1. GitHub Repository

1. Fork or clone this repo
2. Go to **Settings → Secrets and variables → Actions**
3. Add secret: `SERVICE_ACCOUNT_JSON` — full contents of your Google service account JSON file

The workflow file is `.github/workflows/scrape.yml`. It accepts one input: `urls` (product URL).

### 2. Google Service Account

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → Enable **Google Sheets API**
3. Create a **Service Account** → download JSON key
4. Share the Google Sheet with the service account email (Editor access)
5. Paste the full JSON content into the GitHub secret `SERVICE_ACCOUNT_JSON`

### 3. Google Apps Script

1. Open the Google Sheet
2. Click **Extensions → Apps Script**
3. Delete any existing code
4. Paste the full contents of `apps_script.js`
5. Save (Ctrl+S) and reload the Sheet
6. A **Shopify** menu appears in the top bar

> `apps_script.js` in this repo is the source of truth. When it changes, paste the updated version into Apps Script manually.

### 4. Shopify App Credentials

Create a custom app in Shopify with the following scopes:

| Scope | Required for |
|-------|-------------|
| `write_products` | Create and update products |
| `read_products` | Fetch product/variant data |
| `write_inventory` | Set stock levels |
| `read_inventory` | Read inventory item IDs |
| `read_locations` | Fetch location ID for inventory |

Then in the Google Sheet: **Shopify → Set credentials** and enter Client ID + Client Secret.

The Apps Script stores `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` in Script Properties.
`SHOPIFY_TOKEN` is fetched automatically via the `client_credentials` OAuth flow and cached for 23 hours (refreshed 5 min before expiry).

### 5. Script Properties Reference

Set via **Shopify → Set credentials** in the Sheet:

| Property | Value |
|----------|-------|
| `SHOPIFY_CLIENT_ID` | App client ID from Shopify Partner dashboard |
| `SHOPIFY_CLIENT_SECRET` | App client secret |
| `SHOPIFY_STORE` | `8ctj86-ft.myshopify.com` |
| `GITHUB_PAT` | GitHub Personal Access Token (scopes: `repo` + `workflow`) |
| `SHOPIFY_TOKEN` | Auto-managed. Do not set manually. |
| `SHOPIFY_TOKEN_EXPIRY` | Auto-managed. Do not set manually. |

---

## Google Sheet Column Reference

| Col | Field | Owner | Notes |
|-----|-------|-------|-------|
| A | url | User | Must start with `https://tradestarexports.com/product/` |
| B | title | Scraper | |
| C | sku | Scraper | |
| D | categories | Scraper | Pipe-separated. First value → Shopify `product_type` |
| E | tags | Scraper | Pipe-separated → comma-joined for Shopify |
| F | short_description | Scraper | Key-value spec text |
| G | full_description | Scraper | Full narrative |
| H | stock_status | Scraper | |
| I | weight | Scraper | Parsed to value + unit (g/kg/lb/oz) |
| J | dimensions | Scraper | |
| K | attributes | Scraper | |
| L | images | Scraper | Pipe-separated URLs |
| M | local_images | Scraper | Pipe-separated local paths |
| N | shopify_id | Apps Script | Written on product create |
| O | notes | User | Never overwritten by script |
| P | price | User | Required before push. Default: `0.00` |
| Q | quantity | User | Optional. Sets inventory level if present. |
| R | variant_id | Apps Script | Written on product create |
| S | status | Scraper / Script | `pending` / `pushed` / `error` |
| T | shopify_status | User | `draft` (default) or `active` |

---

## Shopify API Field Mapping

| Sheet column | Shopify field |
|---|---|
| B — title | `product.title` |
| F+G — descriptions | `product.body_html` (formatted HTML, see below) |
| C — sku | `variants[0].sku` |
| E — tags | `product.tags` (pipe → comma) |
| D — categories[0] | `product.product_type` |
| L — images | `product.images[].src` |
| I — weight | `variants[0].weight` + `weight_unit` |
| P — price | `variants[0].price` |
| T — shopify_status | `product.status` |
| N — shopify_id | written back from `product.id` |
| R — variant_id | written back from `variants[0].id` |

### Description Formatting

`short_description` is parsed into HTML key-value pairs:

```
"Material\n:\n100% Cotton\nUsage :\nHome décor"
```
→
```html
<p><strong>Material</strong>: 100% Cotton</p>
<p><strong>Usage</strong>: Home décor</p>
```

Full description paragraphs are appended below, separated by `<br>`.

---

## GitHub Actions Workflow

**File:** `.github/workflows/scrape.yml`
**Trigger:** Manual (`workflow_dispatch`) via Apps Script

**Inputs:**
- `urls` — product URL(s), comma-separated
- `output_dir` — output directory (default: `.`)

**Steps:**
1. Checkout repo
2. Set up Python 3.11
3. `pip install -r requirements.txt`
4. Write `service_account.json` from `SERVICE_ACCOUNT_JSON` secret
5. Run `python runner.py --url <url> --output <output_dir>`

Apps Script calls the workflow via:
```
POST https://api.github.com/repos/{owner}/{repo}/actions/workflows/scrape.yml/dispatches
Authorization: Bearer <GITHUB_PAT>
```

---

## Python Dependencies

```
requests==2.34.2
beautifulsoup4==4.14.3
lxml==6.1.1
gspread>=6.0.0
```

Install:
```bash
pip install -r requirements.txt
```

---

## Scraper Behavior

- Single URL per run (by design — user manually selects products)
- Respects `robots.txt` — disallowed paths checked before fetch
- User-Agent: Chrome/125 browser headers (avoids Cloudflare blocks)
- Request delay: 1.5s between pages, 0.5s between images
- Price fields intentionally empty (B2B login-gated on supplier site)
- `products.json` keyed by URL — reruns update existing entries

---

## Known Issues / Decisions

| Item | Decision |
|------|----------|
| Supplier site behind Cloudflare | Chrome UA headers used. If 403 returns, GitHub Actions IPs may be blocked — run scraper locally instead. |
| Price not scraped | Supplier site is B2B login-gated. Set price manually in Col P. |
| Bulk scraping | Intentionally not supported. Products are manually curated. |
| Products created as draft | Default. Set Col T to `active` to publish immediately. |
| Shopify token refresh | `client_credentials` OAuth flow. 24h expiry. Auto-refreshed by `_getShopifyToken()`. |
| Required Shopify scopes | `write_products`, `read_products`, `write_inventory`, `read_inventory`, `read_locations`. Missing scopes → 403 on locations endpoint. |

---

## Local Development

```bash
# Create virtualenv
python -m venv .scraper-venv
source .scraper-venv/bin/activate  # Windows: .scraper-venv\Scripts\activate

# Install deps
pip install -r requirements.txt

# Scrape a single URL
python runner.py --url "https://tradestarexports.com/product/example" --output .

# Push existing products.json to Sheet only
python sheets_sync.py push

# Pull Sheet back to products.json
python sheets_sync.py pull
```

Requires `service_account.json` in root for Sheet access.

---

## API Version

Shopify Admin REST API: **`2026-04`**
Defined in `apps_script.js` as `const API_VERSION = "2026-04"`.
