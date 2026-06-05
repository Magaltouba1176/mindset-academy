/**
 * Mindset Academy — PayDunya Backend Server
 * ==========================================
 * Run:  node server.js
 * Deps: npm install express cors dotenv node-fetch@2
 */

"use strict";

require("dotenv").config();
const http = require("http");
const https = require("https");
const url = require("url");
const fs = require("fs");
const path = require("path");

// ── Config ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

const PAYDUNYA = {
  masterKey:  process.env.PAYDUNYA_MASTER_KEY,
  privateKey: process.env.PAYDUNYA_PRIVATE_KEY,
  token:      process.env.PAYDUNYA_TOKEN,
  mode:       process.env.PAYDUNYA_MODE || "test", // "test" | "live"
};

// PayDunya endpoints
const PD_BASE =
  PAYDUNYA.mode === "live"
    ? "https://app.paydunya.com/api/v1"
    : "https://app.paydunya.com/sandbox-api/v1";

// Coaching product definition
const PRODUCT = {
  name:        "Mindset Academy — 4 semaines de coaching de groupe",
  amount:      5000,   // FCFA
  description: "Coaching de groupe chaque samedi pendant 4 semaines avec Papa Diouf. Accès WhatsApp + matériaux de lecture inclus.",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simple JSON POST using built-in https (no external deps needed) */
function httpPost(endpoint, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(endpoint);
    const payload = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.path,
      method:   "POST",
      headers:  {
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(new Error("Invalid JSON from PayDunya: " + data)); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/** Simple JSON GET using built-in https */
function httpGet(endpoint, headers) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(endpoint);
    const options = {
      hostname: parsed.hostname,
      path:     parsed.path,
      method:   "GET",
      headers:  { "Content-Type": "application/json", ...headers },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(new Error("Invalid JSON from PayDunya: " + data)); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/** Validate that all PayDunya keys are configured */
function keysConfigured() {
  return PAYDUNYA.masterKey && PAYDUNYA.privateKey && PAYDUNYA.token &&
    !PAYDUNYA.masterKey.includes("your-");
}

/** Parse JSON body from incoming request */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 10_000) reject(new Error("Body too large")); });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
  });
}

/** Send JSON response */
function json(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

/** Serve a static file */
function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

// ── PayDunya Invoice Creator ──────────────────────────────────────────────────

async function createPaydunyaInvoice({ customerName, customerEmail, customerPhone }) {
  if (!keysConfigured()) {
    throw new Error("PayDunya API keys are not configured in .env");
  }

  const headers = {
    "PAYDUNYA-MASTER-KEY":  PAYDUNYA.masterKey,
    "PAYDUNYA-PRIVATE-KEY": PAYDUNYA.privateKey,
    "PAYDUNYA-TOKEN":       PAYDUNYA.token,
  };

  const body = {
    invoice: {
      items: {
        item_0: {
          name:        PRODUCT.name,
          quantity:    1,
          unit_price:  PRODUCT.amount,
          total_price: PRODUCT.amount,
          description: PRODUCT.description,
        },
      },
      total_amount:  PRODUCT.amount,
      description:   PRODUCT.description,
    },
    store: {
      name:     "Mindset Academy",
      tagline:  "Maîtrise ton esprit. Atteins tous tes objectifs.",
      postal_address: "Dakar, Sénégal",
      phone_number:   "+221 77 205 31 66",
      website_url:    APP_URL,
    },
    actions: {
      cancel_url:  `${APP_URL}/cancel.html`,
      return_url:  `${APP_URL}/success.html`,
      callback_url: `${APP_URL}/api/paydunya/webhook`, // server-to-server
    },
    custom_data: {
      customer_name:  customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone,
      product:        PRODUCT.name,
    },
  };

  const result = await httpPost(`${PD_BASE}/checkout-invoice/create`, headers, body);
  if (result.status !== 200 || result.body.response_code !== "00") {
    const msg = result.body.response_text || result.body.description || "PayDunya error";
    throw new Error(`PayDunya rejected the invoice: ${msg}`);
  }

  const token = result.body.token;

  // PayDunya returns the checkout URL in response_text (not invoice_url)
  const invoiceUrl = result.body.invoice_url || result.body.response_text;

  return { ...result.body, invoice_url: invoiceUrl };
}

// ── Webhook handler (PayDunya calls this after payment) ───────────────────────

async function handleWebhook(req, res) {
  try {
    const body = await parseBody(req);
    const hash = body.data?.hash;

    // Verify the payment by fetching invoice status (GET is required by PayDunya)
    if (hash) {
      const pdHeaders = {
        "PAYDUNYA-MASTER-KEY":  PAYDUNYA.masterKey,
        "PAYDUNYA-PRIVATE-KEY": PAYDUNYA.privateKey,
        "PAYDUNYA-TOKEN":       PAYDUNYA.token,
      };
      const result = await httpGet(
        `${PD_BASE}/checkout-invoice/confirm/${hash}`,
        pdHeaders
      );
      const data = result.body;

      if (data.invoice?.status === "completed") {
        // ── Payment confirmed ──────────────────────────────────────────────
        // TODO: Here you can:
        //   1. Save to a database (customer name, email, timestamp)
        //   2. Send a WhatsApp message via Twilio / WhatsApp Business API
        //   3. Send a welcome email via Mailchimp / Brevo
        //   4. Log the sale to a Google Sheet via Make.com webhook
        console.log("✅ Payment confirmed:", {
          name:   data.custom_data?.customer_name,
          email:  data.custom_data?.customer_email,
          amount: data.invoice?.total_amount,
        });
      }
    }

    json(res, 200, { received: true });
  } catch (err) {
    console.error("Webhook error:", err.message);
    json(res, 200, { received: true }); // always 200 to PayDunya
  }
}

// ── HTTP Router ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method.toUpperCase();

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // ── API: Create PayDunya invoice ──────────────────────────────────────────
  if (pathname === "/api/paydunya/checkout" && method === "POST") {
    try {
      const body = await parseBody(req);
      const { customerName, customerEmail, customerPhone } = body;

      if (!customerName || !customerEmail || !customerPhone) {
        return json(res, 400, { error: "Merci de remplir tous les champs (nom, email, téléphone)." });
      }

      console.log(`💳 Creating invoice for: ${customerName} <${customerEmail}>`);
      const invoice = await createPaydunyaInvoice({ customerName, customerEmail, customerPhone });

      return json(res, 200, {
        invoiceUrl: invoice.invoice_url,
        token:      invoice.token,
      });
    } catch (err) {
      console.error("Checkout error:", err.message);
      return json(res, 500, { error: err.message });
    }
  }

  // ── API: PayDunya webhook (server-to-server callback) ────────────────────
  if (pathname === "/api/paydunya/webhook" && method === "POST") {
    return handleWebhook(req, res);
  }

  // ── Static files ──────────────────────────────────────────────────────────
  const staticMap = {
    "/":              ["public/index.html",   "text/html"],
    "/index.html":    ["public/index.html",   "text/html"],
    "/success.html":  ["public/success.html", "text/html"],
    "/cancel.html":   ["public/cancel.html",  "text/html"],
  };

  if (staticMap[pathname]) {
    const [file, ct] = staticMap[pathname];
    return serveFile(res, path.join(__dirname, file), ct);
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`\n🚀 Mindset Academy server running`);
  console.log(`   URL:  http://localhost:${PORT}`);
  console.log(`   Mode: PayDunya ${PAYDUNYA.mode.toUpperCase()}`);
  if (!keysConfigured()) {
    console.warn("\n⚠️  PayDunya keys not set — copy .env.example to .env and fill in your keys\n");
  }
});
