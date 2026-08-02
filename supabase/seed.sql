-- The Saturday Quiz, sample data for local testing.
-- Not a migration. Seeds edition 1 as published.
-- The quiz is created as a draft first because the completeness trigger
-- blocks publishing until 4 categories and 16 questions exist.
-- To remove the sample data later, a single delete cascades through
-- categories, questions, responses, and completions:
--   delete from quizzes where edition_number = 1;

do $$
declare
  v_quiz uuid;
  v_cat uuid;
begin
  insert into quizzes (edition_number, title, publish_at, status)
  values (1, 'Sample edition', timestamptz '2026-08-01 06:00:00+10', 'draft')
  returning id into v_quiz;

  insert into categories (quiz_id, name, sort_order)
  values (v_quiz, 'Geography', 1) returning id into v_cat;
  insert into questions (quiz_id, category_id, sort_order, question_text, answer_text) values
    (v_quiz, v_cat, 1, 'What is the capital of Canada?', 'Ottawa'),
    (v_quiz, v_cat, 2, 'Which river flows through Cairo?', 'The Nile'),
    (v_quiz, v_cat, 3, 'Which country, counting its overseas territories, spans the most time zones?', 'France'),
    (v_quiz, v_cat, 4, 'What is the largest desert in Australia?', 'The Great Victoria Desert');

  insert into categories (quiz_id, name, sort_order)
  values (v_quiz, 'History', 2) returning id into v_cat;
  insert into questions (quiz_id, category_id, sort_order, question_text, answer_text) values
    (v_quiz, v_cat, 5, 'In which year did the Berlin Wall fall?', '1989'),
    (v_quiz, v_cat, 6, 'Who was the first female Prime Minister of Australia?', 'Julia Gillard'),
    (v_quiz, v_cat, 7, 'Which Roman city was buried by the eruption of Mount Vesuvius in 79 AD?', 'Pompeii'),
    (v_quiz, v_cat, 8, 'Who was the first President of the United States?', 'George Washington');

  insert into categories (quiz_id, name, sort_order)
  values (v_quiz, 'Science and nature', 3) returning id into v_cat;
  insert into questions (quiz_id, category_id, sort_order, question_text, answer_text) values
    (v_quiz, v_cat, 9, 'What is the chemical symbol for gold?', 'Au'),
    (v_quiz, v_cat, 10, 'What is the largest planet in the solar system?', 'Jupiter'),
    (v_quiz, v_cat, 11, 'What gas do plants absorb from the atmosphere during photosynthesis?', 'Carbon dioxide'),
    (v_quiz, v_cat, 12, 'What is the only mammal capable of true flight?', 'The bat');

  insert into categories (quiz_id, name, sort_order)
  values (v_quiz, 'Sport', 4) returning id into v_cat;
  insert into questions (quiz_id, category_id, sort_order, question_text, answer_text) values
    (v_quiz, v_cat, 13, 'How many players from one team are on court in netball?', 'Seven'),
    (v_quiz, v_cat, 14, 'Which country has won the most FIFA World Cups?', 'Brazil'),
    (v_quiz, v_cat, 15, 'In which sport do Australia and England contest the Ashes?', 'Cricket'),
    (v_quiz, v_cat, 16, 'How often are the Summer Olympic Games held?', 'Every four years');

  update quizzes set status = 'published' where id = v_quiz;
end $$;
