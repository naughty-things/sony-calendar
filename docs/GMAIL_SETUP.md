# Gmail Workspace Inbox Setup (Option B — Service Account)

The AI agent lives at `agent@naughtythings.com.hk` (a Google Workspace
shared mailbox). The app polls that inbox every minute and ingests
new messages into the calendar as `needs_review` posts.

We use a **Service Account with domain-wide delegation** instead of
App Passwords, because App Passwords is disabled on the
`naughtythings.com.hk` Workspace.

This is the modern Google-approved path. About 15 min of admin work,
all in the Google Cloud / Workspace admin consoles.

---

## Part 1 — Create the Google Cloud project + service account

*To be done by: anyone with a Google account in your org. Can be Sam or IT.*

### 1.1 — Create the project
1. Go to https://console.cloud.google.com
2. Top-left → project dropdown → **New project**
3. Project name: `SONY Calendar` (or whatever you like)
4. Organization: **naughty-things.com.hk** (your Workspace)
5. Click **Create**
6. Wait until it says "Your project is ready" — then **select** the new project

### 1.2 — Enable the Gmail API
1. In the same console, left menu → **APIs & Services → Library**
2. Search: `Gmail API`
3. Click it → click **Enable**
4. Wait for the dashboard to load (it'll show "API enabled")

### 1.3 — Configure the consent screen
1. Left menu → **APIs & Services → OAuth consent screen**
2. User type: **Internal** (this is the only option for Workspace orgs anyway)
3. Click **Create**
4. App name: `SONY Calendar`
5. User support email: pick your own (Sam Lee or whoever)
6. Developer contact: same email
7. Click **Save and continue** through the remaining steps (Scopes, Test users — you can skip both for internal apps)
8. Back at the consent screen page, you should see status "Publishing status: In production"

### 1.4 — Create a service account
1. Left menu → **IAM & Admin → Service Accounts**
2. **+ Create Service Account** at the top
3. Service account name: `sony-calendar-inbox-reader`
4. Service account ID: `sony-calendar-inbox-reader` (auto-fills)
5. Description: `Reads agent@naughtythings.com.hk inbox for SONY content calendar`
6. Click **Create and continue**
7. **Grant this service account access to project** — skip (don't need any IAM roles; the access comes from Gmail delegation)
8. **Grant users access to this service account** — skip
9. Click **Done**

### 1.5 — Download the JSON key
1. You should be back at the service accounts list. Click the new `sony-calendar-inbox-reader@…` row.
2. Top tab → **Keys** → **Add Key** → **Create new key** → **JSON** → **Create**
3. A `.json` file downloads. **Save it somewhere safe** — this is the only copy. You can't download it again.

The file looks like:
```json
{
  "type": "service_account",
  "project_id": "sony-calendar-…",
  "private_key_id": "…",
  "private_key": "-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n",
  "client_email": "sony-calendar-inbox-reader@sony-calendar-….iam.gserviceaccount.com",
  "…
}
```

You need two things from this file:
- **`client_email`** → this goes into `.env` as `GMAIL_SA_EMAIL`
- **`private_key`** → the full PEM string with `\n` literal preserved → `.env` as `GMAIL_SA_PRIVATE_KEY`

---

## Part 2 — Grant domain-wide delegation in Workspace

*To be done by: Workspace super admin (your IT admin).*

### 2.1 — Find the service account's Client ID
1. Still in Google Cloud console → IAM & Admin → Service Accounts → click `sony-calendar-inbox-reader@…`
2. Top section → **Details** tab → copy the **OAuth 2 Client ID** (a long number)

### 2.2 — Add the scope in Workspace Admin
1. In a new tab, go to https://admin.google.com (logged in as super admin)
2. Left menu → **Menu (≡) → Security → API controls**
3. Scroll down to **Domain wide delegation** → click **Manage Domain Wide Delegation**
4. Click **Add new**
5. **Client ID**: paste the OAuth 2 Client ID from step 2.1
6. **OAuth Scopes** (comma-separated, no spaces):
   ```
   https://www.googleapis.com/auth/gmail.readonly
   ```
7. Click **Authorize**

---

## Part 3 — Grant the service account access to the mailbox

*To be done by: Workspace super admin.*

1. In Google Admin → **Menu → Directory → Users**
2. Find and click `agent@naughtythings.com.hk`
3. Scroll down to the **Mail** section (if not visible, the user might not be a full Workspace user yet — make sure they are)
4. There should be a "Manage delegate access" or "Email delegation" section
   - In the new Admin Console: **Security → Data → Delegate access → Add delegate** (you may need to use the older admin console at admin.google.com/naughty-things.com.hk/ManageDelegation)
5. Add the service account's email (`sony-calendar-inbox-reader@…iam.gserviceaccount.com`) as a delegate
6. Save

> If you can't find the delegate UI, an alternative is the **Gmail API itself** — we just call `gmail.users.messages.list` and the domain-wide delegation handles the rest. As long as the scope is correct in step 2.2, the service account can read the mailbox on behalf of any user in the domain. The "delegate access" UI is for *sending* mail as another user; we only need *read* access which is already covered by the scope.

---

## Part 4 — Send me the values

Once Part 1–3 are done, send me:

1. **The service account's `client_email`** (looks like `sony-calendar-inbox-reader@sony-calendar-….iam.gserviceaccount.com`)
2. **The service account's `private_key`** (the full PEM string including the `-----BEGIN/END-----` lines)
3. **Confirmation that the `agent@naughtythings.com.hk` mailbox exists** in the Workspace

> ⚠️ **Don't send these in a public Discord channel.** They grant read access to your company's inbox. Send them via:
> - A 1Password / Bitwarden shared vault entry
> - A direct DM to me
> - Or a private GitHub Gist you can revoke later

I'll plug them into `.env` (gitignored), deploy, and we'll run a real end-to-end test: I send an email to `agent@naughtythings.com.hk`, the poller picks it up within 60s, a `needs_review` chip appears on the calendar.

---

## What the app does with the mail (recap)
- Every 60s, calls `gmail.users.history.list` for new messages
- For each new message, runs the AI parser
- If the AI extracts a publish date and title → creates a `needs_review` post
- Otherwise → logs as `rejected` (you can review later; we can build a UI for rejected items)
- **Never deletes or modifies the mailbox.** To re-ingest, lower the `history_id` in the `app_state` table.

## Troubleshooting
- **`invalid_grant / Precondition check failed`** — domain-wide delegation not set up. Re-check Part 2.
- **`Insufficient Permission / 403`** — the `gmail.readonly` scope wasn't added. Re-check Part 2.2, the OAuth Scopes line must be exactly `https://www.googleapis.com/auth/gmail.readonly`.
- **`Not Found / 404`** — the agent mailbox doesn't exist yet, or the service account's `subject` (GMAIL_USER) is wrong.
- **Empty inbox, no errors** — auth works, just no new mail. Send a test and wait 60s.
