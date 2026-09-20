import { INTENTS, LEVEL_LABELS } from './taxonomy.js';
import { emptyHistory, aggregate, flaggedRatio, avgPressure, topIntents, severityBand, dayKey } from './history.js';
import { loadSettings } from './settings.js';

const I18N = globalThis.COGSEC_I18N;
const $ = (id) => document.getElementById(id);
let lang = 'en', range = 30, site = '', history = emptyHistory(), openSite = null;
const T = () => I18N[lang] || I18N.en;
const S = (k, vars) => String((T().stats || {})[k] ?? I18N.en.stats[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars?.[v] ?? '');
const intentLabel = (i) => (T().intents && T().intents[i.key]?.label) || i.label;
const levelLabel = (n) => (T().levels || I18N.en.levels)[n] || LEVEL_LABELS[n];
const pct = (r) => `${Math.round(100 * r)}%`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sevColor = (b) => ['var(--sev0)', 'var(--sev1)', 'var(--sev2)', 'var(--sev3)'][b];

function applyLang() {
  document.documentElement.lang = lang;
  document.title = S('title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = S(el.dataset.i18n);
  $('range').innerHTML = [[7, 'r7'], [30, 'r30'], [90, 'r90'], [0, 'all']].map(([d, k]) => `<option value="${d}">${esc(S(k))}</option>`).join('');
  $('range').value = String(range);
  $('clear').textContent = S('clear');
}

function fillSites() {
  const hosts = Object.keys(history.sites).sort();
  $('site').innerHTML = `<option value="">${esc(S('allSites'))}</option>` + hosts.map((h) => `<option value="${esc(h)}">${esc(h)}</option>`).join('');
  $('site').value = hosts.includes(site) ? site : '';
  if (!hosts.includes(site)) site = '';
}

function render() {
  const agg = aggregate(history, { days: range || null, host: site || null });
  const activeDays = agg.byDay.filter((d) => d.posts).length;
  $('tiles').innerHTML = [
    [S('posts'), agg.posts, ''],
    [S('flagged'), agg.posts ? pct(flaggedRatio(agg)) : '–', agg.posts ? `${agg.flagged} / ${agg.posts}` : ''],
    [S('avgPressure'), agg.posts ? avgPressure(agg).toFixed(2) : '–', '/ 4'],
    [S('sites'), agg.bySite.length, ''],
    [S('days'), activeDays, ''],
  ].map(([k, v, s]) => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join('');
  renderChart(agg.byDay);
  renderTable(agg.bySite);
}

/** Single-series bar chart: one bar per day, height = share of manipulative posts. Thin marks, recessive grid,
 *  hover detail via <title>, the peak day direct-labeled. Days with no posts are drawn as empty slots. */
function renderChart(byDay) {
  const svg = $('chart');
  const W = svg.clientWidth || 900, H = 220, padL = 36, padR = 8, padT = 14, padB = 26;
  const days = fillDays(byDay);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (!days.length) { svg.innerHTML = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="axis">${esc(S('chartEmpty'))}</text>`; return; }
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = days.length, slot = plotW / n, bw = Math.max(2, Math.min(28, slot - 2));
  const y = (r) => padT + plotH * (1 - r);
  const peak = days.reduce((m, d) => (d.posts && flaggedRatio(d) > flaggedRatio(m) ? d : m), days.find((d) => d.posts) || days[0]);
  let out = '';
  for (const g of [0, 0.25, 0.5, 0.75, 1]) out += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(g)}" y2="${y(g)}"/><text class="axis" x="${padL - 6}" y="${y(g) + 4}" text-anchor="end">${Math.round(g * 100)}%</text>`;
  days.forEach((d, i) => {
    const x = padL + i * slot + (slot - bw) / 2;
    if (d.posts) {
      const r = flaggedRatio(d), top = y(r), h = Math.max(2, y(0) - top);
      out += `<rect class="bar" x="${x}" y="${top}" width="${bw}" height="${h}" rx="2" data-date="${d.date}"><title>${esc(S('tooltip', { date: d.date, flagged: d.flagged, posts: d.posts, pct: Math.round(100 * r) }))}</title></rect>`;
      if (d === peak) out += `<text class="lbl" x="${x + bw / 2}" y="${top - 4}" text-anchor="middle">${Math.round(100 * r)}%</text>`;
    }
    const every = n > 40 ? 7 : n > 14 ? 3 : 1;
    if (i % every === 0 || i === n - 1) out += `<text class="axis" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${d.date.slice(5)}</text>`;
  });
  svg.innerHTML = out;
}

/** Expand the day list to a contiguous range so gaps read as gaps. */
function fillDays(byDay) {
  if (!byDay.length && !range) return [];
  const end = new Date(); const start = new Date(end);
  if (range) start.setDate(end.getDate() - (range - 1)); else if (byDay.length) { const [y, m, d] = byDay[0].date.split('-').map(Number); start.setFullYear(y, m - 1, d); }
  const map = Object.fromEntries(byDay.map((d) => [d.date, d]));
  const out = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) { const k = dayKey(d); out.push(map[k] || { date: k, posts: 0, flagged: 0, pressureSum: 0 }); }
  return out;
}

function renderTable(bySite) {
  const tbody = $('table').querySelector('tbody');
  $('empty').hidden = bySite.length > 0; $('empty').textContent = S('empty');
  tbody.innerHTML = bySite.map((s) => {
    const band = severityBand(flaggedRatio(s));
    const top = topIntents(s.intents, 3).map((t) => `${t.intent ? intentLabel(t.intent) : t.key} ${t.count}`).join(' · ');
    const row = `<tr class="site" data-host="${esc(s.host)}">
      <td>${esc(s.host)}</td><td class="num">${s.posts}</td><td class="num">${pct(flaggedRatio(s))} <span class="chips">(${s.flagged})</span></td>
      <td class="num hide-sm">${avgPressure(s).toFixed(2)}</td><td class="nowrap"><span class="dot" style="background:${sevColor(band)}"></span>${esc(levelLabel(band))}</td>
      <td class="hide-sm chips">${esc(top) || '–'}</td><td class="hide-sm chips nowrap">${esc(s.last)}</td></tr>`;
    if (openSite !== s.host) return row;
    const max = Math.max(1, ...Object.values(s.intents));
    const groups = ['feel', 'believe', 'do'].map((g) => {
      const rows = INTENTS.filter((i) => i.group === g).map((i) => ({ i, n: s.intents[i.key] || 0 })).sort((a, b) => b.n - a.n)
        .map(({ i, n }) => `<div class="brow"><span>${esc(intentLabel(i))}</span><i style="width:${Math.round((100 * n) / max)}%"></i><span>${n}</span></div>`).join('');
      return `<div class="grp"><h3>${esc((T().groups || I18N.en.groups)[g])}</h3>${rows}</div>`;
    }).join('');
    return row + `<tr class="detail"><td colspan="7"><h2>${esc(S('breakdown'))} · ${esc(s.host)}</h2><div class="groups">${groups}</div></td></tr>`;
  }).join('');
  for (const tr of tbody.querySelectorAll('tr.site')) tr.onclick = () => { openSite = openSite === tr.dataset.host ? null : tr.dataset.host; render(); };
}

async function load() {
  const { history: saved } = await chrome.storage.local.get('history');
  history = saved?.v === 1 && saved.sites ? saved : emptyHistory();
  fillSites(); render();
}

// ------------------------------------------------------------------ boot
const cfg = await loadSettings().catch(() => ({}));
lang = I18N[cfg.lang] ? cfg.lang : 'en';
for (const [code, d] of Object.entries(I18N)) { const o = document.createElement('option'); o.value = code; o.textContent = d.name; $('lang').appendChild(o); }
$('lang').value = lang;
$('lang').onchange = async () => { lang = $('lang').value; await chrome.storage.local.set({ lang }); applyLang(); fillSites(); render(); };
$('range').onchange = () => { range = Number($('range').value); render(); };
$('site').onchange = () => { site = $('site').value; render(); };
$('export').onclick = () => {
  const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `cogsec-history-${dayKey()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
let armed = false;
$('clear').onclick = async () => {
  if (!armed) { armed = true; $('clear').textContent = S('clearConfirm'); setTimeout(() => { armed = false; $('clear').textContent = S('clear'); }, 4000); return; }
  armed = false; await chrome.runtime.sendMessage({ type: 'clearHistory' }); $('clear').textContent = S('clear'); $('msg').textContent = S('cleared'); await load();
};
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.history) load(); });
window.addEventListener('resize', render);
applyLang();
await load();
