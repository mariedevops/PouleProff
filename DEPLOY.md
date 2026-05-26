# Description
In the Netherlands, millions of people participate in corporate or friend "poules" 
for the Eredivisie, Formula 1, or major football tournaments via platforms like Scorito. 
However, people often struggle to make informed predictions because they don't want to dig through complex sports stats.

The Concept: A "Cheat Sheet" generator for casual pool participants.
How it works: A single-page dashboard where a user selects an upcoming Eredivisie match. 
The page uses a basic, hardcoded statistical formula (historical head-to-head, recent form, home/away advantage) to give a definitive "Optimized Pool Prediction" (e.g., Ajax vs. PSV: Predicted Score 1-2. Probability of Draw: 22%).
Why it’s in demand: It saves users time. Instead of analyzing stats themselves, 
they use your tool to quickly fill out their company Scorito pool. 
You don't need a live database for this initially; you can just hardcode data for the current season or use a free API.  
The challenge is data freshness. Hardcoded stats go stale fast, and if your predictions feel off, trust dies immediately. 
You'd want to hook into a free API (API-Football has a decent free tier) relatively quickly. 
But the core concept is "just tell me what to pick" 


# PouleProff — Deploy Guide

## Project structure

```
pouleproff/
├── frontend/               ← your static site (index.html, app.js, data.js, styles.css)
└── azure-function/
    ├── host.json
    ├── package.json
    ├── local.settings.json ← ⚠️ NEVER commit this file (contains your API key)
    └── eredivisie-data/
        ├── function.json
        └── index.js
```

---

## Step 1 — Regenerate your API key (do this first!)

Your key was exposed in plain text. Go to:
https://rapidapi.com/api-sports/api/api-football → "My Apps" → regenerate key.

---

## Step 2 — Create Azure resources (one-time)

You need: a free Azure account, the Azure CLI installed.

```bash
# Login
az login

# Create a resource group (West Europe = Amsterdam)
az group create --name pouleproff-rg --location westeurope

# Create a storage account (for blob cache + function runtime)
az storage account create \
  --name pouleproffstore \
  --resource-group pouleproff-rg \
  --location westeurope \
  --sku Standard_LRS

# Get the storage connection string (save this for later)
az storage account show-connection-string \
  --name pouleproffstore \
  --resource-group pouleproff \
  --query connectionString -o tsv

# Create the Function App (Node 18, consumption plan = free tier)
az functionapp create \
  --resource-group pouleproff-rg \
  --consumption-plan-location westeurope \
  --runtime node \
  --runtime-version 18 \
  --functions-version 4 \
  --name pouleproff-api \
  --storage-account pouleproffstore \
  --os-type Linux
```

---

## Step 3 — Set environment variables (your secrets, never in code)

```bash
az functionapp config appsettings set \
  --name pouleproff-api \
  --resource-group pouleproff-rg \
  --settings \
    RAPIDAPI_KEY="YOUR_NEW_API_KEY_HERE" \
    AZURE_STORAGE_CONNECTION_STRING="YOUR_CONNECTION_STRING_HERE"
```

---

## Step 4 — Deploy the Azure Function

```bash
cd azure-function
npm install
func azure functionapp publish pouleproff-api
```

After deploy, your function URL will be:
`https://pouleproff-api.azurewebsites.net/api/eredivisie-data`

Test it in your browser — you should see JSON with teams + fixtures.

---

## Step 5 — Deploy the frontend as Azure Static Web App

```bash
# Create Static Web App (free tier)
az staticwebapp create \
  --name pouleproff \
  --resource-group pouleproff-rg \
  --location westeurope \
  --sku Free
```

Then connect your GitHub repo in the Azure Portal:
1. Portal → Static Web Apps → pouleproff → GitHub Actions
2. Set "App location" to `/frontend`
3. Leave "API location" and "Output location" blank

Or deploy manually:
```bash
# Install SWA CLI
npm install -g @azure/static-web-apps-cli

cd frontend
swa deploy --deployment-token YOUR_SWA_TOKEN --env production
```

---

## Step 6 — Point the frontend at your function

In `frontend/index.html`, just before `</head>`, add:

```html
<script>
  window.POULEPROFF_API_URL =
    "https://pouleproff-api.azurewebsites.net/api/eredivisie-data";
</script>
```

---

## Step 7 — Add a custom domain (optional)

```bash
az staticwebapp hostname set \
  --name pouleproff \
  --resource-group pouleproff-rg \
  --hostname pouleproff.nl
```

Then add a CNAME record at your DNS provider:
`@ → your-site.azurestaticapps.net`

---

## Local development

```bash
# Terminal 1 — run the function locally
cd azure-function
npm install
# Edit local.settings.json: add your real API key
func start

# Terminal 2 — serve the frontend
cd frontend
npx serve .   # or just open index.html in a browser

# The frontend will call localhost:7071/api/eredivisie-data automatically
# (because window.POULEPROFF_API_URL is not set during local dev)
```

---

## API request budget

| Event                          | API calls |
|-------------------------------|-----------|
| First page load of the day    | 2 (fixtures + standings) |
| Subsequent loads (same day)   | 0 (blob cache hit) |
| After cache expires (24h)     | 2 |
| **Monthly total (est.)**      | ~60 calls |
| **Free tier limit**           | 100/day   |

You have a large safety margin. If you later add F1 or EK support,
each sport is a separate set of 2 calls per 24h window.

---

## Files to NEVER commit

Add to `.gitignore`:
```
azure-function/local.settings.json
azure-function/node_modules/
```
