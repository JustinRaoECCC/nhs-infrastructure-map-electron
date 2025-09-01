// frontend/js/list_view.js

// Provide a safe stub in case station.js hasn't loaded yet
window.loadStationPage = window.loadStationPage || function (id) {
  console.warn('[list_view] loadStationPage not loaded yet; station id:', id);
};

// Quick-view renderer (shared shape with map_view; defined here so we work in list.html, too)
window.showStationDetails = window.showStationDetails || function showStationDetails(stn) {
  const container = document.getElementById('station-details');
  if (!container) return;

  const placeholder = container.querySelector('p');
  if (placeholder) placeholder.remove();

  let body = container.querySelector('.station-details-body');
  if (!body) {
    body = document.createElement('div');
    body.className = 'station-details-body';
    container.appendChild(body);
  }

  const fixedOrder = [
    ['Station ID', stn.station_id],
    ['Category',   stn.asset_type],
    ['Site Name',  stn.name],
    ['Province',   stn.province],
    ['Latitude',   stn.lat],
    ['Longitude',  stn.lon],
    ['Status',     stn.status],
  ];

  // collect "Section – Field" extras
  const extras = {};
  Object.keys(stn || {}).forEach(key => {
    if (!key.includes(' – ')) return;
    const [section, field] = key.split(' – ');
    (extras[section] ||= {})[field] = stn[key];
  });

  let html = '';
  html += '<div class="station-section">';
  html += '<h3>General Information</h3><table>';
  fixedOrder.forEach(([label, val]) => {
    html += `<tr><th>${label}:</th><td>${val ?? ''}</td></tr>`;
  });
  html += '</table></div>';

  Object.entries(extras).forEach(([section, fields]) => {
    html += `<div class="station-section"><h3>${section}</h3><table>`;
    Object.entries(fields).forEach(([fld, val]) => {
      html += `<tr><th>${fld}:</th><td>${val ?? ''}</td></tr>`;
    });
    html += '</table></div>';
  });

  body.innerHTML = html;
};

// ────────────────────────────────────────────────────────────────────────────
// List view - FIXED to prevent interfering with map
// ────────────────────────────────────────────────────────────────────────────
(function () {
  const table = document.getElementById('stationTable');
  if (!table) return; // not on this page

  console.log('[list_view] Initializing list view');

  const tbody = table.querySelector('tbody');
  const filterTree = document.getElementById('filterTree');

  // current sort state
  let sortKey = 'name';
  let sortDir = 'asc';

  // map column index → station field
  const columnField = ['station_id', 'asset_type', 'name', 'lat', 'lon', 'status'];

  // click-to-sort headers
  const theadCells = Array.from(table.querySelectorAll('thead th'));
  theadCells.forEach((th, idx) => {
    th.style.cursor = 'pointer';
    th.title = 'Sort';
    th.addEventListener('click', () => {
      const newKey = columnField[idx];
      if (sortKey === newKey) {
        sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
      } else {
        sortKey = newKey;
        sortDir = 'asc';
      }
      renderList(); // re-render with new sort
    });
  });

  function getActiveFilters() {
    const norm = s => String(s ?? '').trim().toLowerCase();
    const locCbs = Array.from(document.querySelectorAll('.filter-checkbox.location'));
    const atCbs  = Array.from(document.querySelectorAll('.filter-checkbox.asset-type'));
    const locations = new Set(locCbs.filter(cb => cb.checked).map(cb => norm(cb.value)));
    const assetTypes = new Set(atCbs.filter(cb => cb.checked).map(cb => norm(cb.value)));
    const allLocationsSelected  = locCbs.length > 0 && locations.size === locCbs.length;
    const allAssetTypesSelected = atCbs.length  > 0 && assetTypes.size === atCbs.length;
    return { locations, assetTypes, allLocationsSelected, allAssetTypesSelected, totalLocs: locCbs.length, totalAts: atCbs.length, _norm: norm };
  }

  function compare(a, b, key) {
    const av = (a?.[key] ?? '').toString().toLowerCase();
    const bv = (b?.[key] ?? '').toString().toLowerCase();
    if (av < bv) return -1;
    if (av > bv) return  1;
    return 0;
  }

  async function renderList() {
    console.log('[list_view] renderList() called');
    
    tbody.innerHTML = '';

    try {
      const data = await window.electronAPI.getStationData();
      const { locations, assetTypes, allLocationsSelected, allAssetTypesSelected, _norm } = getActiveFilters();
      const restrictByLocations  = !(allLocationsSelected  || locations.size  === 0);
      const restrictByAssetTypes = !(allAssetTypesSelected || assetTypes.size === 0);

      const filtered = (data || []).filter(stn => {
        const locCandidates = [
          _norm(stn.province), _norm(stn.location), _norm(stn.location_file)
        ].filter(Boolean);
        const locOk = !restrictByLocations || locCandidates.some(v => locations.has(v));
        const atOk  = !restrictByAssetTypes || assetTypes.has(_norm(stn.asset_type));
        return locOk && atOk;
      });

      filtered.sort((a, b) => {
        const dir = (sortDir === 'asc') ? 1 : -1;
        return compare(a, b, sortKey) * dir;
      });

      if (!filtered.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="6" style="padding:0.75em; text-align:center; opacity:0.75;">
          No stations match the current filters.
        </td>`;
        tbody.appendChild(tr);
        return;
      }

      filtered.forEach(stn => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.innerHTML = `
          <td>${stn.station_id ?? ''}</td>
          <td>${stn.asset_type ?? ''}</td>
          <td>
            <a href="#" class="station-link" data-id="${stn.station_id}" style="text-decoration:underline;">
              ${stn.name ?? ''}
            </a>
          </td>
          <td>${stn.lat ?? ''}</td>
          <td>${stn.lon ?? ''}</td>
          <td>${stn.status ?? ''}</td>
        `;

        // hover = update RHS details (quick-view)
        tr.addEventListener('mouseover', () => window.showStationDetails(stn));

        // click name = open full station page (station_specific.html)
        tr.querySelector('.station-link').addEventListener('click', (e) => {
          e.preventDefault();
          window.loadStationPage(stn.station_id);
        });

        tbody.appendChild(tr);
      });
      
      console.log('[list_view] Rendered', filtered.length, 'stations in list');
      
    } catch (error) {
      console.error('[list_view] Error rendering list:', error);
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="6" style="padding:0.75em; text-align:center; color:red;">
        Error loading station data. Check console for details.
      </td>`;
      tbody.appendChild(tr);
    }
  }

  // CRITICAL FIX: Don't automatically render on load - wait for explicit call
  // This prevents race conditions with map rendering
  
  // FIXED: Only listen for filter changes if we're on a page that has the filter tree
  // AND only set up the listener once the filters are ready
  if (filterTree) {
    // Use a more conservative approach - check if filters are ready before binding
    const setupFilterListener = () => {
      if (filterTree.dataset.ready === '1') {
        console.log('[list_view] Setting up filter change listener');
        filterTree.addEventListener('change', () => {
          console.log('[list_view] Filter change detected, re-rendering list');
          renderList();
        });
        return true;
      }
      return false;
    };
    
    // Try to set up listener immediately, otherwise poll
    if (!setupFilterListener()) {
      const pollForReady = () => {
        if (!setupFilterListener()) {
          setTimeout(pollForReady, 100);
        }
      };
      setTimeout(pollForReady, 100);
    }
  }

  // IMPROVED: Only do initial render if we're actually on the list page
  // Check if we have the table and it's visible
  const isListPage = table && table.offsetParent !== null;
  if (isListPage) {
    console.log('[list_view] On list page, doing initial render');
    // Small delay to ensure filters have had a chance to initialize
    setTimeout(renderList, 500);
  } else {
    console.log('[list_view] Not on list page or table not visible, skipping initial render');
  }

  // expose globally so other modules (e.g., import, filters) can ask for a redraw
  window.renderList = renderList;

  // If a global import occurred, map_view will invalidate cache & call window.renderList().
  // Nothing else to do here — just be ready to cycle!
})();