// Drifting background shapes, shared by host.html and index.html.
// Deterministic layout (no randomness) so the page looks the same on every load.
(function () {
  const kinds = ['circle', 'square', 'diamond', 'triangle'];
  const wrap = document.createElement('div');
  wrap.className = 'bgfx';
  wrap.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('i');
    const size = 46 + ((i * 37) % 90);
    s.className = 'sh-' + kinds[i % 4];
    s.style.cssText =
      `left:${(i * 29 + 7) % 96}%;top:${(i * 43 + 11) % 92}%;width:${size}px;height:${size}px;` +
      `background:var(--c${(i % 4) + 1});--t:${22 + (i * 5) % 18}s;--d:${-(i * 3)}s;` +
      `--x:${((i * 53) % 120) - 60}px;--y:${((i * 71) % 140) - 90}px;--r:${((i * 47) % 160) - 80}deg`;
    wrap.appendChild(s);
  }
  document.body.prepend(wrap);
})();
