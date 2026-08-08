-- The Quizz, withdrawal status.
-- A fourth quiz_status for an edition pulled back off the site after it has
-- been out. Distinct from 'draft', which means never written: a withdrawn
-- edition keeps the delete guard on its content, because real responses
-- point at its questions.
--
-- This file adds the label and nothing else. Postgres will not let a new
-- enum label be used in the transaction that added it, and one migration is
-- one transaction, so everything that names 'unpublished' waits for the next
-- migration.
--
-- Nothing downstream needs editing. The anon predicate is
--   status = 'published' or (status = 'scheduled' and publish_at <= now())
-- so a withdrawn edition falls out of the RLS policy on quizzes, out of
-- is_quiz_visible() and therefore the categories and questions policies, and
-- out of get_archive_stats(), by construction rather than by remembering.
--
-- One way door: Postgres has no ALTER TYPE ... DROP VALUE.

alter type quiz_status add value if not exists 'unpublished';
