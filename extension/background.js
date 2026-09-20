// cogsec service worker: rate-limits calls to the model endpoint, caches verdicts, keeps session stats.
import { ask, isLocalUrl } from './provider.js';
import { summarize, INTENTS } from './taxonomy.js';
import { loadSettings } from './settings.js';
import { emptyHistory, recordExposure, pruneHistory } from './history.js';
import './i18n.js'; // side-effect script: sets globalThis.COGSEC_I18N

// Local servers share one context window across parallel slots (LM Studio: 4 by default), so one request
// at a time is the safe choice there. Hosted APIs take a few in flight.
const CONCURRENCY = (cfg) => (isLocalUrl(cfg.baseUrl) ? 1 : 4);
const CACHE_MAX = 3000;

// The service worker is shut down after ~30 s idle, so anything that must outlive a tab switch goes to
// chrome.storage.session: it survives worker restarts and is cleared when the browser closes.
const cache = new Map();            // cacheKey -> { answers, model, at }
const inflight = new Map();         // cacheKey -> Promise
const queue = [];
let running = 0;

// Per-tab session stats, kept until the tab closes.
const stats = { tabs: {} };         // tabId -> { host, since, posts, flagged, pressureSum, levels, intents, counted }
const COUNTED_MAX = 2000;

// Long-term exposure history, per site per day, in chrome.storage.local (survives browser restarts).
let history = emptyHistory();
let historyTimer = null;
function scheduleHistorySave() {
  if (historyTimer) return;
  historyTimer = setTimeout(async () => { historyTimer = null; try { await chrome.storage.local.set({ history }); } catch { /* quota */ } }, 2000);
}

const ready = (async () => {
  try {
    const { history: savedHistory } = await chrome.storage.local.get('history');
    if (savedHistory?.v === 1 && savedHistory.sites) history = pruneHistory(savedHistory);
  } catch { /* first run */ }
  try {
    const saved = await chrome.storage.session.get(['stats', 'cache']);
    if (saved.stats?.tabs) Object.assign(stats.tabs, saved.stats.tabs);
    for (const [k, v] of saved.cache || []) cache.set(k, v);
    // drop stats for tabs that no longer exist (browser restart keeps nothing, but a worker restart might race)
    const open = new Set((await chrome.tabs.query({})).map((t) => String(t.id)));
    for (const id of Object.keys(stats.tabs)) if (!open.has(id)) delete stats.tabs[id];
  } catch { /* first run */ }
})();

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      const entries = [...cache.entries()].slice(-CACHE_MAX);
      await chrome.storage.session.set({ stats, cache: entries });
    } catch { /* quota or shutdown; in-memory state still valid */ }
  }, 500);
}

function tabStats(tabId, host) {
  const id = String(tabId ?? 'none');
  if (!stats.tabs[id]) {
    stats.tabs[id] = { host, since: Date.now(), posts: 0, flagged: 0, pressureSum: 0, levels: [0, 0, 0, 0], intents: Object.fromEntries(INTENTS.map((i) => [i.key, 0])), counted: [] };
  }
  if (host && stats.tabs[id].host !== host) { // same tab navigated to another site: start over
    stats.tabs[id] = { host, since: Date.now(), posts: 0, flagged: 0, pressureSum: 0, levels: [0, 0, 0, 0], intents: Object.fromEntries(INTENTS.map((i) => [i.key, 0])), counted: [] };
  }
  return stats.tabs[id];
}

chrome.tabs.onRemoved.addListener((tabId) => { delete stats.tabs[String(tabId)]; stopBusy(tabId); scheduleSave(); });

/** Per-tab action calls on a closed tab log "Unchecked runtime.lastError: No tab with id" (setIcon's custom
 *  binding reports through the callback channel, so try/catch does not silence it). Check first. */
const tabExists = (tabId) => chrome.tabs.get(tabId).then(() => true, () => false);

// ------------------------------------------------------------------ toolbar badge: this tab's severity
// Status palette (good / warning / serious / critical). Severity = share of posts rated Manipulative or Heavy.
// Dark text on the two light backgrounds keeps the percentage readable.
const SEVERITY = [
  { below: 0.15, color: '#0ca30c', text: '#ffffff' },
  { below: 0.35, color: '#fab219', text: '#0b1633' },
  { below: 0.60, color: '#ec835a', text: '#0b1633' },
  { below: Infinity, color: '#d03b3b', text: '#ffffff' },
];
async function updateBadge(tabId, lang) {
  if (tabId == null || !chrome.action || !(await tabExists(tabId))) return;
  const s = stats.tabs[String(tabId)];
  try {
    if (!s || !s.posts) { await chrome.action.setBadgeText({ tabId, text: '' }); await chrome.action.setTitle({ tabId, title: 'cogsec' }); return; }
    const ratio = s.flagged / s.posts, pct = Math.round(100 * ratio);
    const sev = SEVERITY.find((x) => ratio < x.below);
    await chrome.action.setBadgeBackgroundColor({ tabId, color: sev.color });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: sev.text });
    await chrome.action.setBadgeText({ tabId, text: `${pct}%` });
    const I = globalThis.COGSEC_I18N || {}; const L = I[lang] || I.en;
    const tpl = L?.badge?.tooltip || 'cogsec: {posts} posts, {flagged} manipulative ({pct}%)';
    await chrome.action.setTitle({ tabId, title: tpl.replace(/\{(\w+)\}/g, (_, k) => ({ posts: s.posts, flagged: s.flagged, pct })[k]) });
  } catch { /* tab gone */ }
}
// ------------------------------------------------------------------ activity indicator: pulsing dot while busy
const ICON_DEFAULT = { 16: 'icons/icon16.png', 32: 'icons/icon32.png' };
const ICON_BUSY = [1, 2, 3].map((n) => ({ 16: `icons/icon16-busy${n}.png`, 32: `icons/icon32-busy${n}.png` }));
const busy = new Map();   // tabId -> { pending, frame, timer, lang }
function stopBusy(tabId) {
  const b = busy.get(tabId);
  if (b?.timer) clearInterval(b.timer);
  busy.delete(tabId);
}
async function setBusy(tabId, delta, lang) {
  if (tabId == null || !chrome.action) return;
  if (!(await tabExists(tabId))) { stopBusy(tabId); return; }
  const b = busy.get(tabId) || { pending: 0, frame: 0, timer: null, lang };
  b.pending = Math.max(0, b.pending + delta); b.lang = lang ?? b.lang;
  busy.set(tabId, b);
  try {
    if (b.pending > 0 && !b.timer) {
      const tick = async () => {
        if (!(await tabExists(tabId))) { stopBusy(tabId); return; }
        b.frame = (b.frame + 1) % ICON_BUSY.length;
        try { await chrome.action.setIcon({ tabId, path: ICON_BUSY[b.frame] }); } catch { stopBusy(tabId); }
      };
      tick(); b.timer = setInterval(tick, 250);
      const s = stats.tabs[String(tabId)];
      if (!s || !s.posts) { await chrome.action.setBadgeBackgroundColor({ tabId, color: '#6b7280' }); if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' }); await chrome.action.setBadgeText({ tabId, text: '…' }); }
    }
    if (b.pending > 0) {
      const I = globalThis.COGSEC_I18N || {}; const L = I[b.lang] || I.en;
      await chrome.action.setTitle({ tabId, title: (L?.badge?.busy || 'cogsec: analysing {n} posts…').replace('{n}', b.pending) });
    } else if (b.timer) {
      stopBusy(tabId);
      if (await tabExists(tabId)) { await chrome.action.setIcon({ tabId, path: ICON_DEFAULT }); await updateBadge(tabId, b.lang); }
    }
  } catch { /* tab gone */ }
}

// After a worker restart, re-apply badges for tabs we still have stats for.
ready.then(async () => { const cfg = await loadSettings().catch(() => ({})); for (const id of Object.keys(stats.tabs)) updateBadge(Number(id), cfg.lang); });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    await ready;
    switch (msg?.type) {
      case 'analyze': return analyzeBatch(msg, sender);
      case 'stats': { const s = stats.tabs[String(msg.tabId)]; return s ? { ...s, counted: undefined } : null; }
      case 'resetStats': {
        const ids = msg.tabId != null ? [String(msg.tabId)] : Object.keys(stats.tabs);
        for (const k of ids) { delete stats.tabs[k]; updateBadge(Number(k)); }
        scheduleSave(); return { ok: true };
      }
      case 'settings': return loadSettings();
      case 'clearHistory': { history = emptyHistory(); await chrome.storage.local.set({ history }); return { ok: true }; }
      case 'openStats': { await chrome.tabs.create({ url: chrome.runtime.getURL('stats.html') }); return { ok: true }; }
      case 'analyzePage': return injectIntoActiveTab();
      case 'test': return testProvider(msg.state);
      case 'ping': return { ok: true };
      default: return { error: `unknown message ${msg?.type}` };
    }
  })().then(sendResponse, (e) => sendResponse({ error: String(e?.message || e) }));
  return true; // async response
});

async function injectIntoActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { error: 'no active tab' };
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['i18n.js', 'content.js'] });
  return { ok: true, tabId: tab.id };
}

async function testProvider(state) {
  const cfg = await loadSettings();
  const t0 = Date.now();
  const res = await ask({ baseUrl: cfg.baseUrl, model: cfg.model, apiKey: cfg.apiKey, state: state || { platform: 'test', post: { text: 'Retweet if you agree. They hate you and they are laughing about it.' } } });
  return { ok: true, model: res.model, ms: Date.now() - t0, verdict: summarize(res.answers, cfg.threshold) };
}

async function analyzeBatch(msg, sender) {
  const cfg = await loadSettings();
  if (cfg.paused) return { paused: true, results: [] };
  const host = msg.host || safeHost(sender?.url || sender?.tab?.url);
  const tabId = sender?.tab?.id;
  const posts = msg.posts || [];
  await setBusy(tabId, posts.length, cfg.lang);
  const results = await Promise.all(posts.map(async (post) => {
    try {
      const images = cfg.sendImages ? (post.images || []).slice(0, cfg.maxImages) : [];
      const { answers, model } = await getAnswers(post.key, post.state, cfg, images);
      const verdict = summarize(answers, cfg.threshold);
      record(tabId, host, post.key, verdict);
      return { key: post.key, verdict, model };
    } catch (e) {
      return { key: post.key, error: String(e?.message || e), status: e?.status };
    } finally {
      await setBusy(tabId, -1, cfg.lang);
    }
  }));
  if (!busy.has(tabId)) updateBadge(tabId, cfg.lang);
  return { results, dimHeavy: cfg.dimHeavy, threshold: cfg.threshold };
}

function getAnswers(key, state, cfg, images = []) {
  const ck = `${cfg.baseUrl}|${cfg.model}|${images.length ? 'img|' : ''}${key}`;
  const hit = cache.get(ck);
  if (hit) { cache.delete(ck); cache.set(ck, hit); return Promise.resolve({ answers: hit.answers, model: hit.model }); }
  if (inflight.has(ck)) return inflight.get(ck);
  const p = new Promise((resolve, reject) => queue.push({ ck, state, cfg, images, resolve, reject }));
  inflight.set(ck, p);
  pump();
  return p;
}

function pump() {
  while (queue.length && running < CONCURRENCY(queue[0].cfg)) {
    const job = queue.shift();
    running++;
    ask({ baseUrl: job.cfg.baseUrl, model: job.cfg.model, apiKey: job.cfg.apiKey, state: job.state, images: job.images })
      .then((res) => {
        cache.set(job.ck, { answers: res.answers, model: res.model, at: Date.now() });
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
        scheduleSave();
        job.resolve({ answers: res.answers, model: res.model });
      })
      .catch(job.reject)
      .finally(() => { running--; inflight.delete(job.ck); pump(); });
  }
}

function record(tabId, host, key, verdict) {
  const s = tabStats(tabId, host);
  if (s.counted.includes(key)) return;
  s.counted.push(key);
  if (s.counted.length > COUNTED_MAX) s.counted.shift();
  s.posts++;
  s.pressureSum += verdict.pressure;
  s.levels[verdict.level]++;
  if (verdict.level >= 2) s.flagged++;
  for (const it of verdict.intents) s.intents[it.key] = (s.intents[it.key] || 0) + 1;
  scheduleSave();
  if (recordExposure(history, host, key, verdict)) scheduleHistorySave();
}

function safeHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'unknown'; }
}
