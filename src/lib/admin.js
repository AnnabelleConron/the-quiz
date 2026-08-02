// Shared admin helpers: auth gate, Sydney time handling, data access.
// Admin pages render nothing until the session check completes.

import { supabase } from './supabase.js';
import { el } from './quiz-render.js';

const SYDNEY_TZ = 'Australia/Sydney';

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

export function renderLogin(root) {
  const email = el('input', { type: 'email', autocomplete: 'username', required: '' });
  const password = el('input', {
    type: 'password',
    autocomplete: 'current-password',
    required: '',
  });
  const errorLine = el('p', { class: 'mono form-error hidden', role: 'alert' });
  const submit = el('button', { type: 'submit', text: 'Sign in' });
  const form = el('form', { class: 'admin-login' }, [
    el('h1', { text: 'Admin' }),
    el('label', {}, [el('span', { class: 'label', text: 'Email' }), email]),
    el('label', {}, [el('span', { class: 'label', text: 'Password' }), password]),
    errorLine,
    submit,
  ]);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    errorLine.classList.add('hidden');
    const { error } = await supabase.auth.signInWithPassword({
      email: email.value,
      password: password.value,
    });
    if (error) {
      errorLine.textContent = 'Sign in failed. Check the email and password.';
      errorLine.classList.remove('hidden');
      submit.disabled = false;
      return;
    }
    location.reload();
  });
  root.replaceChildren(form);
}

// Returns the session, or renders the login form and returns null.
export async function requireAdmin(root) {
  const session = await getSession();
  if (!session) {
    renderLogin(root);
    return null;
  }
  return session;
}

export function adminNav() {
  const signOut = el('button', { class: 'small-btn', text: 'Sign out' });
  signOut.addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.href = '/admin';
  });
  return el('header', { class: 'site-top' }, [
    el('span', {}, [
      el('a', { href: '/admin', class: 'mono', text: 'Dashboard' }),
      document.createTextNode(' '),
      el('a', { href: '/admin/analytics', class: 'mono', text: 'Analytics' }),
      document.createTextNode(' '),
      el('a', { href: '/', class: 'mono', text: 'Site' }),
    ]),
    signOut,
  ]);
}

export async function fetchQuizById(id) {
  const { data, error } = await supabase
    .from('quizzes')
    .select(
      'id, edition_number, title, publish_at, status, categories(id, name, sort_order), questions(id, category_id, sort_order, question_text, answer_text)'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Sydney time. 6am never falls inside a DST transition (Sydney switches at
// 2am and 3am), so conversions here are unambiguous across AEST and AEDT.
function sydneyParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SYDNEY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(date);
  const get = (type) => {
    const part = parts.find((p) => p.type === type);
    return part ? part.value : '';
  };
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    hh: Number(get('hour')),
    mm: Number(get('minute')),
    weekday: get('weekday'),
  };
}

// The UTC instant for a given Sydney wall-clock time. Starts from an AEST
// guess and corrects using the real offset at that instant.
export function utcForSydney(y, m, d, hh, mm) {
  let guess = Date.UTC(y, m - 1, d, hh, mm) - 10 * 3600 * 1000;
  for (let i = 0; i < 3; i++) {
    const p = sydneyParts(new Date(guess));
    const diff = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - Date.UTC(y, m - 1, d, hh, mm);
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

export function nextSaturdaySydney6am() {
  const now = new Date();
  for (let i = 1; i <= 7; i++) {
    const candidate = new Date(now.getTime() + i * 86400 * 1000);
    const p = sydneyParts(candidate);
    if (p.weekday === 'Sat') return utcForSydney(p.y, p.m, p.d, 6, 0);
  }
  return null;
}

const pad = (n) => String(n).padStart(2, '0');

// Value for a datetime-local input, expressed as Sydney wall-clock time.
export function sydneyInputValue(iso) {
  const p = sydneyParts(new Date(iso));
  return p.y + '-' + pad(p.m) + '-' + pad(p.d) + 'T' + pad(p.hh) + ':' + pad(p.mm);
}

// Parses a datetime-local value entered as Sydney wall-clock time.
export function parseSydneyInput(value) {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return utcForSydney(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

export function formatSydney(iso) {
  return (
    new Date(iso).toLocaleString('en-AU', {
      timeZone: SYDNEY_TZ,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' Sydney time'
  );
}
