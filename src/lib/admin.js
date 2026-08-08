// Shared admin helpers: auth gate, publish-time handling, data access.
// Admin pages render nothing until the session check completes.

import { supabase } from './supabase.js';
import { el } from './quiz-render.js';

// The quiz is Melbourne based. Melbourne and Sydney share identical offsets
// and daylight-saving rules, so the IANA zone below is the same clock either
// way; only the label the reader sees differs.
const SYDNEY_TZ = 'Australia/Sydney';

// How that clock is named in the interface, for the instant in question:
// AEST through winter, AEDT from early October to early April. Read out of
// the zone itself rather than hardcoded, so it stays correct through any
// future change to the daylight-saving rules.
//
// Every user-facing time on the site is labelled through this.
export function timeLabel(when = new Date()) {
  const date = when instanceof Date ? when : new Date(when);
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: SYDNEY_TZ,
    timeZoneName: 'short',
  }).formatToParts(date);
  const name = parts.find((part) => part.type === 'timeZoneName');
  return name ? name.value : 'AEST';
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

// The masthead of the workshop. Carried by every admin screen, signed in
// or not, so the editorial side is never mistaken for the paper.
function adminBrand() {
  return el('span', { class: 'admin-top-brand' }, [
    el('span', { class: 'admin-top-name', text: 'The Quizz' }),
    el('span', { class: 'admin-top-tag', text: 'Editorial' }),
  ]);
}

// A labelled field. The label wraps the control, so the association holds
// without ids to keep in step.
export function field(labelText, control, modifier) {
  return el('label', { class: 'field' + (modifier ? ' ' + modifier : '') }, [
    el('span', { class: 'field-label', text: labelText }),
    control,
  ]);
}

// Whether an edition's publish time has arrived. An instant comparison, not
// a wall-clock one: publish_at is a UTC ISO string and Date parses it to an
// absolute moment. The Sydney helpers further down this file exist to read
// and write wall-clock text in the editor, and would be the wrong tool here.
export function isPast(iso) {
  return new Date(iso).getTime() <= Date.now();
}

// What an edition is, as a reader would describe it, rather than as the
// column spells it. Nothing in the app promotes 'scheduled' to 'published',
// so a scheduled edition whose morning has passed is simply live.
//
// Advisory only: this decides which controls to draw, on the client's clock.
// The database is the authority, and enforce_quiz_status_transition() refuses
// anything this gets wrong.
export function editionState(quiz) {
  if (quiz.status === 'draft') return 'draft';
  if (quiz.status === 'unpublished') return 'unpublished';
  if (quiz.status === 'published') return 'live';
  return isPast(quiz.publish_at) ? 'live' : 'scheduled';
}

export function statusChip(quiz) {
  const state = editionState(quiz);
  return el('span', { class: 'status status-' + state, text: state });
}

export function renderLogin(root) {
  const email = el('input', {
    type: 'email',
    autocomplete: 'username',
    required: '',
    placeholder: 'you@example.com',
  });
  const password = el('input', {
    type: 'password',
    autocomplete: 'current-password',
    required: '',
    placeholder: ' ',
  });
  const errorLine = el('p', { class: 'mono form-error hidden', role: 'alert' });
  const submit = el('button', { type: 'submit', class: 'btn-primary btn-block', text: 'Sign in' });
  const form = el('form', { class: 'admin-login' }, [
    el('div', { class: 'admin-head' }, [el('h1', { text: 'Editorial' })]),
    field('Email', email),
    field('Password', password),
    errorLine,
    el('div', { class: 'admin-login-actions' }, [submit]),
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
  root.replaceChildren(el('header', { class: 'admin-top' }, [adminBrand()]), form);
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

// The admin bar is deliberately not the public one: solid ink, no masthead.
// `current` underlines the screen you are on.
export function adminNav(current = null) {
  const signOut = el('button', { type: 'button', text: 'Sign out' });
  signOut.addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.href = '/admin';
  });
  const link = (href, text, key) =>
    el('a', { href, text, 'aria-current': current && current === key ? 'page' : null });
  return el('header', { class: 'admin-top' }, [
    adminBrand(),
    el('nav', { class: 'admin-top-links', 'aria-label': 'Editorial' }, [
      link('/admin', 'Dashboard', 'dashboard'),
      link('/admin/analytics', 'Analytics', 'analytics'),
      link('/', 'Site', null),
      signOut,
    ]),
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

// Labelled for its own instant, so an edition published in January reads
// AEDT while one published in July reads AEST.
export function formatSydney(iso) {
  const date = new Date(iso);
  return (
    date.toLocaleString('en-AU', {
      timeZone: SYDNEY_TZ,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) +
    ' ' +
    timeLabel(date)
  );
}
