// frontend/js/boot_status.js
(function () {
  'use strict';
  const overlay = document.getElementById('excelBootOverlay');
  const fill = document.getElementById('excelBootFill');
  const text = document.getElementById('excelBootText');
  if (!overlay || !fill || !text || !window.electronAPI?.onExcelProgress) return;

  const update = (pct, msg) => {
    fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    text.textContent = msg || 'Loading Excel…';
    if (pct >= 100) {
      // small delay for a smooth finish
      setTimeout(() => overlay.classList.add('boot-hidden'), 250);
    }
  };

  // initial state
  update(5, 'Starting Excel worker…');

  // subscribe to progress
  window.electronAPI.onExcelProgress((p) => {
    // choose the highest percentage seen so far
    const pct = typeof p?.pct === 'number' ? p.pct : 0;
    const msg = p?.msg || 'Loading…';
    update(pct, msg);
  });
})();
