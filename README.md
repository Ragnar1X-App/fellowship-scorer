# Fellowship Scorer — Netlify + Supabase build

Ported from the Claude.ai artifact prototype. Same scoring logic, same document-verification
pipeline, now with a real backend that can actually fetch documents automatically.

## What this does

1. Upload the raw Excel export from the fellowship portal (must be the direct download —
   opening/re-saving through Google Sheets strips the hyperlink formulas this relies on)
2. The app reads the real document URLs hidden behind each "Download..." cell
3. For each student, a Netlify Function fetches their documents directly from the portal,
   reads them with Claude, matches/scores everything, and saves the result to Supabase
4. Results table + CSV export

## Setup

### 1. Supabase
- Create a project at supabase.com (or use one you already have)
- Run `supabase/schema.sql` in the SQL editor — creates `base_projects`, `nirf_list`,
  `batches`, `scores` tables
- Grab your Project URL and **service_role** key (Settings > API) — not the anon key,
  the functions need full write access

### 2. Seed the base dataset (one-time)
Once deployed, POST your existing base project list and NIRF ranking list to
`/api/base-data` to seed the tables — or insert directly via the Supabase SQL editor /
table editor if you'd rather just paste the data in.

### 3. Local development
```bash
npm install
cp .env.example .env   # fill in your real keys
npx netlify dev        # runs frontend + functions together, needs Netlify CLI
```

### 4. Deploy
```bash
npm install -g netlify-cli   # if you don't have it
netlify login
netlify init                 # links this folder to a Netlify site
netlify deploy --prod
```
Then set the three environment variables (`ANTHROPIC_API_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`) in Netlify's dashboard under Site settings > Environment
variables — do this before your first prod deploy actually gets used, functions will
error without them.

## Architecture notes

- **Sized for ~100 applicants per batch**, not 1,000+. Processing is one Netlify Function
  call per student (fetches their docs, runs extraction, scores, saves), called from the
  frontend with a concurrency limit of 4. No queue system, no background jobs — deliberately
  kept simple at this scale. Revisit if batch size grows well past 100.
- **`scores` table has a `status` column** for resumability — if a batch is interrupted
  partway through, only reprocess students not already marked `done` (this isn't wired into
  the frontend loop yet — currently reprocesses everyone on retry; cheap fix if needed).
- **Document fetching is plain server-side `fetch()`** — not subject to browser CORS, not
  subject to `robots.txt` (that only applies to crawler-style tools like Claude's own fetch
  tool, not a normal HTTP client).

## Known gaps not yet built (carried over from the artifact conversation)

- **CGPA cross-check**: extraction pulls `cgpaOrLatestMarks` from documents but nothing
  compares it against the spreadsheet's claimed value yet.
- **Course/subject verification**: extraction now pulls `courseSubjects` off marksheets
  (new in this build) but nothing cross-checks them against the claimed AI courses yet.
- **Guest-teacher detection**: currently a keyword match (`guest|adjunct|visiting`) on the
  guide's designation — fragile, not exhaustive.
- **Per-institute quota (max 10) + CGPA tiebreaker**: explicitly deferred, not implemented.
- **Within-batch duplicate detection**: uniqueness only checks against the base dataset,
  not against other students in the same batch.
- **"Needs manual review" UI**: the artifact had a dedicated triage view for flagged/
  unmatched students; this build's frontend is intentionally leaner — the data (flags,
  errors) is all in the `scores` table, just not surfaced with the same UI yet.

## Cost estimate (per ~100-student batch)

Roughly $0.30–0.50 total — project-quality judging (~$0.003/student) + document extraction
(~$0.007–0.01/document, ~3 documents/student). See conversation history for the math.

## Deploy the backend to Cloudflare Workers (recommended)

The backend was moved from Netlify Functions to Cloudflare Workers because Workers bill
by CPU time, not wall-clock time — time spent waiting on document fetches or the
Anthropic API doesn't count against the limit. This is what actually fixes the
502/504 timeouts hit on Netlify's default function timeout.

```bash
cd cloudflare-worker
npm install -g wrangler   # if you don't have it
wrangler login
npm install

# Set your 3 secrets (prompts for each value, doesn't echo it back)
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY

wrangler deploy
```

This prints your live Worker URL, something like:
```
https://fellowship-scorer-api.your-subdomain.workers.dev
```

Then point the frontend at it: set `VITE_API_BASE_URL` to that URL in Netlify's
environment variables (same place as your other keys), and redeploy the frontend.
Once this is done, Netlify only needs `VITE_API_BASE_URL` — the Anthropic and Supabase
keys live in the Worker instead.

**Local testing:** `cd cloudflare-worker && npm run dev` runs the Worker locally (needs
a `.dev.vars` file with the same 3 keys — wrangler's local equivalent of `.env`, also
never commit it).

## Alternative: keep the backend on Netlify Functions

The original `netlify/functions/*.js` are still in this repo and still work — the
shared `src/lib/` code was made portable (no `Buffer`, no `process.env` reads inside
the library itself), but Netlify's functions still pass `process.env` explicitly, so
nothing broke. If you'd rather not deal with two platforms, leave `VITE_API_BASE_URL`
unset and the frontend keeps calling Netlify Functions at `/api/*` as before — just
know you may hit the same timeout issue at higher document counts per student.

