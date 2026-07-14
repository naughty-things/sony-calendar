# SONY Content Calendar

Internal tool for managing SONY's social content calendar. AI agent
has a dedicated email address; team forwards emails to it and the
agent creates draft posts for human review.

## Stack
- **Next.js 14** (App Router) + TypeScript
- **Supabase** (Postgres + RLS-ready schema)
- **Gmail (Google Workspace)** shared mailbox `agent@naughtythings.com.hk`
  — polled every 60s via the Gmail API using a service account with domain-wide delegation
- **MiniMax (MiniMax-M3)** for email parsing + copy drafting (Anthropic-compat API)
- **Tailwind** UI
- Deploy: **Railway**

## Setup

1. **Supabase**
   - Create a new project
   - Run `supabase/schema.sql`
   - The schema enables RLS and exposes only approved/posted rows and a limited
     column set through `public_calendar_posts` for anonymous viewers.
   - Existing deployments must also apply
     `supabase/migrations/20260714071434_security_hardening.sql`.
   - Create the Supabase Auth admin as `sam.lee@naughtythings.com.hk`; database
     policies reject every other authenticated identity.
   - Seed at least one SONY team member / client contact:
     ```sql
     insert into people (client_id, name, email, side, role)
     select id, 'Sam Lee', 'sam.lee@naughtythings.com.hk', 'internal', 'PM'
     from clients where slug = 'sony';
     ```

2. **Gmail inbox** — see `docs/GMAIL_SETUP.md` for the step-by-step
   - Workspace admin creates `agent@naughtythings.com.hk`
   - Create a Google Cloud service account with Gmail API access
   - Enable domain-wide delegation for `https://www.googleapis.com/auth/gmail.readonly`
   - Put `GMAIL_SA_EMAIL`, `GMAIL_SA_PRIVATE_KEY`, and `GMAIL_USER` into your env vars

3. **Environment**
   - Copy `.env.example` → `.env` and fill in
   - `MINIMAX_API_KEY` — MiniMax API key for the Anthropic-compatible endpoint
   - `POLL_SECRET` — required in production to lock down the poll endpoints;
     send it in an authorization header, never a query string
   - `INBOUND_ALLOWED_DOMAINS` — comma-separated domains allowed to forward
     messages for AI ingestion (defaults to `naughtythings.com.hk`)
   - (Optional) `COPY_TEMPLATE` — the template Sam will provide
     later for AI copy generation

4. **Run**
   ```bash
   npm install
   npm run dev
   ```

## Workflow

| Step | Who | What |
|------|-----|------|
| 1 | Internal team | Sends (or forwards) email to `agent@naughtythings.com.hk` |
| 2 | App | Polls the inbox every 60s, picks up new messages |
| 3 | AI agent | Parses date, platform, title, people mentioned |
| 4 | AI agent | Places every email-derived post in private `staging`; model confidence is audit metadata only |
| 5 | Sam / PIC | Opens calendar, reviews the new chip |
| 6 | Sam / PIC | Assigns internal PIC, client PIC, internal assignee, sets real status |
| 7 | Designer / copywriter | Works the post, moves it through statuses |
| 8 | Sam | Schedules / posts |

**Nothing auto-publishes.** Every email-derived item starts in private staging
and needs an explicit staff save before it can advance. Anonymous viewers see
only approved or posted calendar items.

## Views

- **Month grid** — overview, click a day to create, click a chip to edit
- **Week kanban** — same data, 7 columns, chips show status + people pills

## Statuses

`staging → in_progress → client_review → approved → posted`

`staging` is the inbox for incomplete or low-confidence email ingests.

## Adding a second client later

The schema is already multi-tenant (everything scoped by `client_id`).
Just insert another row into `clients` and tag people + posts with
its id. No migration needed.
