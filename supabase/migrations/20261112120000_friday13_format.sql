-- Friday 13, 13-question format.
-- An edition is now three categories of four questions (1 to 12), then a
-- final category holding the thirteenth question alone. That is still four
-- category rows, so the categories sort_order check is unchanged.
--
-- The 16-question format is dropped. Any edition still in that shape was a
-- test and is deleted; the cascade takes its categories, questions,
-- responses and completions with it. The delete guards allow removing a
-- whole quiz in any state.

delete from quizzes
where (select count(*) from questions q where q.quiz_id = quizzes.id) = 16;

alter table questions drop constraint questions_sort_order_check;
alter table questions
  add constraint questions_sort_order_check check (sort_order between 1 and 13);

alter table quiz_completions drop constraint quiz_completions_score_check;
alter table quiz_completions
  add constraint quiz_completions_score_check check (score between 0 and 13);

-- Structural completeness guard. A quiz cannot become scheduled or published
-- unless it has exactly 4 named categories and exactly 13 complete questions,
-- laid out 4/4/4/1: categories 1 to 3 hold four questions each, and category
-- 4 holds only question 13. The admin UI performs the same check as a
-- friendly layer, the database enforces it.
create or replace function enforce_quiz_completeness()
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
  v_misplaced int;
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

  if v_total_questions <> 13 or v_complete_questions <> 13 then
    raise exception 'quiz must have exactly 13 questions with non-empty question and answer text (has %, % complete)',
      v_total_questions, v_complete_questions;
  end if;

  -- Questions 1 to 12 sit four to a category in categories 1 to 3, and
  -- question 13 sits in category 4.
  select count(*) into v_misplaced
    from questions q
    join categories c on c.id = q.category_id
    where q.quiz_id = new.id
      and c.sort_order <> case when q.sort_order = 13 then 4 else (q.sort_order - 1) / 4 + 1 end;

  if v_misplaced > 0 then
    raise exception 'quiz must have questions 1-12 four to a category in categories 1-3, and question 13 alone in category 4 (% misplaced)',
      v_misplaced;
  end if;

  return new;
end;
$$;

-- Single batch submission, now for 13 questions. Marks are held client-side
-- until all 13 questions are marked, then submitted once. In one transaction
-- this validates the quiz and the marks, inserts the 13 response rows,
-- computes the score server-side, and inserts the completion row. It fails
-- cleanly and changes nothing if the device already submitted this quiz.
create or replace function submit_quiz(p_quiz_id uuid, p_session_id uuid, p_marks jsonb)
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
  if v_question_count <> 13 then
    raise exception 'quiz is malformed';
  end if;

  if p_marks is null or jsonb_typeof(p_marks) <> 'object' then
    raise exception 'marks must be an object of question id to boolean';
  end if;

  if (select count(*) from jsonb_object_keys(p_marks)) <> 13 then
    raise exception 'exactly 13 marks are required';
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

-- create or replace keeps existing grants, but restate them so this file
-- reads complete on its own.
revoke all on function enforce_quiz_completeness() from public;
revoke all on function submit_quiz(uuid, uuid, jsonb) from public;
grant execute on function submit_quiz(uuid, uuid, jsonb) to anon, authenticated;
