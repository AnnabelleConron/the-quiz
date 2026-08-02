-- The Quizz, delete guard for live content.
-- Categories and questions cannot be deleted from a scheduled or published
-- quiz, so live quizzes can never fall below 4 categories or 16 questions.
-- Draft quizzes stay freely editable. Deleting a whole quiz still works at
-- any status: the cascade removes the parent row first, so by the time these
-- triggers fire the quiz lookup finds nothing and the delete is allowed.

create function block_live_content_removal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status quiz_status;
begin
  select status into v_status from quizzes where id = old.quiz_id;
  if v_status in ('scheduled', 'published') then
    raise exception 'cannot delete from a % quiz, set it back to draft is not supported, edit in place instead', v_status;
  end if;
  return old;
end;
$$;

revoke all on function block_live_content_removal() from public;

create trigger category_delete_guard
  before delete on categories
  for each row
  execute function block_live_content_removal();

create trigger question_delete_guard
  before delete on questions
  for each row
  execute function block_live_content_removal();
