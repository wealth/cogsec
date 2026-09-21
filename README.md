# cogsec

A Chrome extension that lists, for every post in your feed, what the post is trying to make you **feel**, **believe**, or **do**.
Each post gets a small bar under it: an overall rating (Clean / Mild / Manipulative / Heavy), the main intent, the
detected intents with probabilities, a "reflex" score (how hard the post leans on your System 1), and whether it gives you
anything checkable. Click the bar for the full breakdown. The popup shows what your feed as a whole is doing to you, and
the toolbar icon carries a per-tab badge: the share of posts rated Manipulative or Heavy, green below 15%, yellow below
35%, orange below 60%, red above (status colours always paired with a label). While posts from a tab are queued or waiting on the model, the icon pulses a yellow
dot and the tooltip shows how many are in flight.

Classification runs through any OpenAI-compatible chat endpoint: a **local** model via LM Studio, Ollama or llama.cpp
(nothing leaves your machine), or a **hosted** API such as Cerebras, Groq, OpenAI or OpenRouter with your API key.
It also speaks **Jev**, TypeSafe's System One model, which answers typed questions instead of writing text: the whole
taxonomy goes over the wire as 25 questions and comes back as calibrated probabilities, no prompt and no JSON to repair.

## The taxonomy

Twenty-two intents, each judged independently, plus three meta questions. The "feel" group covers both the
aversive hooks and the pleasant ones that make a feed worth coming back to.

| Wants you to feel | Wants you to believe | Wants you to do |
|---|---|---|
| Outrage | Us vs. them | Engagement bait |
| Fear | Hidden hand (conspiracy framing) | Curiosity gap |
| Contempt | Unverifiable authority | Selling |
| Guilt / shame | Misleading framing | Parasocial hook |
| Urgency / FOMO | Strawman | Inauthentic |
| Empowerment | False certainty | |
| Love / warmth (wholesome bait) | | |
| Envy / comparison | | |
| Lust | | |
| Insecurity / anxiety | | |
| Curiosity / awe | | |

Meta questions:

- **Main intent**: the dominant thing the post is doing, or "none".
- **System 1 pressure** (0–4): 0 = gives evidence and leaves the conclusion to you; 4 = pure reflex trigger.
- **Evidence**: does the post give you anything checkable?

Every intent carries a "what counts / what does NOT count" rubric with examples. The NOT side is what keeps a plain
news report of an upsetting event from being flagged as outrage bait. Everything lives in `extension/taxonomy.js`;
edit the wording or add intents there and the prompt, the extension and the CLI all pick it up.

## Install

### 1. A model endpoint

**Local, LM Studio** (tested, macOS):

```
# one-time: download a model. Qwen 3.5 9B is the tested default; any non-thinking instruct model 7B+ works.
lms get qwen/qwen3.5-9b

# each session: start the server with CORS (the extension needs it) and load the model
lms server start --cors
lms load qwen/qwen3.5-9b --context-length 8192
```

`lms` lives at `~/.cache/lm-studio/bin/lms` (or `~/.lmstudio/bin/lms`). The GUI works too: Developer tab → Start server → enable CORS → load a model.

**Local, Ollama**: `ollama pull qwen3:8b`, then pick the Ollama preset in the popup. Ollama allows Chrome extension
origins by default. Untested here.

**Local, llama.cpp**: `llama-server -m model.gguf --jinja -c 8192`, preset llama.cpp. Untested here.

**Hosted (Cerebras, Groq, OpenAI, OpenRouter, anything with `/v1/chat/completions`)**: pick the preset or type the
base URL, paste your API key, type a model id (or hit ↻ to list what the API offers). On Save the extension asks for
permission to contact that site; it holds no remote host permissions by default. Post text (and images, if enabled)
then leaves your machine for that provider. Requests carry `reasoning_effort` and `chat_template_kwargs` hints for
thinking models; an endpoint that rejects them with HTTP 400 gets them switched off automatically and remembered,
same for `response_format: json_schema`. Untested here beyond mocked responses; no key was available.

**Hosted, Jev (TypeSafe)**: pick the **Jev (TypeSafe)** preset (`https://api.typesafe.ai/v1`), paste a key from
[console.typesafe.ai](https://console.typesafe.ai) into the API key field, leave the model at `jev-latest`. Jev is a
System One model: you send a `state` and a map of typed questions, and each comes back as a typed answer — a
yes-probability (noul) per intent, a choice for the main intent, a score for System 1 pressure. That is exactly the
shape `summarize()` already consumes, so there is no prompt, no JSON to fish out of a reply and no 0–3 ordinals to
map: `jev.js` hands the taxonomy over as it stands. All 25 questions ride in one request and are evaluated against
the post in parallel, about 7.6k input tokens (~$0.0003 at $0.042 / Mtok; output is free). Text only, so images are
skipped for this endpoint.

### 2. Extension

1. Chrome → `chrome://extensions` → enable Developer mode → **Load unpacked** → pick the `extension/` folder.
2. Click the cogsec icon. Endpoint defaults to LM Studio. Hit ↻ to list models, pick one (or leave it empty for the first loaded model), **Test**.
3. Open X. Posts get annotated as they scroll into view, roughly one every 2–3 seconds on an M2 Max with the 9B model.

Auto-runs on X/Twitter, Bluesky, Reddit, Threads, Hacker News, 4chan (threads and catalog) and 2ch / Dvach on all its
mirrors (2ch.hk, 2ch.org, 2ch.life, 2ch.pm, 2ch.su). On any other page, click **Analyze this page** in the popup; a
generic adapter picks up article-like blocks of text.

**Long-term statistics.** The **Statistics** button in the popup (also the extension's options page) opens a dashboard
of everything cogsec has rated: posts analysed, share manipulative, average System 1 pressure, per site and per day,
with an intent breakdown per site, a range switch (7 / 30 / 90 days / all time), JSON export and a clear button. Each
post counts once per site per day; history is kept for 90 days in the extension's local storage and never leaves the
browser. The per-tab counter in the popup and the toolbar badge are separate and reset when the tab closes.

**Language.** The popup has a language switch (English, Русский). It localises the badge, the intent names and hints,
the levels and the popup itself; strings live in `extension/i18n.js`, one dictionary per language, so adding another is
a matter of one more entry. The model is told posts may be in any language and rates them the same way; the two Russian
fixtures come out as expected on Qwen 3.5. CLI: `--lang ru`.

## CLI

```
node cli/cogsec.mjs --fixtures                              # 24 sample posts with expected labels, LM Studio by default
node cli/cogsec.mjs --fixtures --lang ru                    # same, Russian labels
node cli/cogsec.mjs "Retweet if you agree!"                 # one post
node cli/cogsec.mjs --file posts.txt                        # one post per line, or a JSON array
node cli/cogsec.mjs --fixtures --model gigachat3.1-10b-a1.8b   # try another loaded model
node cli/cogsec.mjs --fixtures --url https://api.cerebras.ai/v1 --key $CEREBRAS_API_KEY --model llama-3.3-70b
node cli/cogsec.mjs --fixtures --url https://api.typesafe.ai/v1 --key $TYPESAFE_API_KEY   # Jev; model defaults to jev-latest
node cli/cogsec.mjs "text" --image meme.jpg                 # attach an image (vision models)
node cli/cogsec.mjs "text" --dry                            # print the exact request, no call
```

Flags: `--url`, `--model`, `--key`, `--threshold`, `--image`, `--lang`, `--json`, `--dry`. Env: `COGSEC_BASE_URL`, `COGSEC_MODEL`, `COGSEC_API_KEY` (`TYPESAFE_API_KEY` is picked up for Jev), `COGSEC_LANG`.

Use the fixtures loop to tune the taxonomy: change a rubric, rerun, compare against `expect`.

## Measured on an M2 Max, 32 GB (September 2026)

| Model | Per post | Fixture result |
|---|---|---|
| qwen3.5-9b-mlx 4-bit, 6 GB (MLX engine, template patched) | ~2.5 s (22-intent prompt) | 22/22 headline verdicts: 6 controls Clean with no intents flagged, 16 manipulative posts Heavy with the expected main intent |
| qwen/qwen3.5-9b GGUF, 10.5 GB (llama.cpp engine, reasoning off) | ~3.3 s | 14/14 on the original 16-intent set; not re-run on the 22-intent set |
| gigachat3.1-10b-a1.8b (MoE, 1.8B active) | ~2.4 s | 10/14; flags first-hand and reasoned posts as "unverifiable authority" |
| jev-1.13.0 (hosted, not local: TypeSafe) | ~0.42 s, 7.6k input tokens (~$0.0003) | 24/24 headline verdicts; 7/7 controls Clean with no intent above 60%; main intent inside the expected set on 16 of 17 manipulative posts |

Secondary intents are the noisy part with a 4-bit 9B model: a Heavy post typically lists 3–5 intents at 65% (rating
"clearly present") next to 1–3 at 93%. The badge shows the top five chips; set "Show intent at ≥ 70%" in the popup to
see only the 93% ones. Rubric edits in `taxonomy.js` moved results reliably; rewording the strictness instruction in
the local prompt did not (two attempts made the model noisier and produced false positives on control posts).
Jev spreads the secondaries out instead (98 / 94 / 76 / 61 %…) and leaves the controls completely empty, which is
what a calibrated per-intent probability buys you; the whole fixture run cost 184k input tokens, under a cent.

Per-post time is dominated by generating the ~100-token JSON answer, not by the ~2k-token prompt. The MLX build is
now the faster one and uses 4 GB less memory. Jev inverts the shape: a 7.6k-token request, no text generated at all,
~0.42 s per post.

## How it works

```
content.js (site adapter) --posts--> background.js --> provider.js --> <base url>/chat/completions
        ^                                |                   |          (LM Studio, Ollama, llama.cpp, Cerebras, Groq, OpenAI, ...)
        |                                |                   +-------> jev.js --> api.typesafe.ai/v1/systemone
        +-------- verdicts + render -----+   cache by content hash, queue, capability memo per endpoint
```

- `extension/taxonomy.js`: intents, rubrics, and the verdict logic (`summarize`).
- `extension/provider.js`: the front door (`ask`, `listModels`, presets) and the OpenAI-compatible client. Builds one
  system prompt from the taxonomy and asks for 0–3 ratings per intent. First attempt is a free reply (the model writes
  compact JSON on its own; accepted only if it validates as a rating), second enforces a strict JSON schema. Remembers
  per endpoint which request fields it rejects. Ordinals map to probabilities for `summarize`. A TypeSafe endpoint
  (`api.typesafe.ai`, or any URL ending in `/systemone`) is routed to `jev.js` instead.
- `extension/jev.js`: the System One client. Turns the taxonomy into Jev's `questions` map — each rubric becomes a
  question's `criteria`, the pressure levels become a score's levels — and returns the `answers` map untouched,
  because it is already what `summarize` reads. `extension/errors.js` holds the `ProviderError` both clients throw.
- `extension/background.js`: queue (one request at a time for local servers, four for hosted), verdict cache, per-tab stats. Both live in `chrome.storage.session`, so they survive Chrome suspending the worker and last until the tab closes (stats) or the browser closes (cache).
- `extension/content.js`: site adapters (X, Bluesky, Reddit, HN, Threads, 4chan, 2ch, Mastodon, generic), MutationObserver, shadow-DOM badges, optional image fetch + downscale.
- `extension/history.js`: long-term exposure history (per site, per day; pure functions), `extension/stats.*`: the dashboard page.
- `extension/i18n.js`: UI strings per language (English, Russian).
- `extension/popup.*`, `extension/settings.js`: endpoint, key and model settings (with host-permission request for hosted URLs), test button, intent tally.
- `scripts/qwen-thinking-off.py`: flips a Qwen chat template to thinking-off by default (for LM Studio's MLX engine).

By default only post text (author, text, quoted post, link-card text) is sent to the model endpoint.

### Images (optional)

Turn on **Send post images to the model** in the popup to include a post's pictures, GIF and video thumbnails.
The content script fetches each image from the page, downscales it to 512 px JPEG in the browser, and attaches up
to two per post as `image_url` parts. Needs a vision-capable model (Qwen 3.5 is one). Adds about a second per image.
Measured effect on the 9B MLX model: a bland "look at this" caption is Clean on its own and
Heavy (hidden hand, fear, urgency, engagement) with a "they don't want you to see this, share before it's deleted"
meme attached. Test from the CLI with `--image meme.jpg`. Jev is text only: with that endpoint selected the toggle is
disabled and the content script leaves the images alone.

## Local-model gotchas

- **Thinking models return nothing.** Qwen 3.5 spends the whole token budget reasoning and leaves `content` empty.
  The provider sends `reasoning_effort: "none"` (honoured by LM Studio) and `chat_template_kwargs: {enable_thinking: false}`
  (honoured by llama.cpp / Ollama). LM Studio ignores the template flag for Qwen 3.5 ([bug #1990](https://github.com/lmstudio-ai/lmstudio-bug-tracker/issues/1990)), hence both.
  Hosted APIs that reject these fields get them switched off after the first HTTP 400.
- **MLX engine ignores every thinking-off switch.** The Qwen template opens a `<think>` block unless the engine
  passes `enable_thinking=false`, which LM Studio's MLX engine never does, so the reply is filed as reasoning and
  `content` is empty. Fix it at the source by flipping the template default:

  ```
  python3 scripts/qwen-thinking-off.py ~/.cache/lm-studio/models/lmstudio-community/Qwen3.5-9B-MLX-4bit
  lms unload qwen3.5-9b-mlx && lms load qwen3.5-9b-mlx
  ```

  Backups land next to the originals as `*.orig`; `--restore` puts them back. Without the patch the provider still
  works, because it falls back to parsing `reasoning_content` (accepting only objects that look like a rating).
- **MLX + vision-capable model = spaced JSON, no matter what you ask.** Qwen 3.5 is a vision-language model, and
  LM Studio's MLX engine routes VLMs through mlx-vlm's structured-output path, which compiles the schema with
  llguidance using hard-coded separators `(", ", ": ")` and no flexible whitespace (`mlx_vlm/structured.py`,
  mlx-vlm 0.6.5). The grammar mandates one space after every colon and comma, so the ~135-token reply cannot be
  made compact through prompting. Text-only MLX models go through Outlines (space optional) and GGUF models through
  llama.cpp's grammar (whitespace optional), which is why those honour the compact instruction. This is why the
  provider asks without a schema first: the same model then writes compact JSON in ~2.2 s instead of ~3 s, and the
  schema is only used if the free reply does not validate.
- **"Context size has been exceeded."** LM Studio shares one context window across its parallel slots (4 by default).
  Requests are ~2.2k tokens, so load the model with at least 4096 context; 8192 is comfortable. cogsec sends one request at a time.
- **Structured output.** Servers that reject `response_format: json_schema` get a second request without it; the reply is then parsed for the first JSON object.

## Limits

- A 9B model's rating is a judgement call, not a calibrated probability. Ratings are 0–3 ordinals mapped to 5 / 35 / 65 / 93 %.
  Jev returns calibrated probabilities instead, so the "show intent at ≥" threshold means what it says there.
- Text only. Manipulation carried by an image or video is invisible.
- Replies are judged without their parent post. Sarcasm and in-jokes produce false positives.
- Site DOMs change. If a site stops getting badges, its adapter in `content.js` needs a selector update.

## Ideas

- "Why?" button: send one post to a bigger model for a free-text explanation (System 2 on demand).
- Reply context: send the parent post along with a reply.
- Per-account profile: what does this account do to you over 100 posts?
- Hide instead of dim, per intent ("never show me curiosity-gap threads").

## License

MIT. See `LICENSE`.
