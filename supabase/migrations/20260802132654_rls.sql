-- The Saturday Quiz, row level security.
-- RLS is enabled on every table. With RLS enabled and no matching policy,
-- access is denied by default, so only the listed access exists:
--   anon: read visible quizzes, categories, questions. Nothing else.
--         All writes go through the submit_quiz function, so anon has no
--         direct insert policies on responses or quiz_completions.
--   authenticated (the two admins): full CRUD on quiz content, read access
--         to raw responses and completions for analytics.

alter table quizzes enable row level security;
alter table categories enable row level security;
alter table questions enable row level security;
alter table responses enable row level security;
alter table quiz_completions enable row level security;

-- Belt and braces on top of RLS: remove the default table grants that
-- Supabase gives anon on the raw response tables. Even if a permissive
-- policy were added by mistake later, anon still could not touch them.
revoke all on responses from anon;
revoke all on quiz_completions from anon;
revoke insert, update, delete on responses from authenticated;
revoke insert, update, delete on quiz_completions from authenticated;

-- quizzes
create policy "anon can read visible quizzes"
  on quizzes for select
  to anon
  using (
    status = 'published'
    or (status = 'scheduled' and publish_at <= now())
  );

create policy "admins have full access to quizzes"
  on quizzes for all
  to authenticated
  using (true)
  with check (true);

-- categories
create policy "anon can read categories of visible quizzes"
  on categories for select
  to anon
  using (is_quiz_visible(quiz_id));

create policy "admins have full access to categories"
  on categories for all
  to authenticated
  using (true)
  with check (true);

-- questions
create policy "anon can read questions of visible quizzes"
  on questions for select
  to anon
  using (is_quiz_visible(quiz_id));

create policy "admins have full access to questions"
  on questions for all
  to authenticated
  using (true)
  with check (true);

-- responses: no anon policies at all. Inserts happen inside submit_quiz,
-- which runs as the function owner. Admins can read for analytics.
create policy "admins can read responses"
  on responses for select
  to authenticated
  using (true);

-- quiz_completions: same shape as responses.
create policy "admins can read completions"
  on quiz_completions for select
  to authenticated
  using (true);
