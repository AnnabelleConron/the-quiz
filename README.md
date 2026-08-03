# The Quizz

A weekly quiz in the style of Australian newspaper quizzes. A new edition is published every Saturday with 4 categories and 16 questions. Groups play together on one device, reveal answers upside down, mark themselves with a tick or a cross, and submit once per device per quiz.

Static Astro frontend on Cloudflare Pages, Supabase (Postgres, Auth, Row Level Security) as the only backend. Quiz content and stats are fetched client side at runtime, so new editions and live stats never require a rebuild.

## Local development

Requirements: Node 22 or later.

```sh
npm install
cp .env.example .env   # then fill in the values, see Environment below
npm run dev            # http://localhost:4321
```

For a production-faithful preview including the Cloudflare redirect rules:

```sh
npm run build
npx wrangler pages dev dist
```

## Environment

Two variables, both safe to expose to the browser. They live in `.env` locally (gitignored) and in the Cloudflare Pages settings in production.

| Variable | Value |
| --- | --- |
| `PUBLIC_SUPABASE_URL` | The Supabase project URL, Dashboard, Settings, API |
| `PUBLIC_SUPABASE_ANON_KEY` | The publishable key (`sb_publishable_...`), same page |

Never put the secret key (`sb_secret_...`) in this repo, in `.env`, or in Cloudflare. The publishable key is the only key the site uses. Row Level Security and SECURITY DEFINER functions in the database enforce all access rules.

## Cloudflare Pages settings

| Setting | Value |
| --- | --- |
| Framework preset | Astro |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variables | `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` |

`npm run build` runs `astro build` and then `scripts/generate-redirects.mjs`. The script writes `dist/_redirects` with an exact rule for every prerendered edition followed by a `/quiz/*` catch-all. This matters because Cloudflare evaluates redirects before static assets: without the exact rules the catch-all would mask the prerendered edition pages and their per-edition Open Graph tags. The catch-all lets editions published after the last deploy resolve at their permalinks through a client-rendered shell. No manual step is involved, any standard Pages build produces the correct file.

After changing the production domain, update `site` in `astro.config.mjs` so canonical URLs and Open Graph tags point at the right host.

## Database

The schema, functions, RLS policies, and grants live in `supabase/migrations/` and are already applied to the project. `supabase/seed.sql` documents the sample data (edition 1).

Key properties:

- Anonymous visitors can read only published quizzes (or scheduled ones whose publish time has passed). Drafts are not retrievable in any way.
- The public client cannot read or write raw response rows. Submissions go through the `submit_quiz` function, which validates the marks, computes the score server side, and inserts everything in one transaction, once per device per quiz.
- Stats come from `get_question_stats`, `get_quiz_stats`, and `get_archive_stats`.
- A trigger blocks scheduling or publishing a quiz unless it has exactly 4 named categories and 16 complete questions, and blocks deleting content from a live quiz. Deleting a whole quiz cascades cleanly at any status.

## Admin

The CMS is at `/admin`: dashboard, quiz editor with a completeness check, public-identical preview, and analytics. There is no signup flow.

To create the two admin accounts: Supabase Dashboard, Authentication, Users, Add user, with Auto Confirm enabled. Any authenticated user has full admin access, so create accounts only for admins.

Recommended: enable leaked password protection under Authentication, Passwords before creating the accounts.

Publish times are entered and shown as Sydney wall-clock time and stored as UTC. New quizzes default to the next Saturday at 6:00am Sydney time, correct across AEST and AEDT.

## Web analytics

The Cloudflare Web Analytics beacon is in `src/layouts/Base.astro`. Replace `REPLACE_WITH_YOUR_TOKEN` with the real token from the Cloudflare dashboard, Analytics, Web Analytics. It collects no cookies and no personal data.

## Pre-launch checklist

1. Delete the sample quiz wholesale. One statement cascades through categories, questions, responses, and completions:
   ```sql
   delete from quizzes where edition_number = 1;
   ```
2. Set the real production domain in `astro.config.mjs` (`site`).
3. Paste the real Cloudflare Web Analytics token in `src/layouts/Base.astro`.
4. Redeploy, then verify the zero state on a fresh device in production: no stat lines, no social proof line, and the first submission shows the score with no average.
5. Confirm `/quiz/1` returns "not available" after the seed deletion, and that the current edition's permalink serves its own Open Graph tags (paste the link into a social preview checker).
