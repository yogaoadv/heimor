// ============================================================
// Google Apps Script — Shopify Control Center
// Paste this into: Google Sheet -> Extensions -> Apps Script
//
// SETUP: Project Settings -> Script Properties -> Add:
//   SHOPIFY_TOKEN  =  shpat_xxxxxxxxxxxx
//   SHOPIFY_STORE  =  8ctj86-ft.myshopify.com
//   GITHUB_PAT     =  github_pat_xxxxxxxxxxxx  (needs: repo + workflow scope)
//
// Sheet columns:
//   A  url              B  title           C  sku
//   D  categories       E  tags            F  short_description
//   G  full_description H  stock_status    I  weight
//   J  dimensions       K  attributes      L  images
//   M  local_images     N  shopify_id      O  notes
//   P  price            Q  quantity        R  variant_id
//
// Scraper-owned (auto-filled): A-M
// User-managed:                P (price), Q (quantity)
// Auto-populated by script:    N (shopify_id), R (variant_id)
// Manual notes:                O (notes)
// ============================================================

const API_VERSION  = "2026-04";
const GITHUB_REPO  = "yogaoadv/heimor";
const GITHUB_REF   = "master";
const WORKFLOW_FILE = "scrape.yml";

const COL = {
  URL: 1, TITLE: 2, SKU: 3, CATEGORIES: 4, TAGS: 5,
  SHORT_DESC: 6, FULL_DESC: 7, STOCK_STATUS: 8,
  WEIGHT: 9, DIMENSIONS: 10, ATTRIBUTES: 11,
  IMAGES: 12, LOCAL_IMAGES: 13,
  SHOPIFY_ID: 14, NOTES: 15,
  PRICE: 16, QUANTITY: 17, VARIANT_ID: 18
};

// ============================================================
// Menu
// ============================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Shopify")
    .addItem("Scrape URL -> Sheet",      "scrapeActiveRow")
    .addItem("Push row -> Shopify",      "pushActiveRow")
    .addItem("Update price / quantity",  "updatePriceQty")
    .addSeparator()
    .addItem("Setup sheet headers",      "setupSheetHeaders")
    .addItem("Set credentials",          "promptCredentials")
    .addToUi();
}

// ============================================================
// 1. Scrape URL -> triggers GitHub Actions -> Sheet auto-updates
// ============================================================

function scrapeActiveRow() {
  const ui    = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const row   = sheet.getActiveCell().getRow();

  if (row === 1) { ui.alert("Select data row, not header."); return; }

  const url = sheet.getRange(row, COL.URL).getValue().toString().trim();
  if (!url) { ui.alert("Col A is empty. Paste product URL first."); return; }
  if (!url.startsWith("https://tradestarexports.com/product/")) {
    ui.alert("URL must start with:\nhttps://tradestarexports.com/product/");
    return;
  }

  const props = PropertiesService.getScriptProperties();
  const PAT   = props.getProperty("GITHUB_PAT");
  if (!PAT) { ui.alert("Missing GitHub PAT. Use Shopify -> Set credentials."); return; }

  const apiUrl  = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const payload = { ref: GITHUB_REF, inputs: { url: url, output_dir: "." } };

  try {
    const resp = UrlFetchApp.fetch(apiUrl, {
      method: "post",
      headers: {
        "Authorization":        `Bearer ${PAT}`,
        "Accept":               "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type":         "application/json"
      },
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = resp.getResponseCode();
    if (code === 204) {
      sheet.getRange(row, COL.NOTES).setValue(
        "Scrape triggered " + new Date().toLocaleString("en-IN")
      );
      ui.alert("Scrape triggered!\nSheet row updates in ~1-2 min via GitHub Actions.");
    } else {
      ui.alert("GitHub API error: HTTP " + code + "\n" + resp.getContentText());
    }
  } catch (e) {
    ui.alert("Exception: " + e.message);
  }
}

// ============================================================
// 2. Push row -> Shopify (create or update product)
// ============================================================

function pushActiveRow() {
  const ui    = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const row   = sheet.getActiveCell().getRow();

  if (row === 1) { ui.alert("Select data row, not header."); return; }

  const data  = sheet.getRange(row, 1, 1, 18).getValues()[0];
  const title = (data[COL.TITLE - 1] || "").toString().trim();
  if (!title) { ui.alert("Row has no title. Scrape URL first."); return; }

  const props = PropertiesService.getScriptProperties();
  const TOKEN = props.getProperty("SHOPIFY_TOKEN");
  const STORE = props.getProperty("SHOPIFY_STORE");
  if (!TOKEN || !STORE) {
    ui.alert("Missing Shopify credentials. Use Shopify -> Set credentials.");
    return;
  }

  const pipe = (v) =>
    v ? v.toString().split("|").map(s => s.trim()).filter(Boolean) : [];

  const cats       = pipe(data[COL.CATEGORIES - 1]);
  const tags       = pipe(data[COL.TAGS - 1]).join(", ");
  const imgSrcs    = pipe(data[COL.IMAGES - 1]).map(src => ({ src }));
  const wt         = parseWeight(data[COL.WEIGHT - 1]);
  const existingId = (data[COL.SHOPIFY_ID - 1] || "").toString().trim();
  const price      = (data[COL.PRICE - 1] || "0.00").toString().trim();

  const payload = {
    product: {
      title:        title,
      body_html:    (data[COL.FULL_DESC - 1] || data[COL.SHORT_DESC - 1] || "").toString(),
      vendor:       "Tradestar Exports",
      product_type: cats[0] || "",
      tags:         tags,
      status:       "draft",
      variants: [{
        sku:                  (data[COL.SKU - 1] || "").toString(),
        price:                price,
        requires_shipping:    true,
        taxable:              false,
        weight:               wt.value,
        weight_unit:          wt.unit,
        inventory_management: "shopify",
        inventory_policy:     "deny"
      }],
      images: imgSrcs
    }
  };

  const base   = `https://${STORE}/admin/api/${API_VERSION}/products`;
  const url    = existingId ? `${base}/${existingId}.json` : `${base}.json`;
  const method = existingId ? "put" : "post";
  const action = existingId ? "Updated" : "Created";

  try {
    const resp = UrlFetchApp.fetch(url, {
      method:             method,
      headers: {
        "Content-Type":           "application/json",
        "X-Shopify-Access-Token": TOKEN
      },
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const code = resp.getResponseCode();
    const body = JSON.parse(resp.getContentText());

    if (code === 200 || code === 201) {
      const pid = body.product.id;
      const vid = body.product.variants[0].id;
      sheet.getRange(row, COL.SHOPIFY_ID).setValue(pid);
      sheet.getRange(row, COL.VARIANT_ID).setValue(vid);
      sheet.getRange(row, COL.NOTES).setValue(
        `${action} ${new Date().toLocaleString("en-IN")}`
      );
      ui.alert(`${action}! Product ID: ${pid}`);
    } else {
      const err = body.errors
        ? JSON.stringify(body.errors)
        : `HTTP ${code}: ${resp.getContentText()}`;
      sheet.getRange(row, COL.NOTES).setValue("ERR: " + err);
      ui.alert("Shopify error:\n" + err);
    }
  } catch (e) {
    sheet.getRange(row, COL.NOTES).setValue("EXC: " + e.message);
    ui.alert("Exception: " + e.message);
  }
}

// ============================================================
// 3. Update price and/or quantity on Shopify
// ============================================================

function updatePriceQty() {
  const ui    = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const row   = sheet.getActiveCell().getRow();

  if (row === 1) { ui.alert("Select data row, not header."); return; }

  const data      = sheet.getRange(row, 1, 1, 18).getValues()[0];
  const shopifyId = (data[COL.SHOPIFY_ID - 1] || "").toString().trim();
  if (!shopifyId) { ui.alert("No Shopify ID in col N. Push to Shopify first."); return; }

  const price  = (data[COL.PRICE - 1] || "").toString().trim();
  const qtyRaw = data[COL.QUANTITY - 1];
  const qty    = qtyRaw !== "" && qtyRaw !== null ? parseInt(qtyRaw) : null;
  let variantId = (data[COL.VARIANT_ID - 1] || "").toString().trim();

  if (!price && qty === null) {
    ui.alert("Set price (col P) or quantity (col Q) first.");
    return;
  }

  const props = PropertiesService.getScriptProperties();
  const TOKEN = props.getProperty("SHOPIFY_TOKEN");
  const STORE = props.getProperty("SHOPIFY_STORE");
  if (!TOKEN || !STORE) { ui.alert("Missing Shopify credentials."); return; }

  const base   = `https://${STORE}/admin/api/${API_VERSION}`;
  const errors = [];
  let inventoryItemId = null;

  // Fetch variant ID + inventory_item_id if not stored in col R
  if (!variantId) {
    const r = UrlFetchApp.fetch(`${base}/products/${shopifyId}.json`, {
      headers: { "X-Shopify-Access-Token": TOKEN },
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) {
      ui.alert("Could not fetch product from Shopify. Check Shopify ID in col N.");
      return;
    }
    const variant   = JSON.parse(r.getContentText()).product.variants[0];
    variantId       = variant.id.toString();
    inventoryItemId = variant.inventory_item_id;
    sheet.getRange(row, COL.VARIANT_ID).setValue(variantId);
  }

  // Update price
  if (price) {
    const r = UrlFetchApp.fetch(`${base}/variants/${variantId}.json`, {
      method: "put",
      headers: {
        "Content-Type":           "application/json",
        "X-Shopify-Access-Token": TOKEN
      },
      payload:            JSON.stringify({ variant: { id: parseInt(variantId), price: price } }),
      muteHttpExceptions: true
    });
    if (r.getResponseCode() !== 200) {
      errors.push("Price update failed: " + r.getContentText());
    }
  }

  // Update inventory quantity
  if (qty !== null) {
    // Get inventory_item_id if not already fetched above
    if (!inventoryItemId) {
      const r = UrlFetchApp.fetch(`${base}/variants/${variantId}.json`, {
        headers: { "X-Shopify-Access-Token": TOKEN },
        muteHttpExceptions: true
      });
      if (r.getResponseCode() === 200) {
        inventoryItemId = JSON.parse(r.getContentText()).variant.inventory_item_id;
      }
    }

    if (inventoryItemId) {
      const locResp = UrlFetchApp.fetch(`${base}/locations.json`, {
        headers: { "X-Shopify-Access-Token": TOKEN },
        muteHttpExceptions: true
      });
      if (locResp.getResponseCode() === 200) {
        const locationId = JSON.parse(locResp.getContentText()).locations[0].id;
        const r = UrlFetchApp.fetch(`${base}/inventory_levels/set.json`, {
          method: "post",
          headers: {
            "Content-Type":           "application/json",
            "X-Shopify-Access-Token": TOKEN
          },
          payload:            JSON.stringify({
            location_id:       locationId,
            inventory_item_id: inventoryItemId,
            available:         qty
          }),
          muteHttpExceptions: true
        });
        if (r.getResponseCode() !== 200) {
          errors.push("Quantity update failed: " + r.getContentText());
        }
      } else {
        errors.push("Could not fetch Shopify locations.");
      }
    } else {
      errors.push("Could not get inventory_item_id from variant.");
    }
  }

  if (errors.length === 0) {
    sheet.getRange(row, COL.NOTES).setValue(
      "Price/qty updated " + new Date().toLocaleString("en-IN")
    );
    ui.alert("Price/qty updated on Shopify!");
  } else {
    sheet.getRange(row, COL.NOTES).setValue("ERR: " + errors.join("; "));
    ui.alert("Errors:\n" + errors.join("\n"));
  }
}

// ============================================================
// Helpers
// ============================================================

function parseWeight(raw) {
  if (!raw) return { value: 0, unit: "g" };
  const s = raw.toString().toLowerCase();
  const n = parseFloat(s.replace(/[^\d.]/g, "")) || 0;
  if (s.includes("kg")) return { value: n, unit: "kg" };
  if (s.includes("lb")) return { value: n, unit: "lb" };
  if (s.includes("oz")) return { value: n, unit: "oz" };
  return { value: n, unit: "g" };
}

function setupSheetHeaders() {
  const sheet = SpreadsheetApp.getActiveSheet();
  sheet.getRange("P1").setValue("price");
  sheet.getRange("Q1").setValue("quantity");
  sheet.getRange("R1").setValue("variant_id");
  SpreadsheetApp.getUi().alert("Headers P/Q/R added.");
}

function promptCredentials() {
  const ui    = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  const t = ui.prompt("Shopify token (shpat_xxx):");
  if (t.getSelectedButton() !== ui.Button.OK) return;

  const s = ui.prompt("Shopify store domain (e.g. 8ctj86-ft.myshopify.com):");
  if (s.getSelectedButton() !== ui.Button.OK) return;

  const g = ui.prompt("GitHub PAT (github_pat_xxx) — needs repo + workflow scope:");
  if (g.getSelectedButton() !== ui.Button.OK) return;

  props.setProperty("SHOPIFY_TOKEN", t.getResponseText().trim());
  props.setProperty("SHOPIFY_STORE", s.getResponseText().trim());
  props.setProperty("GITHUB_PAT",    g.getResponseText().trim());
  ui.alert("All credentials saved.");
}
