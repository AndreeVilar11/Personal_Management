import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// ---------- utilitários ----------
const $ = (s) => document.querySelector(s);
const eur = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const fmt = (n) => eur.format(Number(n) || 0);
const monthFmt = new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('pt-PT', { weekday: 'long', day: 'numeric', month: 'short' });
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Aceita "12,5", "12.50", "1 234,56" → 12.5 / 12.5 / 1234.56 ; inválido → NaN */
export function parseAmount(v) {
  let s = String(v ?? '').trim().replace(/\s|€/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(parseFloat(s) * 100) / 100;
}
const amountToInput = (n) => String(Number(n).toFixed(2)).replace('.', ',');

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

// ---------- estado ----------
const state = {
  user: null,
  members: [],      // [{user_id, name}]
  balances: [],     // [{user_id, name, balance}]
  expenses: [],     // do mês visível
  settlements: [],  // do mês visível
  recurring: [],
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  editingExpense: null,
  editingRecurring: null,
};
const nameOf = (id) => state.members.find((m) => m.user_id === id)?.name ?? '?';
const me = () => state.members.find((m) => m.user_id === state.user?.id);
const other = () => state.members.find((m) => m.user_id !== state.user?.id);

// ---------- autenticação ----------
async function init() {
  const { data } = await sb.auth.getSession();
  await onSession(data.session);
  sb.auth.onAuthStateChange((_e, session) => {
    if ((session?.user?.id ?? null) !== (state.user?.id ?? null)) onSession(session);
  });
}

async function onSession(session) {
  state.user = session?.user ?? null;
  $('#login').hidden = !!state.user;
  $('#app').hidden = !state.user;
  if (!state.user) return;

  const { data: members, error } = await sb.from('members').select('user_id,name').order('name');
  if (error) {
    console.error('members:', error);
    alert(`Erro a ler os membros: ${error.code ?? ''} ${error.message}`);
    await sb.auth.signOut();
    return;
  }
  if (!members?.some((m) => m.user_id === state.user.id)) {
    alert(`Esta conta (${state.user.email}) ainda não está ligada a um membro. Vê o passo 3 do README.`);
    await sb.auth.signOut();
    return;
  }
  state.members = members;
  await sb.rpc('post_recurring_expenses'); // lança as fixas do mês, se faltarem
  await refresh();
  subscribe();
}

$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  $('#login-error').textContent = '';
  if (SUPABASE_URL.includes('SEU-PROJETO') || SUPABASE_ANON_KEY.includes('COLAR')) {
    $('#login-error').textContent = 'O config.js ainda tem os valores de exemplo.';
    return;
  }
  let error;
  try {
    ({ error } = await sb.auth.signInWithPassword({
      email: String(f.get('email')).trim(), password: f.get('password'),
    }));
  } catch (e) { error = e; }
  if (!error) return;
  console.error('Login falhou:', error);
  const msg = String(error.message || error);
  const status = error.status ?? '';
  let text;
  if (/invalid login credentials/i.test(msg)) text = 'Email ou palavra-passe incorretos.';
  else if (/email not confirmed/i.test(msg)) text = 'A conta ainda não está confirmada no Supabase (Auto Confirm).';
  else if (/invalid api key|no api key|jwt|apikey/i.test(msg) || status === 401)
    text = 'A chave no config.js não é válida. Usa a chave anon/publishable.';
  else if (/fetch|network|load failed/i.test(msg) || status === 0)
    text = 'Não foi possível ligar ao Supabase. Verifica o SUPABASE_URL no config.js.';
  else text = 'Erro ao entrar.';
  $('#login-error').textContent = `${text} [${status} ${msg}]`;
});
$('#logout').addEventListener('click', () => sb.auth.signOut());

// ---------- dados ----------
async function refresh() {
  const start = isoDate(state.month);
  const endD = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1);
  const end = isoDate(endD);

  const [bal, exp, set, rec] = await Promise.all([
    sb.from('member_balances').select('*'),
    sb.from('expenses').select('*').gte('spent_on', start).lt('spent_on', end)
      .order('spent_on', { ascending: false }).order('created_at', { ascending: false }),
    sb.from('settlements').select('*').gte('settled_on', start).lt('settled_on', end),
    sb.from('recurring_expenses').select('*').order('day_of_month'),
  ]);
  state.balances = bal.data ?? [];
  state.expenses = exp.data ?? [];
  state.settlements = set.data ?? [];
  state.recurring = rec.data ?? [];
  render();
}

let channel;
function subscribe() {
  if (channel) return;
  let t;
  const later = () => { clearTimeout(t); t = setTimeout(refresh, 300); };
  channel = sb.channel('changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, later)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, later)
    .subscribe();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}

// ---------- desenho ----------
function render() {
  $('#month-label').textContent = cap(monthFmt.format(state.month));
  const now = new Date();
  $('#next-month').disabled =
    state.month.getFullYear() === now.getFullYear() && state.month.getMonth() === now.getMonth();
  renderBalance();
  renderSummary();
  renderList();
  renderRecurring();
}

function renderBalance() {
  const mine = Number(state.balances.find((b) => b.user_id === state.user.id)?.balance ?? 0);
  const o = other()?.name ?? 'o outro';
  const amt = $('#balance-amount');
  amt.className = 'balance-amount';
  if (Math.abs(mine) < 0.005) {
    $('#balance-label').textContent = 'Estão quites';
    amt.textContent = fmt(0);
    $('#settle-btn').hidden = true;
  } else if (mine > 0) {
    $('#balance-label').textContent = `${o} deve-te`;
    amt.textContent = fmt(mine);
    amt.classList.add('pos');
    $('#settle-btn').hidden = false;
  } else {
    $('#balance-label').textContent = `Deves a ${o}`;
    amt.textContent = fmt(-mine);
    amt.classList.add('neg');
    $('#settle-btn').hidden = false;
  }
}

function renderSummary() {
  const sum = (arr) => arr.reduce((s, e) => s + Number(e.amount), 0);
  const joint = state.expenses.filter((e) => e.joint);
  const box = $('#summary');
  box.replaceChildren(
    el('div', { class: 'total' }, el('span', {}, 'Gasto total no mês'), el('strong', {}, fmt(sum(state.expenses)))),
    ...state.members.map((m) =>
      el('div', {}, el('span', {}, `Pago por ${m.name}`),
        el('strong', {}, fmt(sum(state.expenses.filter((e) => !e.joint && e.paid_by === m.user_id)))))),
    el('div', {}, el('span', {}, 'Conta conjunta'), el('strong', {}, fmt(sum(joint)))),
  );
}

function renderList() {
  const items = [
    ...state.expenses.map((e) => ({ kind: 'e', date: e.spent_on, ts: e.created_at, row: e })),
    ...state.settlements.map((s) => ({ kind: 's', date: s.settled_on, ts: s.created_at, row: s })),
  ].sort((a, b) => (b.date + b.ts).localeCompare(a.date + a.ts));

  const list = $('#expense-list');
  list.replaceChildren();
  let lastDay = null;
  for (const it of items) {
    if (it.date !== lastDay) {
      lastDay = it.date;
      list.append(el('li', { class: 'day-head' }, cap(dayFmt.format(new Date(it.date + 'T12:00')))));
    }
    if (it.kind === 'e') {
      const e = it.row;
      list.append(el('li', { onclick: () => openExpense(e) },
        el('div', { class: 'item-main' },
          el('div', { class: 'item-desc' }, e.description),
          el('div', { class: 'item-meta' },
            e.joint ? 'Conta conjunta' : `Pago por ${nameOf(e.paid_by)}`,
            e.recurring_id ? el('span', { class: 'tag' }, 'fixa') : null)),
        el('div', { class: 'item-amount' }, fmt(e.amount))));
    } else {
      const s = it.row;
      list.append(el('li', { class: 'settlement', onclick: () => deleteSettlement(s) },
        el('div', { class: 'item-main' },
          el('div', { class: 'item-desc' }, `Acerto: ${nameOf(s.from_user)} → ${nameOf(s.to_user)}`)),
        el('div', { class: 'item-amount' }, fmt(s.amount))));
    }
  }
  $('#empty').hidden = items.length > 0;
}

function renderRecurring() {
  const list = $('#recurring-list');
  list.replaceChildren(...state.recurring.map((r) =>
    el('li', { class: r.active ? '' : 'inactive', onclick: () => openRecurring(r) },
      el('div', { class: 'item-main' },
        el('div', { class: 'item-desc' }, r.description),
        el('div', { class: 'item-meta' },
          `Dia ${r.day_of_month} · ${r.joint ? 'Conta conjunta' : `Pago por ${nameOf(r.paid_by)}`}`,
          r.active ? null : ' · inativa')),
      el('div', { class: 'item-amount' }, fmt(r.amount)))));
}

// ---------- navegação ----------
document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tab-btn').forEach((x) => x.classList.toggle('active', x === b));
  $('#tab-expenses').hidden = b.dataset.tab !== 'expenses';
  $('#tab-recurring').hidden = b.dataset.tab !== 'recurring';
  $('#fab').hidden = b.dataset.tab !== 'expenses';
}));
$('#prev-month').addEventListener('click', () => {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); refresh();
});
$('#next-month').addEventListener('click', () => {
  state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); refresh();
});
document.querySelectorAll('[data-close]').forEach((b) =>
  b.addEventListener('click', () => b.closest('dialog').close()));

// ---------- despesa ----------
const expForm = $('#expense-form');
function openExpense(e = null) {
  state.editingExpense = e;
  expForm.reset();
  $('#expense-error').textContent = '';
  $('#expense-title').textContent = e ? 'Editar despesa' : 'Nova despesa';
  $('#expense-delete').hidden = !e;
  const sel = expForm.elements.paid_by;
  sel.replaceChildren(...state.members.map((m) => el('option', { value: m.user_id }, m.name)));
  expForm.elements.description.value = e?.description ?? '';
  expForm.elements.amount.value = e ? amountToInput(e.amount) : '';
  expForm.elements.joint.checked = e?.joint ?? false;
  expForm.elements.spent_on.value = e?.spent_on ?? today();
  sel.value = e?.paid_by ?? state.user.id;
  expForm.querySelector('details').open = false;
  $('#expense-sheet').showModal();
  if (!e) expForm.elements.description.focus();
}
$('#fab').addEventListener('click', () => openExpense());

expForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = expForm.elements;
  const amount = parseAmount(f.amount.value);
  if (!(amount > 0)) { $('#expense-error').textContent = 'Valor inválido.'; return; }
  const row = {
    description: f.description.value.trim(),
    amount,
    joint: f.joint.checked,
    spent_on: f.spent_on.value,
    paid_by: f.paid_by.value,
  };
  const btn = expForm.querySelector('[type=submit]');
  btn.disabled = true;
  const { error } = state.editingExpense
    ? await sb.from('expenses').update(row).eq('id', state.editingExpense.id)
    : await sb.from('expenses').insert(row);
  btn.disabled = false;
  if (error) { $('#expense-error').textContent = 'Não foi possível guardar. Tenta de novo.'; return; }
  $('#expense-sheet').close();
  refresh();
});

$('#expense-delete').addEventListener('click', async () => {
  const e = state.editingExpense;
  if (!e || !confirm(`Apagar "${e.description}" (${fmt(e.amount)})?`)) return;
  await sb.from('expenses').delete().eq('id', e.id);
  $('#expense-sheet').close();
  refresh();
});

// ---------- acerto ----------
$('#settle-btn').addEventListener('click', () => {
  const mine = Number(state.balances.find((b) => b.user_id === state.user.id)?.balance ?? 0);
  const debtor = mine > 0 ? other() : me();
  const creditor = mine > 0 ? me() : other();
  $('#settle-desc').textContent = `${debtor.name} paga a ${creditor.name}.`;
  const form = $('#settle-form');
  form.dataset.from = debtor.user_id;
  form.dataset.to = creditor.user_id;
  form.elements.amount.value = amountToInput(Math.abs(mine));
  $('#settle-error').textContent = '';
  $('#settle-sheet').showModal();
});

$('#settle-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const amount = parseAmount(form.elements.amount.value);
  if (!(amount > 0)) { $('#settle-error').textContent = 'Valor inválido.'; return; }
  const { error } = await sb.from('settlements').insert({
    from_user: form.dataset.from, to_user: form.dataset.to, amount,
  });
  if (error) { $('#settle-error').textContent = 'Não foi possível registar.'; return; }
  $('#settle-sheet').close();
  refresh();
});

async function deleteSettlement(s) {
  if (!confirm(`Apagar o acerto de ${fmt(s.amount)} (${nameOf(s.from_user)} → ${nameOf(s.to_user)})?`)) return;
  await sb.from('settlements').delete().eq('id', s.id);
  refresh();
}

// ---------- recorrentes ----------
const recForm = $('#recurring-form');
function openRecurring(r = null) {
  state.editingRecurring = r;
  recForm.reset();
  $('#recurring-error').textContent = '';
  $('#recurring-title').textContent = r ? 'Editar despesa fixa' : 'Nova despesa fixa';
  $('#recurring-delete').hidden = !r;
  recForm.elements.description.value = r?.description ?? '';
  recForm.elements.amount.value = r ? amountToInput(r.amount) : '';
  recForm.elements.day_of_month.value = r?.day_of_month ?? '';
  recForm.elements.joint.checked = r?.joint ?? true;
  recForm.elements.active.checked = r?.active ?? true;
  $('#recurring-sheet').showModal();
}
$('#add-recurring').addEventListener('click', () => openRecurring());

recForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = recForm.elements;
  const amount = parseAmount(f.amount.value);
  const day = parseInt(f.day_of_month.value, 10);
  if (!(amount > 0)) { $('#recurring-error').textContent = 'Valor inválido.'; return; }
  if (!(day >= 1 && day <= 28)) { $('#recurring-error').textContent = 'Dia entre 1 e 28.'; return; }
  const row = {
    description: f.description.value.trim(), amount, day_of_month: day,
    joint: f.joint.checked, active: f.active.checked,
  };
  const { error } = state.editingRecurring
    ? await sb.from('recurring_expenses').update(row).eq('id', state.editingRecurring.id)
    : await sb.from('recurring_expenses').insert({ ...row, paid_by: state.user.id });
  if (error) { $('#recurring-error').textContent = 'Não foi possível guardar.'; return; }
  $('#recurring-sheet').close();
  await sb.rpc('post_recurring_expenses');
  refresh();
});

$('#recurring-delete').addEventListener('click', async () => {
  const r = state.editingRecurring;
  if (!r || !confirm(`Apagar a despesa fixa "${r.description}"? As já lançadas ficam.`)) return;
  await sb.from('recurring_expenses').delete().eq('id', r.id);
  $('#recurring-sheet').close();
  refresh();
});

// ---------- arranque ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
init();
