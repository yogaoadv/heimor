// ============================================================
// Google Apps Script — Shopify Control Center
// Paste this into: Google Sheet -> Extensions -> Apps Script
//
// SETUP: Project Settings -> Script Properties -> Add:
//   SHOPIFY_CLIENT_ID      =  your_client_id
//   SHOPIFY_CLIENT_SECRET  =  your_client_secret
//   SHOPIFY_STORE          =  8ctj86-ft.myshopify.com
//   GITHUB_PAT             =  github_pat_xxxxxxxxxxxx  (needs: repo + workflow scope)
//
// SHOPIFY_TOKEN + SHOPIFY_TOKEN_EXPIRY are managed automatically (24h expiry, auto-refresh).
//
// Sheet columns:
//   A  url              B  title           C  sku
//   D  categories       E  tags            F  short_description
//   G  full_description H  stock_status    I  weight
//   J  dimensions       K  attributes      L  images
//   M  local_images     N  shopify_id      O  notes
//   P  price            Q  quantity        R  variant_id
//   S  status           T  shopify_status
//
// Scraper-owned (auto-filled): A-M, S (status written by runner.py)
// User-managed:                P (price), Q (quantity), T (shopify_status: draft/active)
// Auto-populated by script:    N (shopify_id), R (variant_id)
// Manual notes:                O (notes)
// ============================================================

const API_VERSION   = "2026-04";
const GITHUB_REPO   = "yogaoadv/heimor";
const GITHUB_REF    = "master";
const WORKFLOW_FILE = "scrape.yml";

const COL = {
  URL: 1, TITLE: 2, SKU: 3, CATEGORIES: 4, TAGS: 5,
  SHORT_DESC: 6, FULL_DESC: 7, STOCK_STATUS: 8,
  WEIGHT: 9, DIMENSIONS: 10, ATTRIBUTES: 11,
  IMAGES: 12, LOCAL_IMAGES: 13,
  SHOPIFY_ID: 14, NOTES: 15,
  PRICE: 16, QUANTITY: 17, VARIANT_ID: 18,
  STATUS: 19, SHOPIFY_STATUS: 20
};

// ============================================================
// Menu
// ============================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Shopify")
    .addItem("Scrape active row",          "scrapeActiveRow")
    .addItem("Scrape all empty rows",      "scrapeEmptyRows")
    .addSeparator()
    .addItem("Push active row -> Shopify", "pushActiveRow")
    .addItem("Push all unpushed",          "pushAllUnpushed")
    .addItem("Update price / quantity",    "updatePriceQty")
    .addSeparator()
    .addItem("Setup sheet headers",        "setupSheetHeaders")
    .addItem("Set credentials",            "promptCredentials")
    .addToUi();
}

// ============================================================
// 1. Scrape active row -> triggers GitHub Actions -> Sheet auto-updates
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
  const payload = { ref: GITHUB_REF, inputs: { urls: url, output_dir: "." } };

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
      sheet.getRange(row, COL.STATUS).setValue("pending");
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
// 2. Bulk scrape — all rows that have a URL but no title
// Fires ONE GitHub Actions workflow with all URLs (comma-separated).
// ============================================================

function scrapeEmptyRows() {
  const ui    = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const data  = sheet.getDataRange().getValues();

  const urls    = [];
  const rowNums = [];
  for (let r = 1; r < data.length; r++) {
    const url   = (data[r][COL.URL - 1]   || "").toString().trim();
    const title = (data[r][COL.TITLE - 1] || "").toString().trim();
    if (url.startsWith("https://tradestarexports.com/product/") && !title) {
      urls.push(url);
      rowNums.push(r + 1);
    }
  }

  if (!urls.length) {
    ui.alert("No rows found with URL but empty title.");
    return;
  }

  const estMin = Math.ceil(urls.length * 2);
  const confirm = ui.alert(
    "Bulk Scrape",
    `Trigger scrape for ${urls.length} row(s)?\nEstimated completion: ~${estMin} min.`,
    ui.ButtonSet.OK_CANCEL
  );
  if (confirm !== ui.Button.OK) return;

  const props = PropertiesService.getScriptProperties();
  const PAT   = props.getProperty("GITHUB_PAT");
  if (!PAT) { ui.alert("Missing GitHub PAT. Use Shopify -> Set credentials."); return; }

  const apiUrl  = `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
  const payload = { ref: GITHUB_REF, inputs: { urls: urls.join(","), output_dir: "." } };

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
      rowNums.forEach(rowNum => sheet.getRange(rowNum, COL.STATUS).setValue("pending"));
      ui.alert(`Bulk scrape triggered for ${urls.length} product(s)!\nEstimated completion: ~${estMin} min.`);
    } else {
      ui.alert("GitHub API error: HTTP " + code + "\n" + resp.getContentText());
    }
  } catch (e) {
    ui.alert("Exception: " + e.message);
  }
}

// ============================================================
// 3. Push active row -> Shopify (create or update product)
// ============================================================

function pushActiveRow() {
  const ui    = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const row   = sheet.getActiveCell().getRow();

  if (row === 1) { ui.alert("Select data row, not header."); return; }

  const data  = sheet.getRange(row, 1, 1, 20).getValues()[0];
  const title = (data[COL.TITLE - 1] || "").toString().trim();
  if (!title) { ui.alert("Row has no title. Scrape URL first."); return; }

  const props = PropertiesService.getScriptProperties();
  const STORE = props.getProperty("SHOPIFY_STORE");
  if (!STORE) { ui.alert("Missing Shopify store. Use Shopify -> Set credentials."); return; }

  let TOKEN;
  try { TOKEN = _getShopifyToken(STORE); } catch (e) { ui.alert(e.message); return; }

  const result = _doPushRow(sheet, row, data, TOKEN, STORE);

  if (result.ok) {
    const qtyRaw = data[COL.QUANTITY - 1];
    const qty    = (qtyRaw !== "" && qtyRaw !== null && qtyRaw !== undefined)
                   ? parseInt(qtyRaw) : null;
    let note = `${result.action} ${new Date().toLocaleString("en-IN")}`;
    if (qty !== null && !isNaN(qty)) {
      const invErr = setInventoryLevel(TOKEN, STORE, result.inventoryItemId, qty);
      note += invErr ? " | Inv ERR: " + invErr : ` | qty=${qty}`;
    }
    sheet.getRange(row, COL.NOTES).setValue(note);
    sheet.getRange(row, COL.STATUS).setValue("pushed");
    ui.alert(`${result.action}! Product ID: ${result.pid}`);
  } else {
    sheet.getRange(row, COL.NOTES).setValue("ERR: " + result.error);
    sheet.getRange(row, COL.STATUS).setValue("error");
    ui.alert("Shopify error:\n" + result.error);
  }
}

// ============================================================
// 4. Bulk push — all rows with title but no Shopify ID
// ============================================================

function pushAllUnpushed() {
  const ui    = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();

  const props = PropertiesService.getScriptProperties();
  const STORE = props.getProperty("SHOPIFY_STORE");
  if (!STORE) { ui.alert("Missing Shopify store. Use Shopify -> Set credentials."); return; }

  let TOKEN;
  try { TOKEN = _getShopifyToken(STORE); } catch (e) { ui.alert(e.message); return; }

  const allData = sheet.getDataRange().getValues();
  const rows    = [];
  for (let r = 1; r < allData.length; r++) {
    const title     = (allData[r][COL.TITLE     - 1] || "").toString().trim();
    const shopifyId = (allData[r][COL.SHOPIFY_ID - 1] || "").toString().trim();
    if (title && !shopifyId) {
      rows.push({ row: r + 1, data: allData[r] });
    }
  }

  if (!rows.length) {
    ui.alert("No unpushed rows found (need title, no Shopify ID).");
    return;
  }

  const confirm = ui.alert(
    "Bulk Push to Shopify",
    `Push ${rows.length} product(s) to Shopify?`,
    ui.ButtonSet.OK_CANCEL
  );
  if (confirm !== ui.Button.OK) return;

  let success = 0;
  let failed  = 0;

  rows.forEach(({ row, data }) => {
    const result = _doPushRow(sheet, row, data, TOKEN, STORE);

    if (result.ok) {
      const qtyRaw = data[COL.QUANTITY - 1];
      const qty    = (qtyRaw !== "" && qtyRaw !== null && qtyRaw !== undefined)
                     ? parseInt(qtyRaw) : null;
      let note = `Created ${new Date().toLocaleString("en-IN")}`;
      if (qty !== null && !isNaN(qty)) {
        const invErr = setInventoryLevel(TOKEN, STORE, result.inventoryItemId, qty);
        note += invErr ? " | Inv ERR: " + invErr : ` | qty=${qty}`;
      }
      sheet.getRange(row, COL.NOTES).setValue(note);
      sheet.getRange(row, COL.STATUS).setValue("pushed");
      success++;
    } else {
      sheet.getRange(row, COL.NOTES).setValue("ERR: " + result.error);
      sheet.getRange(row, COL.STATUS).setValue("error");
      failed++;
    }

    Utilities.sleep(600);   // ~0.6s between Shopify API calls to stay under rate limit
  });

  ui.alert(`Bulk push complete: ${success} pushed, ${failed} failed.`);
}

// ============================================================
// Internal: core Shopify product create/update
// Returns { ok, pid, vid, inventoryItemId, action } or { ok: false, error }
// Writes shopify_id and variant_id back to sheet on success.
// ============================================================

function _doPushRow(sheet, row, data, TOKEN, STORE) {
  const cats       = pipe(data[COL.CATEGORIES - 1]);
  const tags       = pipe(data[COL.TAGS - 1]).join(", ");
  const imgSrcs    = pipe(data[COL.IMAGES - 1]).map(src => ({ src }));
  const wt         = parseWeight(data[COL.WEIGHT - 1]);
  const existingId = (data[COL.SHOPIFY_ID     - 1] || "").toString().trim();
  const storedVid  = (data[COL.VARIANT_ID     - 1] || "").toString().trim();
  const priceRaw   = data[COL.PRICE - 1];
  const price      = (priceRaw !== "" && priceRaw !== null && priceRaw !== undefined)
                     ? priceRaw.toString().trim() : "0.00";

  const shopifyStatusRaw = (data[COL.SHOPIFY_STATUS - 1] || "").toString().trim().toLowerCase();
  const shopifyStatus    = shopifyStatusRaw === "active" ? "active" : "draft";

  const payload = {
    product: {
      title:        (data[COL.TITLE    - 1] || "").toString(),
      body_html:    (data[COL.FULL_DESC - 1] || data[COL.SHORT_DESC - 1] || "").toString(),
      vendor:       "Tradestar Exports",
      product_type: cats[0] || "",
      tags:         tags,
      status:       shopifyStatus,
      variants: [Object.assign(
        {
          sku:                  (data[COL.SKU - 1] || "").toString(),
          price:                price,
          requires_shipping:    true,
          taxable:              false,
          weight:               wt.value,
          weight_unit:          wt.unit,
          inventory_management: "shopify",
          inventory_policy:     "deny"
        },
        storedVid ? { id: Number(storedVid) } : {}
      )],
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
      const pid     = body.product.id;
      const variant = body.product.variants[0];
      const vid     = variant.id;
      sheet.getRange(row, COL.SHOPIFY_ID).setValue(pid);
      sheet.getRange(row, COL.VARIANT_ID).setValue(vid);
      return { ok: true, pid, vid, inventoryItemId: variant.inventory_item_id, action };
    } else {
      const err = body.errors ? JSON.stringify(body.errors) : `HTTP ${code}: ${resp.getContentText()}`;
      return { ok: false, error: err };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================
// 5. Update price and/or quantity on Shopify
// ============================================================

function updatePriceQty() {
  const ui    = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const row   = sheet.getActiveCell().getRow();

  if (row === 1) { ui.alert("Select data row, not header."); return; }

  const data      = sheet.getRange(row, 1, 1, 20).getValues()[0];
  const shopifyId = (data[COL.SHOPIFY_ID - 1] || "").toString().trim();
  if (!shopifyId) { ui.alert("No Shopify ID in col N. Push to Shopify first."); return; }

  const priceRaw2 = data[COL.PRICE - 1];
  const price  = (priceRaw2 !== "" && priceRaw2 !== null && priceRaw2 !== undefined)
                 ? priceRaw2.toString().trim() : "";
  const qtyRaw = data[COL.QUANTITY - 1];
  const qty    = qtyRaw !== "" && qtyRaw !== null ? parseInt(qtyRaw) : null;
  let variantId = (data[COL.VARIANT_ID - 1] || "").toString().trim();

  if (!price && qty === null) {
    ui.alert("Set price (col P) or quantity (col Q) first.");
    return;
  }

  const props = PropertiesService.getScriptProperties();
  const STORE = props.getProperty("SHOPIFY_STORE");
  if (!STORE) { ui.alert("Missing Shopify store. Use Shopify -> Set credentials."); return; }

  let TOKEN;
  try { TOKEN = _getShopifyToken(STORE); } catch (e) { ui.alert(e.message); return; }

  const base   = `https://${STORE}/admin/api/${API_VERSION}`;
  const errors = [];
  let inventoryItemId = null;

  try {
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
    if (qty !== null && !isNaN(qty)) {
      if (!inventoryItemId) {
        const r = UrlFetchApp.fetch(`${base}/variants/${variantId}.json`, {
          headers: { "X-Shopify-Access-Token": TOKEN },
          muteHttpExceptions: true
        });
        if (r.getResponseCode() === 200) {
          inventoryItemId = JSON.parse(r.getContentText()).variant.inventory_item_id;
        } else {
          errors.push("Could not fetch variant to get inventory_item_id.");
        }
      }
      if (inventoryItemId) {
        const invErr = setInventoryLevel(TOKEN, STORE, inventoryItemId, qty);
        if (invErr) errors.push(invErr);
      }
    }

    if (errors.length === 0) {
      sheet.getRange(row, COL.NOTES).setValue(
        "Price/qty updated " + new Date().toLocaleString("en-IN")
      );
      sheet.getRange(row, COL.STATUS).setValue("pushed");
      ui.alert("Price/qty updated on Shopify!");
    } else {
      sheet.getRange(row, COL.NOTES).setValue("ERR: " + errors.join("; "));
      sheet.getRange(row, COL.STATUS).setValue("error");
      ui.alert("Errors:\n" + errors.join("\n"));
    }
  } catch (e) {
    sheet.getRange(row, COL.NOTES).setValue("EXC: " + e.message);
    sheet.getRange(row, COL.STATUS).setValue("error");
    ui.alert("Exception: " + e.message);
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * Split a pipe-separated sheet cell value into an array.
 */
function pipe(v) {
  return v ? v.toString().split("|").map(s => s.trim()).filter(Boolean) : [];
}

/**
 * Set inventory level for a variant at the first location.
 * Returns null on success, error string on failure.
 */
function setInventoryLevel(TOKEN, STORE, inventoryItemId, qty) {
  const base    = `https://${STORE}/admin/api/${API_VERSION}`;
  const locResp = UrlFetchApp.fetch(`${base}/locations.json`, {
    headers: { "X-Shopify-Access-Token": TOKEN },
    muteHttpExceptions: true
  });
  if (locResp.getResponseCode() !== 200) return "Could not fetch locations.";

  const locationId = JSON.parse(locResp.getContentText()).locations[0].id;
  const r = UrlFetchApp.fetch(`${base}/inventory_levels/set.json`, {
    method: "post",
    headers: {
      "Content-Type":           "application/json",
      "X-Shopify-Access-Token": TOKEN
    },
    payload: JSON.stringify({
      location_id:       locationId,
      inventory_item_id: inventoryItemId,
      available:         qty
    }),
    muteHttpExceptions: true
  });
  return r.getResponseCode() === 200 ? null : "Inventory set failed: " + r.getContentText();
}

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
  sheet.getRange("S1").setValue("status");
  sheet.getRange("T1").setValue("shopify_status");
  SpreadsheetApp.getUi().alert("Headers P/Q/R/S/T added.");
}

function promptCredentials() {
  const ui    = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  const cid = ui.prompt("Shopify Client ID:");
  if (cid.getSelectedButton() !== ui.Button.OK) return;

  const csec = ui.prompt("Shopify Client Secret:");
  if (csec.getSelectedButton() !== ui.Button.OK) return;

  const s = ui.prompt("Shopify store domain (e.g. 8ctj86-ft.myshopify.com):");
  if (s.getSelectedButton() !== ui.Button.OK) return;

  const g = ui.prompt("GitHub PAT (github_pat_xxx) — needs repo + workflow scope:");
  if (g.getSelectedButton() !== ui.Button.OK) return;

  props.setProperty("SHOPIFY_CLIENT_ID",     cid.getResponseText().trim());
  props.setProperty("SHOPIFY_CLIENT_SECRET", csec.getResponseText().trim());
  props.setProperty("SHOPIFY_STORE",         s.getResponseText().trim());
  props.setProperty("GITHUB_PAT",            g.getResponseText().trim());
  // Clear cached token so it is re-fetched with new credentials
  props.deleteProperty("SHOPIFY_TOKEN");
  props.deleteProperty("SHOPIFY_TOKEN_EXPIRY");
  ui.alert("All credentials saved. Token will be fetched automatically on next Shopify action.");
}

// ============================================================
// Token management — fetch + cache Shopify Admin API token
// Token expires after 24h; cached with 5-min early-expiry buffer.
// ============================================================

function _getShopifyToken(store) {
  const props  = PropertiesService.getScriptProperties();
  const cached = props.getProperty("SHOPIFY_TOKEN");
  const expiry = parseInt(props.getProperty("SHOPIFY_TOKEN_EXPIRY") || "0");

  if (cached && Date.now() < expiry - 5 * 60 * 1000) return cached;

  const clientId     = props.getProperty("SHOPIFY_CLIENT_ID");
  const clientSecret = props.getProperty("SHOPIFY_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Missing Shopify client credentials. Use Shopify -> Set credentials.");
  }

  const resp = UrlFetchApp.fetch(
    `https://${store}/admin/oauth/access_token`,
    {
      method:             "post",
      headers:            { "Content-Type": "application/x-www-form-urlencoded" },
      payload:            `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`,
      muteHttpExceptions: true
    }
  );

  if (resp.getResponseCode() !== 200) {
    throw new Error("Token refresh failed: HTTP " + resp.getResponseCode() + " — " + resp.getContentText());
  }

  const token = JSON.parse(resp.getContentText()).access_token;
  props.setProperty("SHOPIFY_TOKEN",        token);
  props.setProperty("SHOPIFY_TOKEN_EXPIRY", String(Date.now() + 23 * 60 * 60 * 1000));
  return token;
}
