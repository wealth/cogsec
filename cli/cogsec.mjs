#!/usr/bin/env node
// cogsec CLI: run the taxonomy against posts from the terminal, through any OpenAI-compatible endpoint
// or through Jev (--url https://api.typesafe.ai/v1 --key ..., model defaults to jev-latest).
//   node cli/cogsec.mjs "post text"            analyze one post
//   node cli/cogsec.mjs --file posts.txt        one post per line, or a JSON array of strings / {author,text} objects
//   node cli/cogsec.mjs --fixtures              run the bundled sample posts
//   flags: --url http://localhost:1234/v1   --model <id>   --key <api key>   --threshold 0.6
//          --image <file>  attach an image to every post (repeatable; vision models only)
//          --lang ru       print intent names and levels in Russian
//          --dry (print the request instead of calling)   --json (raw answers)
// env: COGSEC_BASE_URL, COGSEC_MODEL, COGSEC_API_KEY (TYPESAFE_API_KEY for Jev), COGSEC_LANG
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ask, previewRequest, isSystemOne, PRESETS, DEFAULT_BASE_URL } from '../extension/provider.js';
import { summarize } from '../extension/taxonomy.js';
import '../extension/i18n.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const OPT_FLAGS = ['--file', '--threshold', '--model', '--url', '--key', '--image', '--lang'];
const I18N = globalThis.COGSEC_I18N;
const lang = opt('--lang', process.env.COGSEC_LANG || 'en');
const L = I18N[lang] || I18N.en;
const tLabel = (i) => (L.intents && L.intents[i.key]?.label) || i.label;
const tHint = (i) => (L.intents && L.intents[i.key]?.hint) || i.hint;
const tLevel = (n) => (L.levels || I18N.en.levels)[n];
const tNone = L.none || I18N.en.none;
const B = L.badge || I18N.en.badge;
const threshold = Number(opt('--threshold', 0.6));
const baseUrl = opt('--url', process.env.COGSEC_BASE_URL || DEFAULT_BASE_URL);
const model = opt('--model', process.env.COGSEC_MODEL || '');
const apiKey = opt('--key', process.env.COGSEC_API_KEY || (isSystemOne(baseUrl) ? process.env.TYPESAFE_API_KEY : '') || '');
const defaultModelNote = isSystemOne(baseUrl) ? PRESETS.jev.model : '(first loaded model)';
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const images = args.flatMap((a, i) => (a === '--image' && args[i + 1] ? [args[i + 1]] : [])).map((f) => {
  const ext = f.split('.').pop().toLowerCase();
  return `data:${MIME[ext] || 'image/jpeg'};base64,${readFileSync(f).toString('base64')}`;
});

let posts = [];
if (flag('--fixtures')) posts = JSON.parse(readFileSync(join(here, 'fixtures.json'), 'utf8'));
else if (opt('--file')) {
  const raw = readFileSync(opt('--file'), 'utf8');
  try { posts = JSON.parse(raw); } catch { posts = raw.split(/\n+/).map((s) => s.trim()).filter(Boolean); }
} else {
  const positional = args.filter((a, i) => !a.startsWith('--') && !OPT_FLAGS.includes(args[i - 1]));
  if (!positional.length) { console.error('usage: cogsec.mjs "post text" | --file posts.txt | --fixtures  [--url ...] [--model ...] [--key ...] [--image f] [--dry] [--json]'); process.exit(2); }
  posts = [positional.join(' ')];
}
posts = posts.map((p) => (typeof p === 'string' ? { text: p } : p));

if (!flag('--dry') && !flag('--json')) console.error(`\x1b[2m${baseUrl} · ${model || defaultModelNote}${apiKey ? ' · key set' : ''}\x1b[0m`);

const bar = (p) => '█'.repeat(Math.round(p * 20)).padEnd(20, '·');
const C = { 0: '\x1b[32m', 1: '\x1b[33m', 2: '\x1b[38;5;208m', 3: '\x1b[31m' };
const R = '\x1b[0m', D = '\x1b[2m', BOLD = '\x1b[1m';

let totalTokens = 0;
for (const post of posts) {
  const { expect, ...rest } = post;
  const state = { platform: post.platform || 'cli', post: { ...rest, ...(images.length ? { images_attached: images.length } : {}) } };
  if (flag('--dry')) { console.log(JSON.stringify(previewRequest({ baseUrl, state, model, images: images.map((u) => u.slice(0, 40) + '…') }), null, 2)); continue; }
  const t0 = Date.now();
  let res;
  try {
    res = await ask({ baseUrl, model, apiKey, state, images });
  } catch (e) { console.error(`${C[3]}error${R} ${e.message}`); if (/Cannot reach|rejected the API key|needs an API key/.test(e.message)) process.exit(1); continue; }
  const ms = Date.now() - t0;
  totalTokens += res.usage?.input_tokens || 0;
  const v = summarize(res.answers, threshold);
  if (flag('--json')) { console.log(JSON.stringify({ post: rest, answers: res.answers, verdict: v, usage: res.usage, ms }, null, 2)); continue; }

  console.log(`\n${D}${'─'.repeat(78)}${R}`);
  console.log(`${D}${(post.author ? post.author + ': ' : '')}${R}${(post.title ? post.title + ' — ' : '') + (post.text || '')}`);
  if (expect) console.log(`${D}expected: ${expect}${R}`);
  const primaryIntent = v.primary.key !== 'none' ? v.all.find((i) => i.key === v.primary.key) : null;
  console.log(`${C[v.level]}${BOLD}${tLevel(v.level)}${R}  ${B.main}: ${BOLD}${primaryIntent ? tLabel(primaryIntent) : tNone}${R} ${D}(${pct(v.primaryConfidence)})${R}  ${B.reflex} ${v.pressure.toFixed(1)}/4  ${B.evidence} ${pct(v.evidence)}  ${D}${res.usage?.input_tokens ?? '?'} tok · ${ms} ms · ${res.model}${R}`);
  for (const i of v.all.slice().sort((a, b) => b.p - a.p)) {
    const hit = i.p >= threshold;
    console.log(`  ${hit ? C[Math.min(3, 1 + Math.floor(i.p * 3))] : D}${tLabel(i).padEnd(26)} ${bar(i.p)} ${pct(i.p).padStart(4)}${R}${hit ? `  ${D}${tHint(i)}${R}` : ''}`);
  }
}
if (!flag('--dry') && !flag('--json') && posts.length > 1) {
  console.log(`\n${D}${posts.length} posts · ${totalTokens} input tokens${R}`);
}

function pct(p) { return `${Math.round((p || 0) * 100)}%`; }
