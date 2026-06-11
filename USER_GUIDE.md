# Heimora Product Import — User Guide

> **Who this is for:** Anyone adding products to the Heimora Shopify store.
> No coding required. Everything runs from a Google Sheet.

---

## What This Tool Does

You paste a product URL from the supplier website into the Google Sheet.
The tool automatically fills in all product details (title, description, images, weight, etc.).
You set the price, then push the product to Shopify — all without leaving the Sheet.

```
Paste URL  →  Click Scrape  →  Review  →  Set Price  →  Push to Shopify
```

---

## Before You Start

You need:
- Access to the **Heimora Google Sheet** (ask the admin to share it)
- Credentials set up (one-time — see [First-Time Setup](#first-time-setup))

---

## The Google Sheet — Column Reference

| Column | Name | Who fills it | What it is |
|--------|------|-------------|------------|
| A | URL | You | Supplier product URL |
| B | Title | Auto | Product name |
| C | SKU | Auto | Product code |
| D | Categories | Auto | Product category |
| E | Tags | Auto | Search tags |
| F | Short Description | Auto | Key specs (Type, Material, etc.) |
| G | Full Description | Auto | Full product narrative |
| H | Stock Status | Auto | In stock / Out of stock |
| I | Weight | Auto | Shipping weight |
| J | Dimensions | Auto | Product dimensions |
| K | Attributes | Auto | Other product attributes |
| L | Images | Auto | Image URLs |
| M | Local Images | Auto | Downloaded image paths |
| N | Shopify ID | Auto | Set after push to Shopify |
| O | Notes | You | Any manual notes |
| P | **Price** | **You** | Selling price (required before push) |
| Q | Quantity | You | Stock quantity (optional) |
| R | Variant ID | Auto | Set after push to Shopify |
| S | Status | Auto | pending / pushed / error |
| T | Shopify Status | You | `draft` or `active` (default: draft) |

> **Columns you touch:** A (URL), O (notes), P (price), Q (quantity), T (shopify_status)
> Everything else is filled automatically.

---

## Step-by-Step: Add a Product

### Step 1 — Paste the URL

1. Open the Google Sheet
2. Click an empty row in **Column A**
3. Paste the product URL from the supplier site
   - URL must start with: `https://tradestarexports.com/product/`

### Step 2 — Scrape the Product

1. Click the cell in Column A where you pasted the URL
2. In the top menu, click **Shopify → Scrape active row**
3. A confirmation message appears: *"Scrape triggered!"*
4. Wait **1–2 minutes**
5. The row fills automatically with title, description, images, weight, etc.
6. Column S (status) changes to `pushed` when done

> If nothing fills after 3 minutes, check Column O (Notes) for an error message.

### Step 3 — Review and Set Price

1. Check Column B (title) — make sure it looks correct
2. Check Column F/G (descriptions) — review the content
3. **Set price in Column P** — required. Example: `499`
4. Optionally set quantity in Column Q. Example: `50`
5. Optionally set Column T to `active` if you want it live immediately (default is `draft`)

### Step 4 — Push to Shopify

1. Click any cell in the product row
2. Click **Shopify → Push active row → Shopify**
3. A success message shows the Shopify Product ID
4. Column N (Shopify ID) fills automatically
5. Column S (status) changes to `pushed`

The product appears in your Shopify admin as a **draft** (unless you set Column T to `active`).

---

## Bulk Operations

### Scrape All Empty Rows

If you have pasted many URLs and want to scrape them all at once:

1. Click **Shopify → Scrape all empty rows**
2. Confirm the number of rows in the popup
3. All rows with a URL but no title will be scraped
4. Wait based on the estimated time shown

### Push All Unpushed Products

To push all rows that have a title but no Shopify ID:

1. Set prices in Column P for all rows you want to push
2. Click **Shopify → Push all unpushed**
3. Confirm the popup
4. Products push one by one — a summary shows at the end

---

## Update Price or Quantity on an Existing Product

For a product already pushed to Shopify:

1. Change the value in Column P (price) and/or Column Q (quantity)
2. Click any cell in that row
3. Click **Shopify → Update price / quantity**
4. Shopify updates immediately

> This only works if Column N (Shopify ID) is already filled.

---

## Status Reference

Column S (status) tells you where each row stands:

| Status | Meaning |
|--------|---------|
| *(empty)* | Not yet scraped |
| `pending` | Scrape triggered, waiting for result |
| `pushed` | Successfully on Shopify |
| `error` | Something went wrong — check Column O for details |

---

## First-Time Setup

> Do this once. Ask your admin if credentials are already set.

1. Open the Google Sheet
2. Click **Shopify → Set credentials**
3. Enter the following one by one when prompted:
   - **Shopify Client ID** — from the Shopify app settings
   - **Shopify Client Secret** — from the Shopify app settings
   - **Shopify Store Domain** — `8ctj86-ft.myshopify.com`
   - **GitHub PAT** — provided by your admin
4. Click OK after each entry

Credentials are saved securely in the Sheet's script settings. You do not need to re-enter them unless they change.

> The Shopify access token is fetched and refreshed automatically every 24 hours — no action needed from you.

---

## Troubleshooting

| Problem | What to check |
|---------|--------------|
| Row not filling after scrape | Wait 2–3 min. Check Col O for error. Try scraping again. |
| "Missing GitHub PAT" alert | Run **Shopify → Set credentials** again |
| "Missing Shopify credentials" alert | Run **Shopify → Set credentials** again |
| "Token refresh failed" alert | Client ID or Secret is wrong — re-run Set credentials |
| Push fails with error in Col O | Check Col O message. Common: missing price in Col P |
| "Could not fetch locations" | Shopify app scopes missing. Contact admin. |
| Product created but wrong status | Set Col T to `active` before pushing |

---

## Tips

- You can add notes in **Column O** — the script never overwrites it
- Products are created as **drafts** by default — safe to push and review in Shopify before publishing
- Do not edit Columns N or R — these are Shopify IDs managed automatically
- If a product was already pushed and you edit the row and push again, it **updates** the existing Shopify product (does not create a duplicate)
