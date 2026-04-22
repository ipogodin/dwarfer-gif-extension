const API_BASE = 'https://dwarfer.link';

function show(id) {
  document.querySelectorAll('.state').forEach((el) => el.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

async function init() {
  try {
    const res = await fetch(`${API_BASE}/api/rest/v1/auth/me`, { credentials: 'include' });
    if (res.ok) {
      const user = await res.json();
      document.getElementById('username').textContent = user.name || user.email || 'Signed in';
      document.getElementById('useremail').textContent = user.email || '';
      const avatar = document.getElementById('user-avatar');
      if (user.picture) {
        avatar.src = user.picture;
      } else {
        avatar.style.display = 'none';
      }
      show('logged-in');
    } else {
      show('logged-out');
    }
  } catch {
    show('logged-out');
  }
}

document.getElementById('sign-in-btn')?.addEventListener('click', () => {
  chrome.tabs.create({ url: `${API_BASE}/oauth2/authorization/google` });
  window.close();
});

// Account dropdown
const chevron = document.getElementById('account-chevron');
const dropdown = document.getElementById('account-dropdown');

chevron?.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = !dropdown.classList.contains('hidden');
  dropdown.classList.toggle('hidden');
  chevron.classList.toggle('open', !isOpen);
});

document.addEventListener('click', (e) => {
  if (!dropdown?.classList.contains('hidden') && !e.target.closest('.user-card-wrapper')) {
    dropdown.classList.add('hidden');
    chevron?.classList.remove('open');
  }
});

document.getElementById('sign-out-btn')?.addEventListener('click', async () => {
  try {
    await fetch(`${API_BASE}/api/rest/v1/auth/logout`, { method: 'POST', credentials: 'include' });
    await chrome.storage.local.remove('ext-token');
  } catch { /* best-effort */ }
  show('logged-out');
});

const gifToggle = document.getElementById('gif-toggle');

chrome.storage.local.get('gifRenderEnabled', ({ gifRenderEnabled }) => {
  gifToggle.checked = gifRenderEnabled !== false;
});

gifToggle.addEventListener('change', () => {
  chrome.storage.local.set({ gifRenderEnabled: gifToggle.checked });
});

init();
