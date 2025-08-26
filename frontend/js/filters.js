// frontend/js/filters.js
// Builds the Company → Location → Asset Type filter tree,
// and wires simple prompts to write into data/lookups.xlsx via electronAPI.

(function () {
  const filterTree = document.getElementById('filterTree');
  if (!filterTree) return;

  // ─── Small helpers ───────────────────────────────────────────────────────
  const debounce = (fn, ms = 120) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function createCollapsibleItem(title, type, parent = null) {
    const wrapper = document.createElement('div');
    wrapper.classList.add('collapsible-wrapper');

    const header = document.createElement('div');
    header.classList.add('collapsible-header');

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.classList.add('filter-checkbox', type);
    chk.value = title;
    chk.checked = true;
    if (type === 'asset-type') {
      // parent here is the location string
      chk.dataset.location = parent;
    }
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', () => {
      const allDesc = wrapper.querySelectorAll('input.filter-checkbox');
      allDesc.forEach(b => b.checked = chk.checked);
      if (window.refreshMarkers) window.refreshMarkers();
      if (window.renderList)     window.renderList();
    });

    const toggleBtn = type !== 'asset-type' ? document.createElement('button') : null;
    if (toggleBtn) {
      toggleBtn.classList.add('toggle-collapse-button');
      toggleBtn.textContent = '+';
    }

    const titleSpan = document.createElement('span');
    titleSpan.classList.add('collapsible-title');
    titleSpan.textContent = title;

    const content = document.createElement('div');
    content.classList.add('collapsible-content');
    content.style.display = 'none';

    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const hidden = getComputedStyle(content).display === 'none';
        content.style.display = hidden ? 'block' : 'none';
        toggleBtn.textContent = hidden ? '–' : '+';
      });
    }

    // Click behavior: left-of-title toggles, right-of-title opens add modal
    header.addEventListener('click', (e) => {
      const rect = titleSpan.getBoundingClientRect();
      if (e.clientX < rect.left) {
        const hidden = getComputedStyle(content).display === 'none';
        content.style.display = hidden ? 'block' : 'none';
        if (toggleBtn) toggleBtn.textContent = hidden ? '–' : '+';
      } else {
        if (type === 'company') openAddLocationModal(title);
        else if (type === 'location') openAddAssetTypeModal(parent, title);
      }
    });

    header.appendChild(chk);
    if (toggleBtn) header.appendChild(toggleBtn);
    header.appendChild(titleSpan);

    wrapper.appendChild(header);
    wrapper.appendChild(content);
    return wrapper;
  }

  // Expose a couple of helpers for other modules (compat with older code)
  window.findCompanyWrapper = function (companyName) {
    return Array.from(filterTree.querySelectorAll('.collapsible-wrapper'))
      .find(w => w.querySelector('.collapsible-title')?.textContent === companyName);
  };
  window.findLocationWrapper = function (companyWrapper, locationName) {
    if (!companyWrapper) return null;
    return Array.from(companyWrapper.querySelectorAll('.collapsible-wrapper'))
      .find(w => w.querySelector('.collapsible-title')?.textContent === locationName);
  };

  // ─── Build tree ──────────────────────────────────────────────────────────
  async function buildFilterTree() {
    filterTree.innerHTML = '';

    const companies = await window.electronAPI.getActiveCompanies();

    for (const company of companies) {
      const compDiv = createCollapsibleItem(company, 'company');
      const compContent = compDiv.querySelector('.collapsible-content');

      const locs = await window.electronAPI.getLocationsForCompany(company);
      for (const loc of locs) {
        const locDiv = createCollapsibleItem(loc, 'location', company);
        const locContent = locDiv.querySelector('.collapsible-content');

        const assetTypes = await window.electronAPI.getAssetTypesForLocation(company, loc);
        for (const at of assetTypes) {
          if (at.toLowerCase() === 'sheet') continue; // legacy guard
          const atDiv = createCollapsibleItem(at, 'asset-type', loc);
          locContent.appendChild(atDiv);
        }
        compContent.appendChild(locDiv);
      }
      filterTree.appendChild(compDiv);
    }
  }

  window.buildFilterTree = buildFilterTree;

  // ─── Add flows (simple prompts) ──────────────────────────────────────────
  async function openAddCompanyModal() {
    const name = (prompt('New company name:') || '').trim();
    if (!name) return;
    const ok = await window.electronAPI.upsertCompany(name, true);
    if (!ok || ok.success === false) {
      alert('Failed to add company.');
      return;
    }
    await buildFilterTree();
  }

  async function openAddLocationModal(company) {
    const c = company || (prompt('Parent company:') || '').trim();
    if (!c) return;
    const loc = (prompt(`New location for "${c}":`) || '').trim();
    if (!loc) return;
    const ok = await window.electronAPI.upsertLocation(loc, c);
    if (!ok || ok.success === false) {
      alert('Failed to add location.');
      return;
    }
    await buildFilterTree();
  }

  async function openAddAssetTypeModal(companyOrLocation, locationMaybe) {
    // We only need the location; if user clicked on a location item, parent carries company
    const location = locationMaybe || companyOrLocation || (prompt('Location:') || '').trim();
    if (!location) return;
    const at = (prompt(`New asset type for "${location}":`) || '').trim();
    if (!at) return;
    const ok = await window.electronAPI.upsertAssetType(at, location);
    if (!ok || ok.success === false) {
      alert('Failed to add asset type.');
      return;
    }
    await buildFilterTree();
  }

  // Top-of-drawer buttons
  const btnAddCompany  = document.getElementById('btnAddCompany');
  const btnAddLocation = document.getElementById('btnAddLocation');
  const btnAddAsset    = document.getElementById('btnAddAssetType');

  if (btnAddCompany && !btnAddCompany.dataset.bound) {
    btnAddCompany.addEventListener('click', openAddCompanyModal);
    btnAddCompany.dataset.bound = '1';
  }
  if (btnAddLocation && !btnAddLocation.dataset.bound) {
    btnAddLocation.addEventListener('click', () => openAddLocationModal());
    btnAddLocation.dataset.bound = '1';
  }
  if (btnAddAsset && !btnAddAsset.dataset.bound) {
    btnAddAsset.addEventListener('click', () => openAddAssetTypeModal());
    btnAddAsset.dataset.bound = '1';
  }

  // ─── Startup ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    await buildFilterTree();
    // trigger map/list initial render if present
    if (window.refreshMarkers) window.refreshMarkers();
    if (window.renderList)     window.renderList();
  });

  // Rebuild on filter drawer open/close might not be necessary; debounce manual calls:
  window.refreshFilters = debounce(buildFilterTree, 200);
})();
