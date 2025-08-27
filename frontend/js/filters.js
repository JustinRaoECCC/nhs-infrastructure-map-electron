// frontend/js/filters.js (stub)
// Filters drawer stays openable, but persistence & lookups are disabled.
(function () {
  'use strict';
  const filterTree = document.getElementById('filterTree');
  if (filterTree) {
    filterTree.innerHTML = `
      <div style="padding:.75rem;opacity:.75">
        Filters are temporarily disabled.
      </div>`;
  }

  // Disable top-of-drawer buttons
  const btnAddCompany  = document.getElementById('btnAddCompany');
  const btnAddLocation = document.getElementById('btnAddLocation');
  const btnAddAsset    = document.getElementById('btnAddAssetType');
  [btnAddCompany, btnAddLocation, btnAddAsset].forEach(btn => {
    if (!btn) return;
    btn.setAttribute('disabled', 'true');
    btn.classList.add('btn-ghost');
    btn.title = 'Disabled for now';
  });

  // Provide a no-op so any callers won't break.
  window.refreshFilters = function () {};
})();