// In-page replacements for confirm() and alert().
// Browsers and embedded previews (for example a preview pane inside an editor) can block the
// native pop-ups, which made buttons look dead. These are part of the page, so they always work.
const UI = (() => {
  let dlg = null, box = null;
  function dialog() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'cfm';
    dlg.setAttribute('aria-labelledby', 'cfmMsg');
    dlg.innerHTML = '<form method="dialog" class="dlg"><h3 id="cfmMsg"></h3><div class="row"><button class="btn" value="ok" id="cfmOk"></button><button class="btn ghost" value="cancel" id="cfmNo">ยกเลิก</button></div></form>';
    document.body.appendChild(dlg);
    return dlg;
  }
  // resolves true if the person pressed the confirm button, false for cancel or Esc
  function confirm(message, okLabel = 'ตกลง') {
    return new Promise(resolve => {
      const d = dialog();
      d.querySelector('#cfmMsg').textContent = message;
      d.querySelector('#cfmOk').textContent = okLabel;
      d.returnValue = '';
      d.onclose = () => resolve(d.returnValue === 'ok');
      d.showModal();
      d.querySelector('#cfmNo').focus();
    });
  }
  // short message at the bottom of the screen, replaces alert()
  function toast(message) {
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = message;
    box.appendChild(t);
    setTimeout(() => t.remove(), 6000);
  }
  return { confirm, toast };
})();
