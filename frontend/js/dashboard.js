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
    // Fallback (safer): if target is multi-word, allow full-phrase suffix match.
    // This covers "Inspection Frequency" vs "Section Inspection Frequency",
    // but avoids single-word traps like "Type" matching "Infrastructure Type".
    if (target.includes(' ')) {
      for (const k of Object.keys(row || {})) {
        const key = String(k).toLowerCase().trim();
        if (key.endsWith(' ' + target)) return row[k];
      }
    }
    return '';
  };

  const normStr = (s) => String(s ?? '').trim();
  const stationLocation = (s) => normStr(s.province || s.location || s.location_file);
  const stationAssetType = (s) => normStr(s.asset_type);

  // Basic, dependency-free bar chart
function renderBarChart(container, dataPairs, opts = {}) {
    container.innerHTML = '';
    // Tooltip element
    const tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    container.appendChild(tip);

    const width = Math.max(0, container.clientWidth || 300);
    const height = Math.max(0, container.clientHeight || width); // Safety check
    const padL = 35, padR = 10, padT = 15, padB = 30; // Increased padding for aesthetics

    const W = width, H = height;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxVal = Math.max(1, ...dataPairs.map(d => +d.value || 0));
    // Round max up to nice number for grid
    const niceMax = Math.ceil(maxVal / 10) * 10 || 10;
    
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.style.overflow = 'visible';

    // 1. Grid Lines (Background)
    const gridGroup = document.createElementNS(svg.namespaceURI, 'g');
    const numGridLines = 5;
    for (let i = 0; i <= numGridLines; i++) {
      const yVal = padT + (plotH * (i / numGridLines));
      const line = document.createElementNS(svg.namespaceURI, 'line');
      line.setAttribute('x1', padL);
      line.setAttribute('x2', W - padR);
      line.setAttribute('y1', yVal);
      line.setAttribute('y2', yVal);
      line.setAttribute('stroke', 'currentColor');
      line.setAttribute('stroke-opacity', '0.05');
      line.setAttribute('stroke-dasharray', '4 2');
      gridGroup.appendChild(line);

      // Y-Axis label (Value)
      const label = document.createElementNS(svg.namespaceURI, 'text');
      const val = Math.round(niceMax - (niceMax * (i / numGridLines)));
      label.setAttribute('x', padL - 8);
      label.setAttribute('y', yVal + 4);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('font-size', '10');
      label.setAttribute('fill', 'currentColor');
      label.setAttribute('fill-opacity', '0.5');
      label.textContent = val > 1000 ? (val/1000).toFixed(1) + 'k' : val;
      gridGroup.appendChild(label);
    }
    svg.appendChild(gridGroup);

    // 2. Bars
    const barGap = 12;
    const n = dataPairs.length || 1;
    const barW = Math.max(6, Math.min(60, (plotW - (n - 1) * barGap) / n)); // Cap max width
    const totalBarBlockW = n * barW + (n - 1) * barGap;
    const startX = padL + (plotW - totalBarBlockW) / 2; // Center chart if few items

    dataPairs.forEach((d, i) => {
      const v = (+d.value || 0);
      const h = Math.round((v / niceMax) * plotH);
      const x = startX + i * (barW + barGap);
      const y = padT + (plotH - h);

      // Bar Rect (Rounded Top)
      const rect = document.createElementNS(svg.namespaceURI, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', barW);
      rect.setAttribute('height', h);
      rect.setAttribute('rx', 4); // Rounded corners
      rect.setAttribute('fill', chartPalette[i % chartPalette.length]);
      rect.setAttribute('fill-opacity', '0.85');
      rect.style.transition = 'opacity 0.2s';
      rect.style.cursor = 'pointer';

      // Hover Effects
      rect.addEventListener('mouseenter', () => {
        rect.setAttribute('fill-opacity', '1');
        tip.textContent = `${d.label}: ${d.value}`;
        tip.style.left = `${x + barW/2}px`;
        tip.style.top = `${y}px`;
        tip.classList.add('visible');
      });
      rect.addEventListener('mouseleave', () => {
        rect.setAttribute('fill-opacity', '0.85');
        tip.classList.remove('visible');
      });

      svg.appendChild(rect);

      // X Label (Rotate if necessary, truncate if long)
      const tl = document.createElementNS(svg.namespaceURI, 'text');
      const tx = x + barW / 2;
      const ty = padT + plotH + 16;
      tl.setAttribute('x', tx);
      tl.setAttribute('y', ty);
      tl.setAttribute('text-anchor', 'middle');
      tl.setAttribute('font-size', '11');
      tl.setAttribute('fill', 'currentColor');
      
      let labelText = String(d.label);
      if (labelText.length > 15) labelText = labelText.slice(0, 12) + '...';
      tl.textContent = labelText;

      // Rotate if crowded
      if (dataPairs.length > 6) {
        tl.setAttribute('text-anchor', 'end');
        tl.setAttribute('transform', `rotate(-35, ${tx}, ${ty})`);
        tl.setAttribute('dy', '6');
      }

      svg.appendChild(tl);
    });

    container.appendChild(svg);
  }

  // ---- State ---------------------------------------------------------------

  const chartPalette = [
    '#2563eb', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444',
    '#8b5cf6', '#10b981', '#f97316', '#e11d48', '#14b8a6'
  ];

  const state = {
    allStations: [],
    filteredStations: [],
    lookupTree: null,
    cards: [],
    initialized: false,
    fieldNames: [],
    scopeCounts: null,
    scopeIndex: null,
    dataVersion: 0,
    scopeDataCache: new Map(),
    distributionCache: new Map()
  };

  const builderEls = {
    fieldInput: null,
    vizSelect: null,
    valueInput: null,
    valueCol: null,
    scopeMode: null,
    scopeCompany: null,
    scopeLocation: null,
    scopeAsset: null,
    conditionBox: null,
    conditionList: null,
    addConditionBtn: null,
    addCardBtn: null,
    builderTotal: null
  };

  const warn = (msg) => {
    if (window.appAlert) window.appAlert(msg);
    else alert(msg);
  };

  const uniqCaseInsensitive = (arr) => {
    const seen = new Set();
    const out = [];
    for (const val of arr || []) {
      const key = String(val || '').toLowerCase();
      if (!seen.has(key)) { seen.add(key); out.push(val); }
    }
    return out;
  };

  function resolveFieldValue(row, fieldName) {
    if (!fieldName) return '';
    const clean = String(fieldName).replace(/\s*\((?:Station Data|Repairs)\)$/i, '').trim();
    const direct = getFieldValue(row, clean);
    if (direct !== '') return direct;
    return getFieldValue(row, fieldName);
  }

  // ---- Filters integration (Analytics only) --------------------------------

  function readActiveFilters() {
    const tree = $('#filterTree');
    if (!tree) return { locations: null, assetsByLocation: new Map() };

    const locCbs = $$('input.location', tree);
    const checkedLocs = new Set(locCbs.filter(cb => cb.checked).map(cb => cb.value));

    const assetsByLoc = new Map();
    const locMap = new Map();
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

  function clearCaches() {
    state.scopeDataCache.clear();
    state.distributionCache.clear();
  }

  function applyAnalyticsFilters() {
    const { locations, assetsByLocation } = readActiveFilters();

    if (!locations || locations.size === 0) {
      state.filteredStations = [];
    } else {
      const matches = (s) => {
        const loc = stationLocation(s);
        if (!loc || !locations.has(loc)) return false;
        const set = assetsByLocation.get(loc);
        if (!set || set.size === 0) return true;
        return set.has(stationAssetType(s));
      };
      state.filteredStations = state.allStations.filter(matches);
    }

    state.dataVersion += 1;
    clearCaches();
    rebuildScopeCaches();
    updateBuilderTotal();
  }

  function onFiltersChanged() {
    applyAnalyticsFilters();
    renderScopeSummary();
    populateScopeSelectors();
    scheduleCardUpdates();
  }

  // ---- Scope helpers -------------------------------------------------------

  function scopeKey(scope) {
    const mode = scope?.mode || 'all';
    const parts = [mode];
    if (scope?.company) parts.push(scope.company);
    if (scope?.location) parts.push(scope.location);
    if (scope?.assetType) parts.push(scope.assetType);
    return parts.join('|');
  }

  function matchesScope(row, scope) {
    if (!scope || scope.mode === 'all') return true;
    const co = normStr(row.company);
    const loc = stationLocation(row);
    const at = stationAssetType(row);
    switch (scope.mode) {
      case 'company': return co && scope.company && co === scope.company;
      case 'company-location': return co === scope.company && loc === scope.location;
      case 'company-location-asset': return co === scope.company && loc === scope.location && at === scope.assetType;
      case 'location': return loc && scope.location && loc === scope.location;
      case 'location-asset': return loc === scope.location && at === scope.assetType;
      case 'asset': return at && scope.assetType && at === scope.assetType;
      default: return true;
    }
  }

  function getScopedStations(scope) {
    const key = `${state.dataVersion}:${scopeKey(scope)}`;
    if (state.scopeDataCache.has(key)) return state.scopeDataCache.get(key);
    const rows = state.filteredStations.filter(r => matchesScope(r, scope));
    state.scopeDataCache.set(key, rows);
    return rows;
  }

  function applyConditions(rows, conditions) {
    const conds = (conditions || [])
      .map(c => ({ field: normStr(c.field), value: normStr(c.value).toLowerCase() }))
      .filter(c => c.field && c.value);
    if (!conds.length) return rows;
    return rows.filter(r => conds.every(c => normStr(resolveFieldValue(r, c.field)).toLowerCase() === c.value));
  }

  function rebuildScopeCaches() {
    const counts = {
      company: new Map(),
      location: new Map(),
      assetType: new Map(),
      companyLocation: new Map(),
      companyLocationAsset: new Map(),
      locationAsset: new Map()
    };

    for (const s of state.filteredStations) {
      const co = normStr(s.company);
      const loc = stationLocation(s);
      const at = stationAssetType(s);
      if (co) counts.company.set(co, (counts.company.get(co) || 0) + 1);
      if (loc) counts.location.set(loc, (counts.location.get(loc) || 0) + 1);
      if (at) counts.assetType.set(at, (counts.assetType.get(at) || 0) + 1);
      if (co && loc) counts.companyLocation.set(`${co}|||${loc}`, (counts.companyLocation.get(`${co}|||${loc}`) || 0) + 1);
      if (loc && at) counts.locationAsset.set(`${loc}|||${at}`, (counts.locationAsset.get(`${loc}|||${at}`) || 0) + 1);
      if (co && loc && at) counts.companyLocationAsset.set(`${co}|||${loc}|||${at}`, (counts.companyLocationAsset.get(`${co}|||${loc}|||${at}`) || 0) + 1);
    }

    const toList = (map, mapper) => Array.from(map.entries()).map(mapper).sort((a, b) => b.count - a.count || String(a.label || '').localeCompare(String(b.label || '')));

    state.scopeCounts = counts;
    state.scopeIndex = {
      companies: toList(counts.company, ([company, count]) => ({ company, count })),
      locations: toList(counts.location, ([location, count]) => ({ location, count })),
      assetTypes: toList(counts.assetType, ([assetType, count]) => ({ assetType, count })),
      companyLocations: toList(counts.companyLocation, ([key, count]) => {
        const [company, location] = key.split('|||');
        return { company, location, count };
      }),
      companyLocationAssets: toList(counts.companyLocationAsset, ([key, count]) => {
        const [company, location, assetType] = key.split('|||');
        return { company, location, assetType, count };
      }),
      locationAssets: toList(counts.locationAsset, ([key, count]) => {
        const [location, assetType] = key.split('|||');
        return { location, assetType, count };
      })
    };
  }

  function renderScopeSummary() {
    const wrap = $('#scopeSummary');
    if (!wrap) return;
    wrap.innerHTML = '';
    const idx = state.scopeIndex;
    if (!idx) return;

    const groups = [
      { title: 'Company -> Location -> Asset Type', items: idx.companyLocationAssets },
      { title: 'Company -> Location', items: idx.companyLocations },
      { title: 'Company', items: idx.companies },
      { title: 'Location -> Asset Type', items: idx.locationAssets },
      { title: 'Location', items: idx.locations },
      { title: 'Asset Type', items: idx.assetTypes }
    ];

    groups.forEach(group => {
      if (!group.items || !group.items.length) return;
      const chip = document.createElement('div');
      chip.className = 'scope-chip';
      chip.innerHTML = `<div class="chip-title">${esc(group.title)}</div>`;
      const list = document.createElement('div');
      list.className = 'chip-list';
      group.items.slice(0, 4).forEach(item => {
        const labelParts = [];
        if (item.company) labelParts.push(item.company);
        if (item.location) labelParts.push(item.location);
        if (item.assetType) labelParts.push(item.assetType);
        const label = labelParts.join(' -> ') || item.location || item.assetType || item.company;
        const row = document.createElement('div');
        row.className = 'tag';
        row.innerHTML = `<span>${esc(label)}</span><span class="count">${item.count}</span>`;
        list.appendChild(row);
      });
      chip.appendChild(list);
      wrap.appendChild(chip);
    });
  }

  // ---- Field catalog + value hints ----------------------------------------

  async function loadAnalyticsFieldNames() {
    try {
      let names = [];
      if (window.electronAPI?.getWorkbookFieldCatalog) {
        const catalog = await window.electronAPI.getWorkbookFieldCatalog();
        if (catalog?.sheets) {
          Object.values(catalog.sheets).forEach(fields => {
            (fields || []).forEach(f => names.push(f));
          });
        }
      }

      if (!names.length && state.allStations.length) {
        const set = new Set();
        state.allStations.forEach(row => Object.keys(row || {}).forEach(k => set.add(k)));
        names = Array.from(set);
      }

      state.fieldNames = uniqCaseInsensitive(names).sort((a, b) => a.localeCompare(b));
      renderFieldDatalist();
    } catch (e) {
      console.error('[analytics] Failed to load field names', e);
    }
  }

  function renderFieldDatalist() {
    const list = $('#analyticsFieldList');
    if (!list) return;
    list.innerHTML = '';
    state.fieldNames.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f;
      list.appendChild(opt);
    });
  }

  // ---- Scope selector wiring ----------------------------------------------

  function populateScopeSelectors() {
    const { scopeIndex } = state;
    if (!scopeIndex) return;
    const setOptions = (el, items, formatter) => {
      if (!el) return;
      const current = el.value;
      el.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Choose...';
      el.appendChild(placeholder);
      items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.value || item.company || item.location || item.assetType || '';
        opt.textContent = formatter(item);
        el.appendChild(opt);
      });
      if (current) el.value = current;
    };

    setOptions(builderEls.scopeCompany, scopeIndex.companies, (i) => `${i.company} (${i.count})`);
    setOptions(builderEls.scopeLocation, scopeIndex.locations, (i) => `${i.location} (${i.count})`);
    setOptions(builderEls.scopeAsset, scopeIndex.assetTypes, (i) => `${i.assetType} (${i.count})`);

    onScopeCompanyChange();
    onScopeLocationChange();
    syncScopePickerVisibility();
  }

  function onScopeCompanyChange() {
    const company = normStr(builderEls.scopeCompany?.value || '');
    const locSel = builderEls.scopeLocation;
    if (!locSel || !state.scopeIndex) return;
    if (!company) return;
    const locs = state.scopeIndex.companyLocations.filter(item => item.company === company);
    locSel.innerHTML = '<option value="">' + 'Choose...' + '</option>';
    locs.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.location;
      opt.textContent = `${item.location} (${item.count})`;
      locSel.appendChild(opt);
    });
    onScopeLocationChange();
  }

  function onScopeLocationChange() {
    const loc = normStr(builderEls.scopeLocation?.value || '');
    const co = normStr(builderEls.scopeCompany?.value || '');
    const assetSel = builderEls.scopeAsset;
    if (!assetSel || !state.scopeIndex) return;
    const assets = [];
    if (co && loc) {
      state.scopeIndex.companyLocationAssets.forEach(item => {
        if (item.company === co && item.location === loc) assets.push(item);
      });
    } else if (loc) {
      state.scopeIndex.locationAssets.forEach(item => {
        if (item.location === loc) assets.push(item);
      });
    } else {
      assets.push(...state.scopeIndex.assetTypes);
    }
    assetSel.innerHTML = '<option value="">' + 'Choose...' + '</option>';
    assets.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.assetType;
      opt.textContent = `${item.assetType} (${item.count})`;
      assetSel.appendChild(opt);
    });
  }

  function syncScopePickerVisibility() {
    const mode = builderEls.scopeMode?.value || 'all';
    const companyWrap = builderEls.scopeCompany?.closest('.scope-picker');
    const locationWrap = builderEls.scopeLocation?.closest('.scope-picker');
    const assetWrap = builderEls.scopeAsset?.closest('.scope-picker');
    if (companyWrap) companyWrap.classList.add('hidden');
    if (locationWrap) locationWrap.classList.add('hidden');
    if (assetWrap) assetWrap.classList.add('hidden');
    if (mode.includes('company') && companyWrap) companyWrap.classList.remove('hidden');
    if (mode.includes('location') && locationWrap) locationWrap.classList.remove('hidden');
    if (mode.includes('asset') && assetWrap) assetWrap.classList.remove('hidden');
  }

  // ---- Condition rows ------------------------------------------------------

  function addConditionRow(field = '', value = '') {
    if (!builderEls.conditionList) return;
    const row = document.createElement('div');
    row.className = 'condition-row';
    row.innerHTML = `
      <input class="cond-field" list="analyticsFieldList" placeholder="Field" value="${esc(field)}" />
      <input class="cond-value" placeholder="Value" value="${esc(value)}" />
      <button type="button" class="remove">Remove</button>
    `;
    const fieldInput = $('.cond-field', row);
    const valueInput = $('.cond-value', row);
    if (fieldInput) {
      fieldInput.dataset.autofill = field ? '0' : '1';
      fieldInput.addEventListener('input', () => fieldInput.dataset.autofill = '0');
    }
    if (valueInput) {
      valueInput.addEventListener('input', () => valueInput.dataset.autofill = '0');
    }
    $('.remove', row).addEventListener('click', () => row.remove());
    builderEls.conditionList.appendChild(row);
  }

  function collectConditionRows() {
    const rows = [];
    (builderEls.conditionList ? $$('.condition-row', builderEls.conditionList) : []).forEach(row => {
      const field = normStr($('.cond-field', row)?.value);
      const value = normStr($('.cond-value', row)?.value);
      if (field && value) {
        rows.push({ field, value });
      } else if (field || value) {
        rows.push({ field, value, _incomplete: true });
      }
    });
    return rows;
  }

  function syncPrimaryConditionField() {
    if (builderEls.vizSelect?.value !== 'ratio') return;
    const firstRow = builderEls.conditionList?.querySelector('.condition-row');
    if (!firstRow) return;
    const fieldInput = $('.cond-field', firstRow);
    if (!fieldInput) return;
    const shouldAutofill = !fieldInput.value || fieldInput.dataset.autofill === '1';
    if (shouldAutofill) {
      fieldInput.value = builderEls.fieldInput?.value || '';
      fieldInput.dataset.autofill = '1';
    }
  }

  function onVizChange() {
    const isRatio = builderEls.vizSelect?.value === 'ratio';
    if (builderEls.valueCol) builderEls.valueCol.style.display = isRatio ? '' : 'none';
    if (builderEls.conditionBox) builderEls.conditionBox.style.display = isRatio ? '' : 'none';
    if (!isRatio && builderEls.conditionList) builderEls.conditionList.innerHTML = '';
    if (isRatio && builderEls.conditionList && builderEls.conditionList.childElementCount === 0) {
      addConditionRow(builderEls.fieldInput?.value || '', '');
    }
    if (isRatio) syncPrimaryConditionField();
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
    closeBtn.textContent = '×';
    closeBtn.title = 'Remove this analytic';
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

function renderPieChart(container, dataPairs, opts = {}) {
    container.innerHTML = '';
    // Tooltip
    const tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    container.appendChild(tip);

    const boxW = container.clientWidth || 300;
    const boxH = container.clientHeight || 300;
    const size = Math.max(0, Math.min(boxW, boxH) - 10); // Safety check
    const r = size / 2 - 10;
    const cx = size / 2;
    const cy = size / 2;
    // Donut hole radius
    const holeR = r * 0.55; 

    const total = dataPairs.reduce((sum, d) => sum + (+d.value || 0), 0);
    if (!total) {
      container.innerHTML = '<div class="empty">No data</div>';
      return;
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

    let angle = -Math.PI / 2;
    
    dataPairs.forEach((slice, idx) => {
      const v = +slice.value || 0;
      if (v <= 0) return;
      const fraction = v / total;
      const delta = fraction * Math.PI * 2;
      const next = angle + delta;

      // Calculate coordinates for outer circle
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(next);
      const y2 = cy + r * Math.sin(next);

      // Calculate coordinates for inner circle (donut hole)
      const x3 = cx + holeR * Math.cos(next);
      const y3 = cy + holeR * Math.sin(next);
      const x4 = cx + holeR * Math.cos(angle);
      const y4 = cy + holeR * Math.sin(angle);

      const large = delta > Math.PI ? 1 : 0;
      
      // Draw Donut Slice
      const path = document.createElementNS(svg.namespaceURI, 'path');
      const d = [
        'M', x1, y1,
        'A', r, r, 0, large, 1, x2, y2,
        'L', x3, y3,
        'A', holeR, holeR, 0, large, 0, x4, y4,
        'Z'
      ].join(' ');

      path.setAttribute('d', d);
      const color = chartPalette[idx % chartPalette.length];
      path.setAttribute('fill', color);
      path.setAttribute('fill-opacity', '0.9');
      path.setAttribute('stroke', '#fff');
      path.setAttribute('stroke-width', '2');
      path.style.cursor = 'pointer';
      path.style.transition = 'fill-opacity 0.2s, transform 0.2s';
      path.style.transformOrigin = `${cx}px ${cy}px`;

      path.addEventListener('mouseenter', () => {
        path.setAttribute('fill-opacity', '1');
        path.style.transform = 'scale(1.03)'; // Mild pop effect
        tip.textContent = `${slice.label}: ${slice.value} (${(fraction*100).toFixed(1)}%)`;
        // Position tip roughly near mouse or center - simplifying to center of chart for stability
        tip.style.left = `${cx}px`;
        tip.style.top = `${cy - 10}px`; 
        tip.classList.add('visible');
      });

      path.addEventListener('mouseleave', () => {
        path.setAttribute('fill-opacity', '0.9');
        path.style.transform = 'scale(1)';
        tip.classList.remove('visible');
      });

      svg.appendChild(path);
      angle = next;
    });

    // Donut Center Text
    const centerText = document.createElementNS(svg.namespaceURI, 'text');
    centerText.setAttribute('x', cx);
    centerText.setAttribute('y', cy + 5);
    centerText.setAttribute('text-anchor', 'middle');
    centerText.setAttribute('font-weight', 'bold');
    centerText.setAttribute('font-size', '14');
    centerText.setAttribute('fill', 'currentColor');
    centerText.style.pointerEvents = 'none';
    centerText.textContent = total.toLocaleString();
    svg.appendChild(centerText);

    const centerLabel = document.createElementNS(svg.namespaceURI, 'text');
    centerLabel.setAttribute('x', cx);
    centerLabel.setAttribute('y', cy + 20);
    centerLabel.setAttribute('text-anchor', 'middle');
    centerLabel.setAttribute('font-size', '10');
    centerLabel.setAttribute('fill', 'currentColor');
    centerLabel.setAttribute('fill-opacity', '0.6');
    centerLabel.style.pointerEvents = 'none';
    centerLabel.textContent = 'Total';
    svg.appendChild(centerLabel);

    container.appendChild(svg);
  }

  function scopeLabel(scope) {
    if (!scope || scope.mode === 'all') return 'All data (using current filters)';
    const parts = [];
    if (scope.company) parts.push(scope.company);
    if (scope.location) parts.push(scope.location);
    if (scope.assetType) parts.push(scope.assetType);
    return parts.join(' -> ') || 'All data';
  }

  function conditionSummary(conditions) {
    if (!conditions || !conditions.length) return 'No extra filters';
    return conditions.map(c => `${c.field} = ${c.value}`).join(' · ');
  }

  function createDistributionCard(cfg) {
    const root = document.createElement('div');
    const title = esc(cfg.field || 'Unknown field');
    root.innerHTML = `
      <div class="stat-title">${title} (${cfg.viz === 'pie' ? 'Pie' : 'Bar'})</div>
      <div class="meta-line">${esc(scopeLabel(cfg.scope))}</div>
      <div class="chart" style="width:100%;" aria-label="${title} chart"></div>
      <div class="chart-legend"></div>
      ${cfg.conditions?.length ? `<div class="meta-line">${esc(conditionSummary(cfg.conditions))}</div>` : ''}
    `;
    const chart = $('.chart', root);
    const legend = $('.chart-legend', root);

    const lastRender = { key: null };

    const update = () => {
      const cacheKey = `${state.dataVersion}:${scopeKey(cfg.scope)}:${(cfg.field || '').toLowerCase()}:${cfg.viz}:${conditionSummary(cfg.conditions)}`;

      if (!state.distributionCache.has(cacheKey)) {
        const scoped = getScopedStations(cfg.scope);
        const filtered = applyConditions(scoped, cfg.conditions);
        const counts = new Map();
        filtered.forEach(row => {
          const v = normStr(resolveFieldValue(row, cfg.field)) || 'Unknown';
          counts.set(v, (counts.get(v) || 0) + 1);
        });
        let items = Array.from(counts.entries()).map(([label, value]) => ({ label, value }));
        items.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
        const MAX_SLICES = 12;
        if (items.length > MAX_SLICES) {
          const head = items.slice(0, MAX_SLICES - 1);
          const otherSum = items.slice(MAX_SLICES - 1).reduce((s, d) => s + d.value, 0);
          head.push({ label: 'Other', value: otherSum });
          items = head;
        }
        state.distributionCache.set(cacheKey, items);
      }

      const items = state.distributionCache.get(cacheKey);

      // 1. Clear containers
      chart.innerHTML = '';
      legend.innerHTML = '';

      if (!items.length) {
        chart.innerHTML = '<div class="empty">No data (adjust filters)</div>';
        lastRender.key = cacheKey;
        return;
      }

      // 2. RENDER LEGEND FIRST (So it takes up space)
      const total = items.reduce((s, d) => s + (+d.value || 0), 0) || 1;
      items.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'legend-row';
        row.innerHTML = `
          <span class="dot" style="background:${chartPalette[idx % chartPalette.length]};"></span>
          <span>${esc(item.label)}</span>
          <span class="legend-value">${item.value} (${((item.value / total) * 100).toFixed(1)}%)</span>
        `;
        legend.appendChild(row);
      });

      // 3. RENDER CHART SECOND (Calculates remaining height correctly)
      // Use a micro-task to ensure DOM has updated heights from the legend insertion
      requestAnimationFrame(() => {
        if (cfg.viz === 'pie') {
          renderPieChart(chart, items, { ariaLabel: `${cfg.field} pie chart` });
        } else {
          renderBarChart(chart, items, { ariaLabel: `${cfg.field} bar chart` });
        }
      });

      lastRender.key = cacheKey;
      // lastRender.width check removed as it's less reliable with flex resizing
    };

    return addCard(root, update);
  }

  function createRatioCard(cfg) {
    const root = document.createElement('div');
    const title = esc(cfg.field || 'Ratio');
    root.innerHTML = `
      <div class="stat-title">${title} ratio</div>
      <div class="meta-line">${esc(scopeLabel(cfg.scope))}</div>
      <div class="ratio-block">
        <div class="ratio-fraction">
          <span class="num" data-role="num"></span>
          <span class="den">/ <span data-role="den"></span></span>
        </div>
        <div class="ratio-bar"><div class="fill"></div></div>
        <div class="ratio-pct" data-role="pct"></div>
        <div class="meta-line" data-role="detail"></div>
      </div>
    `;
    const numEl = root.querySelector('[data-role="num"]');
    const denEl = root.querySelector('[data-role="den"]');
    const pctEl = root.querySelector('[data-role="pct"]');
    const detailEl = root.querySelector('[data-role="detail"]');
    const fillEl = root.querySelector('.ratio-bar .fill');

    const lastRender = { key: null };

    const update = () => {
      const key = `${state.dataVersion}:${scopeKey(cfg.scope)}:${conditionSummary(cfg.conditions)}`;
      if (lastRender.key === key) return;
      const scoped = getScopedStations(cfg.scope);
      const denom = scoped.length;
      const numerator = applyConditions(scoped, cfg.conditions).length;
      const pct = denom ? (numerator / denom) * 100 : 0;
      numEl.textContent = numerator;
      denEl.textContent = denom;
      pctEl.textContent = `${pct.toFixed(1)}%`;
      fillEl.style.width = `${Math.min(100, pct).toFixed(1)}%`;
      detailEl.textContent = conditionSummary(cfg.conditions);
      lastRender.key = key;
    };

    return addCard(root, update);
  }

  function createAnalyticsCard(cfg) {
    if (cfg.viz === 'ratio') return createRatioCard(cfg);
    return createDistributionCard(cfg);
  }

  // ---- Builder form --------------------------------------------------------

  let pendingCardsUpdate = null;
  function scheduleCardUpdates() {
    if (pendingCardsUpdate) return;
    pendingCardsUpdate = requestAnimationFrame(() => {
      pendingCardsUpdate = null;
      state.cards.forEach(c => c.update());
    });
  }

  function readScopeFromForm() {
    const mode = builderEls.scopeMode?.value || 'all';
    const scope = { mode };
    if (mode.includes('company')) scope.company = normStr(builderEls.scopeCompany?.value);
    if (mode.includes('location')) scope.location = normStr(builderEls.scopeLocation?.value);
    if (mode.includes('asset')) scope.assetType = normStr(builderEls.scopeAsset?.value);

    if (mode === 'company' && !scope.company) { warn('Pick a company for this scope'); return null; }
    if (mode === 'company-location' && (!scope.company || !scope.location)) { warn('Pick a company and location'); return null; }
    if (mode === 'company-location-asset' && (!scope.company || !scope.location || !scope.assetType)) { warn('Pick company, location, and asset type'); return null; }
    if (mode === 'location' && !scope.location) { warn('Pick a location'); return null; }
    if (mode === 'location-asset' && (!scope.location || !scope.assetType)) { warn('Pick a location and asset type'); return null; }
    if (mode === 'asset' && !scope.assetType) { warn('Pick an asset type'); return null; }
    return scope;
  }

  function readCardConfig() {
    const field = normStr(builderEls.fieldInput?.value);
    if (!field) { warn('Pick a field to analyze'); return null; }
    const viz = builderEls.vizSelect?.value || 'pie';
    const scope = readScopeFromForm();
    if (!scope) return null;

    if (viz === 'ratio') {
      const value = normStr(builderEls.valueInput?.value);
      if (!value) { warn('Enter the value you want to count'); return null; }
      const extraConds = collectConditionRows();
      if (extraConds.some(c => c._incomplete)) {
        warn('Fill every numerator condition field or remove the row.');
        return null;
      }
      const conditions = [{ field, value }, ...extraConds];
      return { field, viz, scope, conditions };
    }

    const conditions = collectConditionRows().filter(c => !c._incomplete);
    return { field, viz, scope, conditions };
  }

  function updateBuilderTotal() {
    if (builderEls.builderTotal) {
      builderEls.builderTotal.textContent = `${state.filteredStations.length} stations in current filters`;
    }
  }

  function wireBuilder() {
    builderEls.fieldInput = $('#fieldInput');
    builderEls.vizSelect = $('#vizType');
    builderEls.valueInput = $('#valueInput');
    builderEls.valueCol = $('#valueCol');
    builderEls.scopeMode = $('#scopeMode');
    builderEls.scopeCompany = $('#scopeCompany');
    builderEls.scopeLocation = $('#scopeLocation');
    builderEls.scopeAsset = $('#scopeAsset');
    builderEls.conditionBox = $('#conditionBox');
    builderEls.conditionList = $('#conditionList');
    builderEls.addConditionBtn = $('#btnAddCondition');
    builderEls.addCardBtn = $('#btnAddCard');
    builderEls.builderTotal = $('#builderTotal');

    builderEls.vizSelect?.addEventListener('change', onVizChange);
    builderEls.fieldInput?.addEventListener('input', () => {
      syncPrimaryConditionField();
    });
    builderEls.scopeMode?.addEventListener('change', syncScopePickerVisibility);
    builderEls.scopeCompany?.addEventListener('change', onScopeCompanyChange);
    builderEls.scopeLocation?.addEventListener('change', onScopeLocationChange);
    builderEls.addConditionBtn?.addEventListener('click', () => addConditionRow());
    builderEls.addCardBtn?.addEventListener('click', () => {
      const cfg = readCardConfig();
      if (cfg) createAnalyticsCard(cfg);
    });

    onVizChange();
    syncScopePickerVisibility();
  }

  // ---- Repairs and Maintenance Tab ---------------------------------------
  
  // Now dynamic: one table per Type (e.g., "Repair", "Monitoring", etc.)
  let repairsState = {
    allRepairs: [],
    selectedByType: new Map(),   // type -> Set(rows)
  };
  let stationsList = [];

  async function loadRepairsData() {
    try {
      const repairs = await window.electronAPI.getAllRepairs();
      repairsState.allRepairs = Array.isArray(repairs) ? repairs : [];
      renderTypeTables();
    } catch (e) {
      console.error('[dashboard:repairs] Failed to load repairs:', e);
      repairsState.allRepairs = [];
    }
  }

  // Expose globally for other views to refresh
  window.loadRepairsData = loadRepairsData;

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

  function _setTriState(headerCheckbox, selectedSize, total) {
    if (!headerCheckbox) return;
    headerCheckbox.indeterminate = selectedSize > 0 && selectedSize < total;
    headerCheckbox.checked = total > 0 && selectedSize === total;
  }

  // ---- Dynamic tables by Type -----------------------------------------------
 function _typeLabel(r) {
   const t = String((r && (r.scopeType ?? r.type)) || '').trim();
   return t || 'Repair';
 }
  function _groupByType(rows) {
    const map = new Map();
    rows.forEach(r => {
      const k = _typeLabel(r);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    // Ensure "Repair" shows (even empty) when there is no data yet
    if (map.size === 0) map.set('Repair', []);
    return [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  }

  function _slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$|/g,''); }

  function renderTypeTables() {
    const wrap = $('#globalTypeTables');
    if (!wrap) return;
    wrap.innerHTML = '';

    const groups = _groupByType(repairsState.allRepairs);
    groups.forEach(([type, rows], idx) => {
      const slug = _slug(type || 'repair') || 'repair';
      const isOpen = idx === 0; // First type open by default

      const panel = document.createElement('div');
      panel.className = 'panel';
      panel.style.marginTop = '20px';

      // Collapsible header
      const header = document.createElement('div');
      header.className = 'panel-header-collapsible';
      header.dataset.type = slug;
      header.innerHTML = `
        <span class="toggle-icon">${isOpen ? '▼' : '▶'}</span>
        <strong class="panel-title-inline">${esc(type)}</strong>
        <span class="count-badge">${rows.length} item${rows.length !== 1 ? 's' : ''}</span>
      `;
      header.style.cursor = 'pointer';
      header.style.userSelect = 'none';

      // Collapsible body
      const body = document.createElement('div');
      body.className = 'panel-body-collapsible';
      body.style.display = isOpen ? 'block' : 'none';
      body.dataset.slug = slug;
      body.dataset.type = type;

      panel.appendChild(header);
      panel.appendChild(body);
      wrap.appendChild(panel);

      // Toggle accordion on header click
      header.addEventListener('click', () => {
        const isCurrentlyOpen = body.style.display !== 'none';
        const icon = header.querySelector('.toggle-icon');
        
        if (!isCurrentlyOpen && !body.dataset.rendered) {
          // Lazy render this table
          renderSingleTypeTable(body, type, rows, slug);
          body.dataset.rendered = 'true';
        }
        
        // Toggle visibility
        body.style.display = isCurrentlyOpen ? 'none' : 'block';
        icon.textContent = isCurrentlyOpen ? '▶' : '▼';
      });

      // Render the first table immediately
      if (isOpen) {
        renderSingleTypeTable(body, type, rows, slug);
        body.dataset.rendered = 'true';
      }
    });
  }

  function renderSingleTypeTable(bodyContainer, type, rows, slug) {
    // Selection bucket per type
    if (!repairsState.selectedByType.has(type)) {
      repairsState.selectedByType.set(type, new Set());
    }
    const selSet = repairsState.selectedByType.get(type);

    // Create table structure
    const scroller = document.createElement('div');
    scroller.className = 'table-scroll';

    const table = document.createElement('table');
    table.className = 'data-table';
    table.id = `globalTable_${slug}`;

    const nameHdr = (type === 'Repair') ? 'Repair Name' : 'Item';
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width:40px;">
            <input type="checkbox" id="selectAll_${slug}" title="Select all ${type}" />
          </th>
          <th>Date</th>
          <th>Station ID</th>
          <th>Location</th>
          <th>Asset Type</th>
          <th>${nameHdr}</th>
          <th>Severity</th>
          <th>Priority</th>
          <th>Cost</th>
          <th>Category</th>
          <th>Days</th>
        </tr>
      </thead>
      <tbody id="globalBody_${slug}"></tbody>
    `;

    scroller.appendChild(table);
    bodyContainer.appendChild(scroller);

    const tbody = table.querySelector('tbody');

    // Simple direct rendering (no virtualization needed for small datasets)
    rows.forEach((r, i) => {
      const checked = selSet.has(r) ? 'checked' : '';
      const tr = document.createElement('tr');
      tr.dataset.index = i;
      tr.innerHTML = `
        <td><input type="checkbox" class="type-checkbox" ${checked} data-idx="${i}"></td>
        <td>${esc(r.date || '')}</td>
        <td>${esc(r.station_id || '')}</td>
        <td>${esc(r.location || '')}</td>
        <td>${esc(r.assetType || '')}</td>
        <td>${esc(r.name || '')}</td>
        <td>${esc(r.severity || '')}</td>
        <td>${esc(r.priority || '')}</td>
        <td>${formatCost(r.cost)}</td>
        <td>${esc(r.category || '')}</td>
        <td>${esc(r.days || '')}</td>
      `;
      tbody.appendChild(tr);
    });

    // Delegate per-row selection
    tbody.addEventListener('change', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || !t.classList.contains('type-checkbox')) return;
      const idx = Number(t.dataset.idx);
      if (Number.isNaN(idx)) return;
      const item = rows[idx];
      if (!item) return;
      if (t.checked) selSet.add(item); else selSet.delete(item);
      _setTriState(document.getElementById(`selectAll_${slug}`), selSet.size, rows.length);
      updateAllCheckboxes(); // Update global count
    });

    // Header select-all
    const hdr = document.getElementById(`selectAll_${slug}`);
    hdr?.addEventListener('change', (e) => {
      if (e.target.checked) {
        selSet.clear();
        rows.forEach(r => selSet.add(r));
      } else {
        selSet.clear();
      }
      vt.refresh();
      // Re-render checkboxes
      tbody.querySelectorAll('.type-checkbox').forEach((cb, i) => {
        cb.checked = selSet.has(rows[i]);
      });
      _setTriState(hdr, selSet.size, rows.length);
      updateAllCheckboxes(); // Update global count
    });
    _setTriState(hdr, selSet.size, rows.length);
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
              ${filterOptions.companies.map(c => {
                const name = c.name || c;
                return `<option value="${name}">${name}</option>`;
              }).join('')}
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
            <label>Type / Scope Type</label>
            <input id="grType" type="text" placeholder="e.g. Repair, Monitoring, Coating…" />
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
        type: ($('#grType').value || '').trim() || 'Repair',
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
      companies: (tree.companies || []).map(c => c.name || c),
      locationsByCompany: tree.locationsByCompany || {},
      assetTypesByLocation
    };
  }

  async function resolveSelectedRepairs() {
    // Flatten all selections across types
    const allSelected = [...repairsState.selectedByType.values()].reduce((acc, set) => {
      set.forEach(x => acc.push(x));
      return acc;
    }, []);

    if (allSelected.length === 0) {
      appAlert('No items selected to resolve');
      return;
    }
    
    const confirmed = await appConfirm(`Are you sure you want to resolve ${allSelected.length} selected items? This will permanently delete them.`);
    if (!confirmed) return;
    
    // Group by station for efficient deletion
    const byStation = new Map();
    allSelected.forEach(repair => {
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

  function selectAllRepairs() {
    // Group repairs by type
    const groups = _groupByType(repairsState.allRepairs);
    
    // Select all repairs in each type
    groups.forEach(([type, rows]) => {
      if (!repairsState.selectedByType.has(type)) {
        repairsState.selectedByType.set(type, new Set());
      }
      const selSet = repairsState.selectedByType.get(type);
      selSet.clear();
      rows.forEach(r => selSet.add(r));
    });
    
    // Update all visible checkboxes
    updateAllCheckboxes();
  }

  function deselectAllRepairs() {
    // Clear all selections
    repairsState.selectedByType.forEach((selSet) => {
      selSet.clear();
    });
    
    // Update all visible checkboxes
    updateAllCheckboxes();
  }

  function updateAllCheckboxes() {
    const groups = _groupByType(repairsState.allRepairs);
    let totalSelected = 0;
    
    groups.forEach(([type, rows]) => {
      const slug = _slug(type || 'repair') || 'repair';
      const selSet = repairsState.selectedByType.get(type);
      totalSelected += selSet ? selSet.size : 0;
      const tbody = document.getElementById(`globalBody_${slug}`);
      
      // Only update if the section is rendered
      if (tbody) {
        // Update row checkboxes
        tbody.querySelectorAll('.type-checkbox').forEach((cb, i) => {
          cb.checked = selSet ? selSet.has(rows[i]) : false;
        });
        
        // Update header checkbox tri-state
        const hdr = document.getElementById(`selectAll_${slug}`);
        _setTriState(hdr, selSet ? selSet.size : 0, rows.length);
      }
    });

    // Update selection count display
    const countEl = document.getElementById('repairsSelectionCount');
    if (countEl) {
      countEl.textContent = `${totalSelected} selected`;
    }
  }

  // No-op now; select-all is wired per dynamic table in renderTypeTables()
  function wireSelectAllCheckboxes() {}

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
  // Usage: rowsHaveColumn(result.rows, ['Type', 'Scope Type', 'Repair/Maintenance', 'Work Type'])
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
      const hasTypeColumn = rowsHaveColumn(result.rows, ['Type', 'Scope Type', 'Repair/Maintenance', 'Work Type']);

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
      scopeType: pickField(row, ['Scope Type']),
      // If there is NO Type column at all, leave blank to force a per-row prompt.
      // If present, keep whatever is provided (no coercion).
      type: (function () {
        const raw = (pickField(row, ['Scope Type', 'Type', 'Repair/Maintenance', 'Work Type']) || '').trim();
        if (!raw) return noTypeColumn ? '' : 'Repair';
        return raw;
      })()
    };

    // Normalize common cost input formats without destroying ranges like "10-20" or "<2"
    if (mapped.cost) {
      const v = String(mapped.cost).trim();
      // e.g., 12K or 12k -> 12000
      const kMatch = v.match(/^\$?\s*([0-9]+(?:\.[ss0-9]+)?)\s*[kK]\s*$/);
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
      { key: 'category',  label: 'Category',      type: 'select', options: ['Capital', 'O&M', 'Decommission'], bulk: true },
      { key: 'type',      label: 'Type / Scope Type', type: 'text', bulk: true },
      { key: 'assetType', label: 'Asset Type',    type: 'select-dynamic', bulk: true },
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
          const applyAllHtml = (f.bulk)
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
        const applyAllIdText = `mf_${f.key}_all`;
        const applyAllHtmlText = f.bulk
          ? `<label style="margin-left:8px;font-size:0.9em;">
               <input id="${applyAllIdText}" type="checkbox"> Apply to all remaining missing
             </label>`
          : '';
        return `
          <div class="form-row">
            <label>${f.label}</label>
            <input id="${id}" type="${f.type === 'number' ? 'number' : 'text'}" placeholder="${ph}" ${step} />
            ${applyAllHtmlText}
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

            // Optional bulk apply for selected/bulk-enabled fields
            if (f.bulk && v) {
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
        'Type': repair.scopeType || repair.type || 'Repair',
        'Scope Type': repair.scopeType || repair.type || 'Repair',
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
    const tabAnalytics = $('#tabAnalytics');
    const tabRepairs = $('#tabRepairs');
    const paneAnalytics = $('#analyticsTab');
    const paneRepairs = $('#repairsTab');

    if (tabAnalytics) {
      tabAnalytics.addEventListener('click', () => {
        tabAnalytics.classList.add('active');
        tabRepairs?.classList.remove('active');
        if (paneAnalytics) paneAnalytics.style.display = '';
        if (paneRepairs) paneRepairs.style.display = 'none';
      });
    }

    if (tabRepairs) {
      tabRepairs.addEventListener('click', async () => {
        tabRepairs.classList.add('active');
        tabAnalytics?.classList.remove('active');
        if (paneRepairs) paneRepairs.style.display = '';
        if (paneAnalytics) paneAnalytics.style.display = 'none';
        await loadRepairsData();
      });
    }
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
    await loadAnalyticsFieldNames();
    applyAnalyticsFilters();
    renderScopeSummary();
    populateScopeSelectors();
    scheduleCardUpdates();
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
    wireBuilder();

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

    const btnSelectAll = $('#btnSelectAllRepairs');
    if (btnSelectAll) {
      btnSelectAll.addEventListener('click', selectAllRepairs);
    }

    const btnDeselectAll = $('#btnDeselectAllRepairs');
    if (btnDeselectAll) {
      btnDeselectAll.addEventListener('click', deselectAllRepairs);
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
      scheduleCardUpdates();
    });
  }

  // Expose init for index loader
  window.initStatisticsView = initStatisticsView;
})();
