-- The Saturday Quiz, table privileges.
-- Tables created through the MCP migration role carry no default grants for
-- the API roles, so every privilege is granted explicitly here. RLS policies
-- then restrict which rows those privileges reach.

grant usage on schema public to anon, authenticated;

-- Public quiz content: anon may read, RLS limits rows to visible quizzes.
grant select on quizzes, categories, questions to anon;

-- Admins: full CRUD on quiz content.
grant select, insert, update, delete on quizzes, categories, questions to authenticated;

-- Raw response data: admins read only. Anon gets nothing, all public writes
-- go through the submit_quiz function.
grant select on responses, quiz_completions to authenticated;
