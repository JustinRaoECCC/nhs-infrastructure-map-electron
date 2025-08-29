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

  // collect “Section – Field” extras
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
// List view
// ────────────────────────────────────────────────────────────────────────────
(function () {
  const table = document.getElementById('stationTable');
  if (!table) return; // not on this page

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
    const locations = new Set(Array.from(document.querySelectorAll('.filter-checkbox.location:checked')).map(cb => norm(cb.value)));
    const assetTypes = new Set(Array.from(document.querySelectorAll('.filter-checkbox.asset-type:checked')).map(cb => norm(cb.value)));
    return { locations, assetTypes, _norm: norm };
  }

  function compare(a, b, key) {
    const av = (a?.[key] ?? '').toString().toLowerCase();
    const bv = (b?.[key] ?? '').toString().toLowerCase();
    if (av < bv) return -1;
    if (av > bv) return  1;
    return 0;
  }

  async function renderList() {
    tbody.innerHTML = '';

    const data = await window.electronAPI.getStationData();
    const { locations, assetTypes, _norm } = getActiveFilters();
    const anySelected = (locations.size > 0) || (assetTypes.size > 0);

    const filtered = anySelected
      ? (data || []).filter(stn => {
          // match by province, location, or file-derived tag
          const locCandidates = [
            _norm(stn.province), _norm(stn.location), _norm(stn.location_file)
          ].filter(Boolean);
          const locOk = (locations.size === 0) || locCandidates.some(v => locations.has(v));
          const atOk  = (assetTypes.size === 0) || assetTypes.has(_norm(stn.asset_type));
          return locOk && atOk;
        })
      : (data || []);

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
  }

  // initial render
  renderList();

  // re-render when filters change (if the tree exists)
  if (filterTree) {
    filterTree.addEventListener('change', () => renderList());
  }

  // expose globally so other modules (e.g., import, filters) can ask for a redraw
  window.renderList = renderList;

  // If a global import occurred, map_view will invalidate cache & call window.renderList().
  // Nothing else to do here — just be ready to cycle!
})();
