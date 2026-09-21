// TypeSafe System One client — Jev. https://docs.typesafe.ai/api
//
// Jev answers typed questions instead of writing text, and its three answer types are exactly the ones
// `summarize()` consumes: a noul (probability the answer is yes) per intent, a choice for the main intent,
// a score for System 1 pressure. So there is no system prompt, no JSON to fish out of a reply and no
// ordinal-to-probability mapping: the taxonomy goes out as `questions`, and the `answers` map comes back
// in the shape taxonomy.js already expects. The probabilities are calibrated, which the 0-3 ordinals a
// chat model writes are not.
//
// The whole taxonomy rides in one request: Jev reads the state once and evaluates every question against
// it in parallel, so 25 questions cost about as much latency as one (https://docs.typesafe.ai/patterns/fan-out).
import { INTENTS, FRAME, PRESSURE_LEVELS, PRIMARY_NONE } from './taxonomy.js';
import { ProviderError } from './errors.js';

export const BASE_URL = 'https://api.typesafe.ai/v1';
export const DEFAULT_MODEL = 'jev-latest';     // alias; the reply reports the version that answered
export const KEYS_URL = 'https://console.typesafe.ai';

/** The taxonomy as a Jev `questions` map: one noul per intent, plus the three meta questions. */
export function buildQuestions() {
  const q = {};
  for (const i of INTENTS) {
    q[i.key] = {
      type: 'noul',
      instructions: { frame: FRAME, question: i.question },
      criteria: {
        true: { counts_as_yes: i.yes.what, examples: i.yes.examples },
        false: { does_not_count: i.no.what, examples: i.no.examples },
      },
    };
  }
  q.primary_intent = {
    type: 'choice',
    instructions: { frame: FRAME, question: 'Which single intent is the dominant thing this post does to the reader?' },
    criteria: {
      ...Object.fromEntries(INTENTS.map((i) => [i.key, `${i.label}: ${i.hint}`])),
      [PRIMARY_NONE]: 'None of these: the post is not trying to manipulate the reader.',
    },
  };
  q.pressure = {
    type: 'score',
    instructions: { frame: FRAME, question: "How much does this post lean on the reader's fast, emotional System 1 reaction instead of giving them something to check?" },
    criteria: PRESSURE_LEVELS,
  };
  q.evidence = {
    type: 'noul',
    instructions: { frame: FRAME, question: 'Does this post give the reader something checkable?' },
    criteria: {
      true: 'A named source, a link to primary material, specific figures with provenance, or first-hand detail.',
      false: 'Nothing to check: bare assertion, anonymous "they say", a claim with no way to trace it.',
    },
  };
  return q;
}

const QUESTIONS = buildQuestions();

export function buildRequest(state, model = DEFAULT_MODEL) {
  return { state, model, questions: QUESTIONS };
}

/**
 * Ask Jev about one post. Same contract as provider.ask(): returns { model, answers, raw, usage }.
 * `images` is accepted and ignored — Jev is text only (https://docs.typesafe.ai/models); the post's
 * state already carries `images_attached`, so an image-heavy post is still visible as such.
 */
export async function ask({ baseUrl = BASE_URL, model, state, apiKey, fetchImpl = globalThis.fetch, signal } = {}) {
  if (!apiKey) throw new ProviderError(`Jev needs an API key. Create one at ${KEYS_URL} and paste it into the API key field.`, { status: 401 });
  const url = evalUrl(baseUrl);
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildRequest(state, model || DEFAULT_MODEL)),
    });
  } catch (e) {
    throw new ProviderError(`Cannot reach ${url}: ${e?.message || e}`, { retryable: true });
  }
  const text = await res.text();
  if (!res.ok) throw httpError(url, res, text);
  let j;
  try { j = JSON.parse(text); } catch { throw new ProviderError(`${url} returned non-JSON: ${text.slice(0, 200)}`); }
  if (!j.answers || typeof j.answers !== 'object') throw new ProviderError(`${url} returned no answers: ${text.slice(0, 200)}`);
  return {
    model: j.model || model || DEFAULT_MODEL,
    answers: j.answers,   // already { noul | choice | score } per question id: what summarize() reads
    raw: j.answers,
    usage: { input_tokens: j.usage?.input_tokens ?? 0, output_tokens: j.usage?.output_tokens ?? 0 },
  };
}

/** GET /v1/models — the aliases and models this key may send in `model`. */
export async function listModels({ baseUrl = BASE_URL, apiKey, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new ProviderError(`Jev needs an API key. Create one at ${KEYS_URL} and paste it into the API key field.`, { status: 401 });
  const url = `${apiRoot(baseUrl)}/models`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}` } })
    .catch((e) => { throw new ProviderError(`Cannot reach ${url}: ${e?.message || e}`); });
  const text = await res.text();
  if (!res.ok) throw httpError(url, res, text);
  let j;
  try { j = JSON.parse(text); } catch { throw new ProviderError(`${url} returned non-JSON: ${text.slice(0, 200)}`); }
  return (j.models || j.data || []).map((m) => m.name || m.id).filter(Boolean);
}

function httpError(url, res, body) {
  const retryAfter = res.headers?.get?.('retry-after');
  const snippet = String(body || '').slice(0, 300);
  if (res.status === 401 || res.status === 403) return new ProviderError(`${url} rejected the API key (HTTP ${res.status}). Check the key at ${KEYS_URL}.`, { status: res.status, body });
  if (res.status === 422) return new ProviderError(`Jev rejected the request (HTTP 422): ${snippet}`, { status: 422, body });
  if (res.status === 429) return new ProviderError(`Jev rate limit reached (HTTP 429)${retryAfter ? `, retry after ${retryAfter}s` : ''}. Slow down or ask TypeSafe for higher limits.`, { status: 429, retryable: true, body });
  if (res.status === 529 || res.status >= 500) return new ProviderError(`Jev is unavailable (HTTP ${res.status}): ${snippet}`, { status: res.status, retryable: true, body });
  return new ProviderError(`Jev HTTP ${res.status}: ${snippet}`, { status: res.status, body });
}

// Settings hold the API root (".../v1"), but a URL pasted straight from the docs already ends in
// /systemone; accept either.
const trim = (u) => String(u || BASE_URL).replace(/\/+$/, '');
const apiRoot = (u) => trim(u).replace(/\/systemone$/, '');
const evalUrl = (u) => `${apiRoot(u)}/systemone`;
