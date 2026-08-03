// Shared client-side quiz renderer.
// Used by the public quiz pages, the home page, and the admin preview,
// so the preview is exactly the public experience.
// All text is set through textContent, never innerHTML.

import { supabase } from './supabase.js';
import { getSessionId, loadProgress, saveProgress } from './session.js';

const TOTAL_QUESTIONS = 16;

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

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-AU', {
    timeZone: 'Australia/Sydney',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export async function fetchQuizByEdition(edition) {
  const { data, error } = await supabase
    .from('quizzes')
    .select(
      'id, edition_number, title, publish_at, categories(id, name, sort_order), questions(id, category_id, sort_order, question_text, answer_text)'
    )
    .eq('edition_number', edition)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchLatestQuiz() {
  const { data, error } = await supabase
    .from('quizzes')
    .select(
      'id, edition_number, title, publish_at, categories(id, name, sort_order), questions(id, category_id, sort_order, question_text, answer_text)'
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
  return 'The Quizz #' + editionNumber + ', ' + score + '/16\n' + url;
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

export async function initQuiz(root, options = {}) {
  root.textContent = 'Loading the quiz.';
  try {
    await render(root, options);
  } catch (err) {
    console.error('[quizz]', err);
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
    root.replaceChildren(el('p', { text: 'Edition ' + edition + ' is not available.' }));
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

  // Header: newspaper label and value table.
  const metaRows = [
    ['Edition', '#' + quiz.edition_number + (quiz.title ? ', ' + quiz.title : '')],
    ['Date', formatDate(quiz.publish_at)],
    ['Categories', categories.map((c) => c.name).join(', ')],
  ];
  frag.appendChild(
    el('table', { class: 'meta-table' }, [
      el(
        'tbody',
        {},
        metaRows.map(([label, value]) =>
          el('tr', {}, [el('th', { scope: 'row', text: label }), el('td', { text: value })])
        )
      ),
    ])
  );

  // Social proof: real numbers or nothing. Hidden only at zero completions.
  const playedCount = quizStats ? Number(quizStats.completion_count) : 0;
  if (playedCount >= 1) {
    frag.appendChild(
      el('p', {
        class: 'social-proof mono',
        text:
          playedCount === 1
            ? '1 group has played this week'
            : playedCount + ' groups have played this week',
      })
    );
  }

  const isCompleted = Boolean(progress.completed);
  const markButtons = [];

  // Tally bar, fixed at the bottom until the quiz is submitted.
  const tallyText = el('span', { class: 'mono', role: 'status' });
  const finishBtn = el('button', { class: 'finish-btn hidden', text: 'Finish and submit' });
  const tallyError = el('span', { class: 'mono tally-error hidden', role: 'alert' });
  const tallyBar = el('div', { class: 'tally' }, [
    el('div', { class: 'tally-inner' }, [tallyText, tallyError, finishBtn]),
  ]);

  const finalPanelSlot = el('div');

  function markedCount() {
    return questions.filter((q) => q.id in progress.marks).length;
  }

  function correctCount() {
    return questions.filter((q) => progress.marks[q.id] === true).length;
  }

  function updateTally() {
    const marked = markedCount();
    tallyText.textContent = marked + ' of 16 marked, ' + correctCount() + ' correct';
    finishBtn.classList.toggle('hidden', marked < TOTAL_QUESTIONS);
  }

  function persist() {
    if (!preview) saveProgress(quiz.id, progress);
  }

  function lockMarking() {
    for (const btn of markButtons) btn.disabled = true;
  }

  function renderFinalPanel(score, avgScore, completionCount) {
    const shareBtn = el('button', { text: 'Copy share text' });
    shareBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(buildShareText(quiz.edition_number, score));
      shareBtn.textContent = ok ? 'Copied' : 'Copy failed, select the text manually';
    });
    // With a single completion the average is the submitter's own score
    // reflected back, so the line only appears from two completions onward.
    const showAverage = completionCount >= 2 && avgScore != null;
    const parts = [
      el('hr'),
      el('section', { class: 'final-panel' }, [
        el('p', { class: 'label', text: 'Final score' }),
        el('p', { class: 'score-big', text: score + '/16' }),
        ...(showAverage
          ? [el('p', { text: 'The average this week is ' + avgScore + '.' })]
          : []),
        shareBtn,
      ]),
    ];
    finalPanelSlot.replaceChildren(...parts);
  }

  function complete(score, avgScore, completionCount) {
    progress.completed = { score, avg: avgScore, count: completionCount };
    persist();
    lockMarking();
    tallyBar.remove();
    document.body.classList.remove('has-tally');
    renderFinalPanel(score, avgScore, completionCount);
    finalPanelSlot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function submit() {
    finishBtn.disabled = true;
    tallyError.classList.add('hidden');

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
      finishBtn.disabled = false;
      tallyError.textContent = 'Could not submit, check your connection and try again.';
      tallyError.classList.remove('hidden');
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    complete(row.score, row.avg_score, Number(row.completion_count));
  }

  finishBtn.addEventListener('click', submit);

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
    // The rotation is purely visual, so screen readers read the answer
    // normally. The hidden prefix gives it context when focus lands here.
    const answer = el('span', { class: 'answer-upside-down', tabindex: '-1' }, [
      el('span', { class: 'visually-hidden', text: 'Answer: ' }),
      document.createTextNode(q.answer_text),
    ]);
    const answerRow = el('div', { class: 'answer-row hidden' }, [answer]);
    const revealBtn = el('button', {
      class: 'reveal-btn',
      'aria-label': 'Reveal answer to question ' + q.sort_order,
      text: 'Reveal answer',
    });
    const revealRow = el('div', { class: 'reveal-row' }, [revealBtn]);
    const tick = el('button', {
      class: 'mark-btn',
      'aria-label': 'Mark question ' + q.sort_order + ' correct',
      'aria-pressed': 'false',
    });
    tick.innerHTML = TICK_SVG;
    const cross = el('button', {
      class: 'mark-btn',
      'aria-label': 'Mark question ' + q.sort_order + ' incorrect',
      'aria-pressed': 'false',
    });
    cross.innerHTML = CROSS_SVG;
    markButtons.push(tick, cross);
    const marksRow = el('div', { class: 'marks-row hidden' }, [
      el('span', { class: 'marks' }, [tick, cross]),
    ]);
    const stat = el('p', { class: 'stat mono hidden', 'aria-live': 'polite' });

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
        updateTally();
      }
      showStat(q.id, stat);
    }

    revealBtn.addEventListener('click', () => reveal(true));
    tick.addEventListener('click', () => applyMark(true, true));
    cross.addEventListener('click', () => applyMark(false, true));

    const node = el('div', { class: 'question' }, [
      el('p', { class: 'question-text' }, [
        el('span', { class: 'question-number', text: q.sort_order + '. ' }),
        document.createTextNode(q.question_text),
      ]),
      revealRow,
      answerRow,
      marksRow,
      stat,
    ]);

    // Restore state.
    if (isCompleted || progress.revealed[q.id]) reveal(false);
    if (q.id in progress.marks) {
      applyMark(progress.marks[q.id], false);
      stat.classList.remove('hidden');
    }

    return node;
  }

  // Questions grouped under category headings. Rules between blocks come
  // from CSS borders so the rhythm stays consistent.
  for (const category of categories) {
    frag.appendChild(el('h2', { class: 'category-heading', text: category.name }));
    for (const q of questionsByCategory.get(category.id) || []) {
      frag.appendChild(buildQuestion(q));
    }
  }

  frag.appendChild(finalPanelSlot);

  root.replaceChildren(frag);

  if (isCompleted) {
    lockMarking();
    const freshAvg =
      quizStats && quizStats.avg_score != null ? quizStats.avg_score : progress.completed.avg;
    const freshCount = quizStats
      ? Number(quizStats.completion_count)
      : progress.completed.count || 0;
    renderFinalPanel(progress.completed.score, freshAvg, freshCount);
  } else {
    document.body.appendChild(tallyBar);
    document.body.classList.add('has-tally');
    updateTally();
  }
}
