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

  // ---- Tabs ----------------------------------------------------------------

  function bindTabs() {
    const tabOverview = $('#tabOverview');
    const tabAnalytics = $('#tabAnalytics');
    const paneOverview = $('#overviewTab');
    const paneAnalytics = $('#analyticsTab');

    tabOverview.addEventListener('click', () => {
      tabOverview.classList.add('active');
      tabAnalytics.classList.remove('active');
      paneOverview.style.display = '';
      paneAnalytics.style.display = 'none';
    });

    tabAnalytics.addEventListener('click', () => {
      tabAnalytics.classList.add('active');
      tabOverview.classList.remove('active');
      paneAnalytics.style.display = '';
      paneOverview.style.display = 'none';
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
