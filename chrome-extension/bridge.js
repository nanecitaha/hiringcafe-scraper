// Normal (isolated) content script. scraper.js runs in the page's own context and
// can't use chrome.* APIs, so this relays messages between it and the popup.
const CHANNEL = 'hc-scraper';
let lastStatus = null;

// Page -> extension: remember the latest status and forward it to an open popup.
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.channel !== CHANNEL || event.data.dir !== 'to-ext') return;
  lastStatus = event.data.status;
  chrome.runtime.sendMessage({ type: 'status', status: lastStatus }).catch(() => {
    // No popup open right now; that's fine.
  });
});

// Popup -> page.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'start' || msg.type === 'stop') {
    window.postMessage({ channel: CHANNEL, dir: 'to-page', ...msg }, window.location.origin);
    sendResponse({ ok: true });
  } else if (msg.type === 'getStatus') {
    sendResponse({ ok: true, status: lastStatus });
  }
});

// Pick up the current status in case the scraper was already running.
window.postMessage({ channel: CHANNEL, dir: 'to-page', type: 'getStatus' }, window.location.origin);
