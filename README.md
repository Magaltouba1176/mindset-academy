# Mindset Academy — Papa Diouf
## PayDunya Payment Integration

---

## Project Structure

```
mindset-academy/
├── server.js              ← Backend (Node.js) — holds your secret keys
├── package.json
├── .env                   ← YOUR SECRETS (never commit this)
├── .env.example           ← Template (safe to commit)
├── .gitignore
└── public/
    ├── index.html         ← Landing page (calls /api/paydunya/checkout)
    ├── success.html       ← Shown after successful payment
    └── cancel.html        ← Shown if customer cancels
```

---

## Step 1 — Get Your PayDunya API Keys

1. Go to https://app.paydunya.com
2. Create a Business account
3. Go to **Settings → API Keys**
4. Copy your:
   - `PAYDUNYA-MASTER-KEY`
   - `PAYDUNYA-PRIVATE-KEY`
   - `PAYDUNYA-TOKEN`
5. Start with **Sandbox/Test mode** to test without real money

---

## Step 2 — Configure Your Environment

```bash
# Copy the template
cp .env.example .env

# Open .env and fill in your real keys:
nano .env
```

Your `.env` should look like:
```
PAYDUNYA_MASTER_KEY=live_xxxxxxxxxxxxxxxxxx
PAYDUNYA_PRIVATE_KEY=live_xxxxxxxxxxxxxxxxxx
PAYDUNYA_TOKEN=xxxxxxxxxxxxxxxxxx
PAYDUNYA_MODE=live
APP_URL=https://yourdomain.com
PORT=3000
```

---

## Step 3 — Install & Run Locally

```bash
npm install
npm start
```

Open http://localhost:3000 — your landing page is live locally.

---

## Step 4 — Deploy to Production

### Option A: Render.com (Free tier — Recommended)
1. Push your code to GitHub (`.env` is in `.gitignore` — safe)
2. Go to https://render.com → New Web Service
3. Connect your GitHub repo
4. Set **Build Command**: `npm install`
5. Set **Start Command**: `node server.js`
6. Add **Environment Variables** from your `.env` in the Render dashboard
7. Done — Render gives you a public HTTPS URL

### Option B: Railway.app
1. Push to GitHub
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Add environment variables in the Railway dashboard
4. Deploy

### Option C: Your own VPS (DigitalOcean, OVH, etc.)
```bash
git clone your-repo
cd mindset-academy
npm install
cp .env.example .env && nano .env   # fill in keys
node server.js                       # or use PM2
```

---

## Payment Flow

```
Customer fills form
      ↓
Frontend calls POST /api/paydunya/checkout
      ↓
server.js calls PayDunya API (with secret keys — server only)
      ↓
PayDunya returns invoice_url
      ↓
Frontend redirects customer to invoice_url
      ↓
Customer pays on PayDunya (Wave / Orange Money / Card)
      ↓
PayDunya redirects to /success.html (paid) or /cancel.html (cancelled)
      ↓
PayDunya calls /api/paydunya/webhook (server-to-server confirmation)
```

---

## Webhook — After Payment

In `server.js`, the `handleWebhook()` function receives payment confirmation.
You can add:

```javascript
// Send WhatsApp link via Twilio
// Send welcome email via Brevo/Mailchimp
// Log sale to Google Sheets via Make.com webhook
// Save to a database
```

Example Make.com webhook integration (add inside handleWebhook):
```javascript
await fetch('https://hook.make.com/YOUR_WEBHOOK_ID', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: invoice.custom_data?.customer_name,
    email: invoice.custom_data?.customer_email,
    phone: invoice.custom_data?.customer_phone,
    amount: invoice.invoice?.total_amount,
    paid_at: new Date().toISOString(),
  })
});
```

---

## Testing

PayDunya test credentials (sandbox mode):
- Use `PAYDUNYA_MODE=test` in `.env`
- Test Wave number: +221 77 000 00 00
- Any OTP code works in sandbox

---

## Support

PayDunya docs: https://paydunya.com/developers
PayDunya sandbox: https://app.paydunya.com/sandbox
