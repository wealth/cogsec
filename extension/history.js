// Long-term exposure history: per site, per day. Pure functions; storage is handled by the caller.
// Shape:
//   { v: 1, sites: { "x.com": { first, last, days: { "2026-09-21": { posts, flagged, pressureSum, levels:[4], intents:{key:n}, seen:[keys] } } } } }
// "seen" keeps each post counted once per site per day (page reloads re-send the same posts). It is capped.
import { INTENTS } from './taxonomy.js';

export const HISTORY_VERSION = 1;
export const KEEP_DAYS = 90;
export const SEEN_MAX = 3000;

export const emptyHistory = () => ({ v: HISTORY_VERSION, sites: {} });
const emptyDay = () => ({ posts: 0, flagged: 0, pressureSum: 0, levels: [0, 0, 0, 0], intents: {}, seen: [] });

export const dayKey = (d = new Date()) => {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};

/** Count one verdict for a site. Returns true if it was new for that site today. */
export function recordExposure(history, host, key, verdict, date = dayKey()) {
  if (!host) return false;
  const site = history.sites[host] || (history.sites[host] = { first: date, last: date, days: {} });
  const day = site.days[date] || (site.days[date] = emptyDay());
  if (day.seen.includes(key)) return false;
  day.seen.push(key);
  if (day.seen.length > SEEN_MAX) day.seen.shift();
  day.posts++;
  day.pressureSum += verdict.pressure;
  day.levels[verdict.level]++;
  if (verdict.level >= 2) day.flagged++;
  for (const it of verdict.intents) day.intents[it.key] = (day.intents[it.key] || 0) + 1;
  site.last = date;
  return true;
}

/** Drop days older than keepDays and sites left with no days. */
export function pruneHistory(history, keepDays = KEEP_DAYS, now = new Date()) {
  const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - keepDays);
  const min = dayKey(cutoff);
  for (const [host, site] of Object.entries(history.sites)) {
    for (const d of Object.keys(site.days)) if (d < min) delete site.days[d];
    if (!Object.keys(site.days).length) delete history.sites[host];
  }
  return history;
}

/**
 * Aggregate over a range. days = number of days back from `now` (null = all), host = one site (null = all).
 * Returns totals plus byDay (sorted ascending) and bySite (sorted by posts desc).
 */
export function aggregate(history, { days = null, host = null, now = new Date() } = {}) {
  let min = null;
  if (days) { const c = new Date(now); c.setDate(c.getDate() - (days - 1)); min = dayKey(c); }
  const total = { posts: 0, flagged: 0, pressureSum: 0, levels: [0, 0, 0, 0], intents: {} };
  const byDayMap = {}, bySite = [];
  for (const [h, site] of Object.entries(history.sites)) {
    if (host && h !== host) continue;
    const st = { host: h, posts: 0, flagged: 0, pressureSum: 0, levels: [0, 0, 0, 0], intents: {}, first: site.first, last: site.last, activeDays: 0 };
    for (const [d, day] of Object.entries(site.days)) {
      if (min && d < min) continue;
      st.activeDays++;
      for (const agg of [total, st]) {
        agg.posts += day.posts; agg.flagged += day.flagged; agg.pressureSum += day.pressureSum;
        for (let i = 0; i < 4; i++) agg.levels[i] += day.levels[i] || 0;
        for (const [k, n] of Object.entries(day.intents)) agg.intents[k] = (agg.intents[k] || 0) + n;
      }
      const bd = byDayMap[d] || (byDayMap[d] = { date: d, posts: 0, flagged: 0, pressureSum: 0 });
      bd.posts += day.posts; bd.flagged += day.flagged; bd.pressureSum += day.pressureSum;
    }
    if (st.posts) bySite.push(st);
  }
  bySite.sort((a, b) => b.posts - a.posts);
  const byDay = Object.values(byDayMap).sort((a, b) => (a.date < b.date ? -1 : 1));
  return { ...total, byDay, bySite };
}

export const flaggedRatio = (s) => (s.posts ? s.flagged / s.posts : 0);
export const avgPressure = (s) => (s.posts ? s.pressureSum / s.posts : 0);

export function topIntents(intents, n = 3) {
  return Object.entries(intents).sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => ({ key, count, intent: INTENTS.find((i) => i.key === key) }));
}

/** Severity band from a flagged ratio; same thresholds as the toolbar badge. */
export function severityBand(ratio) {
  return ratio < 0.15 ? 0 : ratio < 0.35 ? 1 : ratio < 0.6 ? 2 : 3;
}
