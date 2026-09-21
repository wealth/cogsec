import { INTENTS, LEVEL_LABELS } from './taxonomy.js';
import { listModels, PRESETS, isLocalUrl, isSystemOne } from './provider.js';
import { DEFAULTS, loadSettings } from './settings.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const I18N = globalThis.COGSEC_I18N;
let lang = 'en';
const T = () => I18N[lang] || I18N.en;
const P = (k, vars) => String((T().popup || {})[k] ?? I18N.en.popup[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars?.[v] ?? '');
const intentLabel = (i) => (T().intents && T().intents[i.key]?.label) || i.label;
const levelLabel = (n) => (T().levels || I18N.en.levels)[n] || LEVEL_LABELS[n];
function applyLang() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = P(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = P(el.dataset.i18nPlaceholder);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = P(el.dataset.i18nTitle);
}

let host = '', tabId = null;
try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  host = new URL(tab?.url || 'about:blank').hostname.replace(/^www\./, '');
} catch { /* no tab */ }
$('host').textContent = host || '';

const cfg = await loadSettings();
$('baseUrl').value = cfg.baseUrl;
$('apiKey').value = cfg.apiKey;
$('model').value = cfg.model;
$('threshold').value = String(cfg.threshold);
$('dimHeavy').checked = !!cfg.dimHeavy;
$('sendImages').checked = !!cfg.sendImages;
$('paused').checked = !!cfg.paused;
lang = I18N[cfg.lang] ? cfg.lang : 'en';
for (const [code, d] of Object.entries(I18N)) { const o = document.createElement('option'); o.value = code; o.textContent = d.name; $('lang').appendChild(o); }
$('lang').value = lang;
$('lang').addEventListener('change', () => { lang = $('lang').value; applyLang(); saveSettings(false); refresh(); });
applyLang();

for (const [key, p] of Object.entries(PRESETS)) {
  const b = document.createElement('button');
  b.className = 'preset'; b.textContent = p.label; b.title = p.url;
  b.onclick = () => { $('baseUrl').value = p.url; if (!p.local) $('model').value = p.model || ''; reflectEndpoint(); refreshModels(); };
  $('presets').appendChild(b);
}

/** Jev takes typed questions on text only: no images, and the model name is one of its aliases. */
function reflectEndpoint() {
  const textOnly = isSystemOne($('baseUrl').value.trim());
  const note = $('imagesNote');
  note.dataset.i18n = textOnly ? 'imagesNoteTextOnly' : 'imagesNote';
  note.textContent = P(note.dataset.i18n);
  $('sendImages').disabled = textOnly;
  $('sendImages').closest('label').style.opacity = textOnly ? .55 : 1;
}
$('baseUrl').addEventListener('input', reflectEndpoint);
reflectEndpoint();

for (const id of ['threshold', 'dimHeavy', 'paused', 'sendImages']) $(id).addEventListener('change', () => saveSettings(false));
$('refreshModels').onclick = () => refreshModels();
$('save').onclick = () => saveSettings(true);
$('test').onclick = async () => {
  if (!(await saveSettings(false))) return;
  setMsg(P('testing'));
  const r = await send({ type: 'test' });
  if (r?.error) return setMsg(r.error, 'err');
  const v = r.verdict;
  setMsg(`${r.model} · ${r.ms} ms → ${levelLabel(v.level)}: ${v.intents.map(intentLabel).join(', ') || P('noIntents')}`, 'ok');
};
$('analyzePage').onclick = async () => {
  const r = await send({ type: 'analyzePage' });
  setMsg(r?.error ? r.error : P('scanning'), r?.error ? 'err' : 'ok');
  setTimeout(refresh, 1500);
};
$('reset').onclick = async () => { await send({ type: 'resetStats', tabId }); refresh(); };
$('openStats').onclick = () => send({ type: 'openStats' });

/** Remote endpoints need a host permission; ask for it on save (user gesture). */
async function ensureHostPermission(baseUrl) {
  if (isLocalUrl(baseUrl)) return true;
  let origin;
  try { origin = new URL(baseUrl).origin + '/*'; } catch { setMsg(P('invalidUrl'), 'err'); return false; }
  if (await chrome.permissions.contains({ origins: [origin] })) return true;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) setMsg(P('permissionDenied', { origin }), 'err');
  return granted;
}

async function refreshModels() {
  const baseUrl = $('baseUrl').value.trim() || DEFAULTS.baseUrl;
  if (!(await ensureHostPermission(baseUrl))) return;
  try {
    const ids = await listModels({ baseUrl, apiKey: $('apiKey').value.trim() });
    $('models').innerHTML = ids.map((id) => `<option value="${id.replace(/"/g, '&quot;')}"></option>`).join('');
    setMsg(P('connected', { n: ids.length }), 'ok');
  } catch (e) {
    $('models').innerHTML = '';
    setMsg(e.message, 'err');
  }
}

async function saveSettings(announce) {
  const baseUrl = $('baseUrl').value.trim() || DEFAULTS.baseUrl;
  const ok = await ensureHostPermission(baseUrl);
  await chrome.storage.local.set({
    baseUrl,
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim(),
    threshold: Number($('threshold').value),
    dimHeavy: $('dimHeavy').checked,
    sendImages: $('sendImages').checked,
    paused: $('paused').checked,
    lang,
  });
  if (announce && ok) setMsg(P('saved'), 'ok');
  return ok;
}

function setMsg(t, cls) { const m = $('msg'); m.textContent = t; m.className = cls || ''; }

async function refresh() {
  const s = await send({ type: 'stats', tabId });
  if (!s || !s.posts) {
    $('summary').innerHTML = `<span class="muted">${P('noPosts')}</span><span></span>`;
    $('bars').innerHTML = '';
    return;
  }
  const avg = s.pressureSum / s.posts;
  const pctFlag = Math.round((100 * s.flagged) / s.posts);
  $('summary').innerHTML = `
    <span>${P('posts')}</span><b>${s.posts}</b>
    <span>${P('flagged')}</span><b>${s.flagged} (${pctFlag}%)</b>
    <span>${P('avgPressure')}</span><b>${avg.toFixed(2)} / 4</b>
    <span>${LEVEL_LABELS.map((_, i) => `${levelLabel(i)} ${s.levels[i]}`).join(' · ')}</span><span></span>`;
  const rows = INTENTS.map((i) => ({ label: intentLabel(i), n: s.intents[i.key] || 0 })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
  const max = rows[0]?.n || 1;
  $('bars').innerHTML = rows.map((r) => `<div><b>${r.label}</b><i style="width:${Math.round((100 * r.n) / max)}%"></i><span>${r.n}</span></div>`).join('') || `<span class="muted">${P('nothingFlagged')}</span>`;
}
refresh();
refreshModels();
setInterval(refresh, 2000);
