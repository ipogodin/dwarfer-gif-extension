// Matches URL formats still used in direct links:
//   1. https://dwarfer.link/g/...
//   2. dwarfer.link/g/... (real dot or U+2024 ONE DOT LEADER lookalike)
const DWARFER_URL_REGEX = /https?:\/\/dwarfer[.\u2024]link\/g\/([a-zA-Z0-9]+)|dwarfer[.\u2024]link\/g\/([a-zA-Z0-9]+)/g;

let renderEnabled = true;

// Track elements where a GIF was *successfully embedded* (not just visited).
const embedded = new WeakSet();
// Track elements currently being processed to prevent concurrent duplicate runs.
const inFlight = new WeakSet();

// Track in-flight requests to avoid duplicate fetches for the same code.
const pending = new Map();

// Stores hidden wrapper references for each embed so they can be restored on disable.
const embedMeta = new Map();

/**
 * Ask the service worker to resolve a /g/ code.
 * Returns a Promise<gifData>.
 */
function resolveGif(code) {
  if (pending.has(code)) return pending.get(code);

  const promise = new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'RESOLVE_GIF', code }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.ok) {
        resolve(response.data);
      } else {
        reject(new Error(response?.error || 'Unknown error'));
      }
    });
  }).finally(() => pending.delete(code));

  pending.set(code, promise);
  return promise;
}

/**
 * Build the inline GIF embed element.
 */
function buildEmbed(gifData) {
  const wrap = document.createElement('div');
  wrap.className = 'dwarfer-gif-embed';
  wrap.dataset.dwarferCode = gifData.code || '';

  const img = document.createElement('img');
  img.src = gifData.giphyUrl;
  img.alt = gifData.giphyTitle || 'GIF';
  img.loading = 'lazy';
  img.className = 'dwarfer-gif-img';

  const badge = document.createElement('span');
  badge.className = 'dwarfer-gif-badge';
  badge.textContent = 'GIF via dwarfer';

  wrap.appendChild(img);
  wrap.appendChild(badge);
  return wrap;
}

/**
 * Handle the two-hashtag format: #dwarfer0link #gifcode
 *
 * YouTube wraps each hashtag <a> inside a <span>:
 *   <span><a href="/hashtag/dwarfer0link">#dwarfer0link</a></span>
 *   <span><a href="/hashtag/gifcode">#gifcode</a></span>
 *
 * Returns true if at least one GIF was embedded.
 */
async function processHashtagPairFormat(el) {
  const anchors = Array.from(el.querySelectorAll('a[href="/hashtag/dwarfer0link"]'));
  const codes = [];
  const codeToWrappers = new Map();

  for (const anchor of anchors) {
    const wrapper = anchor.parentElement;
    if (!wrapper) continue;

    // Walk forward through siblings of the wrapper, skipping whitespace text nodes
    let next = wrapper.nextSibling;
    while (next && next.nodeType === Node.TEXT_NODE && next.textContent.trim() === '') {
      next = next.nextSibling;
    }
    if (!next || next.nodeType !== Node.ELEMENT_NODE) continue;

    const codeAnchor = next.nodeName === 'A' ? next : next.querySelector('a');
    if (!codeAnchor) continue;

    const rawCode = codeAnchor.textContent.trim().replace(/^#/, '');
    if (!rawCode) continue;

    // Skip if an embed for this code is already in the DOM
    if (el.querySelector(`.dwarfer-gif-embed[data-dwarfer-code="${rawCode}"]`)) continue;

    if (!codes.includes(rawCode)) {
      codes.push(rawCode);
      codeToWrappers.set(rawCode, { dwarferWrapper: wrapper, codeWrapper: next });
    }
  }

  if (codes.length === 0) return false;

  const results = await Promise.allSettled(codes.map((c) => resolveGif(c)));
  let didEmbed = false;

  codes.forEach((code, i) => {
    if (results[i].status !== 'fulfilled') return;
    const { dwarferWrapper, codeWrapper } = codeToWrappers.get(code);
    const embed = buildEmbed(results[i].value);
    dwarferWrapper.style.display = 'none';
    codeWrapper.style.display = 'none';
    codeWrapper.insertAdjacentElement('afterend', embed);
    embedMeta.set(embed, { dwarferWrapper, codeWrapper });
    didEmbed = true;
  });

  return didEmbed;
}

/**
 * Handle URL format: dwarfer.link/g/{code} via innerHTML regex replacement.
 */
async function processUrlFormat(el) {
  const htmlText = el.innerHTML;
  const codes = [];
  let match;
  const rx = new RegExp(DWARFER_URL_REGEX.source, 'g');
  while ((match = rx.exec(htmlText)) !== null) {
    const code = match[1] || match[2];
    if (code && !codes.includes(code)) codes.push(code);
  }
  if (codes.length === 0) return false;

  const results = await Promise.allSettled(codes.map((c) => resolveGif(c)));
  const gifMap = {};
  codes.forEach((code, i) => {
    if (results[i].status === 'fulfilled') gifMap[code] = results[i].value;
  });
  if (Object.keys(gifMap).length === 0) return false;

  const template = document.createElement('template');
  template.innerHTML = el.innerHTML.replace(
    new RegExp(DWARFER_URL_REGEX.source, 'g'),
    (fullUrl, code1, code2) => {
      const code = code1 || code2;
      if (!gifMap[code]) return fullUrl;
      return buildEmbed(gifMap[code]).outerHTML;
    }
  );
  el.innerHTML = template.innerHTML;
  return true;
}

/**
 * Scan a single DOM node for dwarfer GIF references and render them.
 * Only marks the element as done when a GIF is actually embedded — so if
 * YouTube hasn't rendered the hashtag <a> links yet, the element stays
 * eligible for re-processing on the next mutation.
 */
async function processNode(el) {
  if (!renderEnabled) return;
  if (inFlight.has(el)) return; // already processing — prevent concurrent duplicate runs
  if (embedded.has(el)) {
    // YouTube may re-render comment content after an edit, removing our
    // injected embed. If the embed is gone, re-process the element.
    if (el.querySelector('.dwarfer-gif-embed')) return;
    embedded.delete(el);
  }
  inFlight.add(el);

  if (!el || !el.textContent) return;

  const hasUrlFormat = el.innerHTML.includes('dwarfer.link/g/') || el.innerHTML.includes('dwarfer\u2024link/g/');
  const hasHashtagPair = el.textContent.includes('#dwarfer0link');

  if (!hasUrlFormat && !hasHashtagPair) return;

  try {
    let didEmbed = false;
    if (hasUrlFormat) didEmbed = (await processUrlFormat(el)) || didEmbed;
    if (hasHashtagPair) didEmbed = (await processHashtagPairFormat(el)) || didEmbed;
    if (didEmbed) embedded.add(el);
  } finally {
    inFlight.delete(el);
  }
}

/**
 * Find the nearest yt-attributed-string or #content-text ancestor of a node.
 */
function findCommentTextAncestor(node) {
  let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (el) {
    if (el.tagName?.toLowerCase() === 'yt-attributed-string' || el.id === 'content-text') {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Walk comment text containers and process any that contain dwarfer references.
 */
function scanComments(root = document) {
  const candidates = root.querySelectorAll(
    'ytd-comment-renderer #content-text, yt-attributed-string'
  );
  candidates.forEach((el) => {
    if (el.textContent.includes('#dwarfer0link')) processNode(el);
  });
}

// Initial scan after page settles.
scanComments();

// Periodic fallback: catches cases where YouTube toggles visibility or
// re-renders via custom element internals without triggering childList mutations.
let scanIntervalId = setInterval(scanComments, 2000);

// Watch for new comments and for YouTube updating existing comment content.
const observer = new MutationObserver((mutations) => {
  // Collect unique yt-attributed-string elements to (re-)process.
  const toProcess = new Set();

  for (const mutation of mutations) {
    // childList: new comment nodes or updated inner content
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (!node.textContent?.includes('#dwarfer0link')) continue;

      // Case 1: a whole new comment renderer was added — scan inside it.
      node.querySelectorAll('yt-attributed-string')
        .forEach(el => toProcess.add(el));
      if (node.tagName?.toLowerCase() === 'yt-attributed-string') toProcess.add(node);

      // Case 2: YouTube updated the inner content of an existing comment.
      // The added node is a child span — walk up to find the comment text el.
      const ancestor = findCommentTextAncestor(node);
      if (ancestor) toProcess.add(ancestor);
    }

    // attributes: YouTube may just un-hide the comment view after saving an edit.
    if (mutation.type === 'attributes') {
      const el = mutation.target;
      if (el.nodeType === Node.ELEMENT_NODE && el.textContent?.includes('#dwarfer0link')) {
        const ancestor = findCommentTextAncestor(el) ||
          el.querySelector('yt-attributed-string');
        if (ancestor) toProcess.add(ancestor);
      }
    }
  }

  toProcess.forEach(el => {
    if (el.textContent?.includes('#dwarfer0link')) processNode(el);
  });
});

// Start observing once the comments section exists; retry if not yet rendered.
function attachObserver() {
  const commentsSection = document.querySelector('#comments');
  if (commentsSection) {
    observer.observe(commentsSection, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'style', 'class'],
    });
  } else {
    setTimeout(attachObserver, 1000);
  }
}

attachObserver();

// ============================================================
// GIF PICKER — inject a GIF button into YouTube's comment box
// ============================================================

let pickerPanel = null;
let pickerVisible = false;

function sendMessage(type, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...data }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (response?.ok) resolve(response.data);
      else reject(new Error(response?.error || 'Unknown error'));
    });
  });
}

function insertIntoCommentBox(text) {
  const editor = document.querySelector('ytd-commentbox #contenteditable-root');
  if (!editor) return;

  editor.focus();

  const sel = window.getSelection();
  // Place cursor at end if the selection is outside the editor
  if (!sel.rangeCount || !editor.contains(sel.anchorNode)) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // execCommand is deprecated but still the most reliable path for contenteditable
  if (!document.execCommand('insertText', false, text)) {
    // Fallback: manual DOM insertion + InputEvent so YouTube picks up the change
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true, composed: true, data: text, inputType: 'insertText',
    }));
  }
}

function renderGifGrid(items) {
  const grid = pickerPanel.querySelector('.dwarfer-gif-grid');
  grid.innerHTML = '';
  if (!items || items.length === 0) {
    grid.innerHTML = '<p class="dwarfer-gif-empty">No GIFs found</p>';
    return;
  }
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'dwarfer-gif-item';
    const img = document.createElement('img');
    img.src = item.previewUrl || item.mediaUrl;
    img.alt = item.title || 'GIF';
    img.loading = 'lazy';
    el.appendChild(img);
    el.addEventListener('click', () => onGifSelected(item));
    grid.appendChild(el);
  });
}

async function onGifSelected(gifItem) {
  hidePicker();
  try {
    let result;
    try {
      result = await sendMessage('CREATE_GIF_LINK', { giphyId: gifItem.id });
    } catch (err) {
      if (err.message !== 'NOT_LOGGED_IN') throw err;
      // Not logged in — open login tab, wait, then retry once
      await sendMessage('LOGIN');
      result = await sendMessage('CREATE_GIF_LINK', { giphyId: gifItem.id });
    }
    insertIntoCommentBox(` #dwarfer0link #${result.code} `);
  } catch (err) {
    if (err.message === 'NOT_LOGGED_IN') {
      showLoginPrompt();
    }
  }
}

async function loadTrending() {
  const grid = pickerPanel.querySelector('.dwarfer-gif-grid');
  grid.innerHTML = '<p class="dwarfer-gif-empty">Loading…</p>';
  try {
    const items = await sendMessage('TRENDING_GIFS');
    renderGifGrid(items);
  } catch {
    grid.innerHTML = '<p class="dwarfer-gif-empty">Failed to load GIFs</p>';
  }
}

async function searchGifs(query) {
  const grid = pickerPanel.querySelector('.dwarfer-gif-grid');
  grid.innerHTML = '<p class="dwarfer-gif-empty">Searching…</p>';
  try {
    const items = await sendMessage('SEARCH_GIFS', { query });
    renderGifGrid(items);
  } catch {
    grid.innerHTML = '<p class="dwarfer-gif-empty">Search failed</p>';
  }
}

function createPickerPanel() {
  const panel = document.createElement('div');
  panel.className = 'dwarfer-gif-panel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <div class="dwarfer-gif-panel-header">
      <input class="dwarfer-gif-search" type="text" placeholder="Search GIFs on Giphy…">
      <button class="dwarfer-gif-close" title="Close">✕</button>
    </div>
    <div class="dwarfer-gif-grid"></div>
    <div class="dwarfer-gif-powered">Powered by Giphy · via dwarfer.link</div>
  `;
  panel.querySelector('.dwarfer-gif-close').addEventListener('click', hidePicker);

  let searchTimeout;
  panel.querySelector('.dwarfer-gif-search').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const q = e.target.value.trim();
    if (q.length === 0) {
      searchTimeout = setTimeout(loadTrending, 300);
    } else if (q.length >= 2) {
      searchTimeout = setTimeout(() => searchGifs(q), 400);
    }
  });

  // Prevent clicks inside the panel from bubbling to YouTube and closing the comment box
  panel.addEventListener('click', (e) => e.stopPropagation());

  return panel;
}

function showPicker(btn) {
  if (!pickerPanel) pickerPanel = createPickerPanel();

  // Insert panel after the comment box
  const commentBox = document.querySelector('ytd-commentbox');
  if (!commentBox) return;

  if (!pickerPanel.isConnected) {
    commentBox.parentElement.insertBefore(pickerPanel, commentBox.nextSibling);
  }

  pickerPanel.style.display = 'flex';
  pickerVisible = true;

  // Reset search and load trending
  pickerPanel.querySelector('.dwarfer-gif-search').value = '';
  loadTrending();
}

function hidePicker() {
  if (pickerPanel) pickerPanel.style.display = 'none';
  pickerVisible = false;
}

function showLoginPrompt() {
  const existing = document.querySelector('.dwarfer-signin-card');
  if (existing) { existing.remove(); return; }

  const card = document.createElement('div');
  card.className = 'dwarfer-signin-card';
  card.innerHTML = `
    <button class="dwarfer-signin-close" title="Close">✕</button>
    <div class="dwarfer-signin-logo">🦌 Dwarfer GIF</div>
    <p class="dwarfer-signin-text">Sign in to share GIFs in YouTube comments</p>
    <button class="dwarfer-signin-google-btn">
      <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
        <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
        <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
        <path d="M3.964 10.707A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
        <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
      </svg>
      Sign in with Google
    </button>
  `;

  card.querySelector('.dwarfer-signin-close').addEventListener('click', () => card.remove());

  card.querySelector('.dwarfer-signin-google-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Opening sign-in…';
    try {
      await sendMessage('LOGIN');
      card.remove();
      // User is now signed in — they can click a GIF and it will work
    } catch {
      btn.disabled = false;
      btn.innerHTML = 'Try again';
    }
  });

  const commentBox = document.querySelector('ytd-commentbox');
  if (commentBox) commentBox.parentElement.insertBefore(card, commentBox.nextSibling);
}

function injectGifButton() {
  if (!renderEnabled) return;
  if (document.querySelector('ytd-commentbox .dwarfer-gif-btn')) return;
  const emojiBtn = document.querySelector('ytd-commentbox #emoji-button');
  if (!emojiBtn) return;

  const btn = document.createElement('button');
  btn.className = 'dwarfer-gif-btn';
  btn.title = 'Insert GIF via dwarfer';
  btn.textContent = 'GIF';
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (pickerVisible) { hidePicker(); return; }
    try {
      await sendMessage('CHECK_AUTH');
      showPicker(btn);
    } catch {
      // Not logged in — open login tab, wait, then open picker if auth now passes
      try {
        await sendMessage('LOGIN');
        await sendMessage('CHECK_AUTH');
        showPicker(btn);
      } catch {
        showLoginPrompt();
      }
    }
  });

  // Insert right after the emoji button so GIF sits beside it on the left toolbar.
  emojiBtn.insertAdjacentElement('afterend', btn);
}

const commentBoxObserver = new MutationObserver(() => {
  injectGifButton();
});

commentBoxObserver.observe(document.body, { childList: true, subtree: true });

injectGifButton();

// ── GIF rendering toggle ──────────────────────────────────────────────────

function disableRendering() {
  clearInterval(scanIntervalId);
  scanIntervalId = null;
  observer.disconnect();
  commentBoxObserver.disconnect();

  document.querySelectorAll('.dwarfer-gif-embed').forEach(embed => {
    const meta = embedMeta.get(embed);
    if (meta) {
      meta.dwarferWrapper.style.display = '';
      meta.codeWrapper.style.display = '';
      embedMeta.delete(embed);
    }
    embed.remove();
  });

  const gifBtn = document.querySelector('ytd-commentbox .dwarfer-gif-btn');
  if (gifBtn) gifBtn.remove();
  hidePicker();
}

function enableRendering() {
  if (!scanIntervalId) scanIntervalId = setInterval(scanComments, 2000);
  attachObserver();
  commentBoxObserver.observe(document.body, { childList: true, subtree: true });
  injectGifButton();
  scanComments();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('gifRenderEnabled' in changes)) return;
  renderEnabled = changes.gifRenderEnabled.newValue ?? true;
  if (renderEnabled) enableRendering(); else disableRendering();
});

chrome.storage.local.get('gifRenderEnabled', ({ gifRenderEnabled }) => {
  if (gifRenderEnabled === false) {
    renderEnabled = false;
    disableRendering();
  }
});
