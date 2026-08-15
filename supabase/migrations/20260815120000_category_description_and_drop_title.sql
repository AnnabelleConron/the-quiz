-- The Quizz, category explainers and the end of edition titles.
--
-- categories.description is an optional short explanation of how a category's
-- questions work, shown under the category name where its section begins. It
-- is nullable and never required: enforce_quiz_completeness() counts named
-- categories and complete questions only, so an edition whose explainers are
-- all blank still schedules and still publishes.
--
-- quizzes.title goes with it. Editions are identified by their number alone,
-- nothing reads or writes the column any more, and leaving it would keep a
-- second identity available for an edition to acquire.
--
-- No grant changes are needed. The grants in 20260802132951_grants.sql are
-- table level, so select and update on categories already reach the new
-- column, and RLS has no column-level policies.

alter table categories add column description text;

alter table quizzes drop column title;
