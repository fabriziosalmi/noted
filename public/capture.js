// The quick-capture page. An external file, not an inline script: the production CSP (electron/core/protocol.ts) allows no inline script
// and no inline event handlers, so the page's own script must be a file and its buttons must be wired here.
const ta = document.getElementById('note');
const target = document.getElementById('target');
ta.focus();

// What the page says comes from the app, in its language (see openCaptureWindow); the English above is the fallback.
try {
  const l = JSON.parse(new URLSearchParams(location.search).get('l') || 'null');
  if (l) {
    document.getElementById('title').textContent = l.title;
    document.getElementById('target-label').textContent = l.target;
    document.getElementById('hint').textContent = l.hint;
    document.getElementById('save').textContent = l.save;
    ta.placeholder = l.placeholder;
    for (const o of target.options) if (l.targets[o.value]) o.textContent = l.targets[o.value];
  }
} catch { /* keep the English */ }

// The last choice is the next default.
const KEY = 'noted.capture.target';
try { const last = localStorage.getItem(KEY); if (last && [...target.options].some(o => o.value === last)) target.value = last; } catch { /* no storage */ }
target.addEventListener('change', () => { try { localStorage.setItem(KEY, target.value); } catch { /* no storage */ } ta.focus(); });

async function save() {
  const text = ta.value.trim();
  if (!text) return;
  if (window.electronAPI?.saveCapture) {
    const res = await window.electronAPI.saveCapture(text, target.value);
    // Close on success (or when the handler reports no explicit failure) so a
    // saved capture doesn't leave the window sitting open like a hang.
    if (!res || res.success !== false) close();
  }
}

function close() {
  if (window.electronAPI?.closeCapture) window.electronAPI.closeCapture();
}

document.getElementById('save').addEventListener('click', save);
document.getElementById('close').addEventListener('click', close);

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); }
  if (e.key === 'Escape') close();
});
