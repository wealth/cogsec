// Provider front door, and the OpenAI-compatible chat client behind it: local servers (LM Studio,
// Ollama, llama.cpp) or hosted APIs (Cerebras, Groq, OpenAI, OpenRouter, ...) with an optional API key.
// Endpoints that speak TypeSafe's System One protocol instead (Jev) are routed to jev.js. Either way
// the result is the `answers` shape consumed by `summarize()` in taxonomy.js.
//
// A chat model is asked for one JSON object per post: each intent rated 0–3, a primary intent, System 1
// pressure 0–4, and evidence 0–3. Ordinal ratings are far more stable from small models than raw
// probabilities; they are mapped to probabilities below. Jev answers the same questions natively.
import { INTENTS, FRAME, PRESSURE_LEVELS, PRIMARY_NONE } from './taxonomy.js';
import { ProviderError } from './errors.js';
import * as jev from './jev.js';
export { ProviderError };

export const PRESETS = {
  lmstudio: { label: 'LM Studio', url: 'http://localhost:1234/v1', local: true },
  ollama: { label: 'Ollama', url: 'http://localhost:11434/v1', local: true },
  llamacpp: { label: 'llama.cpp', url: 'http://localhost:8080/v1', local: true },
  jev: { label: 'Jev (TypeSafe)', url: jev.BASE_URL, model: jev.DEFAULT_MODEL, kind: 'systemone' },
  cerebras: { label: 'Cerebras', url: 'https://api.cerebras.ai/v1' },
  groq: { label: 'Groq', url: 'https://api.groq.com/openai/v1' },
  openai: { label: 'OpenAI', url: 'https://api.openai.com/v1' },
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
};
export const DEFAULT_BASE_URL = PRESETS.lmstudio.url;

const ORDINAL_TO_P = [0.05, 0.35, 0.65, 0.93]; // 0 absent, 1 weak hint, 2 clearly present, 3 blatant

export function isLocalUrl(u) {
  try { const h = new URL(u).hostname; return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local'); } catch { return false; }
}

// Preset hosts by protocol, so the table above stays the only place a provider is declared.
const KIND_BY_HOST = new Map(Object.values(PRESETS).map((p) => { try { return [new URL(p.url).hostname, p.kind || 'openai']; } catch { return ['', 'openai']; } }));

/** Which protocol an endpoint speaks: 'systemone' (Jev, typed questions) or 'openai' (chat completions). */
export function providerKind(u) {
  try {
    const { hostname, pathname } = new URL(u);
    return /\/systemone\/?$/.test(pathname) ? 'systemone' : KIND_BY_HOST.get(hostname) || 'openai';
  } catch { return 'openai'; }   // not a URL: the OpenAI client reports it
}
export const isSystemOne = (u) => providerKind(u) === 'systemone';

/** The exact body that would be sent for `state`, whichever protocol the endpoint speaks (CLI --dry). */
export function previewRequest({ baseUrl = DEFAULT_BASE_URL, state, model, images = [] } = {}) {
  return isSystemOne(baseUrl)
    ? jev.buildRequest(state, model || jev.DEFAULT_MODEL)
    : buildRequest(state, model || '<model>', { images });
}

export function buildSystemPrompt() {
  const intents = INTENTS.map((i) =>
    `- ${i.key} (${i.label}): ${i.question}\n    counts: ${i.yes.what}\n    does NOT count: ${i.no.what}`).join('\n');
  const pressure = PRESSURE_LEVELS.map((l, n) => `  ${n} = ${l}`).join('\n');
  const primaryKeys = [...INTENTS.map((i) => i.key), PRIMARY_NONE].join(', ');
  return `You audit social-media posts on behalf of the reader. ${FRAME}

Rate each intent below on a 0-3 scale: 0 = absent, 1 = weak hint, 2 = clearly present, 3 = blatant or dominant.
${intents}

primary_intent: the single dominant thing the post does to the reader. One of: ${primaryKeys}. Use "${PRIMARY_NONE}" when the post is not manipulative.

pressure (0-4): how much the post relies on the reader's fast, emotional System 1 reaction instead of giving them something to check:
${pressure}

evidence (0-3): does the post give the reader something checkable (named source, link to primary material, specific figures with provenance, first-hand detail)? 0 = nothing checkable, 3 = fully sourced.

Posts may be in any language (Russian, English, ...); judge them in their own language the same way. Be strict: most ordinary posts score 0 on most intents. Reply with a single compact JSON object on one line, no spaces or newlines, and nothing else.`;
}

export function buildSchema() {
  const props = {};
  for (const i of INTENTS) props[i.key] = { type: 'integer', minimum: 0, maximum: 3 };
  props.primary_intent = { type: 'string', enum: [...INTENTS.map((i) => i.key), PRIMARY_NONE] };
  props.pressure = { type: 'integer', minimum: 0, maximum: 4 };
  props.evidence = { type: 'integer', minimum: 0, maximum: 3 };
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
}

export const SCHEMA = buildSchema();
const SYSTEM_PROMPT = buildSystemPrompt();
const IMAGE_NOTE = 'Images from the post are attached. Judge them together with the text: memes, screenshots, ' +
  'charts, captions and overlaid text carry the same intents as words.';

/**
 * @param {string[]} [images]  data: URLs (or https URLs) of the post's images, for vision-capable models.
 *   Sent as OpenAI-style image_url content parts in the user message; the system prompt stays unchanged so
 *   the server's prompt-prefix cache keeps working.
 * @param {boolean} [extras]  send reasoning-off hints (thinking models would otherwise spend the whole budget
 *   reasoning and return empty content). Hosted APIs that reject unknown fields get these switched off.
 */
export function buildRequest(state, model, { useSchema = true, extras = true, images = [] } = {}) {
  const text = `Post to audit (JSON):\n${JSON.stringify(state, null, 1)}\n\n${images.length ? IMAGE_NOTE + '\n\n' : ''}Return the JSON rating object.`;
  const user = images.length
    ? { role: 'user', content: [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))] }
    : { role: 'user', content: text };
  const body = {
    model,
    temperature: 0,
    max_tokens: 400,
    stream: false,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, user],
  };
  if (useSchema) body.response_format = { type: 'json_schema', json_schema: { name: 'cogsec_rating', strict: true, schema: SCHEMA } };
  if (extras) {
    body.reasoning_effort = 'none';                       // honoured by LM Studio (llama.cpp engine)
    body.chat_template_kwargs = { enable_thinking: false }; // honoured by llama.cpp / Ollama
  }
  return body;
}

/** Convert the model's ordinal ratings into the answers shape used by summarize(). */
export function toAnswers(r) {
  const answers = {};
  const p = (v, n = 3) => ORDINAL_TO_P[Math.max(0, Math.min(n, Math.round(Number(v) || 0)))];
  for (const i of INTENTS) answers[i.key] = { type: 'noul', noul: p(r[i.key]) };
  const validPrimary = INTENTS.some((i) => i.key === r.primary_intent) ? r.primary_intent : PRIMARY_NONE;
  const top = Math.max(0, ...INTENTS.map((i) => answers[i.key].noul));
  const confidence = validPrimary === PRIMARY_NONE ? 1 - top : answers[validPrimary].noul;
  answers.primary_intent = { type: 'choice', choice: validPrimary, probabilities: { [validPrimary]: confidence }, confidence };
  const pressure = Math.max(0, Math.min(4, Number(r.pressure) || 0));
  answers.pressure = { type: 'score', score: pressure, confidence: 0.7, probabilities: { [String(Math.round(pressure))]: 1 }, legend: Object.fromEntries(PRESSURE_LEVELS.map((l, n) => [String(n), l])) };
  answers.evidence = { type: 'noul', noul: p(r.evidence) };
  return answers;
}

/** List model ids from the server (GET /models). */
export async function listModels({ baseUrl = DEFAULT_BASE_URL, apiKey, fetchImpl = globalThis.fetch } = {}) {
  if (isSystemOne(baseUrl)) return jev.listModels({ baseUrl, apiKey, fetchImpl });
  const res = await fetchImpl(`${trim(baseUrl)}/models`, { headers: headers(apiKey) }).catch((e) => { throw new ProviderError(`Cannot reach ${baseUrl}: ${e?.message || e}`); });
  if (res.status === 401 || res.status === 403) throw new ProviderError(`${baseUrl} rejected the API key (HTTP ${res.status})`, { status: res.status });
  if (!res.ok) throw new ProviderError(`${baseUrl}/models returned HTTP ${res.status}`, { status: res.status });
  const j = await res.json();
  return (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
}

/**
 * Pick a model that is already loaded in memory when the server can tell us (LM Studio's /api/v0/models
 * reports `state`; Ollama's /api/ps lists running models). Falls back to the first id from /models.
 */
export async function pickLoadedModel({ baseUrl = DEFAULT_BASE_URL, apiKey, fetchImpl = globalThis.fetch } = {}) {
  if (isSystemOne(baseUrl)) return jev.DEFAULT_MODEL;
  const root = trim(baseUrl).replace(/\/v1$/, '');
  if (isLocalUrl(baseUrl)) {
    try {
      const r = await fetchImpl(`${root}/api/v0/models`, { headers: headers(apiKey) });
      if (r.ok) { const j = await r.json(); const loaded = (j.data || []).find((m) => m.state === 'loaded' && m.type !== 'embeddings'); if (loaded) return loaded.id; }
    } catch { /* not LM Studio */ }
    try {
      const r = await fetchImpl(`${root}/api/ps`, { headers: headers(apiKey) });
      if (r.ok) { const j = await r.json(); const running = (j.models || [])[0]; if (running?.name) return running.name; }
    } catch { /* not Ollama */ }
  }
  const ids = await listModels({ baseUrl, apiKey, fetchImpl });
  if (!ids.length) throw new ProviderError(`No models available at ${baseUrl}.`);
  return ids[0];
}

// What each endpoint has rejected with HTTP 400, so we stop sending it. Keyed by base URL.
const caps = new Map();
const capsFor = (baseUrl) => { const k = trim(baseUrl); if (!caps.has(k)) caps.set(k, { extras: true, schema: true }); return caps.get(k); };
export const _capsForTests = caps;

/**
 * Ask the model about one post.
 *
 * Attempt order:
 *   1. no schema   — the model writes compact JSON on its own (~100 output tokens). Fastest. Some engines'
 *                    schema grammars force spaced JSON (LM Studio MLX + VLMs via llguidance), so a free
 *                    reply is ~30% quicker there. The reply is accepted only if it validates as a rating.
 *   2. json_schema — enforce the shape if the free reply was not a usable rating.
 * An HTTP 400 on a request with reasoning-off extras retries without them and remembers that for the
 * endpoint; a 400 on a schema request marks schemas unsupported there. A 400 on a bare request is a real error.
 */
export async function ask({ baseUrl = DEFAULT_BASE_URL, model, state, images = [], apiKey, fetchImpl = globalThis.fetch, signal } = {}) {
  if (isSystemOne(baseUrl)) return jev.ask({ baseUrl, model, state, apiKey, fetchImpl, signal });   // typed questions, text only
  if (!model) model = await pickLoadedModel({ baseUrl, apiKey, fetchImpl });
  const cap = capsFor(baseUrl);
  const plan = [{ useSchema: false }, { useSchema: true }];
  let lastErr;
  for (let i = 0; i < plan.length; i++) {
    const { useSchema } = plan[i];
    if (useSchema && !cap.schema) continue;
    const extras = cap.extras;
    let res;
    try {
      res = await fetchImpl(`${trim(baseUrl)}/chat/completions`, {
        method: 'POST', headers: headers(apiKey), signal,
        body: JSON.stringify(buildRequest(state, model, { useSchema, extras, images })),
      });
    } catch (e) {
      throw new ProviderError(`Cannot reach ${baseUrl}: ${e?.message || e}${isLocalUrl(baseUrl) ? '. Is the local server running (LM Studio → Developer → Start server, with CORS on)?' : ''}`, { retryable: true });
    }
    if (res.status === 400) {
      const body = await res.text().catch(() => '');
      if (extras) { cap.extras = false; i--; continue; }              // retry the same step without extras
      if (useSchema) { cap.schema = false; lastErr = new ProviderError(`${lastErr ? lastErr.message + ' ; and ' : ''}endpoint rejected json_schema: ${body.slice(0, 200)}`, { status: 400, body }); continue; }
      if (/context size|context length|exceed/i.test(body)) throw new ProviderError('Model context too small for this request. Load the model with a context length of at least 4096 tokens (LM Studio: model settings, or `lms load <model> --context-length 8192`).', { status: 400, body });
      throw new ProviderError(`Endpoint rejected the request (HTTP 400): ${body.slice(0, 300)}`, { status: 400, body });
    }
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new ProviderError(`${baseUrl} rejected the API key (HTTP ${res.status}).`, { status: res.status, body: text });
    if (res.status === 404) throw new ProviderError(`Model or endpoint not found (HTTP 404): ${text.slice(0, 200)}`, { status: 404, body: text });
    if (!res.ok) {
      if (/context size|context length|exceed/i.test(text)) throw new ProviderError('Model context too small for this request. Load the model with a context length of at least 4096 tokens (LM Studio: model settings, or `lms load <model> --context-length 8192`).', { status: res.status, body: text });
      throw new ProviderError(`Endpoint HTTP ${res.status}: ${text.slice(0, 300)}`, { status: res.status, retryable: res.status === 429 || res.status >= 500, body: text });
    }
    let j;
    try { j = JSON.parse(text); } catch { throw new ProviderError(`Endpoint returned non-JSON: ${text.slice(0, 200)}`); }
    const msg = j.choices?.[0]?.message ?? {};
    const content = msg.content ?? '';
    // Some engines (LM Studio MLX with Qwen 3.5) leave `content` empty and put the whole reply in
    // `reasoning_content`, because the chat template opens a think block the model never closes.
    const parsed = extractJson(content) || extractJson(msg.reasoning_content ?? msg.reasoning ?? '');
    if (!parsed) {
      const rt = j.usage?.completion_tokens_details?.reasoning_tokens;
      const why = rt && j.choices?.[0]?.finish_reason === 'length' ? ' (model spent the whole budget thinking; use a non-thinking model or a build whose engine honours reasoning off)' : '';
      lastErr = new ProviderError(`Model reply had no rating JSON${why}: ${String(content || msg.reasoning_content || '').slice(0, 160)}`);
      continue;
    }
    return { model: j.model || model, answers: toAnswers(parsed), raw: parsed, usage: { input_tokens: j.usage?.prompt_tokens ?? 0, output_tokens: j.usage?.completion_tokens ?? 0 } };
  }
  throw lastErr ?? new ProviderError('request failed');
}

/** A parsed object counts as a rating only if it carries the primary intent and most intent keys as numbers. */
export function isRating(o) {
  if (!o || typeof o !== 'object' || typeof o.primary_intent !== 'string') return false;
  const n = INTENTS.filter((i) => Number.isFinite(Number(o[i.key]))).length;
  return n >= Math.ceil(INTENTS.length * 0.75);
}

/** Find the first balanced JSON object in `s` that looks like a rating (skips quoted input echoes and prose). */
export function extractJson(s) {
  if (!s) return null;
  const text = String(s).replace(/```(?:json)?/g, '');
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try { const o = JSON.parse(text.slice(start, i + 1)); if (isRating(o)) return o; } catch { /* keep scanning */ }
        break;
      }
    }
  }
  return null;
}

const trim = (u) => String(u || '').replace(/\/+$/, '');
const headers = (apiKey) => ({ 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) });
