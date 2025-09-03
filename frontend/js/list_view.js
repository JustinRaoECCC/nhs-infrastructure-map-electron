// frontend/js/list_view.js
// List View = Map View logic, but rendered as a table.
// - Uses the same filter semantics as map_view.js (copied helpers).
// - Renders rows into #stationTable.
// - Hovering a row updates the RHS details via window.showStationDetails.
// - Click a column header to sort (toggles asc/desc).
// - Respects the filter drawer readiness flag to avoid clearing on boot.

(function () {
  'use strict';

  // ────────────────────────────────────────────────────────────────────────────
  // Utils
  // ────────────────────────────────────────────────────────────────────────────
  const debounce = (fn, ms = 150) => {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  const norm = (s) => String(s ?? '').trim().toLowerCase();

  // ────────────────────────────────────────────────────────────────────────────
  // Filter helpers (kept in-sync with map_view.js)
  // ────────────────────────────────────────────────────────────────────────────
  function getActiveFilters() {
    const locCbs = Array.from(document.querySelectorAll('.filter-checkbox.location'));
    const atCbs  = Array.from(document.querySelectorAll('.filter-checkbox.asset-type'));

    const locations  = new Set();
    const assetTypes = new Set();
    const toNorm = (s) => String(s ?? '').trim().toLowerCase();

    locCbs.forEach(cb => { if (cb.checked) locations.add(toNorm(cb.value)); });
    atCbs.forEach(cb => {
      if (cb.checked) {
        assetTypes.add(toNorm(cb.value));
        const parentLoc = cb.dataset.location ? toNorm(cb.dataset.location) : '';
        if (parentLoc) locations.add(parentLoc);
      }
    });

    const allLocationsSelected  = locCbs.length > 0 && locations.size === locCbs.length;
    const allAssetTypesSelected = atCbs.length  > 0 && assetTypes.size === atCbs.length;

    return {
      locations, assetTypes,
      allLocationsSelected, allAssetTypesSelected,
      totalLocs: locCbs.length, totalAts: atCbs.length,
      _norm: toNorm
    };
  }

  function areFiltersActuallyRestricting() {
    const filterTreeEl = document.getElementById('filterTree');

    // If no filter tree or it's not "ready", treat as unrestricted.
    if (!filterTreeEl || filterTreeEl.dataset.ready !== '1') return false;

    const { locations, assetTypes, totalLocs, totalAts } = getActiveFilters();

    // No checkboxes exist at all -> no restriction
    if (totalLocs === 0 && totalAts === 0) return false;

    // Checkboxes exist but nothing selected -> restrict (show none)
    if ((totalLocs + totalAts) > 0 && locations.size === 0 && assetTypes.size === 0) return true;

    // Everything selected -> not restricting
    if ((totalLocs === 0 || locations.size === totalLocs) &&
        (totalAts  === 0 || assetTypes.size === totalAts)) return false;

    // Some are selected -> restricting
    return true;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // State
  // ────────────────────────────────────────────────────────────────────────────
  let LIST_FAST_BOOT = true;           // trim rows for the first couple seconds
  const MAX_INITIAL_ROWS = 800;        // tune for your dataset
  let RENDERING = false;

  // Keeps current rows in view for hover → details
  let currentRows = [];
  let sortState = { key: 'station_id', dir: 'asc' }; // default sort

  // Optional quick text filter (uses top search box if present)
  let liveQuery = '';

  // ────────────────────────────────────────────────────────────────────────────
  // Data → filtered rows (mirrors map_view filter semantics)
  // ────────────────────────────────────────────────────────────────────────────
  function applyFilters(all) {
    const valid = (all || []).filter(stn => {
      const lat = Number(stn.lat), lon = Number(stn.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) &&
             Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    });

    // Default: show ALL unless filters are actively restricting
    if (!areFiltersActuallyRestricting()) return valid;

    const { locations, assetTypes, totalLocs, totalAts, _norm } = getActiveFilters();

    return valid.filter(stn => {
      // Location filter
      let locOk = true;
      if (locations.size > 0) {
        const locCandidates = [
          _norm(stn.province),
          _norm(stn.location),
          _norm(stn.location_file)
        ].filter(Boolean);
        locOk = locCandidates.some(v => locations.has(v));
      } else if (totalLocs > 0) {
        // nothing selected while boxes exist -> exclude all by location
        locOk = false;
      }

      // Asset type filter
      let atOk = true;
      if (assetTypes.size > 0) {
        atOk = assetTypes.has(_norm(stn.asset_type));
      } else if (totalAts > 0) {
        atOk = false;
      }

      return locOk && atOk;
    });
  }

  function applySearch(rows) {
    const q = norm(liveQuery);
    if (!q) return rows;
    return rows.filter(stn => {
      return [
        stn.station_id, stn.asset_type, stn.name,
        stn.province, stn.location, stn.location_file,
        stn.status, stn.lat, stn.lon
      ].some(v => String(v ?? '').toLowerCase().includes(q));
    });
  }

  function sortRows(rows) {
    const { key, dir } = sortState;
    const dirMul = dir === 'desc' ? -1 : 1;
    const numKeys = new Set(['lat', 'lon']);

    return rows.slice().sort((a, b) => {
      const va = a?.[key], vb = b?.[key];
      if (numKeys.has(key)) {
        const na = Number(va), nb = Number(vb);
        const aa = Number.isFinite(na) ? na : -Infinity;
        const bb = Number.isFinite(nb) ? nb : -Infinity;
        if (aa < bb) return -1 * dirMul;
        if (aa > bb) return  1 * dirMul;
        return 0;
      }
      const sa = String(va ?? '').toLowerCase();
      const sb = String(vb ?? '').toLowerCase();
      if (sa < sb) return -1 * dirMul;
      if (sa > sb) return  1 * dirMul;
      return 0;
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Rendering
  // ────────────────────────────────────────────────────────────────────────────
  function formatNum(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v.toFixed(5) : '';
    // fixed precision keeps the table tidy; tweak as needed
  }

  function stationToRow(stn) {
    // Province column shows the best available location label, same priority as map filters
    const provinceLike = stn.province ?? stn.location ?? stn.location_file ?? '';
    return [
      stn.station_id ?? '',
      stn.asset_type ?? '',
      stn.name ?? '',
      provinceLike,
      formatNum(stn.lat),
      formatNum(stn.lon),
      stn.status ?? ''
    ];
  }

  function attachSorting(tableEl) {
    const head = tableEl.querySelector('thead');
    if (!head || head.dataset.bound === '1') return;

    const keyForIndex = (idx) => {
      switch (idx) {
        case 0: return 'station_id';
        case 1: return 'asset_type';
        case 2: return 'name';
        case 3: return 'province'; // we still sort by stn.province field
        case 4: return 'lat';
        case 5: return 'lon';
        case 6: return 'status';
        default: return 'station_id';
      }
    };

    head.addEventListener('click', (e) => {
      const th = e.target.closest('th');
      if (!th) return;
      const row = th.parentElement;
      if (!row) return;

      const idx = Array.from(th.parentElement.children).indexOf(th);
      const key = keyForIndex(idx);
      if (!key) return;

      // toggle direction
      if (sortState.key === key) {
        sortState.dir = (sortState.dir === 'asc') ? 'desc' : 'asc';
      } else {
        sortState.key = key;
        sortState.dir = 'asc';
      }
      // re-render rows (no refetch)
      renderRowsOnly();
    }, { passive: true });

    head.dataset.bound = '1';
  }

  function attachHover(tbodyEl) {
    if (!tbodyEl || tbodyEl.dataset.bound === '1') return;
    let lastIdx = -1;

    tbodyEl.addEventListener('mousemove', (e) => {
      const tr = e.target.closest('tr[data-idx]');
      if (!tr) return;
      const idx = Number(tr.dataset.idx);
      if (!Number.isFinite(idx) || idx === lastIdx) return;
      lastIdx = idx;

      const stn = currentRows[idx];
      if (stn && typeof window.showStationDetails === 'function') {
        window.showStationDetails(stn);
      }
    }, { passive: true });

    tbodyEl.dataset.bound = '1';
  }

  // NEW: clicking a row opens the station detail page
  function attachRowClicks(tbodyEl) {
    if (!tbodyEl || tbodyEl.dataset.clickBound === '1') return;
    tbodyEl.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-idx]');
      if (!tr) return;
      const idx = Number(tr.dataset.idx);
      if (!Number.isFinite(idx)) return;
      const stn = currentRows[idx];
      if (!stn) return;
      if (typeof window.loadStationPage === 'function') {
        window.loadStationPage(stn.station_id, 'list'); // pass origin
      }
    });
    tbodyEl.dataset.clickBound = '1';
  }

  function updateCountBadge(n) {
    const badge = document.getElementById('listCount');
    if (!badge) return;
    if (!n || n < 0) {
      badge.style.display = 'none';
      badge.textContent = '';
      return;
    }
    badge.style.display = 'inline-block';
    badge.textContent = `${n} row${n === 1 ? '' : 's'}`;
  }

  function renderIntoTable(rows, opts = {}) {
    const table = document.getElementById('stationTable');
    if (!table) return;

    attachSorting(table);

    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const frag = document.createDocumentFragment();

    const limit = (LIST_FAST_BOOT && !opts.full) ? Math.min(rows.length, MAX_INITIAL_ROWS) : rows.length;

    for (let i = 0; i < limit; i++) {
      const stn = rows[i];
      const tr = document.createElement('tr');
      tr.dataset.idx = String(i);

      const cols = stationToRow(stn);
      for (const text of cols) {
        const td = document.createElement('td');
        td.textContent = String(text ?? '');
        tr.appendChild(td);
      }

      frag.appendChild(tr);
    }

    tbody.appendChild(frag);
    attachHover(tbody);
    attachRowClicks(tbody);
    updateCountBadge(limit);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Fetch + compose + render
  // ────────────────────────────────────────────────────────────────────────────
  async function computeRows() {
    // Always fetch fresh to avoid cache mismatch with map_view invalidateStationData()
    let data = [];
    try {
      if (typeof window.electronAPI?.getStationData === 'function') {
        data = await window.electronAPI.getStationData({});
      }
    } catch (e) {
      console.error('[list] getStationData failed:', e);
    }

    let rows = applyFilters(data);
    rows = applySearch(rows);
    rows = sortRows(rows);
    return rows;
  }

  async function renderList(full = false) {
    if (RENDERING) return;
    RENDERING = true;
    try {
      currentRows = await computeRows();
      renderIntoTable(currentRows, { full });
    } catch (e) {
      console.error('[list] renderList error:', e);
    } finally {
      RENDERING = false;
    }
  }

  const renderListDebounced = debounce(() => renderList(false), 150);

  function renderRowsOnly() {
    // Re-render rows using existing currentRows + current sort/search
    try {
      currentRows = sortRows(applySearch(currentRows));
      renderIntoTable(currentRows);
    } catch (e) {
      console.error('[list] renderRowsOnly error:', e);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Public bootstrapping API (called by add_infra.js after list.html loads)
  // ────────────────────────────────────────────────────────────────────────────
  function initListView() {
    const page = document.getElementById('listPage');
    const table = document.getElementById('stationTable');
    if (!page || !table) {
      // DOM not ready yet (e.g., just injected) — try again next frame
      requestAnimationFrame(initListView);
      return;
    }

    if (!page.dataset.bound) {
      // Hook filter changes → refresh
      const filterTree = document.getElementById('filterTree');
      if (filterTree) {
        // Avoid double-binding
        if (!filterTree.dataset.listBound) {
          filterTree.addEventListener('change', () => {
            renderListDebounced();
          });
          filterTree.dataset.listBound = '1';
        }
      }

      // Hook search box if present
      const search = document.getElementById('searchAssets');
      if (search && !search.dataset.bound) {
        search.addEventListener('input', () => {
          liveQuery = search.value || '';
          renderRowsOnly(); // no refetch needed
        });
        search.dataset.bound = '1';
      }

      page.dataset.bound = '1';
    }

    // Initial render
    renderList(false);

    // Switch to full render after a short delay (mirrors map fast boot)
    setTimeout(() => {
      LIST_FAST_BOOT = false;
      renderList(true);
    }, 2000);
  }

  // Expose for add_infra.js
  window.initListView  = window.initListView  || initListView;
  window.renderList    = window.renderList    || (() => renderListDebounced());

  // If list markup was pre-injected somehow, allow auto-init
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('listPage')) initListView();
  });
})();
