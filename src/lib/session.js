// Anonymous device identity and per-quiz progress, all in localStorage.
// No personal data is stored anywhere.

const SESSION_KEY = 'quizz:session';

export function getSessionId() {
  let id = null;
  try {
    id = localStorage.getItem(SESSION_KEY);
  } catch {
    // storage unavailable, fall through to a throwaway id
  }
  if (!id) {
    id = crypto.randomUUID();
    try {
      localStorage.setItem(SESSION_KEY, id);
    } catch {
      // private browsing or blocked storage, the id lives for this page only
    }
  }
  return id;
}

function progressKey(quizId) {
  return 'quizz:progress:' + quizId;
}

export function loadProgress(quizId) {
  try {
    const raw = localStorage.getItem(progressKey(quizId));
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        revealed: parsed.revealed || {},
        marks: parsed.marks || {},
        completed: parsed.completed || null,
      };
    }
  } catch {
    // corrupt or unavailable storage, start fresh
  }
  return { revealed: {}, marks: {}, completed: null };
}

export function saveProgress(quizId, progress) {
  try {
    localStorage.setItem(progressKey(quizId), JSON.stringify(progress));
  } catch {
    // storage unavailable, progress only lives in memory
  }
}
