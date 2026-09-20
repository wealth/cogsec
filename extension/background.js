// cogsec service worker: rate-limits calls to the model endpoint, caches verdicts, keeps session stats.
import { ask, isLocalUrl } from './provider.js';
import { summarize, INTENTS } from './taxonomy.js';
import { loadSettings } from './settings.js';

// Local servers share one context window across parallel slots (LM Studio: 4 by default), so one request
// at a time is the safe choice there. Hosted APIs take a few in flight.
const CONCURRENCY = (cfg) => (isLocalUrl(cfg.baseUrl) ? 1 : 4);
const CACHE_MAX = 3000;

const cache = new Map();            // cacheKey -> { answers, at }
const inflight = new Map();         // cacheKey -> Promise
const queue = [];
let running = 0;

const stats = { since: Date.now(), hosts: {} };
function hostStats(host) {
  if (!stats.hosts[host]) {
    stats.hosts[host] = { posts: 0, flagged: 0, pressureSum: 0, levels: [0, 0, 0, 0], intents: Object.fromEntries(INTENTS.map((i) => [i.key, 0])), counted: [] };
  }
  return stats.hosts[host];
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'analyze': return analyzeBatch(msg, sender);
      case 'stats': return { ...stats, hosts: Object.fromEntries(Object.entries(stats.hosts).map(([h, s]) => [h, { ...s, counted: undefined }])) };
      case 'resetStats': { for (const k of Object.keys(stats.hosts)) delete stats.hosts[k]; stats.since = Date.now(); return { ok: true }; }
      case 'settings': return loadSettings();
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
  const results = await Promise.all((msg.posts || []).map(async (post) => {
    try {
      const images = cfg.sendImages ? (post.images || []).slice(0, cfg.maxImages) : [];
      const { answers, model } = await getAnswers(post.key, post.state, cfg, images);
      const verdict = summarize(answers, cfg.threshold);
      record(host, post.key, verdict);
      return { key: post.key, verdict, model };
    } catch (e) {
      return { key: post.key, error: String(e?.message || e), status: e?.status };
    }
  }));
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
        job.resolve({ answers: res.answers, model: res.model });
      })
      .catch(job.reject)
      .finally(() => { running--; inflight.delete(job.ck); pump(); });
  }
}

function record(host, key, verdict) {
  const s = hostStats(host);
  if (s.counted.includes(key)) return;
  s.counted.push(key);
  if (s.counted.length > 5000) s.counted.shift();
  s.posts++;
  s.pressureSum += verdict.pressure;
  s.levels[verdict.level]++;
  if (verdict.level >= 2) s.flagged++;
  for (const it of verdict.intents) s.intents[it.key] = (s.intents[it.key] || 0) + 1;
}

function safeHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'unknown'; }
}
