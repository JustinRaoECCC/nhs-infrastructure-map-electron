// frontend/js/dashboard.js
(function () {
  'use strict';

  // ---- Helpers -------------------------------------------------------------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const hasStatsDOM = () => !!document.getElementById('statisticsPage');

  const getFieldValue = (row, fieldName) => {
    // Finds "Inspection Frequency" or any "Section – Inspection Frequency" etc., case-insensitive
    const target = String(fieldName).toLowerCase();
    for (const k of Object.keys(row || {})) {
      if (!k) continue;
      if (String(k).toLowerCase() === target) return row[k];
    }
    for (const k of Object.keys(row || {})) {
      if (k.includes(' – ')) {
        const parts = k.split(' – ');
        const last = parts[parts.length - 1];
        if (String(last).toLowerCase() === target) return row[k];
      }
    }
    return '';
  };

  const normStr = (s) => String(s ?? '').trim();
  const stationLocation = (s) => normStr(s.province || s.location || s.location_file);
  const stationAssetType = (s) => normStr(s.asset_type);

  // Haversine distance in km
  function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // Basic, dependency-free bar chart
  function renderBarChart(container, dataPairs, opts = {}) {
    // dataPairs: [{ label, value }]
    container.innerHTML = '';
    const width = Math.max(320, container.clientWidth || 600);
    const height = opts.height || 240;
    const padL = 40, padR = 12, padT = 10, padB = 28;

    const W = width, H = height;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxVal = Math.max(1, ...dataPairs.map(d => +d.value || 0));
    const barGap = 8;
    const n = dataPairs.length || 1;
    const barW = Math.max(6, (plotW - (n - 1) * barGap) / n);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', esc(opts.ariaLabel || 'Bar chart'));

    // Y axis line
    const yAxis = document.createElementNS(svg.namespaceURI, 'line');
    yAxis.setAttribute('x1', padL);
    yAxis.setAttribute('x2', padL);
    yAxis.setAttribute('y1', padT);
    yAxis.setAttribute('y2', padT + plotH);
    yAxis.setAttribute('stroke', 'currentColor');
    yAxis.setAttribute('stroke-opacity', '0.35');
    svg.appendChild(yAxis);

    // Bars + labels
    dataPairs.forEach((d, i) => {
      const v = (+d.value || 0);
      const h = Math.round((v / maxVal) * plotH);
      const x = padL + i * (barW + barGap);
      const y = padT + (plotH - h);

      const rect = document.createElementNS(svg.namespaceURI, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', barW);
      rect.setAttribute('height', h);
      rect.setAttribute('fill', 'currentColor');
      rect.setAttribute('fill-opacity', '0.8');
      svg.appendChild(rect);

      // Value label
      const tv = document.createElementNS(svg.namespaceURI, 'text');
      tv.setAttribute('x', x + barW / 2);
      tv.setAttribute('y', y - 4);
      tv.setAttribute('text-anchor', 'middle');
      tv.setAttribute('font-size', '10');
      tv.textContent = String(v);
      svg.appendChild(tv);

      // X labels (rotate if long)
      const tl = document.createElementNS(svg.namespaceURI, 'text');
      tl.setAttribute('x', x + barW / 2);
      tl.setAttribute('y', padT + plotH + 14);
      tl.setAttribute('text-anchor', 'end');
      tl.setAttribute('transform', `rotate(-30, ${x + barW / 2}, ${padT + plotH + 14})`);
      tl.setAttribute('font-size', '10');
      tl.textContent = String(d.label);
      svg.appendChild(tl);
    });

    container.appendChild(svg);
  }

  // ---- State ---------------------------------------------------------------

  const state = {
    allStations: [],
    filteredStations: [],
    lookupTree: null,
    cards: [],
    initialized: false
  };

  // ---- Filters integration (Analytics only) --------------------------------

  function readActiveFilters() {
    const tree = $('#filterTree');
    if (!tree) return { locations: null, assetsByLocation: new Map() };

    // Selected locations
    const locCbs = $$('input.location', tree);
    const checkedLocs = new Set(locCbs.filter(cb => cb.checked).map(cb => cb.value));

    // Selected asset types per location (only if not all are selected)
    const assetsByLoc = new Map();
    const locMap = new Map(); // quick map of location -> all asset type checkboxes under it
    $$('.ft-location', tree).forEach(locDetails => {
      const locCb = $('input.location', locDetails);
      if (!locCb) return;
      const atCbs = $$('input.asset-type', locDetails);
      locMap.set(locCb.value, atCbs);
    });

    for (const [loc, atCbs] of locMap.entries()) {
      if (!checkedLocs.has(loc)) continue;
      const checked = atCbs.filter(cb => cb.checked).map(cb => cb.value);
      if (checked.length && checked.length !== atCbs.length) {
        assetsByLoc.set(loc, new Set(checked));
      }
    }

    return { locations: checkedLocs, assetsByLocation: assetsByLoc };
  }

  function applyAnalyticsFilters() {
    const { locations, assetsByLocation } = readActiveFilters();

    if (!locations || locations.size === 0) {
      state.filteredStations = [];
      return;
    }

    const matches = (s) => {
      const loc = stationLocation(s);
      if (!loc || !locations.has(loc)) return false;
      const set = assetsByLocation.get(loc);
      if (!set || set.size === 0) return true; // no AT filter for this location
      return set.has(stationAssetType(s));
    };

    state.filteredStations = state.allStations.filter(matches);
  }

  function onFiltersChanged() {
    applyAnalyticsFilters();
    // Re-render all analytics cards
    state.cards.forEach(c => c.update());
  }

  // ---- Overview (unfiltered) -----------------------------------------------

  function computeOverview() {
    const all = state.allStations;

    const byLoc = new Map();
    const byCo  = new Map();

    // Build location -> count
    all.forEach(s => {
      const loc = stationLocation(s);
      if (!loc) return;
      byLoc.set(loc, (byLoc.get(loc) || 0) + 1);
    });

    // Derive company counts from lookup tree: sum counts of their locations
    const companies = (state.lookupTree?.companies || []);
    const locsByCompany = state.lookupTree?.locationsByCompany || {};
    companies.forEach(co => {
      let sum = 0;
      (locsByCompany[co] || []).forEach(loc => { sum += (byLoc.get(loc) || 0); });
      // Even if a company has 0 (no stations yet), we still show it.
      byCo.set(co, sum);
    });

    return {
      totalStations: all.length,
      totalLocations: byLoc.size,
      totalCompanies: companies.length,
      byLocation: Array.from(byLoc.entries()).sort((a,b)=>a[0].localeCompare(b[0])),
      byCompany: Array.from(byCo.entries()).sort((a,b)=>a[0].localeCompare(b[0]))
    };
  }

  function renderOverview() {
    const ov = computeOverview();
    $('#ovTotalStations').textContent = String(ov.totalStations);
    $('#ovTotalLocations').textContent = String(ov.totalLocations);
    $('#ovTotalCompanies').textContent = String(ov.totalCompanies);

    const locWrap = $('#ovByLocation');
    locWrap.innerHTML = '';
    ov.byLocation.forEach(([loc, n]) => {
      const row = document.createElement('div');
      row.className = 'kv';
      row.innerHTML = `<div class="k">Total ${esc(loc)}</div><div class="v">${n}</div>`;
      locWrap.appendChild(row);
    });

    const coWrap = $('#ovByCompany');
    coWrap.innerHTML = '';
    ov.byCompany.forEach(([co, n]) => {
      const row = document.createElement('div');
      row.className = 'kv';
      row.innerHTML = `<div class="k">Total ${esc(co)}</div><div class="v">${n}</div>`;
      coWrap.appendChild(row);
    });
  }

  // ---- Analytics cards -----------------------------------------------------

  function addCard(node, updater) {
    const list = $('#statsCards');
    const wrap = document.createElement('div');
    wrap.className = 'stat-card';
    const header = document.createElement('div');
    header.className = 'stat-card-header';
    const body = document.createElement('div');
    body.className = 'stat-card-body';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-ghost stat-card-close';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Remove';
    closeBtn.addEventListener('click', () => {
      wrap.remove();
      state.cards = state.cards.filter(c => c.wrap !== wrap);
    });

    header.appendChild(closeBtn);
    wrap.appendChild(header);
    body.appendChild(node);
    wrap.appendChild(body);
    list.appendChild(wrap);

    const card = { wrap, update: updater };
    state.cards.push(card);
    updater();
    return card;
  }

  // -- Card: Province bar chart
  function createProvinceCard() {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="stat-title">Stations per Province</div>
      <div class="chart" style="width:100%;" aria-label="Province chart"></div>
    `;
    const chart = $('.chart', root);

    const update = () => {
      const data = state.filteredStations;
      const counts = new Map();
      data.forEach(s => {
        const loc = stationLocation(s);
        if (!loc) return;
        counts.set(loc, (counts.get(loc) || 0) + 1);
      });
      const items = Array.from(counts.entries()).sort((a,b)=>a[0].localeCompare(b[0]))
        .map(([label, value]) => ({ label, value }));
      chart.innerHTML = '';
      if (!items.length) {
        chart.innerHTML = '<div class="empty">No data (adjust filters)</div>';
        return;
      }
      renderBarChart(chart, items, { ariaLabel: 'Stations per province' });
    };

    return addCard(root, update);
  }

  // -- Card: Inspection Frequency bar chart
  function createInspectionFrequencyCard() {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="stat-title">Stations by Inspection Frequency</div>
      <div class="chart" style="width:100%;" aria-label="Inspection Frequency chart"></div>
      <div class="hint">Looks for a column named “Inspection Frequency” (any section).</div>
    `;
    const chart = $('.chart', root);

    const update = () => {
      const data = state.filteredStations;
      const counts = new Map();
      data.forEach(s => {
        let v = getFieldValue(s, 'Inspection Frequency');
        v = normStr(v) || 'Unknown';
        counts.set(v, (counts.get(v) || 0) + 1);
      });
      const items = Array.from(counts.entries()).sort((a,b)=>a[0].localeCompare(b[0]))
        .map(([label, value]) => ({ label, value }));
      chart.innerHTML = '';
      if (!items.length) {
        chart.innerHTML = '<div class="empty">No data (adjust filters)</div>';
        return;
      }
      renderBarChart(chart, items, { ariaLabel: 'Stations by inspection frequency' });
    };

    return addCard(root, update);
  }

  // -- Card: Lat/Lon radius count
  function createLatLonCard() {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="stat-title">Count within radius</div>
      <div class="form-row compact">
        <label>Latitude</label>
        <input type="number" step="0.000001" class="in-lat" placeholder="49.2827">
        <label>Longitude</label>
        <input type="number" step="0.000001" class="in-lon" placeholder="-123.1207">
        <label>Radius (km)</label>
        <input type="number" step="0.1" class="in-rad" placeholder="10" value="10">
        <button class="btn btn-primary btn-run">Compute</button>
      </div>
      <div class="result"><strong>Stations in circle:</strong> <span class="out">—</span></div>
      <div class="hint">Uses the current filters. Change inputs and click Compute.</div>
    `;
    const out = $('.result .out', root);
    const latIn = $('.in-lat', root);
    const lonIn = $('.in-lon', root);
    const radIn = $('.in-rad', root);
    const runBtn = $('.btn-run', root);

    // Provide a sane default center (mean of filtered lat/lon if available)
    const seedDefaults = () => {
      const pts = state.filteredStations
        .map(s => ({ lat: parseFloat(s.lat), lon: parseFloat(s.lon) }))
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      if (!pts.length) return;
      const avgLat = pts.reduce((a,b)=>a+b.lat,0)/pts.length;
      const avgLon = pts.reduce((a,b)=>a+b.lon,0)/pts.length;
      if (!latIn.value) latIn.value = String(avgLat.toFixed(6));
      if (!lonIn.value) lonIn.value = String(avgLon.toFixed(6));
    };

    const compute = () => {
      const lat = parseFloat(latIn.value);
      const lon = parseFloat(lonIn.value);
      const rad = Math.max(0, parseFloat(radIn.value));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(rad)) {
        out.textContent = '—';
        return;
      }
      let n = 0;
      for (const s of state.filteredStations) {
        const a = parseFloat(s.lat), b = parseFloat(s.lon);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        if (haversineKm(lat, lon, a, b) <= rad) n++;
      }
      out.textContent = String(n);
    };

    runBtn.addEventListener('click', compute);

    const update = () => {
      // try to seed reasonable center; do not auto-compute to avoid surprises
      seedDefaults();
      out.textContent = '—';
    };

    return addCard(root, update);
  }

  // ---- Add-stat popup ------------------------------------------------------

  function openAddStatMenu(anchor) {
    const menu = $('#addStatMenu');
    if (!menu) return;
    const rect = anchor.getBoundingClientRect();
    menu.style.display = 'block';
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 6) + 'px';
    menu.style.left = rect.left + 'px';

    const onDoc = (e) => {
      if (!menu.contains(e.target) && e.target !== anchor) close();
    };
    const close = () => {
      menu.style.display = 'none';
      document.removeEventListener('click', onDoc, true);
    };

    setTimeout(() => document.addEventListener('click', onDoc, true), 0);

    $$('.menu-item', menu).forEach(btn => {
      btn.onclick = () => {
        const kind = btn.dataset.kind;
        if (kind === 'province') createProvinceCard();
        else if (kind === 'inspection_frequency') createInspectionFrequencyCard();
        else if (kind === 'latlon') createLatLonCard();
        // FUTURE: add more cases here to introduce new stats
        close();
      };
    });
  }

  // ---- Repairs and Maintenance Tab ---------------------------------------
  
  let repairsState = {
    allRepairs: [],
    selectedRepairs: new Set(),
    selectedMaintenance: new Set(),
    repairsPage: 1,
    maintenancePage: 1,
    pageSize: 10  // Show 10 items per page
  };
  let stationsList = [];

  async function loadRepairsData() {
    try {
      const repairs = await window.electronAPI.getAllRepairs();
      repairsState.allRepairs = Array.isArray(repairs) ? repairs : [];
      repairsState.repairsPage = 1;  // Reset to page 1
      repairsState.maintenancePage = 1;
      renderRepairsTables();
    } catch (e) {
      console.error('[dashboard:repairs] Failed to load repairs:', e);
      repairsState.allRepairs = [];
    }
  }

  // Expose globally for other views to refresh
  window.loadRepairsData = loadRepairsData;

  function renderRepairsTables() {
    renderRepairsTable();
    renderMaintenanceTable();
  }

  // Replace the updatePaginationControls function in dashboard.js with this version:

  function updatePaginationControls(type, currentPage, totalPages, totalItems) {
    const tableId = type === 'repairs' ? 'globalRepairsTable' : 'globalMaintenanceTable';
    const table = $(`#${tableId}`);
    if (!table) return;
  
    // Find the panel container
    const panel = table.closest('.panel');
    if (!panel) return;

    // Remove existing pagination
    let paginationDiv = panel.querySelector('.pagination-controls');
    if (paginationDiv) paginationDiv.remove();
  
    // Create new pagination
    paginationDiv = document.createElement('div');
    paginationDiv.className = 'pagination-controls';
  
    const startItem = (currentPage - 1) * repairsState.pageSize + 1;
    const endItem = Math.min(currentPage * repairsState.pageSize, totalItems);
  
    paginationDiv.innerHTML = `
      <div class="pagination-info">
        Showing ${startItem}-${endItem} of ${totalItems} items
      </div>
      <div class="pagination-buttons">
        <button class="btn btn-ghost" id="${type}PrevPage" ${currentPage === 1 ? 'disabled' : ''}>← Previous</button>
        <span style="padding:0 12px;line-height:32px;font-size:13px;">Page ${currentPage} of ${totalPages || 1}</span>
        <button class="btn btn-ghost" id="${type}NextPage" ${currentPage >= totalPages ? 'disabled' : ''}>Next →</button>
      </div>
    `;
  
    // IMPORTANT: Insert pagination AFTER the table-scroll container, not after the panel
    const tableScroll = panel.querySelector('.table-scroll');
    if (tableScroll && tableScroll.nextSibling) {
      panel.insertBefore(paginationDiv, tableScroll.nextSibling);
    } else {
      panel.appendChild(paginationDiv);
    }
    
    // Force a reflow to ensure CSS is applied
    panel.offsetHeight;
    
    // Ensure table scroll container maintains its constraints
    if (tableScroll) {
      tableScroll.style.overflowX = 'auto';
      tableScroll.style.overflowY = 'auto';
      tableScroll.style.maxWidth = '100%';
      tableScroll.style.width = '100%';
    }
  
    // Wire up pagination buttons with null checks
    const prevBtn = $(`#${type}PrevPage`);
    const nextBtn = $(`#${type}NextPage`);
    
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (type === 'repairs') {
          repairsState.repairsPage = Math.max(1, repairsState.repairsPage - 1);
          renderRepairsTable();
        } else {
          repairsState.maintenancePage = Math.max(1, repairsState.maintenancePage - 1);
          renderMaintenanceTable();
        }
      });
    }
  
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (type === 'repairs') {
          repairsState.repairsPage = Math.min(totalPages, repairsState.repairsPage + 1);
          renderRepairsTable();
        } else {
          repairsState.maintenancePage = Math.min(totalPages, repairsState.maintenancePage + 1);
          renderMaintenanceTable();
        }
      });
    }
  }

  // Also update renderRepairsTable to ensure constraints after rendering:
  function renderRepairsTable() {
    const repairsBody = $('#globalRepairsBody');
    if (!repairsBody) return;
    
    const repairs = repairsState.allRepairs.filter(r => r.type !== 'Monitoring');
    const totalPages = Math.ceil(repairs.length / repairsState.pageSize);
    const startIdx = (repairsState.repairsPage - 1) * repairsState.pageSize;
    const endIdx = startIdx + repairsState.pageSize;
    const pageRepairs = repairs.slice(startIdx, endIdx);
    
    repairsBody.innerHTML = '';
    
    pageRepairs.forEach((repair, idx) => {
      const globalIdx = startIdx + idx;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" class="repair-checkbox" data-repair-id="${globalIdx}" /></td>
        <td>${esc(repair.date || '')}</td>
        <td>${esc(repair.station_id || '')}</td>
        <td>${esc(repair.location || '')}</td>
        <td>${esc(repair.assetType || '')}</td>
        <td>${esc(repair.name || '')}</td>
        <td>${esc(repair.severity || '')}</td>
        <td>${esc(repair.priority || '')}</td>
        <td>${formatCost(repair.cost)}</td>
        <td>${esc(repair.category || '')}</td>
        <td>${esc(repair.days || '')}</td>
      `;
      const checkbox = tr.querySelector('.repair-checkbox');
      checkbox.checked = repairsState.selectedRepairs.has(repair);
      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) repairsState.selectedRepairs.add(repair);
        else repairsState.selectedRepairs.delete(repair);
      });
      repairsBody.appendChild(tr);
    });
    
    updatePaginationControls('repairs', repairsState.repairsPage, totalPages, repairs.length);
    
    // Ensure table constraints are maintained after render
    const tableScroll = $('#globalRepairsTable').closest('.table-scroll');
    if (tableScroll) {
      // Force the scroll container to maintain its constraints
      tableScroll.style.display = 'block';
      tableScroll.style.overflowX = 'auto';
      tableScroll.style.overflowY = 'auto';
      tableScroll.style.maxWidth = '100%';
      tableScroll.style.width = '100%';
      tableScroll.style.boxSizing = 'border-box';
    }
  }

  function renderMaintenanceTable() {
    const maintenanceBody = $('#globalMaintenanceBody');
    if (!maintenanceBody) return;
    
    const maintenance = repairsState.allRepairs.filter(r => r.type === 'Monitoring');
    const totalPages = Math.ceil(maintenance.length / repairsState.pageSize);
    const startIdx = (repairsState.maintenancePage - 1) * repairsState.pageSize;
    const endIdx = startIdx + repairsState.pageSize;
    const pageMaintenance = maintenance.slice(startIdx, endIdx);
    
    maintenanceBody.innerHTML = '';
    
    pageMaintenance.forEach((item, idx) => {
      const globalIdx = startIdx + idx;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" class="maintenance-checkbox" data-maintenance-id="${globalIdx}" /></td>
        <td>${esc(item.date || '')}</td>
        <td>${esc(item.station_id || '')}</td>
        <td>${esc(item.location || '')}</td>
        <td>${esc(item.assetType || '')}</td>
        <td>${esc(item.name || '')}</td>
        <td>${esc(item.severity || '')}</td>
        <td>${esc(item.priority || '')}</td>
        <td>${formatCost(item.cost)}</td>
        <td>${esc(item.category || '')}</td>
        <td>${esc(item.days || '')}</td>
      `;
      const checkbox = tr.querySelector('.maintenance-checkbox');
      checkbox.checked = repairsState.selectedMaintenance.has(item);
      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) repairsState.selectedMaintenance.add(item);
        else repairsState.selectedMaintenance.delete(item);
      });
      maintenanceBody.appendChild(tr);
    });
  
    updatePaginationControls('maintenance', repairsState.maintenancePage, totalPages, maintenance.length);
    
    // Ensure table constraints are maintained after render
    const tableScroll = $('#globalMaintenanceTable').closest('.table-scroll');
    if (tableScroll) {
      // Force the scroll container to maintain its constraints
      tableScroll.style.display = 'block';
      tableScroll.style.overflowX = 'auto';
      tableScroll.style.overflowY = 'auto';
      tableScroll.style.maxWidth = '100%';
      tableScroll.style.width = '100%';
      tableScroll.style.boxSizing = 'border-box';
    }
  }

  function updatePaginationControls(type, currentPage, totalPages, totalItems) {
    const tableId = type === 'repairs' ? 'globalRepairsTable' : 'globalMaintenanceTable';
    const table = $(`#${tableId}`);
    if (!table) return;
  
    // Find the panel container
    const panel = table.closest('.panel');
    if (!panel) return;

    // Remove existing pagination
    let paginationDiv = panel.querySelector('.pagination-controls');
    if (paginationDiv) paginationDiv.remove();
  
    // Create new pagination
    paginationDiv = document.createElement('div');
    paginationDiv.className = 'pagination-controls';
  
    const startItem = (currentPage - 1) * repairsState.pageSize + 1;
    const endItem = Math.min(currentPage * repairsState.pageSize, totalItems);
  
    paginationDiv.innerHTML = `
      <div class="pagination-info">
        Showing ${startItem}-${endItem} of ${totalItems} items
      </div>
      <div class="pagination-buttons">
        <button class="btn btn-ghost" id="${type}PrevPage" ${currentPage === 1 ? 'disabled' : ''}>← Previous</button>
        <span style="padding:0 12px;line-height:32px;font-size:13px;">Page ${currentPage} of ${totalPages || 1}</span>
        <button class="btn btn-ghost" id="${type}NextPage" ${currentPage >= totalPages ? 'disabled' : ''}>Next →</button>
      </div>
    `;
  
    // IMPORTANT: Insert pagination AFTER the table-scroll container, not after the panel
    const tableScroll = panel.querySelector('.table-scroll');
    if (tableScroll && tableScroll.nextSibling) {
      panel.insertBefore(paginationDiv, tableScroll.nextSibling);
    } else {
      panel.appendChild(paginationDiv);
    }
    
    // Force a reflow to ensure CSS is applied
    panel.offsetHeight;
    
    // Ensure table scroll container maintains its constraints
    if (tableScroll) {
      tableScroll.style.overflowX = 'auto';
      tableScroll.style.overflowY = 'auto';
      tableScroll.style.maxWidth = '100%';
      tableScroll.style.width = '100%';
    }
  
    // Wire up pagination buttons with null checks
    const prevBtn = $(`#${type}PrevPage`);
    const nextBtn = $(`#${type}NextPage`);
    
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (type === 'repairs') {
          repairsState.repairsPage = Math.max(1, repairsState.repairsPage - 1);
          renderRepairsTable();
        } else {
          repairsState.maintenancePage = Math.max(1, repairsState.maintenancePage - 1);
          renderMaintenanceTable();
        }
      });
    }
  
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (type === 'repairs') {
          repairsState.repairsPage = Math.min(totalPages, repairsState.repairsPage + 1);
          renderRepairsTable();
        } else {
          repairsState.maintenancePage = Math.min(totalPages, repairsState.maintenancePage + 1);
          renderMaintenanceTable();
        }
      });
    }
  }

  function formatCost(cost) {
    if (typeof cost === 'number' && Number.isFinite(cost)) {
      return `$${cost.toLocaleString()}`;
    }
    return String(cost || '—');
  }

  function openGlobalRepairModal() {
    const modal = $('#globalRepairModal');
    if (!modal) return;

    // Load stations list for validation
    window.electronAPI.getStationData({}).then(data => { stationsList = data || []; });
    
    // Get available filters from the tree
    const filterOptions = getFilteredAssetTypes();
    
    modal.innerHTML = `
      <div class="modal-content" style="max-width:680px;width:92%;">
        <h3 style="margin-top:0;">Add Repair/Maintenance</h3>
        <div class="form-grid" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
          <div class="form-row" style="grid-column: 1 / 4;">
            <label>Company</label>
            <select id="grCompany">
              <option value="">Select Company...</option>
              ${filterOptions.companies.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-row" style="grid-column: 1 / 4;">
            <label>Location</label>
            <select id="grLocation" disabled>
              <option value="">Select Company first...</option>
            </select>
          </div>
          <div class="form-row" style="grid-column: 1 / 4;">
            <label>Asset Type</label>
            <select id="grAssetType" disabled>
              <option value="">Select Location first...</option>
            </select>
          </div>
          <div class="form-row" style="grid-column: 1 / 4;">
            <label>Station ID *</label>
            <select id="grStationId" disabled>
              <option value="">Select Asset Type first...</option>
            </select>
          </div>
          <div class="form-row" style="grid-column: 1 / 4;">
            <label>Name *</label>
            <input id="grName" type="text" placeholder="Repair/Maintenance name" />
          </div>
          <div class="form-row">
            <label>Severity</label>
            <input id="grSeverity" type="text" placeholder="Low/Medium/High" />
          </div>
          <div class="form-row">
            <label>Priority</label>
            <input id="grPriority" type="text" placeholder="1-5" />
          </div>
          <div class="form-row">
            <label>Cost</label>
            <input id="grCost" type="text" placeholder="15000" />
          </div>
          <div class="form-row">
            <label>Days</label>
            <input id="grDays" type="text" placeholder="5" />
          </div>
          <div class="form-row">
            <label>Category</label>
            <select id="grCategory">
              <option value="Capital">Capital</option>
              <option value="O&M">O&M</option>
            </select>
          </div>
          <div class="form-row">
            <label>Type</label>
            <select id="grType">
              <option value="Repair">Repair</option>
              <option value="Monitoring">Monitoring</option>
            </select>
          </div>
        </div>
        <div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
          <button id="grCreate" class="btn btn-primary">Add</button>
          <button id="grCancel" class="btn btn-ghost">Cancel</button>
        </div>
      </div>
    `;
    
    modal.style.display = 'flex';
    
    // Wire up cascading dropdowns
    const companySelect = $('#grCompany');
    const locationSelect = $('#grLocation');
    const assetTypeSelect = $('#grAssetType');
    const stationSelect = $('#grStationId');
    
    companySelect.addEventListener('change', () => {
      const company = companySelect.value;
      locationSelect.innerHTML = '<option value="">Select Location...</option>';
      assetTypeSelect.innerHTML = '<option value="">Select Asset Type...</option>';
      assetTypeSelect.disabled = true;
      
      if (company) {
        const locations = filterOptions.locationsByCompany[company] || [];
        locations.forEach(loc => {
          const opt = document.createElement('option');
          opt.value = loc;
          opt.textContent = loc;
          locationSelect.appendChild(opt);
        });
        locationSelect.disabled = false;
      } else {
        locationSelect.disabled = true;
      }
    });
    
    locationSelect.addEventListener('change', () => {
      const location = locationSelect.value;
      assetTypeSelect.innerHTML = '<option value="">Select Asset Type...</option>';
      
      if (location) {
        const assetTypes = filterOptions.assetTypesByLocation[location] || [];
        assetTypes.forEach(at => {
          const opt = document.createElement('option');
          opt.value = at;
          opt.textContent = at;
          assetTypeSelect.appendChild(opt);
        });
        assetTypeSelect.disabled = false;
      } else {
        assetTypeSelect.disabled = true;
      }
    });

    assetTypeSelect.addEventListener('change', () => {
      const location = locationSelect.value;
      const assetType = assetTypeSelect.value;
      stationSelect.innerHTML = '<option value="">Select Station...</option>';
      
      if (location && assetType) {
        // Filter stations by location and asset type
        const validStations = stationsList.filter(s => 
          (s.location_file === location || s.province === location) && 
          s.asset_type === assetType
        );
        validStations.forEach(st => {
          const opt = document.createElement('option');
          // Store just the station ID as the value
          opt.value = String(st.station_id).trim();
          opt.textContent = `${st.station_id} - ${st.name || ''}`;
          stationSelect.appendChild(opt);
        });
        stationSelect.disabled = false;
      } else {
        stationSelect.disabled = true;
      }
    });
    
    // Wire up buttons
    $('#grCancel').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    
    $('#grCreate').addEventListener('click', async () => {
      const location = $('#grLocation').value;
      const assetType = $('#grAssetType').value;
      // Ensure we get just the station ID value, not the display text
      const stationId = String($('#grStationId').value).trim();
      const repair = {
        'Station ID': stationId,  // This must match what backend expects
        'station_id': stationId,  // Also include lowercase version for compatibility
        'Repair Name': $('#grName').value,  // Excel expects 'Repair Name'
        name: $('#grName').value,            // Keep for compatibility
        severity: $('#grSeverity').value,
        priority: $('#grPriority').value,
        cost: $('#grCost').value,
        category: $('#grCategory').value,
        type: $('#grType').value,
        days: $('#grDays').value
      };
      
      if (!location || !assetType || !stationId || !repair.name) {
        appAlert('Please fill in all required fields');
        return;
      }
      
      // Validate station exists
      const stationExists = stationsList.some(s => 
        s.station_id === stationId && 
        (s.location_file === location || s.province === location) &&
        s.asset_type === assetType
      );
      
      if (!stationExists) {
        appAlert('Invalid Station ID. Please select a valid station.');
        return;
      }
      
      // Get company from the selected company dropdown
      const company = $('#grCompany').value;
      
      // Call the correct IPC function with proper structure
      const result = await window.electronAPI.appendRepair({ company, location, assetType, repair });

      if (!result.success) {
        appAlert('Failed to add repair: ' + (result.message || 'Unknown error'));
        return;
      }
      modal.style.display = 'none';
      await loadRepairsData();
      // Trigger workplan refresh if it exists
      if (window.populateWorkplanFromRepairs) window.populateWorkplanFromRepairs();
    });
  }

  function getFilteredAssetTypes() {
    const tree = state.lookupTree;
    if (!tree) return { companies: [], locationsByCompany: {}, assetTypesByLocation: {} };

    // Build assetTypesByLocation from the company-scoped structure
    const assetTypesByLocation = {};
    const assetsByCoLoc = tree.assetsByCompanyLocation || {};
    
    for (const [company, locMap] of Object.entries(assetsByCoLoc)) {
      for (const [location, assetTypes] of Object.entries(locMap)) {
        if (!assetTypesByLocation[location]) {
          assetTypesByLocation[location] = new Set();
        }
        assetTypes.forEach(at => assetTypesByLocation[location].add(at));
      }
    }
    
    // Convert sets to arrays
    Object.keys(assetTypesByLocation).forEach(loc => {
      assetTypesByLocation[loc] = Array.from(assetTypesByLocation[loc]);
    });
    
    return {
      companies: tree.companies || [],
      locationsByCompany: tree.locationsByCompany || {},
      assetTypesByLocation
    };
  }

  async function resolveSelectedRepairs() {
    if (repairsState.selectedRepairs.size === 0 && repairsState.selectedMaintenance.size === 0) {
      appAlert('No items selected to resolve');
      return;
    }
    
    const confirmed = await appConfirm(`Are you sure you want to resolve ${repairsState.selectedRepairs.size + repairsState.selectedMaintenance.size} selected items? This will permanently delete them.`);
    if (!confirmed) return;
    
    // Group by station for efficient deletion
    const byStation = new Map();
    [...repairsState.selectedRepairs, ...repairsState.selectedMaintenance].forEach(repair => {
      const key = `${repair.location}||${repair.assetType}||${repair.station_id}`;
      if (!byStation.has(key)) byStation.set(key, []);
      byStation.get(key).push(repair);
    });
    
    // Delete from each station's repairs
    for (const [key, repairs] of byStation.entries()) {
      const [location, assetType, stationId] = key.split('||');
      // Get all repairs for this station
      const allStationRepairs = repairsState.allRepairs.filter(r => 
        r.location === location && 
        r.assetType === assetType && 
        r.station_id === stationId
      );
      // Filter out the selected ones
      const remaining = allStationRepairs.filter(r => !repairs.includes(r));
      // Save the remaining repairs
      await window.electronAPI.saveRepairs('', stationId, remaining);
    }
    
    await loadRepairsData();
    if (window.populateWorkplanFromRepairs) window.populateWorkplanFromRepairs();
  }  

  function wireSelectAllCheckboxes() {
    const selectAllRepairs = $('#selectAllRepairs');
    const selectAllMaintenance = $('#selectAllMaintenance');
    
    if (selectAllRepairs) {
      selectAllRepairs.addEventListener('change', (e) => {
        $$('.repair-checkbox').forEach(cb => {
          cb.checked = e.target.checked;
          cb.dispatchEvent(new Event('change'));
        });
      });
    }
    
    if (selectAllMaintenance) {
      selectAllMaintenance.addEventListener('change', (e) => {
        $$('.maintenance-checkbox').forEach(cb => {
          cb.checked = e.target.checked;
          cb.dispatchEvent(new Event('change'));
        });
      });
    }
  }

  // ---- Tabs ----------------------------------------------------------------

  function bindTabs() {
    const tabOverview = $('#tabOverview');
    const tabAnalytics = $('#tabAnalytics');
    const tabRepairs = $('#tabRepairs');
    const paneOverview = $('#overviewTab');
    const paneAnalytics = $('#analyticsTab');
    const paneRepairs = $('#repairsTab');

    tabOverview.addEventListener('click', () => {
      tabOverview.classList.add('active');
      tabAnalytics.classList.remove('active');
      tabRepairs.classList.remove('active');
      paneOverview.style.display = '';
      paneAnalytics.style.display = 'none';
      paneRepairs.style.display = 'none';
    });

    tabAnalytics.addEventListener('click', () => {
      tabAnalytics.classList.add('active');
      tabOverview.classList.remove('active');
      tabRepairs.classList.remove('active');
      paneAnalytics.style.display = '';
      paneOverview.style.display = 'none';
      paneRepairs.style.display = 'none';
    });

    tabRepairs.addEventListener('click', async () => {
      tabRepairs.classList.add('active');
      tabOverview.classList.remove('active');
      tabAnalytics.classList.remove('active');
      paneRepairs.style.display = '';
      paneOverview.style.display = 'none';
      paneAnalytics.style.display = 'none';
      await loadRepairsData();
      wireSelectAllCheckboxes();
    });

  }

  // ---- Initialization -------------------------------------------------------

  async function refreshStatisticsView() {
    // If the stats DOM isn't loaded yet, skip silently (caller-safe).
    if (!hasStatsDOM()) return;
    try {
      const [rows, tree] = await Promise.all([
        window.electronAPI.getStationData({}),
        window.electronAPI.getLookupTree()
      ]);
      state.allStations = Array.isArray(rows) ? rows : [];
      state.lookupTree = tree || { companies: [], locationsByCompany: {} };
    } catch (e) {
      console.error('[statistics] refresh failed', e);
      state.allStations = [];
      state.lookupTree = { companies: [], locationsByCompany: {} };
    }
    // Re-render everything
    renderOverview();           // Overview = unfiltered
    applyAnalyticsFilters();    // Analytics = filtered
    state.cards.forEach(c => c.update());
  }
  // Expose globally so other flows can poke it after imports/adds
  window.refreshStatisticsView = refreshStatisticsView;

  async function initStatisticsView() {
    if (state.initialized) {
      // If already initialized and the DOM is present, just refresh data.
      await refreshStatisticsView();
      return;
    }
    state.initialized = true;

    bindTabs();

    // Wire up repairs buttons
    const btnAddRepair = $('#btnAddGlobalRepair');
    if (btnAddRepair) {
      btnAddRepair.addEventListener('click', openGlobalRepairModal);
    }

    const btnResolve = $('#btnResolveRepairs');
    if (btnResolve) {
      btnResolve.addEventListener('click', resolveSelectedRepairs);
    }

    // Wire + Add Statistic
    const addBtn = $('#btnAddStat');
    if (addBtn) {
      addBtn.addEventListener('click', (e) => openAddStatMenu(addBtn));
    }

    // First data load + paint
    await refreshStatisticsView();

    // Listen to filter changes
    const filterTree = $('#filterTree');
    if (filterTree) {
      filterTree.addEventListener('change', onFiltersChanged);
    }

    // Recompute on resize (charts)
    window.addEventListener('resize', () => {
      state.cards.forEach(c => c.update());
    });
  }

  // Expose init for index loader
  window.initStatisticsView = initStatisticsView;
})();
