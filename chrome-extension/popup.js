// Port 5055, not 5000: macOS AirPlay Receiver also uses 5000.
const DEFAULT_SERVER = 'http://127.0.0.1:5055';

const $ = (id) => document.getElementById(id);
let tabId = null;

function render(status) {
  if (!status) return;
  const target = status.maxJobs ? ` of ${status.maxJobs}` : '';
  const page = status.page ? ` · page ${status.page} of ${status.totalPages}` : '';
  $('counts').textContent = `Saved ${status.saved}${target} · skipped ${status.skipped}${page}`;
  $('message').textContent = status.message;
  $('lastJob').textContent = status.lastJob ? `Last saved: ${status.lastJob}` : '';
  $('start').disabled = status.running;
  $('stop').disabled = !status.running;
}

function notOnHiringCafe() {
  $('message').textContent = 'Open a HiringCafe search page in this tab. If it is already open, reload it once after installing the extension.';
  $('start').disabled = true;
  $('stop').disabled = true;
}

async function init() {
  const { server } = await chrome.storage.local.get('server');
  $('server').value = server || DEFAULT_SERVER;
  $('server').addEventListener('change', () => chrome.storage.local.set({ server: $('server').value.trim().replace(/\/+$/, '') }));

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab && tab.id;
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: 'getStatus' });
    if (reply && reply.status) render(reply.status);
    else $('message').textContent = 'Ready.';
  } catch (err) {
    notOnHiringCafe();
  }
}

$('start').addEventListener('click', async () => {
  const mode = document.querySelector('input[name=mode]:checked').value;
  let maxJobs = null;
  if (mode === 'fixed') {
    maxJobs = Number($('count').value);
    if (!Number.isInteger(maxJobs) || maxJobs < 1) {
      $('message').textContent = 'Enter a whole number above 0.';
      return;
    }
  }
  const serverBase = $('server').value.trim().replace(/\/+$/, '') || DEFAULT_SERVER;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'start', maxJobs, serverBase });
    $('start').disabled = true;
    $('stop').disabled = false;
    $('message').textContent = 'Starting…';
  } catch (err) {
    notOnHiringCafe();
  }
});

$('stop').addEventListener('click', async () => {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'stop' });
    $('stop').disabled = true;
    $('message').textContent = 'Stopping after the current job…';
  } catch (err) {
    notOnHiringCafe();
  }
});

// Live updates while the popup is open.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'status' && sender.tab && sender.tab.id === tabId) render(msg.status);
});

init();
