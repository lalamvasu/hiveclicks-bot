# HiveClicks Chat Assistant — setup guide

What this is: a chat bubble for hiveclicks.com that greets visitors, answers
questions about your services using Gemini (free tier), and collects
name/phone/email/project into an email + Google Sheet. Unanswered questions
get pointed to email, phone, or WhatsApp.

Two pieces:
- `widget/chatbot-widget.js` — the frontend bubble, one `<script>` tag on your site
- `server/` — a small Node.js backend it talks to

Footprint: this backend is tiny — Express + a couple of small libraries, no
database, no build step. It idles under ~60–80MB of RAM and runs comfortably
on the smallest paid tier of anything (Render's free/starter web service, or
a $4–6/mo 512MB–1GB DigitalOcean droplet). It won't meaningfully compete with
whatever else is already running on your VPS.

---

Everything below gets pasted into one file: `server/.env` (you'll create it
from `.env.example` in step 4). Each credential says exactly which line it
becomes.

## 1. Get a free Gemini API key

1. Open https://aistudio.google.com/apikey in your browser
2. Sign in with any Google account
3. Click the blue **"Create API key"** button
4. If asked, choose **"Create API key in new project"** (default is fine)
5. A key appears — it looks like `AIzaSy...` — click the copy icon
6. Paste it into `.env` as:
   ```
   GEMINI_API_KEY=AIzaSy...your key...
   ```

That's the whole thing — no billing setup needed for the free tier. If your
traffic ever outgrows the free quota, Google will start returning quota
errors and you can attach a billing account at that point; nothing breaks
silently.

## 2. Get a Gmail app password (so the server can send lead emails)

You need a Gmail account to send *from* — it can be a new one you create
just for this, or an existing one. The lead emails will land in
**lalamvasy2002@gmail.com** either way (that's configured separately in
step 4) — this account is just the "sender."

1. Go to https://myaccount.google.com/security while signed into that
   Gmail account
2. Under "How you sign in to Google," click **2-Step Verification** and
   turn it on if it isn't already (follow the phone verification prompts)
3. Once 2-Step Verification is on, go to
   https://myaccount.google.com/apppasswords
4. Under "App name," type something like `HiveClicks Bot` and click
   **Create**
5. Google shows a 16-character password in a yellow box, like
   `abcd efgh ijkl mnop` — copy it (spaces don't matter)
6. Paste into `.env`:
   ```
   SMTP_USER=that_gmail_address@gmail.com
   SMTP_PASS=abcdefghijklmnop
   ```

Don't use your normal Gmail password here — Google blocks that for
third-party apps; the app password is the correct one. Using a different
provider (Outlook, Zoho, etc.) instead of Gmail? Tell me which and I'll
adjust the config — the app-password step differs slightly per provider.

## 3. Set up the Google Sheet (no credentials file needed)

This uses a free Apps Script "web app" instead of a Google Cloud service
account — much less setup, just copy-paste.

1. Go to https://sheets.google.com and create a new blank sheet
2. In row 1, add these headers across columns A–F:
   `Timestamp | Name | Phone | Email | Project | Page`
3. In the menu bar: **Extensions → Apps Script**
4. You'll see a code editor with a placeholder `function myFunction() {}` —
   select all of it and delete, then paste this in its place:

   ```javascript
   function doPost(e) {
     var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
     var data = JSON.parse(e.postData.contents);
     sheet.appendRow([
       data.timestamp, data.name, data.phone, data.email, data.project, data.page
     ]);
     return ContentService.createTextOutput(JSON.stringify({ ok: true }))
       .setMimeType(ContentService.MimeType.JSON);
   }
   ```

5. Click the disk/save icon (or Ctrl+S), give the project any name when asked
6. Click the blue **Deploy** button (top right) → **New deployment**
7. Click the gear icon next to "Select type" → choose **Web app**
8. Set:
   - Description: anything, e.g. `HiveClicks lead logger`
   - Execute as: **Me**
   - Who has access: **Anyone**
9. Click **Deploy**
10. The first time, Google will show an "Authorize access" prompt — click
    through it (choose your account → "Advanced" → "Go to (project name)
    (unsafe)" — this warning is normal for your own scripts → **Allow**)
11. Copy the **Web app URL** shown (ends in `/exec`)
12. Paste into `.env`:
    ```
    SHEET_WEBHOOK_URL=https://script.google.com/macros/s/AKfycb.../exec
    ```

If you ever edit the Apps Script code later, you must **Deploy → Manage
deployments → edit (pencil) → New version** for the change to take effect —
saving alone isn't enough.

## 4. Configure and run locally (to test before deploying)

```bash
cd server
cp .env.example .env
# edit .env with your real values
npm install
npm start
```

Your finished `.env` should look like this (replace the Gemini key, SMTP
user/pass, and Sheet URL with the real values from steps 1–3 above):

```
GEMINI_API_KEY=AIzaSy...your key...
GEMINI_MODEL=gemini-2.0-flash

CONTACT_EMAIL=contact@hiveclicks.com
LEAD_NOTIFY_TO=lalamvasy2002@gmail.com

SMTP_SERVICE=gmail
SMTP_USER=your_sending_address@gmail.com
SMTP_PASS=your_16_char_app_password

SHEET_WEBHOOK_URL=https://script.google.com/macros/s/XXXXXXXXXXXX/exec

PORT=3000
```

`CONTACT_EMAIL` is what the bot shows to *visitors* when it can't answer
something. `LEAD_NOTIFY_TO` is where *you* receive the lead alert emails —
these can be different addresses, which is why they're separate.

Visit `http://localhost:3000/health` — should return `{"ok":true}`.

To test the widget locally, open any HTML page with:

```html
<script src="http://localhost:3000/widget/chatbot-widget.js" data-api="http://localhost:3000"></script>
```

---

## 5. Deploying — two options

### Option A: Render (simplest)

1. Push this `server/` folder to a GitHub repo (or the whole project)
2. On https://render.com → New → Web Service → connect the repo
3. Root directory: `server` (if the repo has both `widget/` and `server/`)
4. Build command: `npm install` · Start command: `npm start`
5. Add the same environment variables from `.env` in Render's dashboard
6. Deploy. Render gives you a URL like `https://hiveclicks-bot.onrender.com`
7. Free tier note: it sleeps after inactivity and takes ~30-60s to wake on
   the first message — fine for low traffic, but if that first-reply delay
   bothers you, Render's cheapest paid tier ($7/mo) keeps it always-on.

### Option B: Your existing DigitalOcean VPS

Since this app is so lightweight, it can just run alongside whatever else
is on your droplet.

1. Copy the `server/` folder to the droplet (`scp` or `git pull`)
2. Install Node 18+ if not already there: `curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash - && sudo apt install -y nodejs`
3. `cd server && npm install --production`
4. Create `.env` with your real values
5. Keep it running with **pm2** (auto-restarts on crash/reboot):
   ```bash
   sudo npm install -g pm2
   pm2 start server.js --name hiveclicks-bot
   pm2 save
   pm2 startup   # follow the printed instructions once
   ```
6. Point a subdomain at it through nginx (e.g. `bot.hiveclicks.com`), so the
   widget calls a clean HTTPS URL instead of an IP:port. Example nginx block:
   ```nginx
   server {
     listen 80;
     server_name bot.hiveclicks.com;
     location / {
       proxy_pass http://localhost:3000;
       proxy_set_header Host $host;
     }
   }
   ```
   Then `sudo certbot --nginx -d bot.hiveclicks.com` for free HTTPS.

Either way, once it's live, `API_BASE` in the embed snippet below becomes
that URL.

---

## 6. Add the widget to your WordPress site

Your site runs Elementor. Easiest path — Appearance → Theme File Editor
→ `footer.php` (or **Insert Headers and Footers** plugin if you don't want
to touch theme files), and add before `</body>`:

```html
<script src="https://YOUR-BACKEND-URL/widget/chatbot-widget.js"
        data-api="https://YOUR-BACKEND-URL"></script>
```

Replace `YOUR-BACKEND-URL` with your Render URL or `https://bot.hiveclicks.com`.
That's it — it'll appear on every page.

---

## 7. Already set for you

These are filled in with the details you gave me — no further edits needed
unless something's wrong:

- Visitor-facing contact email: `contact@hiveclicks.com`
- Lead alert inbox (where you receive new leads): `lalamvasy2002@gmail.com`
- Phone / WhatsApp: `+91 7337483053`

If any of these change later, they live in two places:
`server/.env` (`CONTACT_EMAIL`, `LEAD_NOTIFY_TO`) for the backend, and the
`FALLBACK_EMAIL` / `FALLBACK_PHONE` / `FALLBACK_WHATSAPP` constants near the
top of `widget/chatbot-widget.js` for the instant fallback shown before the
server even responds. The greeting text itself is also in
`chatbot-widget.js` (search for "Hi! 👋") if you want to tweak the wording.
