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
   - `MINIMAX_API_KEY` — same as in `/Users/naughty/.openclaw/openclaw.json` (works on Anthropic-compat endpoint)
   - `POLL_SECRET` — recommended in production to lock down the poll endpoints
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
| 4 | AI agent | Routes the post to `staging`, `in_progress`, or `client_review` depending on confidence and completeness |
| 5 | Sam / PIC | Opens calendar, reviews the new chip |
| 6 | Sam / PIC | Assigns internal PIC, client PIC, internal assignee, sets real status |
| 7 | Designer / copywriter | Works the post, moves it through statuses |
| 8 | Sam | Schedules / posts |

**Nothing auto-publishes.** Every email-derived item still needs a
human review before it can be considered done.

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
