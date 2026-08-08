-- The Quizz, guards for withdrawn editions.

-- A withdrawn edition still has real responses and completions pointing at
-- its questions, so its content stays locked exactly as a live one's does.
--
-- Written as "anything that is not a draft" rather than a list of statuses,
-- so a status added later is protected by default rather than by memory.
-- Deleting a whole quiz still works at any status: the cascade removes the
-- parent row first, so the lookup below finds nothing and the delete
-- proceeds.
create or replace function block_live_content_removal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status quiz_status;
begin
  select status into v_status from quizzes where id = old.quiz_id;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'cannot delete content from a % edition, edit in place instead', v_status;
  end if;
  return old;
end;
$$;
