# 🤖 WhatsApp AI Bot — Railway Deployment Guide

## 📁 Files in this project
| File | Purpose |
|------|---------|
| `index.js` | Main bot code |
| `package.json` | Node dependencies |
| `nixpacks.toml` | Tells Railway to install Chrome |
| `railway.json` | Railway deploy config |

---

## 🚀 Deploy to Railway (step by step)

### Step 1 — Push to GitHub
1. Create a new repo on github.com (can be private)
2. Upload all 4 files into it

### Step 2 — Create Railway project
1. Go to **railway.app** and sign in
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your repo → Railway will auto-detect and build it

### Step 3 — Add environment variables
In Railway dashboard → your service → **"Variables"** tab, add:

| Variable | Value |
|----------|-------|
| `ANTHROPIC_API_KEY` | your key from console.anthropic.com |
| `BOT_OWNER_NAME` | `Victoire` (or your name) |
| `WHITELIST` | `33612345678,33698765432` (optional, comma-separated) |
| `PUPPETEER_EXECUTABLE_PATH` | `/run/current-system/sw/bin/chromium` |

### Step 4 — Scan the QR code
1. Go to Railway → your service → **"Logs"** tab
2. Wait for the QR code to appear in logs
3. Open WhatsApp → **Settings → Appareils liés → Lier un appareil**
4. Scan the QR code shown in the logs

✅ Done! The bot is now running 24/7 on Railway.

---

## 💡 Important notes

- **Session persistence**: The WhatsApp session is saved in `.wwebjs_auth/`. 
  If Railway redeploys, you may need to scan the QR code again.
  To avoid this, add a **Railway Volume** mounted at `/app/.wwebjs_auth`

- **Free tier**: Railway gives $5/month free credit — enough for this bot

- **Logs**: Monitor your bot live in Railway → Logs tab

---

## 🔄 After redeployment
If you push new code to GitHub, Railway auto-redeploys.
If the session is lost, just scan the QR code again from the logs.

---

## 🛑 Stop the bot
Go to Railway → your service → **Settings** → **Remove service** or just pause it.
