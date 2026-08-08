-- The Quizz, status transition guard.
--
-- Unschedule exists for an edition that never went out: it is still
-- scheduled, its morning has not arrived, so nobody can have played it.
-- Returning that to draft is safe.
--
-- Once an edition has been visible the only way back is 'unpublished', which
-- keeps the delete guard on. Dropping it to 'draft' instead would unlock
-- deleting questions that real responses point at, and would put "Delete
-- draft" in the editor on an edition people have scores for. That is the one
-- path in this feature that can reach data loss, so it is enforced here as
-- well as in the editor.
--
-- enforce_quiz_completeness() only fires on the way in, its WHEN clause
-- tests new.status alone, so nothing else watches the way out.
--
-- Every other transition (scheduled, published and unpublished between
-- themselves) is reversible and harmless, so they stay open.

create function enforce_quiz_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'draft' and old.status <> 'draft' then
    if old.publish_at <= now() then
      raise exception
        'edition % has already gone out, withdraw it rather than returning it to draft',
        old.edition_number;
    end if;
    if exists (select 1 from quiz_completions c where c.quiz_id = old.id) then
      raise exception
        'edition % has recorded scores, withdraw it rather than returning it to draft',
        old.edition_number;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function enforce_quiz_status_transition() from public;

create trigger quiz_status_transition_check
  before update on quizzes
  for each row
  when (old.status is distinct from new.status)
  execute function enforce_quiz_status_transition();
