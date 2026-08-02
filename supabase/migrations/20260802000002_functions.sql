-- The Saturday Quiz, functions.
-- Visibility helper, structural completeness guard, stats functions, and the
-- single batch submission function. Stats and submission are SECURITY DEFINER
-- so the public client never needs read or write access to raw response rows.

-- A quiz is visible to the public when published, or scheduled with a
-- publish time that has passed.
create function is_quiz_visible(p_quiz_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from quizzes q
    where q.id = p_quiz_id
      and (
        q.status = 'published'
        or (q.status = 'scheduled' and q.publish_at <= now())
      )
  );
$$;

-- Structural completeness guard. A quiz cannot become scheduled or published
-- unless it has exactly 4 categories with non-empty names and exactly 16
-- questions with non-empty question and answer text. The admin UI performs
-- the same check as a friendly layer, the database enforces it.
create function enforce_quiz_completeness()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total_categories int;
  v_named_categories int;
  v_total_questions int;
  v_complete_questions int;
begin
  select count(*), count(*) filter (where length(trim(name)) > 0)
    into v_total_categories, v_named_categories
    from categories where quiz_id = new.id;

  select count(*), count(*) filter (
      where length(trim(question_text)) > 0 and length(trim(answer_text)) > 0
    )
    into v_total_questions, v_complete_questions
    from questions where quiz_id = new.id;

  if v_total_categories <> 4 or v_named_categories <> 4 then
    raise exception 'quiz must have exactly 4 categories with non-empty names (has %, % named)',
      v_total_categories, v_named_categories;
  end if;

  if v_total_questions <> 16 or v_complete_questions <> 16 then
    raise exception 'quiz must have exactly 16 questions with non-empty question and answer text (has %, % complete)',
      v_total_questions, v_complete_questions;
  end if;

  return new;
end;
$$;

create trigger quiz_completeness_check
  before insert or update on quizzes
  for each row
  when (new.status in ('scheduled', 'published'))
  execute function enforce_quiz_completeness();

-- Per-question stats: response count and percentage correct.
-- Anon callers only get stats for visible quizzes.
create function get_question_stats(p_quiz_id uuid)
returns table (question_id uuid, response_count bigint, pct_correct int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    q.id,
    count(r.id),
    case
      when count(r.id) > 0
      then round(100.0 * count(*) filter (where r.correct) / count(r.id))::int
      else null
    end
  from questions q
  left join responses r on r.question_id = q.id
  where q.quiz_id = p_quiz_id
    and (is_quiz_visible(p_quiz_id) or auth.role() = 'authenticated')
  group by q.id;
$$;

-- Per-quiz stats: completion count and average score rounded to a whole number.
create function get_quiz_stats(p_quiz_id uuid)
returns table (completion_count bigint, avg_score int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*), round(avg(score))::int
  from quiz_completions
  where quiz_id = p_quiz_id
    and (is_quiz_visible(p_quiz_id) or auth.role() = 'authenticated');
$$;

-- Archive stats for all quizzes visible to the caller, one call for the
-- archive page and the admin overview.
create function get_archive_stats()
returns table (quiz_id uuid, completion_count bigint, avg_score int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select q.id, count(c.id), round(avg(c.score))::int
  from quizzes q
  left join quiz_completions c on c.quiz_id = q.id
  where q.status = 'published'
     or (q.status = 'scheduled' and q.publish_at <= now())
     or auth.role() = 'authenticated'
  group by q.id;
$$;

-- Single batch submission. Marks are held client-side until all 16 questions
-- are marked, then submitted once. In one transaction this validates the quiz
-- and the marks, inserts the 16 response rows, computes the score server-side,
-- and inserts the completion row. It fails cleanly and changes nothing if the
-- device already submitted this quiz.
create function submit_quiz(p_quiz_id uuid, p_session_id uuid, p_marks jsonb)
returns table (score int, completion_count bigint, avg_score int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_score int;
  v_question_count int;
begin
  if p_session_id is null then
    raise exception 'session id is required';
  end if;

  if not is_quiz_visible(p_quiz_id) then
    raise exception 'quiz is not available';
  end if;

  if exists (
    select 1 from quiz_completions c
    where c.quiz_id = p_quiz_id and c.session_id = p_session_id
  ) then
    raise exception 'this device already submitted this quiz';
  end if;

  select count(*) into v_question_count from questions q where q.quiz_id = p_quiz_id;
  if v_question_count <> 16 then
    raise exception 'quiz is malformed';
  end if;

  if p_marks is null or jsonb_typeof(p_marks) <> 'object' then
    raise exception 'marks must be an object of question id to boolean';
  end if;

  if (select count(*) from jsonb_object_keys(p_marks)) <> 16 then
    raise exception 'exactly 16 marks are required';
  end if;

  if exists (
    select 1 from jsonb_each(p_marks) m
    where jsonb_typeof(m.value) <> 'boolean'
  ) then
    raise exception 'every mark must be true or false';
  end if;

  if exists (
    select 1 from jsonb_object_keys(p_marks) k
    where not exists (
      select 1 from questions q
      where q.id = k::uuid and q.quiz_id = p_quiz_id
    )
  ) then
    raise exception 'marks must match the questions of this quiz';
  end if;

  insert into responses (question_id, session_id, correct)
  select (m.key)::uuid, p_session_id, (m.value = 'true'::jsonb)
  from jsonb_each(p_marks) m;

  select count(*)::int into v_score
  from jsonb_each(p_marks) m
  where m.value = 'true'::jsonb;

  insert into quiz_completions (quiz_id, session_id, score)
  values (p_quiz_id, p_session_id, v_score);

  return query
  select
    v_score,
    (select count(*) from quiz_completions c where c.quiz_id = p_quiz_id),
    (select round(avg(c.score))::int from quiz_completions c where c.quiz_id = p_quiz_id);
end;
$$;

-- Function privileges. Postgres grants execute to public by default,
-- so revoke first and grant explicitly.
revoke all on function is_quiz_visible(uuid) from public;
revoke all on function enforce_quiz_completeness() from public;
revoke all on function get_question_stats(uuid) from public;
revoke all on function get_quiz_stats(uuid) from public;
revoke all on function get_archive_stats() from public;
revoke all on function submit_quiz(uuid, uuid, jsonb) from public;

grant execute on function is_quiz_visible(uuid) to anon, authenticated;
grant execute on function get_question_stats(uuid) to anon, authenticated;
grant execute on function get_quiz_stats(uuid) to anon, authenticated;
grant execute on function get_archive_stats() to anon, authenticated;
grant execute on function submit_quiz(uuid, uuid, jsonb) to anon, authenticated;
