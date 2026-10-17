# My Budget

A small personal budget app (PKR) that runs in the browser and installs like an app on a laptop or phone.
Expenses, income, committees, lend & borrow, and a weekly balance check.

**Open it:** https://carlosbrath.github.io/my-budget/

## Install
- **Laptop (Chrome / Edge):** open the link, click **Install app** (or the install icon in the address bar).
- **Android (Chrome):** menu ⋮ → **Install app** / **Add to Home screen**.
- **iPhone (Safari):** Share → **Add to Home Screen**.

After installing it works offline.

## Your data
Your data stays on your own device — nothing is sent to any server.
- **Laptop (Chrome / Edge):** choose a data folder once (Settings → Data folder). Every change is saved to
  `budget-data.json` there, with a daily copy in `backups/`. If the browser ever clears its storage, choose the
  same folder again and everything comes back.
- **Phone:** data is kept inside the app. Use **Settings → Save / share backup** every week (Google Drive, WhatsApp…)
  and **Restore** to load it back.

## Run locally (Windows)
Double-click `Start Budget.bat` — it serves the app at http://localhost:8765 (no installs needed).
