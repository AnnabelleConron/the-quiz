# Friday 13

A quiz in the style of Australian newspaper quizzes, published on Friday mornings, with 13 questions an edition: three categories of four, then a final question in its own category. It is a hobby, not a wire service: editions come out on Fridays but not every Friday, so no copy on the site promises a weekly cadence and nothing names a future date. Groups play together on one device, reveal answers, mark themselves with a tick or a cross, and submit once per device per quiz.

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

Nothing outside `tokens.css` declares a raw colour, a raw font size, a raw border, a raw leading or a raw measure. If a value is needed that is not there, add a token; do not hardcode it at the call site.

Seven values remain raw in the layout files, and each carries a comment saying why a token would be meaningless:

- the hamburger's own geometry in `.menu-toggle` (its bar width and the gaps between them), which is the drawing of one icon and aligns to nothing
- the 1px box and negative margin in `.visually-hidden`, which are the clipping idiom itself
- the 2px underline offset on the active admin nav link, which is optical and specific to one label at one size
- the `flex-basis` on the editor's Save button, which is a wrapping hint rather than a measure

To check the claim rather than trust it:

```sh
grep -nE "^\s+[a-z-]+:\s*[^;]*\b[0-9]+(px|ch|rem)" src/styles/{base,components,pages,admin}.css | grep -v "var(--"
```

Anything that turns up should be a token or carry a justification beside it.

### The rule system

Every divider on the site is one of three tiers, and each tier means one thing. Using the wrong one is how a design like this comes apart.

| Token | Drawn as | Width | Means |
| --- | --- | --- | --- |
| `--rule-zone` | 3px double | Full bleed | A boundary between parts of the page that differ in kind: masthead to dateline, questions to score. |
| `--rule-section` | 1px solid | Inset to the column | A boundary between sections of the same kind. |
| `--rule-item` | 1px solid, 28% ink | Inset to the column | A separator between rows of one list. |

**Tier decides width as well as weight.** A zone boundary separates parts of the page, so it is the width of the page: every element carrying `--rule-zone` also carries `.bleed`, without exception. Section and item rules divide content and belong to it, so they stay inset and align with the text. A banded ground bleeds for the same reason a zone rule does, its edge being the page's edge.

Closed shapes are exempt, because they are objects rather than dividers: `.editor-confirm` and `.danger-btn` draw their borders at zone weight to say "stop" and stay inside the column.

A fourth, `--rule-component`, is drawn like the section rule but means an edge rather than a division: buttons, mark cells, the bar track. It is named separately so a change to the section rule does not silently redraw every button. `--rule-section-inverse` is the section rule on the ink ground of the admin bar.

Three consequences worth knowing before you edit anything:

- **One boundary, one rule.** A boundary is drawn by exactly one of the two elements that meet at it, never both, or the tiers add together into a line belonging to no tier. Where a washed band opens a section, the band's rule wins and the block above drops its closing rule. Anything declaring a bottom rule directly above something declaring a top rule is a bug.
- **A list closes on a section rule** rather than dropping its separator: the last row still needs a bottom edge, it just needs a heavier one. Suppression is always `:last-child`, never a class, which is why the dashboard rows and the archive rows each sit in a container of their own.
- A struck-through archive row is drawn with `--rule-hairline` and `--rule-faint` as a positioned bar, not `text-decoration: line-through`, so its weight matches every other hairline on the page.

### Type

Three families, three jobs, no overlap. The display serif (Bodoni Moda) sets mastheads, category names and large numerals, and never sets a paragraph. The reading serif (Source Serif 4) sets questions, answers and body copy. The monospace (DM Mono) sets every label, number strip and utility control. In the admin the display serif is held back to page titles only.

Each family has its own scale in `tokens.css`: `--fs-label-*` for mono, `--fs-read-*` for the reading serif, `--fs-display-*` for the display serif. The design depends on the distance between the ends of that ladder, so the steps are deliberately far apart.

Two treatments sit on top of that scale and vary by size alone:

**Mastheads** come at exactly two scales, and carry no kicker: the title alone names the page. `--fs-masthead-front` is the front page and is used by nothing else; `--fs-masthead-inner` is every inner page, public and admin alike, so the header block is one height wherever you land. They share `--lh-masthead`.

Inner pages share their padding too. Home's padding is fluid rather than fixed, tracking its own title at a constant 0.52 of it, so the block holds the same proportions at its larger scale. Because `--fs-masthead-front` clamps down to the inner size on a phone, home's padding lands on `--space-6` there as well, and a narrow home matches a narrow inner page exactly.

The masthead's closing rule is `--rule-item` on every page **but one**: what sits directly beneath it is usually still front matter, a dateline or a count strip, and the zone boundary belongs after that strip rather than before it. **About is the exception.** It has no strip, so its masthead is the whole of its front matter and the boundary that follows the strip elsewhere comes directly after the masthead there. It closes on `--rule-zone` and therefore bleeds, like every other zone rule.

**Display numerals** are one family of objects, applied through the `.numeral` class: one face, one weight, `--lh-numeral` and `--track-display` at every size, from the 132px final score down to a 21px category tally. Anything setting its own leading or tracking on a figure breaks the family.

### Fonts

Self-hosted from `public/fonts`, so the site makes no third-party request and sets no third-party cookie. Static instances rather than variable ones, because only one weight of each family is used and no optical-size variation: 74.2 KB across six files, of which the three latin subsets (42.9 KB) are preloaded in `Base.astro` and the three latin-ext subsets load on demand.

Each family is backed by a metric-matched local fallback declared in `base.css`. The `size-adjust`, `ascent-override` and `descent-override` values were computed from the real font metrics against Georgia and Courier New, so the page does not reflow when the webfonts land. If you change a family, recompute them.

## Database

The schema, functions, RLS policies, and grants live in `supabase/migrations/` and are already applied to the project. `supabase/seed.sql` documents the sample data (edition 1).

Key properties:

- Anonymous visitors can read only published quizzes (or scheduled ones whose publish time has passed). Drafts and withdrawn editions are not retrievable in any way.
- The public pages state that same predicate in the query as well, through `onlyVisible()` in `src/lib/quiz-render.js`, rather than leaving it to RLS. The admin policy on `quizzes` is `for all using (true)`, so a signed-in admin browsing the site would otherwise be shown drafts and withdrawn editions as though they were live, on the quiz permalink, the home page, the archive and its count. `/admin/preview` deliberately does not go through it: it fetches by id with `fetchQuizById()`, which is the point of a preview. The filter is a view correction, not a security boundary; what anyone is allowed to read is still decided by RLS on the server.
- The public client cannot read or write raw response rows. Submissions go through the `submit_quiz` function, which validates the marks, computes the score server side, and inserts everything in one transaction, once per device per quiz.
- Stats come from `get_question_stats`, `get_quiz_stats`, and `get_archive_stats`.
- `categories.description` is an optional one-line explainer of how a category's questions work, shown under the category name where its section begins on the quiz page and nowhere else. It is never required: the completeness trigger counts names and questions only, so an edition with all of them left blank still schedules.
- An edition is identified by its number alone. There is no title column and no title field.
- A trigger blocks scheduling or publishing a quiz unless it has exactly 4 named categories (three regular, plus the final) and 13 complete questions laid out 4/4/4/1, and blocks deleting content from anything that is not a draft. Deleting a whole quiz cascades cleanly at any status.
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

**A publish date on a draft does nothing on its own.** Setting the date and saving does not queue an edition; only Schedule does. That is the mistake that costs a Friday morning, so the editor says so twice over: a save confirmation that reads "Saved as a draft. It will not appear on the site until you press Schedule." rather than the finished-sounding "Saved, all changes stored.", and an action row where Schedule carries the primary treatment while Save steps back to an ordinary button. Both key off the derived state, so on a scheduled, live or withdrawn edition Save is primary again and the confirmation reads plainly, because nothing is outstanding.

Withdrawing takes an edition off the site: gone from home, gone from the archive, and its permalink says it is not available. Nothing is destroyed. Responses and completions stay exactly as they were and come back if it is republished, and the content guard stays on, so its questions cannot be deleted while it is withdrawn.

**`publish_at` stays editable while an edition is withdrawn, and Republish honours it.** A date in the past puts the edition straight back on the site. A date in the future requeues it, which is how an edition is postponed rather than restored; the editor says which of the two happened. Only that distinction stops a nudged date from silently leaving an edition dark.

**Delete is the opposite of withdrawing, and it is available in every state.** It removes the quiz, its questions and answers, every mark and every recorded score, in one cascade. There is no undo and no backup, so the confirmation reads the real counts first and names them: "Delete edition 07 permanently? This removes the quiz, its thirteen questions and answers, 312 recorded scores and 4,056 marks." On a live edition it opens by saying the edition is on the site now. A draft has nothing recorded against it and keeps its original short wording.

The status is re-read at the moment you press Delete, not taken from what the page loaded, so an edition that went live while the tab sat open says so before you confirm.

Deleting the newest edition frees its number: `createQuiz` takes `max(edition_number) + 1`, so the next quiz written reuses it. That is what you want after publishing something by mistake, but it does mean an old link to the deleted edition will eventually resolve to its replacement.

Unschedule only exists before the date arrives, because an edition that was never visible cannot have been played. Once one has gone out, the way back is Unpublish, and the database refuses the other route: returning a live edition or one with recorded scores to `draft` would release the guard on content that real responses point at.

To create the two admin accounts: Supabase Dashboard, Authentication, Users, Add user, with Auto Confirm enabled. Any authenticated user has full admin access, so create accounts only for admins.

Recommended: enable leaked password protection under Authentication, Passwords before creating the accounts.

Publish times are entered and shown as Melbourne wall-clock time and stored as UTC. New quizzes default to the next Friday at 6:00am, correct across AEST and AEDT. The IANA zone in `src/lib/admin.js` is `Australia/Sydney`, which has identical offsets and daylight-saving rules to Melbourne, so it is the same clock.

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
