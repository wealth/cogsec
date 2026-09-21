// Settings, shared by the background worker and the popup. Stored in chrome.storage.local.
import { DEFAULT_BASE_URL } from './provider.js';

export const DEFAULTS = {
  baseUrl: DEFAULT_BASE_URL,   // any OpenAI-compatible /v1 endpoint, local or hosted, or Jev's /v1
  apiKey: '',                  // optional; required by hosted APIs (Cerebras, Groq, OpenAI, ...)
  model: '',                   // empty = first loaded model on a local server, else first listed
  threshold: 0.6, dimHeavy: false, paused: false,
  lang: 'en',                  // UI language: 'en' or 'ru' (see i18n.js)
  sendImages: false, maxImages: 2, imageMaxSide: 512,   // vision models only; images are downscaled in the browser
};

/** Read settings, migrating the pre-provider layout (provider / localUrl / localModel / localApiKey) once. */
export async function loadSettings() {
  const raw = await chrome.storage.local.get(null);
  if ('provider' in raw || 'localUrl' in raw) {
    const migrated = {
      baseUrl: raw.localUrl || DEFAULTS.baseUrl,
      apiKey: raw.localApiKey || '',            // the old `apiKey` was the TypeSafe key: dropped
      model: raw.localModel || '',
    };
    for (const k of ['threshold', 'dimHeavy', 'paused', 'sendImages', 'maxImages', 'imageMaxSide', 'lang']) if (k in raw) migrated[k] = raw[k];
    await chrome.storage.local.clear();
    await chrome.storage.local.set(migrated);
  }
  return chrome.storage.local.get(DEFAULTS);
}
