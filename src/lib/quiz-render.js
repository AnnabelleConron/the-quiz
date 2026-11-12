// Shared client-side quiz renderer.
// Used by the public quiz pages, the home page, and the admin preview,
// so the preview is exactly the public experience.
// All text is set through textContent, never innerHTML.

import { supabase } from './supabase.js';
import { getSessionId, loadProgress, saveProgress } from './session.js';

// The format: three categories of four questions, then a final category
// holding a single question, the thirteenth. Four category rows in all.
export const TOTAL_QUESTIONS = 13;
export const FINAL_QUESTION = 13;

// The last category is the final question's own. It is named by the editor
// like the others, but numbered and banded apart.
export function isFinalCategory(index, categories) {
  return index === categories.length - 1;
}

// Pen-stroke tick and cross, thin stroke, square caps. Static markup only.
const TICK_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M5 12.5 10 17.5 19 6.5"/></svg>';
const CROSS_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square"><path d="M6.5 6.5 17.5 17.5 M17.5 6.5 6.5 17.5"/></svg>';

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

function bySortOrder(a, b) {
  return a.sort_order - b.sort_order;
}

// Edition and question numbers are always set two digits wide, the way a
// masthead sets them.
export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-AU', {
    timeZone: 'Australia/Sydney',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

// The dateline strip wants the weekday and the date in separate cells.
export function formatDateline(iso) {
  const date = new Date(iso);
  return {
    weekday: date.toLocaleDateString('en-AU', {
      timeZone: 'Australia/Sydney',
      weekday: 'long',
    }),
    date: date.toLocaleDateString('en-AU', {
      timeZone: 'Australia/Sydney',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  };
}

// The public view, stated in the query rather than left to RLS alone.
//
// Anonymous visitors are already held to this by the anon policy on quizzes,
// but the admin policy is `for all using (true)`, so a signed-in admin
// browsing the public site would otherwise be served drafts and withdrawn
// editions as though they were live. Every public read of quizzes goes
// through here, so the public pages show the public view to everyone.
//
// The admin preview deliberately does not: it fetches by id through
// fetchQuizById in admin.js and passes the quiz straight to initQuiz, which
// is the whole point of a preview.
//
// The predicate is the one the anon policy and is_quiz_visible() use.
// Judgment call: a PostgREST filter cannot call now(), so the cutoff is the
// browser's clock rather than the server's. A wrong clock only shifts what an
// admin is shown on these pages; what anyone is allowed to read is still
// decided by RLS on the server.
export function onlyVisible(query) {
  const now = new Date().toISOString();
  return query.or('status.eq.published,and(status.eq.scheduled,publish_at.lte.' + now + ')');
}

export async function fetchQuizByEdition(edition) {
  const { data, error } = await onlyVisible(
    supabase
      .from('quizzes')
      .select(
        'id, edition_number, publish_at, categories(id, name, description, sort_order), questions(id, category_id, sort_order, question_text, answer_text)'
      )
      .eq('edition_number', edition)
  ).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchLatestQuiz() {
  const { data, error } = await onlyVisible(
    supabase
      .from('quizzes')
      // No description here: home lists category names only, so the column
      // this page has no use for is not fetched.
      .select(
        'id, edition_number, publish_at, categories(id, name, sort_order), questions(id, category_id, sort_order, question_text, answer_text)'
      )
  )
    .order('edition_number', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data && data[0] ? data[0] : null;
}

export async function fetchQuizStats(quizId) {
  const { data, error } = await supabase.rpc('get_quiz_stats', { p_quiz_id: quizId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export function buildShareText(editionNumber, score) {
  const url = location.origin + '/quiz/' + editionNumber;
  return 'Friday 13 #' + editionNumber + ', ' + score + '/' + TOTAL_QUESTIONS + '\n' + url;
}

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // older browsers or blocked clipboard API
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'absolute';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

// Fires the callback the first time the target is on screen. The quiz uses
// this instead of a submit button: reaching the end of the page is the act
// of finishing.
function whenInView(target, onEnter) {
  let done = false;
  let observer = null;

  function stop() {
    done = true;
    if (observer) observer.disconnect();
    window.removeEventListener('scroll', check);
    window.removeEventListener('resize', check);
  }

  function enter() {
    if (done) return;
    stop();
    onEnter();
  }

  function check() {
    const box = target.getBoundingClientRect();
    if (box.top < window.innerHeight && box.bottom > 0) enter();
  }

  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) enter();
    });
    observer.observe(target);
  }

  // Belt and braces. The observer is the efficient path, but it is the only
  // thing standing between a finished quiz and a recorded score, and its
  // callbacks are tied to the rendering lifecycle. A plain scroll check
  // costs one rect read per event and only until it fires once.
  window.addEventListener('scroll', check, { passive: true });
  window.addEventListener('resize', check);
  check();

  return stop;
}

export async function initQuiz(root, options = {}) {
  root.textContent = 'Loading the quiz.';
  try {
    await render(root, options);
  } catch (err) {
    console.error('[friday13]', err);
    root.replaceChildren(
      el('p', { text: 'Something went wrong loading the quiz. Refresh to try again.' })
    );
  }
}

async function render(root, { edition, preview = false, quiz: presetQuiz = null }) {
  let quiz = presetQuiz;
  if (!quiz) {
    if (edition == null || Number.isNaN(edition)) {
      root.replaceChildren(
        el('p', {}, [
          document.createTextNode('No edition specified. Find every edition in '),
          el('a', { href: '/archive', text: 'the archive' }),
          document.createTextNode('.'),
        ])
      );
      return;
    }
    quiz = await fetchQuizByEdition(edition);
  }
  if (!quiz) {
    // Reached by a link to an edition that was withdrawn, one that has not
    // gone out yet, and one that never existed. The page cannot tell them
    // apart, so the wording stays neutral and offers a way on.
    root.replaceChildren(
      el('p', { class: 'load-error' }, [
        document.createTextNode('Edition ' + edition + ' is not available. Find every edition in '),
        el('a', { href: '/archive', text: 'the archive' }),
        document.createTextNode('.'),
      ])
    );
    return;
  }

  const sessionId = getSessionId();
  const progress = preview ? { revealed: {}, marks: {}, completed: null } : loadProgress(quiz.id);
  const categories = [...(quiz.categories || [])].sort(bySortOrder);
  const questions = [...(quiz.questions || [])].sort(bySortOrder);
  const questionsByCategory = new Map(categories.map((c) => [c.id, []]));
  for (const q of questions) {
    if (questionsByCategory.has(q.category_id)) questionsByCategory.get(q.category_id).push(q);
  }

  let quizStats = null;
  try {
    quizStats = await fetchQuizStats(quiz.id);
  } catch {
    // stats are decorative, the quiz still works without them
  }

  // Per-question stats are fetched once, on the first mark.
  let questionStatsPromise = null;
  function getQuestionStats() {
    if (!questionStatsPromise) {
      questionStatsPromise = supabase
        .rpc('get_question_stats', { p_quiz_id: quiz.id })
        .then(({ data, error }) => {
          if (error) throw error;
          return new Map((data || []).map((r) => [r.question_id, r]));
        })
        .catch(() => new Map());
    }
    return questionStatsPromise;
  }

  const frag = document.createDocumentFragment();

  // --- Masthead, dateline, contents ------------------------------------

  frag.appendChild(
    el('div', { class: 'masthead' }, [
      el('h1', { class: 'masthead-title', text: 'Friday 13' }),
    ])
  );

  const dateline = formatDateline(quiz.publish_at);
  frag.appendChild(
    el('div', { class: 'dateline mono bleed' }, [
      el('span', { text: 'No. ' + pad2(quiz.edition_number) }),
      el('span', { class: 'dateline-date', text: dateline.date }),
      el('span', { text: dateline.weekday }),
    ])
  );

  // Contents: the week's three categories and the final question at
  // masthead scale. The final is numbered 13, after its question, so it
  // stands apart from the three.
  const contentsRows = categories.map((category, index) =>
    el('li', { class: 'contents-row' }, [
      el('span', {
        class: 'contents-num mono',
        text: isFinalCategory(index, categories) ? pad2(FINAL_QUESTION) : pad2(index + 1),
      }),
      el('h2', { class: 'contents-name', text: category.name }),
    ])
  );

  frag.appendChild(
    el('section', { class: 'contents' }, [el('ol', { class: 'contents-list' }, contentsRows)])
  );

  const isCompleted = Boolean(progress.completed);
  const markButtons = [];

  // The end of the page. Holds the score section once the quiz is finished,
  // and the editor's note until then.
  const endSlot = el('div', { class: 'quiz-end' });
  // Announcements for screen readers. Kept outside endSlot so replacing the
  // end content never destroys the live region.
  const statusLine = el('p', { class: 'visually-hidden', role: 'status' });

  function markedCount() {
    return questions.filter((q) => q.id in progress.marks).length;
  }

  function correctCount() {
    return questions.filter((q) => progress.marks[q.id] === true).length;
  }

  function persist() {
    if (!preview) saveProgress(quiz.id, progress);
  }

  // Once the score is set, the marks stop moving. A later tap on a question
  // higher up the page cannot leave the displayed score stale.
  function lockMarking() {
    for (const btn of markButtons) btn.disabled = true;
  }

  function firstUnmarked() {
    return questions.find((q) => !(q.id in progress.marks)) || null;
  }

  // --- The end of the page ---------------------------------------------

  // Scrolled to the end with questions still unmarked. Groups run ahead out
  // of curiosity, so this state has to read as deliberate.
  function buildIncompleteNote() {
    const target = firstUnmarked();
    const note = el('section', { class: 'endnote bleed' });
    if (target) {
      const back = el('button', {
        type: 'button',
        class: 'endnote-back',
        text: 'Back to question ' + pad2(target.sort_order),
      });
      back.addEventListener('click', () => {
        const node = document.getElementById('question-' + target.id);
        if (node) {
          node.scrollIntoView({ behavior: 'smooth', block: 'start' });
          node.focus({ preventScroll: true });
        }
      });
      note.appendChild(back);
    }
    return note;
  }

  function buildScoreHead() {
    return el('div', { class: 'score-head' }, [
      el('p', { class: 'label label-accent', text: 'Your score' }),
      el('p', { class: 'label muted', text: 'Edition No. ' + pad2(quiz.edition_number) }),
    ]);
  }

  // Per-category scores, calculated here from the marks already in
  // localStorage joined to the category each question belongs to. Nothing
  // is asked of the database for this.
  function buildBreakdown() {
    if (markedCount() < TOTAL_QUESTIONS) return null;
    const rows = categories.map((category) => {
      const catQuestions = questionsByCategory.get(category.id) || [];
      const total = catQuestions.length;
      if (total === 0) return null;
      const correct = catQuestions.filter((q) => progress.marks[q.id] === true).length;
      const fill = el('div', { class: 'bar' });
      fill.style.width = Math.round((correct / total) * 100) + '%';
      return el('div', { class: 'breakdown-row' }, [
        el('p', { class: 'breakdown-name', text: category.name }),
        el('p', { class: 'breakdown-score numeral' }, [
          document.createTextNode(String(correct)),
          el('span', { class: 'breakdown-total', text: '/' + total }),
        ]),
        el('div', { class: 'bar-track' }, [fill]),
      ]);
    });
    const kept = rows.filter(Boolean);
    if (kept.length === 0) return null;
    return el('div', { class: 'score-breakdown' }, [
      el('div', { class: 'breakdown-list' }, kept),
    ]);
  }

  function buildScorePanel(score, avgScore, completionCount) {
    const panel = el('section', { class: 'score bleed' }, [
      buildScoreHead(),
      el('p', { class: 'score-figure' }, [
        el('span', { class: 'score-number numeral', text: pad2(score) }),
        el('span', { class: 'score-total numeral', text: '/' + TOTAL_QUESTIONS }),
      ]),
    ]);

    // With a single completion the average is the submitter's own score
    // reflected back, so the line only appears from two completions onward.
    const showAverage = completionCount >= 2 && avgScore != null;
    if (showAverage) {
      panel.appendChild(
        el('div', { class: 'score-stats' }, [
          el('div', { class: 'score-stat' }, [
            el('p', { class: 'label muted', text: "Week's average" }),
            el('p', { class: 'score-stat-value numeral', text: String(avgScore) }),
          ]),
          el('div', { class: 'score-stat' }, [
            el('p', { class: 'label muted', text: 'Players this week' }),
            el('p', { class: 'score-stat-value numeral', text: String(completionCount) }),
          ]),
        ])
      );
    } else if (completionCount === 1) {
      panel.appendChild(
        el('div', { class: 'score-first' }, [
          el('p', { class: 'label muted', text: 'First to finish this week' }),
        ])
      );
    }

    const breakdown = buildBreakdown();
    if (breakdown) panel.appendChild(breakdown);

    const shareBtn = el('button', {
      type: 'button',
      class: 'btn-block',
      text: 'Copy result to share',
    });
    shareBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(buildShareText(quiz.edition_number, score));
      shareBtn.textContent = ok ? 'Copied to clipboard' : 'Copy failed, select the text manually';
    });
    panel.appendChild(el('div', { class: 'score-share' }, [shareBtn]));

    return panel;
  }

  // Submission cannot be retried by scrolling again, so a failure needs its
  // own way back. The reference has no failure state; this is ours.
  function buildSubmitError() {
    // An edition withdrawn mid-play is a dead end: submit_quiz refuses it and
    // no amount of retrying will change that, so say so and offer no button.
    if (submitWithdrawn) {
      return el('section', { class: 'endnote bleed', role: 'alert' }, [
        el('p', {
          class: 'endnote-text',
          text:
            'This edition has been taken off the site, so the score could not be recorded. ' +
            'Your marks are still here on this device.',
        }),
      ]);
    }
    const retry = el('button', { type: 'button', class: 'endnote-back', text: 'Try again' });
    retry.addEventListener('click', () => {
      submitting = false;
      submitFailed = false;
      renderEnd();
      submit();
    });
    return el('section', { class: 'endnote bleed', role: 'alert' }, [
      el('p', {
        class: 'endnote-text',
        text: 'The score could not be sent. Check your connection.',
      }),
      retry,
    ]);
  }

  let submitting = false;
  let submitFailed = false;
  let submitWithdrawn = false;
  let stopWatching = null;

  function renderEnd() {
    if (progress.completed) return;
    if (submitFailed) {
      endSlot.replaceChildren(buildSubmitError());
      return;
    }
    if (markedCount() < TOTAL_QUESTIONS) {
      endSlot.replaceChildren(buildIncompleteNote());
      return;
    }
    // Every question is marked. The section is on the page, so scrolling to
    // it is what submits.
    endSlot.replaceChildren(el('section', { class: 'score bleed' }, [buildScoreHead()]));
    if (!stopWatching && !submitting) {
      stopWatching = whenInView(endSlot, () => {
        stopWatching = null;
        submit();
      });
    }
  }

  function complete(score, avgScore, completionCount) {
    progress.completed = { score, avg: avgScore, count: completionCount };
    persist();
    lockMarking();
    endSlot.replaceChildren(buildScorePanel(score, avgScore, completionCount));
    statusLine.textContent = 'Your score, ' + score + ' out of ' + TOTAL_QUESTIONS + '.';
  }

  async function submit() {
    if (submitting || progress.completed) return;
    if (markedCount() < TOTAL_QUESTIONS) return;
    submitting = true;

    if (preview) {
      complete(correctCount(), null, 0);
      return;
    }

    const marks = {};
    for (const q of questions) marks[q.id] = progress.marks[q.id] === true;

    const { data, error } = await supabase.rpc('submit_quiz', {
      p_quiz_id: quiz.id,
      p_session_id: sessionId,
      p_marks: marks,
    });

    if (error) {
      if (/already submitted/i.test(error.message)) {
        // Server has a completion for this device, honour it.
        let avg = null;
        let count = 0;
        try {
          const fresh = await fetchQuizStats(quiz.id);
          avg = fresh ? fresh.avg_score : null;
          count = fresh ? Number(fresh.completion_count) : 0;
        } catch {
          avg = null;
        }
        complete(correctCount(), avg, count);
        return;
      }
      submitting = false;
      submitFailed = true;
      // submit_quiz raises this when the edition is no longer visible, which
      // means it was withdrawn while this group was playing.
      submitWithdrawn = /not available/i.test(error.message);
      renderEnd();
      statusLine.textContent = submitWithdrawn
        ? 'This edition has been taken off the site, so the score could not be recorded.'
        : 'The score could not be sent.';
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    complete(row.score, row.avg_score, Number(row.completion_count));
  }

  // --- Questions --------------------------------------------------------

  function showStat(questionId, statNode) {
    getQuestionStats().then((map) => {
      const s = map.get(questionId);
      // Real numbers or nothing: with zero responses the line does not exist.
      if (!s || Number(s.response_count) < 1 || s.pct_correct == null) return;
      statNode.textContent = s.pct_correct + '% of players got this right';
      statNode.classList.remove('hidden');
      statNode.classList.add('fade-in');
    });
  }

  function buildQuestion(q) {
    // The hidden prefix gives the answer context when focus lands here.
    const answer = el('span', { class: 'answer', tabindex: '-1' }, [
      el('span', { class: 'visually-hidden', text: 'Answer: ' }),
      document.createTextNode(q.answer_text),
    ]);
    const answerRow = el('div', { class: 'answer-row hidden' }, [answer]);
    const revealBtn = el('button', {
      type: 'button',
      class: 'reveal-btn',
      'aria-label': 'Reveal answer to question ' + q.sort_order,
      text: 'Reveal answer ↓',
    });
    const revealRow = el('div', { class: 'reveal-row' }, [revealBtn]);
    const tick = el('button', {
      type: 'button',
      class: 'mark-btn',
      'aria-label': 'Mark question ' + q.sort_order + ' correct',
      'aria-pressed': 'false',
    });
    tick.innerHTML = TICK_SVG;
    const cross = el('button', {
      type: 'button',
      class: 'mark-btn',
      'aria-label': 'Mark question ' + q.sort_order + ' incorrect',
      'aria-pressed': 'false',
    });
    cross.innerHTML = CROSS_SVG;
    markButtons.push(tick, cross);
    const stat = el('p', { class: 'stat mono hidden', 'aria-live': 'polite' });
    const marksRow = el('div', { class: 'marks-row hidden' }, [
      el('span', { class: 'marks' }, [tick, cross]),
      stat,
    ]);

    function reveal(save) {
      answerRow.classList.remove('hidden');
      marksRow.classList.remove('hidden');
      revealRow.remove();
      if (save) {
        progress.revealed[q.id] = true;
        persist();
        // The reveal button just disappeared from under the keyboard user,
        // so move focus to the answer and let screen readers announce it.
        answer.focus();
      }
    }

    function applyMark(correct, save) {
      tick.setAttribute('aria-pressed', String(correct === true));
      cross.setAttribute('aria-pressed', String(correct === false));
      if (save) {
        progress.marks[q.id] = correct;
        persist();
        renderEnd();
      }
      showStat(q.id, stat);
    }

    revealBtn.addEventListener('click', () => reveal(true));
    tick.addEventListener('click', () => applyMark(true, true));
    cross.addEventListener('click', () => applyMark(false, true));

    const node = el(
      'div',
      { class: 'question', id: 'question-' + q.id, tabindex: '-1' },
      [
        el('span', { class: 'question-number mono', text: pad2(q.sort_order) }),
        el('div', { class: 'question-body' }, [
          el('p', { class: 'question-text', text: q.question_text }),
          revealRow,
          answerRow,
          marksRow,
        ]),
      ]
    );

    // Restore state.
    if (isCompleted || progress.revealed[q.id]) reveal(false);
    if (q.id in progress.marks) {
      applyMark(progress.marks[q.id], false);
      stat.classList.remove('hidden');
    }

    return node;
  }

  // Each category opens with a banded header. The category is named once,
  // there, and not repeated above every question.
  categories.forEach((category, index) => {
    const catQuestions = questionsByCategory.get(category.id) || [];
    const header = el('header', { class: 'category-header bleed' }, [
      el('h2', { class: 'category-name', text: category.name }),
    ]);

    // The explainer is optional. Categories that carry one say how their
    // questions work, under the name and inside the same band; categories
    // that do not get no element at all, so nothing holds space for it.
    if (category.description) {
      header.appendChild(el('p', { class: 'category-note', text: category.description }));
    }

    const section = el('section', { class: 'category' }, [header]);
    for (const q of catQuestions) section.appendChild(buildQuestion(q));
    frag.appendChild(section);
  });

  frag.appendChild(endSlot);
  frag.appendChild(statusLine);

  root.replaceChildren(frag);

  if (isCompleted) {
    lockMarking();
    const freshAvg =
      quizStats && quizStats.avg_score != null ? quizStats.avg_score : progress.completed.avg;
    const freshCount = quizStats
      ? Number(quizStats.completion_count)
      : progress.completed.count || 0;
    endSlot.replaceChildren(
      buildScorePanel(progress.completed.score, freshAvg, freshCount)
    );
  } else {
    renderEnd();
  }
}
