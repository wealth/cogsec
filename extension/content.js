// cogsec content script: finds posts in the feed, ships them to the background worker, renders verdicts inline.
// Classic script (no imports) so it can be auto-injected on known sites and on demand elsewhere.
(() => {
  if (window.__cogsec) { window.__cogsec.rescan(true); return; }

  const HOST = location.hostname.replace(/^www\./, '');
  const MARK = 'cogsecKey';
  const BATCH_MS = 200;
  const BATCH_MAX = 12;


  // ------------------------------------------------------------------ adapters
  const text = (el) => (el?.innerText || '').replace(/\s+\n/g, '\n').trim();
  const handle = (el) => {
    if (!el) return '';
    const spans = [...el.querySelectorAll('span')].map((s) => s.textContent.trim()).filter(Boolean);
    const at = spans.find((s) => s.startsWith('@'));
    const name = spans.find((s) => !s.startsWith('@') && s !== '·');
    return [name, at].filter(Boolean).join(' ');
  };

  /** Imageboards link the full file from the thumbnail. Return [full, thumb] candidate pairs: the full file is
   *  tried first (readable text in memes), the thumbnail is the fallback when the CDN blocks the cross-origin fetch. */
  function chanImages(el, linkSel, thumbSel) {
    const abs = (u) => { try { return new URL(u, location.href).href; } catch { return null; } };
    const thumbs = [...el.querySelectorAll(thumbSel)].map((m) => abs(m.currentSrc || m.getAttribute('src'))).filter(Boolean);
    const links = [...new Set([...el.querySelectorAll(linkSel)].map((a) => abs(a.getAttribute('href'))).filter((u) => u && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u)))];
    if (!links.length) return thumbs;
    return links.map((full, i) => (thumbs[i] && thumbs[i] !== full ? [full, thumbs[i]] : full));
  }

  /** From a reaction button, climb to the row that spans the post's content column (the action bar). */
  function actionBar(el, btn) {
    if (!btn) return null;
    const full = el.getBoundingClientRect().width;
    if (!full) return null;
    let n = btn;
    while (n && n !== el) {
      if (n.getBoundingClientRect().width >= 0.6 * full) return n;
      n = n.parentElement;
    }
    return null;
  }

  const ADAPTERS = [
    {
      name: 'x',
      match: () => /(^|\.)(x|twitter)\.com$/.test(HOST),
      posts: () => document.querySelectorAll('article[data-testid="tweet"]'),
      extract(el) {
        const texts = el.querySelectorAll('[data-testid="tweetText"]');
        const names = el.querySelectorAll('[data-testid="User-Name"]');
        const id = el.querySelector('a[href*="/status/"]')?.getAttribute('href')?.match(/status\/(\d+)/)?.[1];
        const card = el.querySelector('[data-testid="card.wrapper"]');
        const social = el.querySelector('[data-testid="socialContext"]');
        return {
          id,
          author: handle(names[0]),
          text: text(texts[0]),
          quoted: texts[1] ? { author: handle(names[1]), text: text(texts[1]) } : undefined,
          link_card: card ? text(card).slice(0, 400) : undefined,
          has_media: !!el.querySelector('[data-testid="tweetPhoto"], [data-testid="videoPlayer"], video'),
          context: social ? text(social) : undefined,
        };
      },
      place(el) {
        const bar = actionBar(el, el.querySelector('[data-testid="reply"]'));
        if (bar) return { node: bar, where: 'beforebegin' };
        const t = el.querySelector('[data-testid="tweetText"]')?.parentElement;
        return t ? { node: t, where: 'afterend' } : { node: el, where: 'beforeend' };
      },
      images: (el) => [...el.querySelectorAll('[data-testid="tweetPhoto"] img, video[poster]')].map((m) => m.tagName === 'VIDEO' ? m.poster : m.currentSrc || m.src),
    },
    {
      name: 'bluesky',
      match: () => /(^|\.)bsky\.app$/.test(HOST),
      posts: () => document.querySelectorAll('[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]'),
      extract(el) {
        const body = el.querySelector('[data-testid="postText"]');
        const author = el.getAttribute('data-testid')?.replace(/^(feedItem|postThreadItem)-by-/, '');
        const quoted = el.querySelector('[data-testid="contentHider-post"], [aria-label^="Post by"]');
        return { id: undefined, author: author ? `@${author}` : '', text: text(body), quoted: quoted && quoted !== body ? { text: text(quoted).slice(0, 600) } : undefined, has_media: !!el.querySelector('img[alt]:not([alt=""]), video') };
      },
      place(el) {
        const bar = actionBar(el, el.querySelector('[data-testid="replyBtn"]'));
        if (bar) return { node: bar, where: 'beforebegin' };
        const t = el.querySelector('[data-testid="postText"]')?.parentElement;
        return t ? { node: t, where: 'afterend' } : { node: el, where: 'beforeend' };
      },
      images: (el) => [...el.querySelectorAll('img[src*="cdn.bsky.app/img/feed"], video[poster]')].map((m) => m.tagName === 'VIDEO' ? m.poster : m.src),
    },
    {
      name: 'reddit',
      match: () => /(^|\.)reddit\.com$/.test(HOST),
      posts: () => document.querySelectorAll('shreddit-post, shreddit-comment'),
      extract(el) {
        if (el.tagName === 'SHREDDIT-POST') {
          const body = el.querySelector('[slot="text-body"]');
          return { id: el.getAttribute('id') || el.getAttribute('permalink'), author: `u/${el.getAttribute('author') || ''}`, subreddit: el.getAttribute('subreddit-prefixed-name'), title: el.getAttribute('post-title'), text: text(body), has_media: /image|video|gallery/.test(el.getAttribute('post-type') || '') };
        }
        return { id: el.getAttribute('thingid'), author: `u/${el.getAttribute('author') || ''}`, text: text(el.querySelector('[slot="comment"]')) };
      },
      place(el) {
        const n = el.tagName === 'SHREDDIT-POST'
          ? (el.querySelector('[slot="text-body"]') || el.querySelector('[slot="post-media-container"]') || el.querySelector('[slot="title"]'))
          : el.querySelector('[slot="comment"]');
        return n ? { node: n, where: 'afterend' } : { node: el, where: 'beforeend' };
      },
      images: (el) => [...el.querySelectorAll('img[src*="redd.it"], img[src*="redditmedia"]')].map((m) => m.src),
    },
    {
      name: 'hn',
      match: () => HOST === 'news.ycombinator.com',
      posts: () => document.querySelectorAll('tr.athing'),
      extract(el) {
        const title = el.querySelector('.titleline a');
        const comment = el.querySelector('.commtext');
        const user = el.querySelector('.hnuser');
        return { id: el.id, author: user ? user.textContent : '', title: title ? title.textContent : undefined, url: title?.href, text: text(comment) };
      },
      mount: (el) => el.querySelector('.commtext') || el.querySelector('.titleline') || el,
      inline: true,
    },
    {
      name: 'threads',
      match: () => /(^|\.)threads\.(net|com)$/.test(HOST),
      posts: () => document.querySelectorAll('[data-pressable-container="true"]'),
      extract(el) {
        const author = el.querySelector('a[href^="/@"]');
        const spans = [...el.querySelectorAll('span[dir="auto"]')].map(text).filter((s) => s.length > 20);
        return { id: el.querySelector('a[href*="/post/"]')?.getAttribute('href'), author: author ? author.textContent : '', text: spans.join('\n').slice(0, 2000), has_media: !!el.querySelector('img[alt]:not([alt=""]), video') };
      },
      place(el) {
        const bar = actionBar(el, el.querySelector('[aria-label="Like"], [aria-label="Comment"]'));
        return bar ? { node: bar, where: 'beforebegin' } : { node: el, where: 'beforeend' };
      },
      images: (el) => [...el.querySelectorAll('img[src*="cdninstagram"], video[poster]')].map((m) => m.tagName === 'VIDEO' ? m.poster : m.src),
    },
    {
      name: '4chan',
      match: () => /(^|\.)4chan(nel)?\.org$/.test(HOST),
      posts: () => /\/catalog$/.test(location.pathname) ? document.querySelectorAll('div.thread') : document.querySelectorAll('div.post.op, div.post.reply'),
      extract(el) {
        if (el.classList.contains('thread')) { // catalog card
          return { id: el.id, author: 'Anonymous', title: text(el.querySelector('.teaser b')), text: text(el.querySelector('.teaser')), has_media: !!el.querySelector('img.thumb') };
        }
        const subject = el.querySelector('.subject');
        const name = el.querySelector('.name');
        return { id: el.id, author: [text(name), text(el.querySelector('.postertrip'))].filter(Boolean).join(' ') || 'Anonymous', title: text(subject), text: text(el.querySelector('blockquote.postMessage')), has_media: !!el.querySelector('.file') };
      },
      place(el) {
        const n = el.querySelector('blockquote.postMessage') || el.querySelector('.teaser');
        return n ? { node: n, where: 'afterend' } : { node: el, where: 'beforeend' };
      },
      images: (el) => chanImages(el, 'a.fileThumb', 'a.fileThumb img, img.thumb'),
    },
    {
      name: '2ch',
      match: () => /(^|\.)2ch\.(hk|org|life|pm|su|so)$/.test(HOST) || !!document.querySelector('.post__message, .post-message'),
      posts: () => document.querySelectorAll('div.post[id^="post-"], .post-wrapper'),
      extract(el) {
        return { id: el.id || el.dataset.num, author: text(el.querySelector('.post__anon, .ananimas')) || 'Аноним', title: text(el.querySelector('.post__title, .post-title')), text: text(el.querySelector('.post__message, .post-message')), has_media: !!el.querySelector('.post__images, .post-images, figure.image') };
      },
      place(el) {
        const n = el.querySelector('.post__message, .post-message');
        return n ? { node: n, where: 'afterend' } : { node: el, where: 'beforeend' };
      },
      images: (el) => chanImages(el, '.post__images a[href], .post-images a[href], figure.image a[href]', '.post__images img, .post-images img, figure.image img'),
    },
    {
      name: 'mastodon',
      match: () => !!document.querySelector('.status__content'),
      posts: () => document.querySelectorAll('article.status, div.status'),
      extract(el) {
        return { id: el.querySelector('a.status__relative-time')?.getAttribute('href'), author: text(el.querySelector('.display-name')).replace(/\n/g, ' '), text: text(el.querySelector('.status__content')), has_media: !!el.querySelector('.media-gallery, video') };
      },
      place(el) {
        const bar = el.querySelector('.status__action-bar');
        if (bar) return { node: bar, where: 'beforebegin' };
        const c = el.querySelector('.status__content');
        return c ? { node: c, where: 'afterend' } : { node: el, where: 'beforeend' };
      },
      images: (el) => [...el.querySelectorAll('.media-gallery img, video[poster]')].map((m) => m.tagName === 'VIDEO' ? m.poster : m.src),
    },
    {
      name: 'generic',
      match: () => true,
      posts() {
        const cands = [...document.querySelectorAll('article, [role="article"], li, section, div')]
          .filter((el) => { const n = (el.innerText || '').length; return n >= 80 && n <= 4000; });
        const set = new Set(cands);
        return cands.filter((el) => ![...el.querySelectorAll('article, [role="article"], li, section, div')].some((c) => set.has(c))).slice(0, 200);
      },
      extract: (el) => ({ id: undefined, author: '', text: text(el).slice(0, 3000) }),
      mount: (el) => el,
      images: (el) => [...el.querySelectorAll('img')].filter((m) => m.naturalWidth >= 200 && m.naturalHeight >= 120).map((m) => m.currentSrc || m.src),
    },
  ];

  const adapter = ADAPTERS.find((a) => { try { return a.match(); } catch { return false; } });

  // ------------------------------------------------------------------ image option
  const imgCfg = { sendImages: false, maxImages: 2, imageMaxSide: 512, lang: 'en' };
  chrome.storage.local.get(imgCfg).then((v) => Object.assign(imgCfg, v)).catch(() => {});
  chrome.storage.onChanged.addListener((ch) => {
    for (const k of Object.keys(imgCfg)) if (ch[k]) imgCfg[k] = ch[k].newValue;
    if (ch.lang) window.__cogsec?.rescan(true); // re-render badges in the new language
  });

  // ------------------------------------------------------------------ localisation
  const I18N = globalThis.COGSEC_I18N || { en: {} };
  const T = () => I18N[imgCfg.lang] || I18N.en;
  const fmt = (s, vars) => String(s || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  const intentText = (i) => (T().intents && T().intents[i.key]) || { label: i.label, hint: i.hint };
  const levelText = (n) => (T().levels || I18N.en.levels)[n] || LEVEL_FALLBACK[n];
  const LEVEL_FALLBACK = ['Clean', 'Mild', 'Manipulative', 'Heavy'];

  const imageCache = new Map(); // url -> Promise<dataUrl|null>
  /** An image entry may be a URL or an array of candidate URLs tried in order. */
  async function loadImage(entry) {
    if (Array.isArray(entry)) { for (const u of entry) { const r = await loadOne(u); if (r) return r; } return null; }
    return loadOne(entry);
  }
  /** Fetch an image (CORS), downscale to imageMaxSide, return a JPEG data: URL. null if unavailable. */
  function loadOne(url) {
    if (!url || url.startsWith('data:')) return Promise.resolve(url || null);
    if (imageCache.has(url)) return imageCache.get(url);
    const p = (async () => {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit', signal: ctrl.signal });
        if (!res.ok) return null;
        const bmp = await createImageBitmap(await res.blob());
        const scale = Math.min(1, imgCfg.imageMaxSide / Math.max(bmp.width, bmp.height));
        const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
        const canvas = new OffscreenCanvas(w, h); canvas.getContext('2d').drawImage(bmp, 0, 0, w, h); bmp.close?.();
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
        return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => r(null); fr.readAsDataURL(blob); });
      } catch { return null; } finally { clearTimeout(t); }
    })();
    imageCache.set(url, p);
    if (imageCache.size > 300) imageCache.delete(imageCache.keys().next().value);
    return p;
  }

  // ------------------------------------------------------------------ scanning
  const pending = new Map(); // key -> { el, state }
  let flushTimer = null;
  let noticeShown = false;

  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

  function scan() {
    let posts;
    try { posts = adapter.posts(); } catch { return; }
    for (const el of posts) {
      let data;
      try { data = adapter.extract(el); } catch { continue; }
      const body = [data.title, data.text, data.quoted?.text].filter(Boolean).join('\n');
      let imageUrls = [];
      if (imgCfg.sendImages && adapter.images) {
        try { const seen = new Set(); imageUrls = adapter.images(el).filter((u) => u && !seen.has(String(u)) && seen.add(String(u))).slice(0, imgCfg.maxImages); } catch { imageUrls = []; }
      }
      if (body.length < 12 && !imageUrls.length) continue;
      const key = `${HOST}:${data.id || ''}:${hash(body + (imageUrls.length ? '|img:' + imageUrls.map(String).join(',') : ''))}`;
      if (el.dataset[MARK] === key) continue;
      el.dataset[MARK] = key;
      el.querySelectorAll('.cogsec-badge').forEach((b) => b.remove()); // stale badge from a reused (virtualized) node
      const state = { platform: adapter.name, post: compact({ author: data.author, title: data.title, text: data.text, quoted: data.quoted, link_card: data.link_card, has_media: data.has_media, context: data.context, subreddit: data.subreddit }) };
      pending.set(key, { el, state, imageUrls });
    }
    if (pending.size && !flushTimer) flushTimer = setTimeout(flush, BATCH_MS);
  }

  function compact(o) { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === '' || o[k] === false) delete o[k]; return o; }

  async function flush() {
    flushTimer = null;
    const items = [...pending.entries()].slice(0, BATCH_MAX);
    for (const [k] of items) pending.delete(k);
    if (pending.size) flushTimer = setTimeout(flush, BATCH_MS);
    const posts = await Promise.all(items.map(async ([key, v]) => {
      const images = (await Promise.all((v.imageUrls || []).map(loadImage))).filter(Boolean);
      if (v.imageUrls?.length) v.state.post.images_attached = images.length;
      return { key, state: v.state, images };
    }));
    let res;
    try { res = await chrome.runtime.sendMessage({ type: 'analyze', host: HOST, posts }); } catch (e) { res = { error: String(e) }; }
    if (!res) { notice((T().badge || I18N.en.badge).noWorker); return; }
    if (res.paused) return;
    if (res.error) { notice(`cogsec: ${res.error}`); return; }
    const byKey = new Map(items);
    for (const r of res.results || []) {
      const item = byKey.get(r.key);
      if (!item || !item.el.isConnected || item.el.dataset[MARK] !== r.key) continue;
      if (r.error) { notice(`cogsec: ${r.error}`); continue; }
      render(item.el, r.key, r.verdict, res.dimHeavy, r.model);
    }
  }

  // ------------------------------------------------------------------ rendering
  const CSS = `
    :host { all: initial; display: block; font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; margin: 6px 0 4px; }
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--b); background: var(--bg); cursor: pointer; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex: none; }
    .lvl { font-weight: 600; color: var(--c); }
    .chip { padding: 1px 6px; border-radius: 999px; background: rgba(0,0,0,.06); white-space: nowrap; }
    .chip b { font-weight: 600; }
    .chip i { font-style: normal; opacity: .6; margin-left: 3px; }
    .meta { margin-left: auto; opacity: .65; white-space: nowrap; }
    .details { display: none; margin-top: 4px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--b); background: var(--bg); }
    .details.open { display: block; }
    .grp { margin: 4px 0 2px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; opacity: .55; }
    .row { display: grid; grid-template-columns: 130px 1fr 40px; gap: 8px; align-items: center; padding: 2px 0; }
    .row .name { font-weight: 600; }
    .row .hint { opacity: .75; }
    .row .p { text-align: right; font-variant-numeric: tabular-nums; }
    .row.dim { opacity: .4; }
    .foot { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--b); opacity: .7; display: flex; gap: 12px; flex-wrap: wrap; }
    @media (prefers-color-scheme: dark) { :host { color: #eee; } .chip { background: rgba(255,255,255,.1); } }
  `;
  // Status palette (good / warning / serious / critical), validated for CVD separation; always paired with a label.
  const THEMES = [
    { c: '#0ca30c', bg: 'rgba(12,163,12,.08)', b: 'rgba(12,163,12,.35)' },
    { c: '#b7810f', bg: 'rgba(250,178,25,.12)', b: 'rgba(250,178,25,.55)' },   // text uses a darker step of warning for contrast
    { c: '#c4552e', bg: 'rgba(236,131,90,.12)', b: 'rgba(236,131,90,.55)' },   // darker step of serious
    { c: '#d03b3b', bg: 'rgba(208,59,59,.10)', b: 'rgba(208,59,59,.5)' },
  ];
  const pct = (p) => `${Math.round(p * 100)}%`;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  function render(el, key, v, dimHeavy, model) {
    let target = null;
    try { target = adapter.place ? adapter.place(el) : null; } catch { target = null; }
    if (!target) {
      let m; try { m = (adapter.mount && adapter.mount(el)) || el; } catch { m = el; }
      target = { node: m, where: adapter.inline ? 'beforeend' : (m === el ? 'beforeend' : 'afterend') };
    }
    const host = document.createElement(adapter.inline ? 'span' : 'div');
    host.className = 'cogsec-badge';
    host.dataset.for = key;
    if (adapter.inline) host.style.display = 'inline-block';
    const root = host.attachShadow({ mode: 'open' });
    const t = THEMES[v.level];
    const S = T(), B = S.badge || I18N.en.badge;
    const MAX_CHIPS = 5;
    const chips = v.intents.slice(0, MAX_CHIPS).map((i) => `<span class="chip"><b>${esc(intentText(i).label)}</b><i>${pct(i.p)}</i></span>`).join('')
      + (v.intents.length > MAX_CHIPS ? `<span class="chip">${esc(fmt(B.more, { n: v.intents.length - MAX_CHIPS }))}</span>` : '');
    const groups = ['feel', 'believe', 'do'].map((g) => {
      const rows = v.all.filter((i) => i.group === g).sort((a, b) => b.p - a.p)
        .map((i) => { const t = intentText(i); return `<div class="row ${i.p < 0.35 ? 'dim' : ''}"><span class="name">${esc(t.label)}</span><span class="hint">${esc(t.hint)}</span><span class="p">${pct(i.p)}</span></div>`; }).join('');
      return `<div class="grp">${esc((S.groups || I18N.en.groups)[g])}</div>${rows}`;
    }).join('');
    const primaryIntent = v.primary.key !== 'none' ? v.all.find((i) => i.key === v.primary.key) : null;
    const primaryLabel = primaryIntent ? intentText(primaryIntent).label : (S.none || I18N.en.none);
    const primaryHint = primaryIntent ? intentText(primaryIntent).hint : '';
    root.innerHTML = `
      <style>${CSS}</style>
      <div style="--c:${t.c};--bg:${t.bg};--b:${t.b}">
        <div class="bar" title="${esc(B.title)}">
          <span class="dot"></span>
          <span class="lvl">${esc(levelText(v.level))}</span>
          ${primaryIntent ? `<span>· ${esc(primaryLabel)}</span>` : ''}
          ${chips}
          <span class="meta">${esc(B.reflex)} ${v.pressure.toFixed(1)}/4 · ${esc(B.evidence)} ${pct(v.evidence)}</span>
        </div>
        <div class="details">
          <div><b>${esc(B.main)}:</b> ${esc(primaryLabel)}${primaryHint ? ` — ${esc(primaryHint)}` : ''} <span style="opacity:.6">(${pct(v.primaryConfidence)} ${esc(B.confident)})</span></div>
          ${groups}
          <div class="foot"><span>${esc(B.pressure)}: <b>${v.pressure.toFixed(1)}</b> / 4</span><span>${esc(B.checkable)}: <b>${pct(v.evidence)}</b></span><span>${esc(B.model)}: ${esc(model || 'unknown')}</span></div>
        </div>
      </div>`;
    root.querySelector('.bar').addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); root.querySelector('.details').classList.toggle('open'); });
    if (adapter.inline) target.node.appendChild(host); else target.node.insertAdjacentElement(target.where, host);
    if (dimHeavy && v.level >= 3) { el.style.opacity = '0.35'; el.addEventListener('mouseenter', () => (el.style.opacity = '1'), { once: false }); el.addEventListener('mouseleave', () => (el.style.opacity = '0.35')); }
  }

  function notice(msg) {
    if (noticeShown) return;
    noticeShown = true;
    const n = document.createElement('div');
    n.textContent = msg;
    Object.assign(n.style, { position: 'fixed', top: '12px', right: '12px', zIndex: 2147483647, background: '#111', color: '#fff', padding: '8px 12px', borderRadius: '8px', font: '12px -apple-system, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,.3)' });
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 8000);
  }

  // ------------------------------------------------------------------ lifecycle
  let scanTimer = null;
  const schedule = () => { if (!scanTimer) scanTimer = setTimeout(() => { scanTimer = null; scan(); }, 150); };
  const observer = new MutationObserver((muts) => { for (const m of muts) if (m.addedNodes.length) { schedule(); return; } });
  observer.observe(document.body, { childList: true, subtree: true });
  setInterval(scan, 2000); // catches virtualized-list content swaps that reuse nodes
  scan();

  window.__cogsec = {
    adapter: adapter.name,
    rescan(force) { if (force) for (const el of document.querySelectorAll(`[data-cogsec-key]`)) delete el.dataset[MARK]; document.querySelectorAll('.cogsec-badge').forEach((b) => b.remove()); scan(); },
  };
})();
