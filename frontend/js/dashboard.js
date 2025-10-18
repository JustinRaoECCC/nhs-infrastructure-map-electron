// frontend/js/dashboard.js
(function () {
  'use strict';

  // === DASHBOARD (Statistics/Repairs) ===
  // ---- Helpers -------------------------------------------------------------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const hasStatsDOM = () => !!document.getElementById('statisticsPage');

  const getFieldValue = (row, fieldName) => {
    // Finds "Inspection Frequency" or any "Section Inspection Frequency" etc., case-insensitive
    const target = String(fieldName).toLowerCase();
    for (const k of Object.keys(row || {})) {
      if (!k) continue;
      if (String(k).toLowerCase() === target) return row[k];
    }
    for (const k of Object.keys(row || {})) {
      if (k.includes(' ')) {
        const parts = k.split(' ');
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
    closeBtn.textContent = '';
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
      <div class="hint">Looks for a column named Inspection Frequency (any section).</div>
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
      <div class="result"><strong>Stations in circle:</strong> <span class="out"></span></div>
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
        out.textContent = '';
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
      out.textContent = '';
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
    // virtualization (no paging)
    _vtRepairs: null,
    _vtMaintenance: null
  };
  let stationsList = [];

  async function loadRepairsData() {
    try {
      const repairs = await window.electronAPI.getAllRepairs();
      repairsState.allRepairs = Array.isArray(repairs) ? repairs : [];
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

  // ===== Virtualized table helper (windowing) =====
  // Use global helper from add_infra.js if present; otherwise define a local copy.
  const mountVirtualizedTable = window.mountVirtualizedTable || (function () {
    return function mountVirtualizedTable({
      rows,
      tbody,
      renderRowHTML,
      rowHeight = 44,
      overscan = 10,
      adaptiveHeight = true,
      maxViewport = 520,
      minViewport = 0
    }) {
      const topSpacer = document.createElement('tr');
      const bottomSpacer = document.createElement('tr');
      topSpacer.innerHTML = `<td colspan="999" style="height:0;padding:0;border:0"></td>`;
      bottomSpacer.innerHTML = `<td colspan="999" style="height:0;padding:0;border:0"></td>`;

      tbody.innerHTML = '';
      tbody.appendChild(topSpacer);
      tbody.appendChild(bottomSpacer);

      const scroller = tbody.closest('.table-scroll') || tbody.parentElement;
      let start = 0, end = 0, rafId = 0;

      const recompute = () => {
        rafId = 0;
        if (topSpacer.parentNode !== tbody || bottomSpacer.parentNode !== tbody) {
          tbody.innerHTML = '';
          tbody.appendChild(topSpacer);
          tbody.appendChild(bottomSpacer);
        }
        if (adaptiveHeight) {
          const table = tbody.closest('table');
          const headH = (table && table.tHead) ? (table.tHead.offsetHeight || 0) : 0;
          const total = rows.length;
          const bodyH = Math.max(0, total) * rowHeight;
          const needed = headH + bodyH;
          const target = Math.max(minViewport, Math.min(maxViewport, needed));
          scroller.style.height = target + 'px';
          scroller.style.overflowY = 'auto';
          scroller.style.position = scroller.style.position || 'relative';
        }

        const viewH = scroller.clientHeight || 400;
        const scrollTop = scroller.scrollTop | 0;
        const total = rows.length;
        const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
        const last  = Math.min(total, Math.ceil((scrollTop + viewH) / rowHeight) + overscan);
        if (first === start && last === end) return;
        start = first; end = last;

        topSpacer.firstElementChild.style.height = (start * rowHeight) + 'px';
        bottomSpacer.firstElementChild.style.height = ((rows.length - end) * rowHeight) + 'px';

        while (topSpacer.nextSibling && topSpacer.nextSibling !== bottomSpacer) {
          tbody.removeChild(topSpacer.nextSibling);
        }
        const frag = document.createDocumentFragment();
        for (let i = start; i < end; i++) {
          const tr = document.createElement('tr');
          tr.dataset.index = i;
          tr.innerHTML = renderRowHTML(rows[i], i);
          frag.appendChild(tr);
        }
        tbody.insertBefore(frag, bottomSpacer);
      };
      const onScroll = () => { if (!rafId) rafId = requestAnimationFrame(recompute); };
      scroller.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll);
      recompute();
      requestAnimationFrame(recompute);
      setTimeout(recompute, 0);

      return {
        update(newRows) { rows = newRows || []; start = -1; end = -1; recompute(); requestAnimationFrame(recompute); },
        refresh() { recompute(); },
        destroy() {
          scroller.removeEventListener('scroll', onScroll);
          window.removeEventListener('resize', onScroll);
          if (rafId) cancelAnimationFrame(rafId);
          if (adaptiveHeight) scroller.style.height = '';
        }
      };
    };
  })();

  // Helpers to compute current filtered lists for each table (no paging)
  function _rowsRepairs() {
    return repairsState.allRepairs.filter(r => r.type !== 'Monitoring');
  }
  function _rowsMaintenance() {
    return repairsState.allRepairs.filter(r => r.type === 'Monitoring');
  }
  function _setTriState(headerCheckbox, selectedSize, total) {
    if (!headerCheckbox) return;
    headerCheckbox.indeterminate = selectedSize > 0 && selectedSize < total;
    headerCheckbox.checked = total > 0 && selectedSize === total;
  }

  // Virtualized renderers
  function renderRepairsTable() {
    const repairsBody = $('#globalRepairsBody');
    if (!repairsBody) return;
    
    const repairs = _rowsRepairs();

    // Render slice via virtualizer
    const renderRowHTML = (repair, i) => {
      const checked = repairsState.selectedRepairs.has(repair) ? 'checked' : '';
      return `
        <td><input type="checkbox" class="repair-checkbox" ${checked}></td>
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
    };

    if (!repairsState._vtRepairs) {
      repairsState._vtRepairs = mountVirtualizedTable({
        rows: repairs,
        tbody: repairsBody,
        renderRowHTML,
        rowHeight: 44,
        overscan: 10,
        adaptiveHeight: true,
        maxViewport: 520,
        minViewport: 0
      });
      // delegate selection via event on tbody
      repairsBody.addEventListener('change', (e) => {
        const t = e.target;
        if (!(t instanceof HTMLInputElement) || !t.classList.contains('repair-checkbox')) return;
        const tr = t.closest('tr'); if (!tr) return;
        const idx = Number(tr.dataset.index); if (Number.isNaN(idx)) return;
        const item = _rowsRepairs()[idx];
        if (!item) return;
        if (t.checked) repairsState.selectedRepairs.add(item); else repairsState.selectedRepairs.delete(item);
        // update header tri-state
        _setTriState($('#selectAllRepairs'), repairsState.selectedRepairs.size, _rowsRepairs().length);
      });
    } else {
      repairsState._vtRepairs.update(repairs);
    }
    // Keep scroller constraints tidy
    const tableScroll = $('#globalRepairsTable')?.closest('.table-scroll');
    if (tableScroll) { tableScroll.style.display = 'block'; tableScroll.style.overflowX = 'auto'; tableScroll.style.overflowY = 'auto'; tableScroll.style.boxSizing = 'border-box'; }
    // update tri-state each render
    _setTriState($('#selectAllRepairs'), repairsState.selectedRepairs.size, repairs.length);
  }

  function renderMaintenanceTable() {
    const maintenanceBody = $('#globalMaintenanceBody');
    if (!maintenanceBody) return;
   
    const maintenance = _rowsMaintenance();

    const renderRowHTML = (item, i) => {
      const checked = repairsState.selectedMaintenance.has(item) ? 'checked' : '';
      return `
        <td><input type="checkbox" class="maintenance-checkbox" ${checked}></td>
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
    };

    if (!repairsState._vtMaintenance) {
      repairsState._vtMaintenance = mountVirtualizedTable({
        rows: maintenance,
        tbody: maintenanceBody,
        renderRowHTML,
        rowHeight: 44,
        overscan: 10,
        adaptiveHeight: true,
        maxViewport: 520,
        minViewport: 0
      });
      maintenanceBody.addEventListener('change', (e) => {
        const t = e.target;
        if (!(t instanceof HTMLInputElement) || !t.classList.contains('maintenance-checkbox')) return;
        const tr = t.closest('tr'); if (!tr) return;
        const idx = Number(tr.dataset.index); if (Number.isNaN(idx)) return;
        const item = _rowsMaintenance()[idx];
        if (!item) return;
        if (t.checked) repairsState.selectedMaintenance.add(item); else repairsState.selectedMaintenance.delete(item);
        _setTriState($('#selectAllMaintenance'), repairsState.selectedMaintenance.size, _rowsMaintenance().length);
      });
    } else {
      repairsState._vtMaintenance.update(maintenance);
    }
    const tableScroll = $('#globalMaintenanceTable')?.closest('.table-scroll');
    if (tableScroll) { tableScroll.style.display = 'block'; tableScroll.style.overflowX = 'auto'; tableScroll.style.overflowY = 'auto'; tableScroll.style.boxSizing = 'border-box'; }
    _setTriState($('#selectAllMaintenance'), repairsState.selectedMaintenance.size, maintenance.length);
  }

  function formatCost(cost) {
    if (typeof cost === 'number' && Number.isFinite(cost)) {
      return `$${cost.toLocaleString()}`;
    }
    return String(cost || '');
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
            <div style="position:relative;">
              <input id="grStationId" type="text" placeholder="Type to search..." disabled autocomplete="off" />
              <div id="grStationDropdown" class="station-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;max-height:200px;overflow-y:auto;background:#fff;border:1px solid #ddd;border-top:none;z-index:1000;"></div>
            </div>
          </div>
          <input type="hidden" id="grStationIdValue" />
          <input type="hidden" id="grStationName" />
          <input type="hidden" id="grStationLocation" />
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
              <option value="Decommission">Decommission</option>
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
    const stationInput = $('#grStationId');
    const stationDropdown = $('#grStationDropdown');
    const stationIdValue = $('#grStationIdValue');
    let availableStations = [];
    
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
      stationInput.value = '';
      stationIdValue.value = '';
      stationDropdown.innerHTML = '';
      stationDropdown.style.display = 'none';
      
      if (location && assetType) {
        // Filter stations by location and asset type
        availableStations = stationsList.filter(s =>
          (s.location_file === location || s.province === location) && 
          s.asset_type === assetType
        );
        stationInput.disabled = false;
        stationInput.placeholder = 'Type to search stations...';
      } else {
        availableStations = [];
        stationInput.disabled = true;
        stationInput.placeholder = 'Select Asset Type first...';
      }
    });

    // Filter stations as user types
    stationInput.addEventListener('input', () => {
      const searchTerm = stationInput.value.toLowerCase().trim();
      stationDropdown.innerHTML = '';
      
      if (!searchTerm || availableStations.length === 0) {
        stationDropdown.style.display = 'none';
        return;
      }
      
      const filtered = availableStations.filter(st => {
        const stationId = String(st.station_id).toLowerCase();
        const stationName = String(st.name || '').toLowerCase();
        return stationId.includes(searchTerm) || stationName.includes(searchTerm);
      });
      
      if (filtered.length === 0) {
        stationDropdown.innerHTML = '<div style="padding:8px;color:#666;">No matching stations</div>';
        stationDropdown.style.display = 'block';
        return;
      }
      
      filtered.forEach(st => {
        const item = document.createElement('div');
        item.style.cssText = 'padding:8px;cursor:pointer;border-bottom:1px solid #f0f0f0;';
        item.textContent = `${st.station_id} - ${st.name || ''}`;
        item.addEventListener('mouseenter', () => {
          item.style.backgroundColor = '#f5f5f5';
        });
        item.addEventListener('mouseleave', () => {
          item.style.backgroundColor = '';
        });
        item.addEventListener('click', () => {
          stationInput.value = `${st.station_id} - ${st.name || ''}`;
          stationIdValue.value = String(st.station_id).trim();
          stationDropdown.style.display = 'none';
        });
        stationDropdown.appendChild(item);
      });
      
      stationDropdown.style.display = 'block';
    });
    
    // Close dropdown when clicking outside
    const closeDropdown = (e) => {
      if (!stationInput.contains(e.target) && !stationDropdown.contains(e.target)) {
        stationDropdown.style.display = 'none';
      }
    };
    document.addEventListener('click', closeDropdown);
    
    // Show all stations when focusing empty input
    stationInput.addEventListener('focus', () => {
      if (!stationInput.value && availableStations.length > 0) {
        stationInput.dispatchEvent(new Event('input'));
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
      const stationId = String($('#grStationIdValue').value).trim();
      const repair = {
        'Station ID': stationId,  // This must match what backend expects
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
        const rows = _rowsRepairs();
        if (e.target.checked) {
          repairsState.selectedRepairs = new Set(rows);
        } else {
          repairsState.selectedRepairs.clear();
        }
        // refresh virtual view + tri-state
        repairsState._vtRepairs?.refresh();
        _setTriState(selectAllRepairs, repairsState.selectedRepairs.size, rows.length);
      });
    }
    
    if (selectAllMaintenance) {
      selectAllMaintenance.addEventListener('change', (e) => {
        const rows = _rowsMaintenance();
        if (e.target.checked) {
          repairsState.selectedMaintenance = new Set(rows);
        } else {
          repairsState.selectedMaintenance.clear();
        }
        repairsState._vtMaintenance?.refresh();
        _setTriState(selectAllMaintenance, repairsState.selectedMaintenance.size, rows.length);
      });
    }
    // Ensure initial tri-state is correct when wiring
    _setTriState(selectAllRepairs, repairsState.selectedRepairs.size, _rowsRepairs().length);
    _setTriState(selectAllMaintenance, repairsState.selectedMaintenance.size, _rowsMaintenance().length);
  }

  // ---- Import Repairs from Excel -----------------------------------------------

  // === Import overlay (green progress bar) ======================================
  // Reuses the same CSS classes the Excel boot overlay uses: .boot-overlay,
  // .boot-card, .boot-title, .boot-status, .boot-bar, .boot-bar-fill, .boot-hidden
  function ensureRepairsProgressOverlay() {
    let overlay = document.getElementById('repairsBootOverlay');
    if (overlay) {
      const fill = overlay.querySelector('#repairsBootFill');
      const text = overlay.querySelector('#repairsBootText');
      return { overlay, fill, text };
    }
    overlay = document.createElement('div');
    overlay.id = 'repairsBootOverlay';
    overlay.className = 'boot-overlay boot-hidden';
    overlay.innerHTML = `
      <div class="boot-card">
        <div class="boot-title">Importing repairs…</div>
        <div id="repairsBootText" class="boot-status">Starting…</div>
        <div class="boot-bar"><div id="repairsBootFill" class="boot-bar-fill" style="width:0%"></div></div>
      </div>
    `;
    document.body.appendChild(overlay);
    const fill = overlay.querySelector('#repairsBootFill');
    const text = overlay.querySelector('#repairsBootText');
    return { overlay, fill, text };
  }

  function showRepairsProgress(pct = 5, msg = 'Preparing import…') {
    const { overlay } = ensureRepairsProgressOverlay();
    overlay.classList.remove('boot-hidden');
    overlay.style.display = 'flex';
    updateRepairsProgress(pct, msg);
  }

  function updateRepairsProgress(pct, msg) {
    const { fill, text } = ensureRepairsProgressOverlay();
    const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
    fill.style.width = clamped + '%';
    text.textContent = msg || 'Importing…';
  }

  function hideRepairsProgress(finalMsg) {
    if (finalMsg) updateRepairsProgress(100, finalMsg);
    const { overlay } = ensureRepairsProgressOverlay();
    // small delay for a smooth finish, matches your boot overlay behavior
    setTimeout(() => {
      overlay.classList.add('boot-hidden');
    }, 250);
  }
  // ==============================================================================

  // detect whether the uploaded sheet includes a given column header
  // Usage: rowsHaveColumn(result.rows, ['Type', 'Repair/Maintenance', 'Work Type'])
  function rowsHaveColumn(rows, candidates) {
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+|[_()-]/g, '');
    const targets = new Set((candidates || []).map(norm));
    for (const r of rows || []) {
      for (const k of Object.keys(r || {})) {
        if (targets.has(norm(k))) {
          return true;
        }
      }
    }
    return false;
  }

  async function openImportRepairsModal() {
    const modal = $('#importRepairsModal');
    if (!modal) return;

    // Load stations list first to ensure we have the data
    stationsList = await window.electronAPI.getStationData({}) || [];

    modal.innerHTML = `
      <div class="modal-content" style="max-width:680px;width:92%;">
        <h3 style="margin-top:0;">Import Repairs from Excel</h3>
        <div class="form-row">
          <label>Select Excel File</label>
          <input type="file" id="irFileInput" accept=".xlsx,.xls" />
        </div>
        <div id="irPreview" style="display:none;margin-top:16px;">
          <div style="margin-bottom:8px;"><strong>Preview:</strong> <span id="irCount"></span> repairs found</div>
          <div id="irMissingFields" style="display:none;margin-bottom:12px;padding:8px;background:#fff3cd;border:1px solid #ffc107;border-radius:4px;">
            <strong>Some repairs are missing required fields</strong>
            <div style="margin-top:4px;font-size:0.9em;">You'll be prompted to fill in missing information after import.</div>
          </div>
        </div>
        <div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
          <button id="irImport" class="btn btn-primary" disabled>Import</button>
          <button id="irCancel" class="btn btn-ghost">Cancel</button>
        </div>
      </div>
    `;

    modal.style.display = 'flex';

    const fileInput = $('#irFileInput');
    const preview = $('#irPreview');
    const countSpan = $('#irCount');
    const missingDiv = $('#irMissingFields');
    const importBtn = $('#irImport');
    const cancelBtn = $('#irCancel');

    let parsedRepairs = [];

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const b64 = await fileToBase64(file);

        // If workbook has multiple sheets, allow selecting which one to import
        const sheetsResp = await window.electronAPI.excelListSheets(b64).catch(() => ({ success:false, sheets:[] }));
        let sheetName = null;
        if (sheetsResp && Array.isArray(sheetsResp.sheets) && sheetsResp.sheets.length) {
          // Prefer a sheet that looks like repairs if present
          sheetName = sheetsResp.sheets.find(s => /repair/i.test(s)) || sheetsResp.sheets[0];

          // Inject/select sheet picker dynamically
          let sheetPicker = document.getElementById('irSheetSelect');
          if (!sheetPicker) {
            const pickerWrap = document.createElement('div');
            pickerWrap.className = 'form-row';
            pickerWrap.innerHTML = `
              <label>Sheet</label>
              <select id="irSheetSelect"></select>
            `;
            fileInput.closest('.form-row').after(pickerWrap);
            sheetPicker = pickerWrap.querySelector('#irSheetSelect');
          }
          sheetPicker.innerHTML = sheetsResp.sheets.map(s => `<option value="${esc(s)}" ${s===sheetName?'selected':''}>${esc(s)}</option>`).join('');
          sheetPicker.onchange = async () => {
            const sel = sheetPicker.value;
            await parseAndPreview(b64, sel);
          };
        }

        await parseAndPreview(b64, sheetName);

      } catch (err) {
        console.error('[importRepairs] parse failed:', err);
        appAlert('Failed to parse Excel file: ' + err.message);
      }
    });

    async function parseAndPreview(b64, sheetName) {
      const result = sheetName
        ? await window.electronAPI.excelParseRowsFromSheet(b64, sheetName)
        : await window.electronAPI.importRepairsExcel(b64);

      if (!result.success || !result.rows || result.rows.length === 0) {
        appAlert('No data found in the selected sheet');
        return;
      }

      // NEW: detect if the sheet actually contains a "Type" column (or aliases)
      const hasTypeColumn = rowsHaveColumn(result.rows, ['Type', 'Repair/Maintenance', 'Work Type']);

      // Map column headers to standardized field names.
      // If there is NO Type column at all, leave type blank so the missing-fields modal
      // prompts per row (with "Apply to all remaining" available).
      parsedRepairs = result.rows.map(row =>
        mapRepairFields(row, { noTypeColumn: !hasTypeColumn })
      );

      // Check for missing fields (required ones)
      const hasMissing = parsedRepairs.some(r => !r.stationId || !r.name);

      countSpan.textContent = parsedRepairs.length;
      preview.style.display = 'block';
      missingDiv.style.display = hasMissing ? 'block' : 'none';
      importBtn.disabled = false;
    }

    importBtn.addEventListener('click', async () => {
      if (parsedRepairs.length === 0) return;

      modal.style.display = 'none';

      const errors = [];
      const REQUIRED_KEYS = ['stationId', 'name'];
      const OPTIONAL_KEYS = ['category', 'type', 'severity', 'priority', 'cost', 'days'];
      const ALL_KEYS = [...REQUIRED_KEYS, ...OPTIONAL_KEYS];
      // Type is per-item; can bulk-apply in prompt similarly to Category
      

      // Split into "needs prompting" vs "already complete"
      const toPrompt = [];
      const ready = [];
      for (const r of parsedRepairs) {
        const missingAny = ALL_KEYS.some(k => !String(r[k] ?? '').trim());
        if (missingAny) toPrompt.push(r); else ready.push(r);
      }

      // Ask user to fill anything missing (including Category/Type/etc.)
      if (toPrompt.length) {
        await promptForMissingFields(toPrompt); // <- updated function below
      }

      // Validate & build final lists (after prompting)
      const complete = [];
      const incomplete = [];

      for (const repair of [...ready, ...toPrompt]) {
        if (REQUIRED_KEYS.every(k => String(repair[k] ?? '').trim())) {
          const station = stationsList.find(s =>
            String(s.station_id).trim().toLowerCase() === String(repair.stationId).trim().toLowerCase()
          );

          if (!station) {
            errors.push(`Station ID "${repair.stationId}" not found in system`);
          } else if (!station.company) {
            errors.push(`Station "${repair.stationId}" is missing company information`);
          } else {
            complete.push(repair);
          }
        } else {
          // still missing required bits
          incomplete.push(repair);
        }
      }

      if (errors.length > 0) {
        await appAlert(`Could not import ${errors.length} repair(s):\n\n${
          errors.slice(0, 5).join('\n')
        }${errors.length > 5 ? '\n...' : ''}`);
      }

      // Import with progress overlay for large jobs
      let successCount = 0;
      let failCount = 0;
      const failReasons = [];

      showRepairsProgress(5, 'Importing repairs…');
      try {
        // Phase A: import "complete" set
        const totalA = complete.length;
        for (let i = 0; i < totalA; i++) {
          const repair = complete[i];
          const res = await importSingleRepair(repair);
          if (res && res.success) successCount++; else { failCount++; failReasons.push(`${repair.stationId}: ${res?.message || 'Unknown error'}`); }
          const pct = 5 + Math.round(((i + 1) / Math.max(1, totalA)) * 55); // 5% -> 60%
          updateRepairsProgress(pct, `Importing repairs… (${i + 1}/${totalA})`);
        }

        // Phase B: handle previously incomplete entries (prompt already done earlier)
        let secondPass = [];
        if (incomplete.length > 0) {
          await promptForMissingFields(incomplete);
          secondPass = incomplete.filter(r => REQUIRED_KEYS.every(k => String(r[k] ?? '').trim()));
          const totalB = secondPass.length;
          for (let i = 0; i < totalB; i++) {
            const repair = secondPass[i];
            const res = await importSingleRepair(repair);
            if (res && res.success) successCount++; else { failCount++; failReasons.push(`${repair.stationId}: ${res?.message || 'Unknown error'}`); }
            const pct = 60 + Math.round(((i + 1) / Math.max(1, totalB)) * 20); // 60% -> 80%
            updateRepairsProgress(pct, `Importing remaining… (${i + 1}/${totalB})`);
          }
        }

        // Phase C: refresh data & UI
        updateRepairsProgress(82, 'Refreshing tables…');
        await loadRepairsData();
        updateRepairsProgress(90, 'Updating workplan…');
        if (window.populateWorkplanFromRepairs) window.populateWorkplanFromRepairs();
        updateRepairsProgress(96, 'Finalizing…');
      } catch (e) {
        console.error('[importRepairs] progress import failed:', e);
        failCount += 1;
        failReasons.push(`Import aborted: ${String(e)}`);
      } finally {
        hideRepairsProgress('Done');
      }

      await loadRepairsData();
      if (window.populateWorkplanFromRepairs) window.populateWorkplanFromRepairs();

      let message = `Import complete!\n\nSuccessfully imported: ${successCount}`;
      if (failCount > 0) {
        message += `\nFailed: ${failCount}`;
        if (failReasons.length > 0) {
          message += `\n\nFailure reasons:\n${failReasons.slice(0, 3).join('\n')}${failReasons.length > 3 ? '\n...' : ''}`;
        }
      }
      appAlert(message);
    });

    cancelBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  // Map various column header names to standardized field names
  function mapRepairFields(row, opts = {}) {
    const noTypeColumn = !!opts.noTypeColumn;

    const mapped = {
      stationId: pickField(row, ['Station Number', 'Site Number', 'Station ID', 'Site ID', 'ID']),
      date:      pickField(row, ['Date']),
      name:      pickField(row, ['Repair Name', 'Tasks', 'Name']),
      severity:  pickField(row, ['Severity Ranking', 'Risk Ranking', 'Severity']),
      priority:  pickField(row, ['Priority Ranking', 'Priority']),
      cost:      pickField(row, ['Repair Cost (K)', 'Repair Cost', 'Cost']),
      days:      pickField(row, ['Days', 'Work Days']),
      category:  pickField(row, ['Category', 'Funding Type']),
      assetType: pickField(row, ['Asset Type', 'Infrastructure Type']),
      // NEW: If there is NO Type column in the sheet, leave blank to force a per-row prompt.
      // If a Type column exists but the cell is blank, default to "Repair" (previous behavior).
      type:      (function () {
        const raw = (pickField(row, ['Type', 'Repair/Maintenance', 'Work Type', 'Scope Type']) || '').trim();
        if (!raw) return noTypeColumn ? '' : 'Repair';
        const t = raw.toLowerCase();
        // Normalize common inputs
        if (/(maintain|monitor)/.test(t)) return 'Monitoring'; // "Maintenance" -> "Monitoring" in app
        return 'Repair';
      })()
    };

    // Normalize common cost input formats without destroying ranges like "10-20" or "<2"
    if (mapped.cost) {
      const v = String(mapped.cost).trim();
      // e.g., 12K or 12k -> 12000
      const kMatch = v.match(/^\$?\s*([0-9]+(?:\.[0-9]+)?)\s*[kK]\s*$/);
      if (kMatch) {
        const n = parseFloat(kMatch[1]);
        if (Number.isFinite(n)) mapped.cost = Math.round(n * 1000);
      }
    }

    return mapped;
  }

  // Helper to pick first non-empty value from multiple possible field names
  function pickField(row, candidates) {
    // Robust lookup: case-insensitive and supports composite keys (Section Field)
    for (const name of candidates) {
      const v = getFieldValue(row, name);
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    // Fallback: try loose matching by normalized key
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+|[_()-]/g, '');
    const keys = Object.keys(row || {});
    for (const name of candidates) {
      const target = norm(name);
      for (const k of keys) {
        if (norm(k) === target && String(row[k] ?? '').trim() !== '') return String(row[k]).trim();
      }
    }
    // Additional exact match pass (case-sensitive) for specific headers
    for (const name of candidates) {
      if (row[name] !== undefined && row[name] !== null && String(row[name]).trim() !== '') {
        return String(row[name]).trim();
      }
    }
    return '';
  }

  // Prompt user to fill in missing fields for repairs
  async function promptForMissingFields(repairs) {
    const FIELD_DEFS = [
      { key: 'stationId', label: 'Station ID *', type: 'text', required: true },
      { key: 'name',      label: 'Repair Name *', type: 'text', required: true },
      { key: 'category',  label: 'Category',      type: 'select', options: ['Capital', 'O&M', 'Decommission'] },
      { key: 'type',      label: 'Type',          type: 'select', options: ['Repair', 'Monitoring'] },
      { key: 'assetType', label: 'Asset Type',    type: 'select-dynamic' },
      { key: 'severity',  label: 'Severity',      type: 'text' },
      { key: 'priority',  label: 'Priority',      type: 'text' },
      { key: 'cost',      label: 'Cost',          type: 'number' },
      { key: 'days',      label: 'Days',          type: 'number' }
    ];

    const getMissingKeys = (r) =>
      FIELD_DEFS.filter(f => !String(r[f.key] ?? '').trim()).map(f => f.key);

    for (let i = 0; i < repairs.length; i++) {
      const repair = repairs[i];
      const missing = getMissingKeys(repair);
      if (missing.length === 0) continue;

      const modal = $('#missingFieldsModal');
      if (!modal) continue;

      const rowHTML = (f) => {
        if (f.type === 'select') {
          const id = `mf_${f.key}`;
          const applyAllId = `mf_${f.key}_all`;
          const applyAllHtml = (f.key === 'category' || f.key === 'type' || f.key === 'assetType')
            ? `<label style="margin-left:8px;font-size:0.9em;">
                <input id="${applyAllId}" type="checkbox"> Apply to all remaining missing
              </label>`
            : '';
          return `
            <div class="form-row">
              <label>${f.label}</label>
              <select id="${id}">
                <option value="">Select</option>
                ${f.options.map(o => `<option value="${o}">${o}</option>`).join('')}
              </select>
              ${applyAllHtml}
            </div>
          `;
        }
        if (f.type === 'select-dynamic') {
          const id = `mf_${f.key}`;
          const sid = String(repair.stationId || '').trim();
          const ats = Array.from(new Set((stationsList || [])
            .filter(s => String(s.station_id).trim().toLowerCase() === sid.toLowerCase())
            .map(s => String(s.asset_type || '').trim())
            .filter(Boolean)));
          const optionsHtml = ats.map(o => `<option value="${o}">${o}</option>`).join('');
          const header = ats.length ? 'Select' : 'None available';
          const note = ats.length ? '' : '<div class="hint" style="font-size:0.85em;opacity:.75;">No known asset types for this Station ID in data.</div>';
          const applyAllIdDyn = `mf_${f.key}_all`;
          const applyAllHtmlDyn = `<label style="margin-left:8px;font-size:0.9em;"><input id="${applyAllIdDyn}" type="checkbox"> Apply to all remaining missing</label>`;
          return `
            <div class="form-row">
              <label>${f.label}</label>
              <select id="${id}">
                <option value="">${header}</option>
                ${optionsHtml}
              </select>
              ${applyAllHtmlDyn}
              ${note}
            </div>
          `;
        }
        const id = `mf_${f.key}`;
        const step = f.type === 'number' ? ` step="1"` : '';
        const ph  = f.type === 'number' ? '0' : '';
        return `
          <div class="form-row">
            <label>${f.label}</label>
            <input id="${id}" type="${f.type === 'number' ? 'number' : 'text'}" placeholder="${ph}" ${step} />
          </div>
        `;
      };

      const currentDataHtml = `
        ${repair.name ? `Name: ${esc(repair.name)}<br>` : ''}
        ${repair.stationId ? `Station ID: ${esc(repair.stationId)}<br>` : ''}
        ${repair.category ? `Category: ${esc(repair.category)}<br>` : ''}
        ${repair.type ? `Type: ${esc(repair.type)}<br>` : ''}
        ${repair.severity ? `Severity: ${esc(repair.severity)}<br>` : ''}
        ${repair.priority ? `Priority: ${esc(repair.priority)}<br>` : ''}
        ${repair.cost ? `Cost: ${esc(repair.cost)}<br>` : ''}
        ${repair.days ? `Days: ${esc(repair.days)}<br>` : ''}
      `;

      modal.innerHTML = `
        <div class="modal-content" style="max-width:520px;width:92%;">
          <h3 style="margin-top:0;">Missing Information (${i + 1}/${repairs.length})</h3>
          <div style="margin-bottom:12px;padding:8px;background:#f8f9fa;border-radius:4px;">
            <div><strong>Current repair data:</strong></div>
            <div style="margin-top:4px;font-size:0.9em;">${currentDataHtml || '(empty)'}</div>
          </div>
          <div class="form-grid" style="display:grid;gap:10px;">
            ${FIELD_DEFS.filter(f => missing.includes(f.key)).map(rowHTML).join('')}
          </div>
          <div class="modal-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
            <button id="mfSave" class="btn btn-primary">Save & Continue</button>
            <button id="mfSkip" class="btn btn-ghost">Skip This Repair</button>
          </div>
        </div>
      `;

      modal.style.display = 'flex';

      await new Promise((resolve) => {
        $('#mfSave').onclick = async () => {
          // Persist inputs
          for (const f of FIELD_DEFS) {
            if (!missing.includes(f.key)) continue;
            const el = document.getElementById(`mf_${f.key}`);
            if (!el) continue;
            const v = String(el.value || '').trim();
            if (v) repair[f.key] = v;

            // Optional bulk apply for Category/Type
            if ((f.key === 'category' || f.key === 'type' || f.key === 'assetType') && v) {
              const allCb = document.getElementById(`mf_${f.key}_all`);
              if (allCb && allCb.checked) {
                for (let j = i + 1; j < repairs.length; j++) {
                  if (!String(repairs[j][f.key] ?? '').trim()) {
                    repairs[j][f.key] = v;
                  }
                }
              }
            }
          }

          // Required checks
          if (!String(repair.stationId || '').trim() || !String(repair.name || '').trim()) {
            appAlert('Station ID and Repair Name are required');
            return;
          }

          modal.style.display = 'none';
          resolve();
        };

        $('#mfSkip').onclick = () => {
          modal.style.display = 'none';
          resolve();
        };
      });
    }
  }

  // Import a single repair by looking up station info
  async function importSingleRepair(repair) {
    try {
      // Find the station to get location, assetType, and company
      const station = stationsList.find(s => 
        String(s.station_id).trim().toLowerCase() === String(repair.stationId).trim().toLowerCase()
      );
      
      if (!station) {
        console.error(`[importSingleRepair] Station not found: ${repair.stationId}`);
        return { success: false, message: 'Station not found' };
      }
      
      const location = station.location_file || station.province || station.location;
      // Prefer user-provided asset type if present (to disambiguate dup Station IDs)
      const assetType = String(repair.assetType || station.asset_type || '').trim();
      const company = station.company || '';

      if (!company) {
        return { success: false, message: 'Station is missing company information' };
      }
      
      if (!location || !assetType) {
        console.error(`[importSingleRepair] Missing location or asset type for station ${repair.stationId}`);
        return { success: false, message: 'Station missing location or asset type' };
      }

      // Normalize category format: "O & M" -> "O&M", "Decommission" stays as is
      let normalizedCategory = String(repair.category ?? '').trim();
      if (normalizedCategory) {
        // Remove spaces around ampersand: "O & M" -> "O&M"
        normalizedCategory = normalizedCategory.replace(/\s*&\s*/g, '&');
      }
      
      // Build repair payload with header-cased fields so backend writes proper columns
      const repairData = {
        'Station ID': repair.stationId,
        'Repair Name': repair.name,
        'Date': repair.date || new Date().toISOString().slice(0, 10), // Use imported date or current date
        'Severity': repair.severity || '',
        'Priority': repair.priority || '',
        'Cost': repair.cost || '',
        'Category': normalizedCategory || 'Capital',
        'Type': repair.type || 'Repair',
        'Days': repair.days || '',
        // Aliases for compatibility with older paths
        name: repair.name,
        date: repair.date || new Date().toISOString().slice(0, 10),
        severity: repair.severity || '',
        priority: repair.priority || '',
        cost: repair.cost || '',
        category: normalizedCategory || 'Capital',
        type: repair.type || 'Repair',
        days: repair.days || ''
      };
      if (repair.assetType) repairData['Asset Type'] = String(repair.assetType).trim();
      
      const result = await window.electronAPI.appendRepair({ 
        company, 
        location, 
        assetType, 
        repair: repairData 
      });

      if (!company) {
        return { success: false, message: 'Station is missing company information' };
      }
      
      return result;
      
    } catch (err) {
      console.error('[importSingleRepair] failed:', err);
      return { success: false, message: String(err) };
    }
  }

  // Convert File to base64
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = reader.result.split(',')[1];
        resolve(b64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
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

    const btnImportRepairs = $('#btnImportRepairs');
    if (btnImportRepairs) {
      btnImportRepairs.addEventListener('click', openImportRepairsModal);
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

    // If user opens Repairs tab later, virtualization is created on-demand
    // (renderRepairsTables is called from tab switch).

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




