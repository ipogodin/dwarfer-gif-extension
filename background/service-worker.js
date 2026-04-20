const API_BASE = 'https://dwarfer.link';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const EXT_TOKEN_KEY = 'ext-token';

// Keep the service worker alive with a periodic alarm.
chrome.alarms.create('keepalive', { periodInMinutes: 4 });
chrome.alarms.onAlarm.addListener(() => {});

/**
 * Resolve a /g/ short code to GIF data.
 */
async function resolveGifCode(code) {
  const cacheKey = `gif:${code}`;
  const stored = await chrome.storage.local.get(cacheKey);
  const entry = stored[cacheKey];
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data;

  const res = await fetch(`${API_BASE}/api/rest/v1/gif/${code}`);
  if (!res.ok) throw new Error(`Failed to resolve GIF code "${code}": ${res.status}`);
  const data = await res.json();
  await chrome.storage.local.set({ [cacheKey]: { data, ts: Date.now() } });
  return data;
}

export function toYouTubeSafeLink(shortUrl) {
  return shortUrl.replace('dwarfer.link', 'dwarfer\u2024link');
}

/**
 * Fetch a short-lived HMAC token from the backend using the session cookie (GET).
 * Cached in chrome.storage with 1-minute buffer before expiry.
 */
async function fetchExtToken() {
  const stored = await chrome.storage.local.get(EXT_TOKEN_KEY);
  const cached = stored[EXT_TOKEN_KEY];
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const res = await fetch(`${API_BASE}/api/rest/v1/auth/ext-token`, { credentials: 'include' });
  if (!res.ok) throw new Error('NOT_LOGGED_IN');
  const data = await res.json();
  await chrome.storage.local.set({ [EXT_TOKEN_KEY]: data });
  return data.token;
}

/**
 * Open the Google OAuth flow in a new tab and resolve when the user lands on
 * dwarfer.link/o/* (login complete). Closes the tab and refocuses YouTube.
 */
function openLoginAndWait(returnTabId) {
  return new Promise((resolve) => {
    // Go directly to Google OAuth — skips the dwarfer landing page entirely
    chrome.tabs.create({ url: `${API_BASE}/oauth2/authorization/google` }, (tab) => {
      let settled = false;

      function finish() {
        if (settled) return;
        settled = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
        // Clear cached ext-token so a fresh one is fetched after login
        chrome.storage.local.remove(EXT_TOKEN_KEY);
        // Return focus to the YouTube tab
        if (returnTabId) chrome.tabs.update(returnTabId, { active: true });
        resolve();
      }

      function onUpdated(tabId, changeInfo, updatedTab) {
        if (tabId !== tab.id || changeInfo.status !== 'complete') return;
        const url = updatedTab.url || '';
        if (url.startsWith(`${API_BASE}/o/`)) {
          setTimeout(() => {
            chrome.tabs.remove(tab.id, () => {});
            finish();
          }, 500);
        }
      }

      function onRemoved(tabId) {
        if (tabId === tab.id) finish();
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onRemoved.addListener(onRemoved);
    });
  });
}

async function checkAuth() {
  const res = await fetch(`${API_BASE}/api/rest/v1/auth/me`, { credentials: 'include' });
  if (!res.ok) throw new Error('Not authenticated');
  const data = await res.json();
  // Pre-warm the ext-token cache while the session is confirmed fresh
  fetchExtToken().catch(() => {});
  return data;
}

async function searchGiphy(query, limit = 20) {
  const res = await fetch(
    `${API_BASE}/api/rest/v1/gif/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    { credentials: 'include' }
  );
  if (!res.ok) throw new Error('Search failed');
  return res.json();
}

async function trendingGiphy(limit = 20) {
  const res = await fetch(
    `${API_BASE}/api/rest/v1/gif/trending?limit=${limit}`,
    { credentials: 'include' }
  );
  if (!res.ok) throw new Error('Trending failed');
  return res.json();
}

/**
 * Create (or find existing) GIF short link via X-Ext-Token header.
 * No session cookie needed for this POST — bypasses SameSite restrictions.
 */
async function createGifLink(giphyId) {
  const token = await fetchExtToken();
  const res = await fetch(`${API_BASE}/api/rest/v1/gif`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Ext-Token': token,
    },
    body: JSON.stringify({ giphyId }),
  });
  const text = await res.text();
  if (text.trimStart().startsWith('<')) throw new Error('NOT_LOGGED_IN');
  if (!res.ok) throw new Error(`Failed to create GIF link: ${res.status}`);
  return JSON.parse(text);
}

// Handle messages from content scripts and popup.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RESOLVE_GIF') {
    resolveGifCode(message.code)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'CHECK_AUTH') {
    checkAuth()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'SEARCH_GIFS') {
    searchGiphy(message.query)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'TRENDING_GIFS') {
    trendingGiphy()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'LOGIN') {
    const returnTabId = sender.tab?.id;
    openLoginAndWait(returnTabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (message.type === 'CREATE_GIF_LINK') {
    createGifLink(message.giphyId)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
