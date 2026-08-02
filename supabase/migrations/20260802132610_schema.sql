-- The Saturday Quiz, core schema.
-- Tables, constraints, and indexes. RLS and functions follow in later migrations.

create type quiz_status as enum ('draft', 'scheduled', 'published');

create table quizzes (
  id uuid primary key default gen_random_uuid(),
  edition_number int not null unique,
  title text,
  publish_at timestamptz not null,
  status quiz_status not null default 'draft',
  created_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes(id) on delete cascade,
  name text not null,
  sort_order int not null check (sort_order between 1 and 4),
  unique (quiz_id, sort_order)
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  sort_order int not null check (sort_order between 1 and 16),
  question_text text not null,
  answer_text text not null,
  unique (quiz_id, sort_order)
);

create table responses (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  session_id uuid not null,
  correct boolean not null,
  created_at timestamptz not null default now(),
  -- one mark per question per device, extra hardening beyond localStorage
  unique (question_id, session_id)
);

create table quiz_completions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes(id) on delete cascade,
  session_id uuid not null,
  score int not null check (score between 0 and 16),
  created_at timestamptz not null default now(),
  -- one submission per device per quiz
  unique (quiz_id, session_id)
);

create index idx_categories_quiz on categories (quiz_id);
create index idx_questions_quiz on questions (quiz_id);
create index idx_questions_category on questions (category_id);
create index idx_responses_question on responses (question_id);
create index idx_completions_quiz on quiz_completions (quiz_id);
create index idx_quizzes_status_publish on quizzes (status, publish_at);
