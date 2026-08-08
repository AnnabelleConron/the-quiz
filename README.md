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

## Styling

One stylesheet, split by role rather than by page. `src/styles/global.css` is the only entry point and is imported once, by `src/layouts/Base.astro`. It does nothing but `@import` the five parts, in this order, which is also the cascade order:

| File | Holds |
| --- | --- |
| `tokens.css` | The `:root` block, and nothing else. Colours, fonts, the type scale, tracking, leading, spacing, rules, column widths. |
| `base.css` | `@font-face`, reset, the ground, base typography, links, focus. |
| `components.css` | Pieces used on more than one page: buttons, fields, marks, bars, the top bar and menu, the footer. |
| `pages.css` | Layout for home, quiz, archive and About. |
| `admin.css` | Layout for `/admin`. |

There is no Tailwind, no CSS modules, and no component-scoped styles. Astro's scoped styles cannot work here: most markup is built at runtime by the `el()` helper in `src/lib/quiz-render.js` and `src/lib/admin.js`, and never receives Astro's scoping attribute.

### The tokens are the contract

Nothing outside `tokens.css` declares a raw colour, a raw font size, or a raw border. If a value is needed that is not there, add a token; do not hardcode it at the call site. The four layout files are checked against this and are clean.

### The rule system

Every divider on the site is one of three tiers, and each tier means one thing. Using the wrong one is how a design like this comes apart.

| Token | Drawn as | Means |
| --- | --- | --- |
| `--rule-zone` | 3px double | A boundary between parts of the page that differ in kind: masthead to dateline, questions to score. |
| `--rule-section` | 1px solid | A boundary between sections of the same kind. |
| `--rule-item` | 1px solid, 28% ink | A separator between rows of one list. |

A fourth, `--rule-component`, is drawn like the section rule but means an edge rather than a division: buttons, mark cells, the bar track. It is named separately so a change to the section rule does not silently redraw every button. `--rule-section-inverse` is the section rule on the ink ground of the admin bar.

Two consequences worth knowing before you edit anything:

- The last item in a list drops its rule (`:last-child`), so nothing stacks against the section rule that opens whatever comes next.
- A struck-through archive row is drawn with `--rule-item` as a positioned bar, not `text-decoration: line-through`, so its weight matches every other hairline on the page.

### Type

Three families, three jobs, no overlap. The display serif (Bodoni Moda) sets mastheads, category names and large numerals, and never sets a paragraph. The reading serif (Source Serif 4) sets questions, answers and body copy. The monospace (DM Mono) sets every label, number strip and utility control. In the admin the display serif is held back to page titles only.

Each family has its own scale in `tokens.css`: `--fs-label-*` for mono, `--fs-read-*` for the reading serif, `--fs-display-*` for the display serif. The design depends on the distance between the ends of that ladder, so the steps are deliberately far apart.

### Fonts

Self-hosted from `public/fonts`, so the site makes no third-party request and sets no third-party cookie. Static instances rather than variable ones, because only one weight of each family is used and no optical-size variation: 74.2 KB across six files, of which the three latin subsets (42.9 KB) are preloaded in `Base.astro` and the three latin-ext subsets load on demand.

Each family is backed by a metric-matched local fallback declared in `base.css`. The `size-adjust`, `ascent-override` and `descent-override` values were computed from the real font metrics against Georgia and Courier New, so the page does not reflow when the webfonts land. If you change a family, recompute them.

## Database

The schema, functions, RLS policies, and grants live in `supabase/migrations/` and are already applied to the project. `supabase/seed.sql` documents the sample data (edition 1).

Key properties:

- Anonymous visitors can read only published quizzes (or scheduled ones whose publish time has passed). Drafts and withdrawn editions are not retrievable in any way.
- The public client cannot read or write raw response rows. Submissions go through the `submit_quiz` function, which validates the marks, computes the score server side, and inserts everything in one transaction, once per device per quiz.
- Stats come from `get_question_stats`, `get_quiz_stats`, and `get_archive_stats`.
- A trigger blocks scheduling or publishing a quiz unless it has exactly 4 named categories and 16 complete questions, and blocks deleting content from anything that is not a draft. Deleting a whole quiz cascades cleanly at any status.
- A trigger blocks returning an edition to `draft` once it has gone out or has recorded scores. Withdrawing is the way back from live, and it keeps the content guard on.

## Admin

The CMS is at `/admin`: dashboard, quiz editor with a completeness check, public-identical preview, and analytics. There is no signup flow.

### The life of an edition

The `status` column holds four values, but the admin shows a **derived** state, because nothing in the app ever promotes `scheduled` to `published`: an edition goes live when its date passes. `editionState()` in `src/lib/admin.js` is the one place that derivation lives.

| Shown | Status and date | Public | Controls |
| --- | --- | --- | --- |
| `draft` | `draft` | no | Schedule, Delete draft |
| `scheduled` | `scheduled`, date ahead | no | Unschedule, Delete edition |
| `live` | `published`, or `scheduled` with the date passed | yes | Unpublish, Delete edition |
| `unpublished` | `unpublished` | no | Republish, Delete edition |

Withdrawing takes an edition off the site: gone from home, gone from the archive, and its permalink says it is not available. Nothing is destroyed. Responses and completions stay exactly as they were and come back if it is republished, and the content guard stays on, so its questions cannot be deleted while it is withdrawn.

**`publish_at` stays editable while an edition is withdrawn, and Republish honours it.** A date in the past puts the edition straight back on the site. A date in the future requeues it, which is how an edition is postponed rather than restored; the editor says which of the two happened. Only that distinction stops a nudged date from silently leaving an edition dark.

**Delete is the opposite of withdrawing, and it is available in every state.** It removes the quiz, its questions and answers, every mark and every recorded score, in one cascade. There is no undo and no backup, so the confirmation reads the real counts first and names them: "Delete edition 07 permanently? This removes the quiz, its sixteen questions and answers, 312 recorded scores and 4,992 marks." On a live edition it opens by saying the edition is on the site now. A draft has nothing recorded against it and keeps its original short wording.

The status is re-read at the moment you press Delete, not taken from what the page loaded, so an edition that went live while the tab sat open says so before you confirm.

Deleting the newest edition frees its number: `createQuiz` takes `max(edition_number) + 1`, so the next quiz written reuses it. That is what you want after publishing something by mistake, but it does mean an old link to the deleted edition will eventually resolve to its replacement.

Unschedule only exists before the date arrives, because an edition that was never visible cannot have been played. Once one has gone out, the way back is Unpublish, and the database refuses the other route: returning a live edition or one with recorded scores to `draft` would release the guard on content that real responses point at.

To create the two admin accounts: Supabase Dashboard, Authentication, Users, Add user, with Auto Confirm enabled. Any authenticated user has full admin access, so create accounts only for admins.

Recommended: enable leaked password protection under Authentication, Passwords before creating the accounts.

Publish times are entered and shown as Melbourne wall-clock time and stored as UTC. New quizzes default to the next Saturday at 6:00am, correct across AEST and AEDT. The IANA zone in `src/lib/admin.js` is `Australia/Sydney`, which has identical offsets and daylight-saving rules to Melbourne, so it is the same clock.

Every time shown in the interface is labelled **AEST** or **AEDT** for its own instant, by `timeLabel()` in `src/lib/admin.js`. The abbreviation is read out of the zone with `Intl.DateTimeFormat` rather than hardcoded, so it stays correct through any future change to the daylight-saving rules. An edition published in July reads AEST; one published in January reads AEDT. In the editor the label follows what you type, so moving an edition across a daylight-saving boundary relabels the field as you set it.

The dashboard and analytics footers say "All times Melbourne" rather than naming an offset, because a list can span both halves of the year and no single abbreviation would be right for every row in it.

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
