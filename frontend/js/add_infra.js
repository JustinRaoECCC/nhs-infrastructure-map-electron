// frontend/js/add_infra.js - Updated with schema conformance on import
(function () {
  'use strict';

  // Utilities
  const debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  // ===== Virtualized table helper (windowing) =====
  function mountVirtualizedTable({
    rows,
    tbody,
    renderRowHTML,
    rowHeight = 44,
    overscan = 10,
    // NEW: only create a viewport when useful; otherwise shrink to content
    adaptiveHeight = true,
    maxViewport = 520,   // cap table height (px) when long
    minViewport = 0      // allow full shrink; set e.g. 120 if you want a floor
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

      // Re-attach spacers if tbody got nuked
      if (topSpacer.parentNode !== tbody || bottomSpacer.parentNode !== tbody) {
        tbody.innerHTML = '';
        tbody.appendChild(topSpacer);
        tbody.appendChild(bottomSpacer);
      }

      // --- NEW: adaptive viewport sizing ---
      if (adaptiveHeight) {
        const table = tbody.closest('table');
        const headH = (table && table.tHead) ? table.tHead.offsetHeight || 0 : 0;
        const total = rows.length;
        const bodyH = Math.max(0, total) * rowHeight;
        const needed = headH + bodyH;                     // exact content height
        const target = Math.max(minViewport, Math.min(maxViewport, needed));
        // If data is short, we shrink; if long, we cap at maxViewport for scrolling.
        scroller.style.height = target + 'px';
        scroller.style.overflowY = 'auto';
        scroller.style.position = scroller.style.position || 'relative';
      }
      // -------------------------------------

      const viewH = scroller.clientHeight || 400;
      const scrollTop = scroller.scrollTop | 0;
      const total = rows.length;

      const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
      const last  = Math.min(total, Math.ceil((scrollTop + viewH) / rowHeight) + overscan);
      if (first === start && last === end) return;
      start = first; end = last;

      topSpacer.firstElementChild.style.height = (start * rowHeight) + 'px';
      bottomSpacer.firstElementChild.style.height = ((rows.length - end) * rowHeight) + 'px';

      // clear current slice
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
      update(newRows) {
        rows = newRows || [];
        start = -1; end = -1;
        recompute();
        requestAnimationFrame(recompute);
      },
      refresh() { recompute(); },
      destroy() {
        scroller.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        if (rafId) cancelAnimationFrame(rafId);
        // Let the page flow naturally when we tear down
        if (adaptiveHeight) scroller.style.height = '';
      }
    };
  }

  function safeEnableFullWidthMode() {
    try {
      if (typeof window.enableFullWidthMode === 'function') return window.enableFullWidthMode();
      const main = document.getElementById('mainContent'); if (main) main.classList.add('full-width');
    } catch (_) {}
  }
  function safeDisableFullWidthMode() {
    try {
      if (typeof window.disableFullWidthMode === 'function') return window.disableFullWidthMode();
      const main = document.getElementById('mainContent'); if (main) main.classList.remove('full-width');
    } catch (_) {}
  }

  // Nav helpers
  function setActiveNav(activeId) {
    try {
      document.querySelectorAll('.left-panel .nav-item').forEach(li => li.classList.remove('active'));
      const el = document.getElementById(activeId);
      if (el) el.classList.add('active');
    } catch (_) {}
  }

  function showViews({ map = false, list = false, docs = false, wizard = false, settings = false }) {
    const mapEl      = document.getElementById('mapContainer');
    const listEl     = document.getElementById('listContainer');
    const docsEl     = document.getElementById('dashboardContentContainer');
    const wizardWrap = document.getElementById('addInfraContainer');
    const settingsEl = document.getElementById('settingsContainer');
    const stationEl  = document.getElementById('stationContentContainer');

    if (mapEl)      mapEl.style.display      = map    ? 'block' : 'none';
    if (listEl)     listEl.style.display     = list   ? 'block' : 'none';
    if (docsEl)     docsEl.style.display     = docs   ? 'block' : 'none';
    if (wizardWrap) wizardWrap.style.display = wizard ? 'block' : 'none';
    if (settingsEl) settingsEl.style.display = settings ? 'block' : 'none';

    if (stationEl && (map || list || docs || wizard || settings)) stationEl.style.display = 'none';
  }

  async function showMapView() {
    setActiveNav('navMap');
    showViews({ map: true, list: false, docs: false, wizard: false, settings: false });
    safeDisableFullWidthMode();
    if (window.map && typeof window.map.invalidateSize === 'function') {
      setTimeout(() => { try { window.map.invalidateSize(); } catch(_) {} }, 50);
    }
    if (typeof window.refreshMarkers === 'function') setTimeout(() => window.refreshMarkers(), 0);
  }

  async function showListView() {
    setActiveNav('navList');
    showViews({ map: false, list: true, docs: false, wizard: false, settings: false });
    safeDisableFullWidthMode();

    const listEl = document.getElementById('listContainer');
    if (!listEl) return;

    if (!listEl.dataset.loaded) {
      try {
        const resp = await fetch('list.html');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        listEl.innerHTML = await resp.text();
        listEl.dataset.loaded = '1';
        if (window.initListView) requestAnimationFrame(() => window.initListView());
      } catch (e) {
        console.error('[showListView] failed to load list.html:', e);
        listEl.innerHTML = `
          <div id="listPage" class="list-view">
            <div class="list-toolbar" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;">
              <h2 style="margin:0;font-size:1rem;">Stations</h2>
              <div id="listCount" class="badge" style="display:none;"></div>
            </div>
            <div class="table-scroll">
              <table id="stationTable" class="data-table">
                <thead>
                  <tr>
                    <th>Station ID</th>
                    <th>Category</th>
                    <th>Site Name</th>
                    <th>Province</th>
                    <th>Latitude</th>
                    <th>Longitude</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody></tbody>
              </table>
            </div>
            <p class="hint" style="opacity:.75;margin-top:.5rem;">Tip: Click a column header to sort. Hover a row to see details on the right. Click to open full details.</p>
          </div>`;
        if (window.initListView) requestAnimationFrame(() => window.initListView());
      }
    } else {
      if (window.initListView) window.initListView();
    }
  }

  async function showSettingsView() {
    setActiveNav('navSettings');
    showViews({ map: false, list: false, docs: false, wizard: false, settings: true });
    safeDisableFullWidthMode();

    const container = document.getElementById('settingsContainer');
    if (!container) return;

    if (!container.dataset.loaded) {
      try {
        const resp = await fetch('settings.html');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        container.innerHTML = await resp.text();
        container.dataset.loaded = '1';
        if (window.initSettingsView) requestAnimationFrame(() => window.initSettingsView());
      } catch (e) {
        console.error('[showSettingsView] failed to load settings.html:', e);
        container.innerHTML = `
          <div id="settingsPage" class="settings-view">
            <h2>Settings</h2>
            <p>Failed to load settings.</p>
          </div>`;
        if (window.initSettingsView) requestAnimationFrame(() => window.initSettingsView());
      }
    } else {
      if (window.initSettingsView) window.initSettingsView();
    }
  }

  async function showDocsView() {
    setActiveNav('navDash');
    showViews({ map: false, list: false, docs: true, wizard: false, settings: false });
    safeDisableFullWidthMode();
    if (!document.getElementById('dashboardContentContainer')) showMapView();
  }

  // Panel host helpers
  function showPanel(html) {
    const container = document.getElementById('addInfraContainer');
    if (!container) return null;
    container.innerHTML = html;
    showViews({ map:false, list:false, docs:false, wizard:true, settings:false });
    safeEnableFullWidthMode();
    setActiveNav('navNewCompany');
    return container;
  }
  function closePanel() {
    const container = document.getElementById('addInfraContainer');
    if (container) container.innerHTML = '';
    showViews({ map:true, list:false, docs:false, wizard:false, settings:false });
    safeDisableFullWidthMode();
    if (window.map && typeof window.map.invalidateSize === 'function') {
      setTimeout(() => { try { window.map.invalidateSize(); } catch(_) {} }, 50);
    }
  }

  // Create Company panel
  async function openCreateCompanyForm() {
    const view = `
      <div class="panel-form">
        <h2 style="margin-top:0;">Create Company</h2>
        <div class="form-row">
          <label>Company Name*</label>
          <input type="text" id="coName" placeholder="Company name..." />
        </div>
        <div class="form-row">
          <label>Company Description</label>
          <textarea id="coDesc" rows="4" placeholder=""></textarea>
        </div>
        <div class="form-row">
          <label>Company Email*</label>
          <input type="email" id="coEmail" placeholder="" />
        </div>
        <div class="wizard-footer" style="justify-content:flex-end;">
          <button id="btnCancel" class="btn btn-ghost">Cancel</button>
          <button id="btnSave" class="btn btn-primary">Save</button>
        </div>
      </div>`;
    const host = showPanel(view);
    if (!host) return;

    const $ = sel => host.querySelector(sel);
    $('#btnCancel')?.addEventListener('click', () => closePanel());
    $('#btnSave')?.addEventListener('click', async () => {
      const name = ($('#coName')?.value || '').trim();
      if (!name) return alert('Please enter a company name.');
      try {
        const res = await window.electronAPI.upsertCompany(name, true);
        if (!res || res.success === false) return alert('Failed to create company.');
        await window.refreshFilters?.();
        closePanel();
      } catch (e) {
        console.error('[CreateCompany] failed', e); alert('Unexpected error.');
      }
    });
  }

  // Create Project/Location
  async function openCreateLocationForm(company) {
    const view = `
      <div class="panel-form">
        <h2 style="margin-top:0;">Create Project/Location</h2>
        <div class="form-row">
          <label>Company</label>
          <input type="text" value="${(company||'')}" disabled />
        </div>
        <div class="form-row">
          <label>Location*</label>
          <input type="text" id="locName" placeholder="Location name..." />
        </div>
        <div class="wizard-footer" style="justify-content:flex-end;">
          <button id="btnCancel" class="btn btn-ghost">Cancel</button>
          <button id="btnSave" class="btn btn-primary">Save</button>
        </div>
      </div>`;
    const host = showPanel(view);
    if (!host) return;

    const $ = sel => host.querySelector(sel);
    $('#btnCancel')?.addEventListener('click', () => closePanel());
    $('#btnSave')?.addEventListener('click', async () => {
      const loc = ($('#locName')?.value || '').trim();
      if (!loc) return alert('Please enter a location.');
      try {
        const res = await window.electronAPI.upsertLocation(loc, company);
        if (!res || res.success === false) return alert('Failed to create location.');
        await window.refreshFilters?.();
        closePanel();
      } catch (e) {
        console.error('[CreateLocation] failed', e); alert('Unexpected error.');
      }
    });
  }

  // Manual Instance Wizard (2 steps)
  async function openManualInstanceWizard(company, location, assetType) {
    const view = `
      <div class="panel-form" id="manualPanel">
        <h2 style="margin-top:0;">Add ${assetType ? `“${assetType}”` : 'Asset'} Manually</h2>
        <div class="card">
          <div class="card-title">Context</div>
          <div class="kv">
            <div><strong>Company:</strong> ${company || '—'}</div>
            <div><strong>Location / Province:</strong> ${location || '—'}</div>
            <div><strong>Asset Type (Category):</strong> ${assetType || '—'}</div>
          </div>
        </div>

        <div id="mStep1" class="wizard-step active">
          <h3>General Information</h3>
          <div class="form-row">
            <label>Station ID*</label>
            <input type="text" id="mStationId" placeholder="e.g., 12345" />
          </div>
          <div class="form-row">
            <label>Site Name*</label>
            <input type="text" id="mSiteName" placeholder="e.g., River Bridge" />
          </div>
          <div class="form-row">
            <label>Latitude*</label>
            <input type="text" id="mLat" placeholder="e.g., 49.2827" />
          </div>
          <div class="form-row">
            <label>Longitude*</label>
            <input type="text" id="mLon" placeholder="e.g., -123.1207" />
          </div>
          <div class="form-row">
            <label>Status*</label>
            <select id="mStatus">
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
              <option value="MOTHBALLED">MOTHBALLED</option>
              <option value="UNKNOWN">UNKNOWN</option>
            </select>
          </div>
        </div>

        <div id="mStep2" class="wizard-step" style="display:none;">
          <h3>Additional Sections & Fields</h3>
          <p class="hint" style="margin-top:.25rem;">Add as many as you want. <strong>Section</strong> and <strong>Field</strong> are required. Value can be blank.</p>
          <div class="table-scroll">
            <table class="data-table" id="mSfTable">
              <thead>
                <tr><th style="width:32%;">Section*</th><th style="width:32%;">Field*</th><th>Value</th><th style="width:1%;"></th></tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
          <div style="margin-top:.5rem;">
            <button id="mAddRow" class="btn btn-ghost">+ Add row</button>
          </div>
        </div>

        <div class="wizard-footer" style="justify-content:flex-end;">
          <button id="mCancel" class="btn btn-ghost">Cancel</button>
          <button id="mBack" class="btn btn-ghost" disabled>Back</button>
          <button id="mNext" class="btn btn-primary">Next</button>
          <button id="mSave" class="btn btn-primary" style="display:none;">Save</button>
        </div>
      </div>`;
    const host = showPanel(view);
    if (!host) return;

    const $ = sel => host.querySelector(sel);
    const tbody = $('#mSfTable tbody');

    function addRow(sec = '', fld = '', val = '') {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" class="mSec" placeholder="Section name" value="${sec}"/></td>
        <td><input type="text" class="mFld" placeholder="Field name" value="${fld}"/></td>
        <td><input type="text" class="mVal" placeholder="Value (optional)" value="${val}"/></td>
        <td><button class="btn btn-ghost mDelRow" title="Remove">×</button></td>`;
      tr.querySelector('.mDelRow').addEventListener('click', () => tr.remove());
      tbody.appendChild(tr);
    }

    $('#mAddRow').addEventListener('click', () => addRow());

    $('#mCancel').addEventListener('click', () => closePanel());
    $('#mNext').addEventListener('click', () => {
      const stationId = ($('#mStationId')?.value || '').trim();
      const siteName  = ($('#mSiteName')?.value || '').trim();
      const lat       = ($('#mLat')?.value || '').trim();
      const lon       = ($('#mLon')?.value || '').trim();
      const status    = ($('#mStatus')?.value || '').trim() || 'UNKNOWN';
      if (!stationId || !siteName || !lat || !lon) {
        return alert('Please fill Station ID, Site Name, Latitude, and Longitude.');
      }
      if (isNaN(Number(lat)) || isNaN(Number(lon))) {
        return alert('Latitude and Longitude must be numeric.');
      }
      $('#mStep1').style.display = 'none';
      $('#mStep1').classList.remove('active');
      $('#mStep2').style.display = '';
      $('#mStep2').classList.add('active');
      $('#mBack').disabled = false;
      $('#mNext').style.display = 'none';
      $('#mSave').style.display = '';
      if (!tbody.children.length) addRow();
    });
    $('#mBack').addEventListener('click', () => {
      $('#mStep2').style.display = 'none';
      $('#mStep2').classList.remove('active');
      $('#mStep1').style.display = '';
      $('#mStep1').classList.add('active');
      $('#mBack').disabled = true;
      $('#mNext').style.display = '';
      $('#mSave').style.display = 'none';
    });

    $('#mSave').addEventListener('click', async () => {
      const payload = {
        company,
        location,
        assetType,
        general: {
          stationId: ($('#mStationId')?.value || '').trim(),
          siteName:  ($('#mSiteName')?.value || '').trim(),
          lat:       ($('#mLat')?.value || '').trim(),
          lon:       ($('#mLon')?.value || '').trim(),
          status:    ($('#mStatus')?.value || 'UNKNOWN').trim()
        },
        extras: []
      };
      if (!payload.general.stationId || !payload.general.siteName || !payload.general.lat || !payload.general.lon) {
        return alert('General Information is incomplete.');
      }
      if (isNaN(Number(payload.general.lat)) || isNaN(Number(payload.general.lon))) {
        return alert('Latitude and Longitude must be numeric.');
      }
      const rows = Array.from(tbody.querySelectorAll('tr'));
      for (const tr of rows) {
        const sec = (tr.querySelector('.mSec')?.value || '').trim();
        const fld = (tr.querySelector('.mFld')?.value || '').trim();
        const val = (tr.querySelector('.mVal')?.value || '').trim();
        if (!sec && !fld && !val) continue;
        if (!sec || !fld) {
          return alert('Each added row requires both Section and Field.');
        }
        payload.extras.push({ section: sec, field: fld, value: val });
      }
      try {
        $('#mSave').disabled = true;
        $('#mSave').textContent = 'Saving…';
        const res = await window.electronAPI.manualCreateInstance(payload);
        if (!res || res.success === false) {
          alert(res?.message || 'Failed to create instance.');
          return;
        }
        if (typeof window.electronAPI.invalidateStationCache === 'function') {
          await window.electronAPI.invalidateStationCache();
        }
        await window.refreshFilters?.();
        await window.refreshMarkers?.();
        await window.renderList?.();
        alert('Asset created.');
        closePanel();
      } catch (e) {
        console.error('[manualCreate] failed', e);
        alert('Unexpected error while creating the asset.');
      } finally {
        $('#mSave').disabled = false;
        $('#mSave').textContent = 'Save';
      }
    });
  }

  // Import MORE for an existing Asset Type — opens NEW window if available
  async function openImportMoreForAsset(company, location, assetType) {
    if (window.electronAPI && typeof window.electronAPI.openImportMoreWindow === 'function') {
      try { await window.electronAPI.openImportMoreWindow({ company, location, assetType }); } catch (_) {}
      return;
    }

    // Fallback: in-panel importer
    const view = `
      <div class="panel-form" id="importMorePanel">
        <h2 style="margin-top:0;">Import more into “${assetType || 'Asset'}”</h2>

        <div class="card">
          <div class="card-title">Context</div>
          <div class="kv">
            <div><strong>Company:</strong> ${company || '—'}</div>
            <div><strong>Location / Province:</strong> ${location || '—'}</div>
            <div><strong>Asset Type (Category):</strong> ${assetType || '—'}</div>
          </div>
        </div>

        <div class="form-row">
          <label>Excel File</label>
          <div class="filepicker">
            <input type="file" id="imExcel" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
            <span id="imExcelLabel">Select Excel File</span>
          </div>
        </div>

        <div class="form-row">
          <label>Select sheet</label>
          <select id="imSheet" disabled>
            <option>Select Excel file first</option>
          </select>
        </div>

        <hr style="margin:1rem 0;">

        <h3>Select data</h3>
        <div class="table-toolbar">
          <div>
            <button id="imSelectAll" class="btn btn-ghost">Select all</button>
            <button id="imDeselectAll" class="btn btn-ghost">Deselect all</button>
          </div>
          <div id="imCount" class="badge">0 selected</div>
        </div>

        <div class="table-scroll">
          <table id="imTable" class="data-table">
            <thead></thead>
            <tbody></tbody>
          </table>
        </div>

        <div class="wizard-footer" style="justify-content:flex-end;">
          <button id="imCancel" class="btn btn-ghost">Cancel</button>
          <button id="imImport" class="btn btn-primary" disabled>Import Selected</button>
        </div>
      </div>`;
    const host = showPanel(view);
    if (!host) return;

    const $ = sel => host.querySelector(sel);
    const thead = $('#imTable thead');
    const tbody = $('#imTable tbody');

    const state = {
      excelB64: null,
      sheets: [],
      selectedSheet: null,
      headers: [],
      sections: [],
      rows: [],
      selectedIdx: new Set()
    };

    let vtIM = null;
    let bound = false;

    function updateBadge() { $('#imCount').textContent = `${state.selectedIdx.size} selected`; }
    function setButtons() { $('#imImport').disabled = !(state.rows && state.rows.length && state.selectedIdx.size); }
    function setHeaderTriState() {
      const chkAll = thead.querySelector('#imChkAll');
      if (!chkAll) return;
      const total = state.rows.length;
      const sel = state.selectedIdx.size;
      chkAll.checked = sel > 0 && sel === total;
      chkAll.indeterminate = sel > 0 && sel < total;
    }

    function renderTable() {
      const scroller = tbody.closest('.table-scroll');
      // Ensure we have a nice empty note element right before the scroller
      let empty = host.querySelector('#imEmptyNote');
      if (!empty) {
        empty = document.createElement('div');
        empty.id = 'imEmptyNote';
        empty.className = 'empty-note';
        empty.textContent = 'Select an Excel file and sheet to preview rows.';
        scroller.parentNode.insertBefore(empty, scroller);
      }

      thead.innerHTML = '';
      // Do NOT clear tbody if a virtualizer exists; otherwise we drop its spacers.
      if (!vtIM) tbody.innerHTML = '';

      if (!state.rows.length) {
        // Hide table entirely; show empty note
        scroller.classList.add('is-hidden');
        empty.classList.add('show');

        // Tear down any existing virtualizer to free DOM
        if (vtIM) { vtIM.destroy(); vtIM = null; }
        tbody.innerHTML = '';             // keep it truly empty
        updateBadge(); setButtons();       // 0 selected
        return;
      }

      // We have data: show table, hide note
      scroller.classList.remove('is-hidden');
      empty.classList.remove('show');

      // section header
      const trSec = document.createElement('tr');
      const thLead = document.createElement('th');
      thLead.style.width = '36px';
      thLead.innerHTML = '<input id="imChkAll" type="checkbox"/>';
      trSec.appendChild(thLead);

      let i = 0;
      while (i < state.headers.length) {
        const sec = state.sections[i] || '';
        let span = 1;
        while (i + span < state.headers.length && (state.sections[i + span] || '') === sec) span++;
        const th = document.createElement('th');
        th.colSpan = span;
        th.textContent = sec || '';
        trSec.appendChild(th);
        i += span;
      }
      thead.appendChild(trSec);

      // field header
      const trFld = document.createElement('tr');
      trFld.innerHTML = '<th></th>' + state.headers.map(h => `<th>${esc(h)}</th>`).join('');
      thead.appendChild(trFld);

      const chkAll = thead.querySelector('#imChkAll');
      if (chkAll) {
        chkAll.addEventListener('change', () => {
          state.selectedIdx = chkAll.checked ? new Set(state.rows.map((_, i) => i)) : new Set();
          updateBadge(); setHeaderTriState(); setButtons(); vtIM?.refresh();
        });
      }

      // default all selected
      state.selectedIdx = new Set(state.rows.map((_, idx) => idx));

      const renderRowHTML = (row, i) => {
        const checked = state.selectedIdx.has(i) ? 'checked' : '';
        let cells = `<td><input type="checkbox" class="imRowChk" ${checked}></td>`;
        for (let idx = 0; idx < state.headers.length; idx++) {
          const h = state.headers[idx];
          const sec = state.sections[idx] || '';
          const key = sec ? `${sec} – ${h}` : h;
          const val = (row?.[key] ?? row?.[h] ?? '');
          cells += `<td>${esc(val)}</td>`;
        }
        return cells;
      };

      if (!vtIM) {
        vtIM = mountVirtualizedTable({
          rows: state.rows,
          tbody,
          renderRowHTML,
          rowHeight: 44,
          overscan: 10,
          adaptiveHeight: true,  // <-- key line
          maxViewport: 520,
          minViewport: 0
        });
      } else {
        vtIM.update(state.rows);
      }

      requestAnimationFrame(() => vtIM && vtIM.refresh());

      if (!bound) {
        bound = true;
        tbody.addEventListener('change', (e) => {
          const t = e.target;
          if (!(t instanceof HTMLInputElement) || !t.classList.contains('imRowChk')) return;
          const tr = t.closest('tr'); if (!tr) return;
          const idx = Number(tr.dataset.index); if (Number.isNaN(idx)) return;
          if (t.checked) state.selectedIdx.add(idx); else state.selectedIdx.delete(idx);
          updateBadge(); setHeaderTriState(); setButtons();
        });
      }

      updateBadge(); setHeaderTriState(); setButtons();
    }

    async function buildPreview() {
      if (!state.excelB64 || !state.selectedSheet) {
        state.rows = [];
        renderTable();
        return;
      }
      try {
        const res = await window.electronAPI.excelParseRowsFromSheet(state.excelB64, state.selectedSheet);
        if (!res || res.success === false) {
          console.error('[importMore] parseRowsFromSheet failed:', res?.message);
          state.rows = [];
          renderTable();
          return;
        }
        state.rows = res.rows || [];
        state.headers = res.headers || (state.rows.length ? Object.keys(state.rows[0]) : []);
        state.sections = res.sections || state.headers.map(() => '');
        renderTable();
      } catch (e) {
        console.error('[importMore] buildPreview error', e);
        state.rows = [];
        renderTable();
      }
    }

    $('#imCancel').addEventListener('click', () => closePanel());
    $('#imSelectAll').addEventListener('click', () => {
      state.selectedIdx = new Set(state.rows.map((_, i) => i));
      updateBadge(); setHeaderTriState(); setButtons(); vtIM?.refresh();
    });
    $('#imDeselectAll').addEventListener('click', () => {
      state.selectedIdx.clear();
      updateBadge(); setHeaderTriState(); setButtons(); vtIM?.refresh();
    });

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const rdr = new FileReader();
        rdr.onload = () => {
          const s = String(rdr.result || '');
          const i = s.indexOf(',');
          resolve(i >= 0 ? s.slice(i + 1) : s);
        };
        rdr.onerror = reject;
        rdr.readAsDataURL(file);
      });
    }

    function populateSheetSelect(names) {
      const sel = $('#imSheet');
      sel.innerHTML = '';
      if (!names || !names.length) {
        sel.appendChild(new Option('No sheets detected', '', true, true));
        sel.disabled = true;
        return;
      }
      names.forEach((n, i) => sel.appendChild(new Option(n, n, i === 0, i === 0)));
      sel.disabled = false;
      state.selectedSheet = sel.value || null;
    }

    $('#imExcel').addEventListener('change', async (e) => {
      const f = (e.target.files || [])[0];
      if (!f) {
        state.excelB64 = null; state.sheets = []; populateSheetSelect([]); renderTable(); return;
      }
      $('#imExcelLabel').textContent = f.name || 'Selected Excel';
      try {
        state.excelB64 = await fileToBase64(f);
        const res = await window.electronAPI.excelListSheets(state.excelB64);
        state.sheets = (res && res.sheets) || [];
        populateSheetSelect(state.sheets);
        await buildPreview();
      } catch (err) {
        console.error('[importMore] list sheets failed', err);
        populateSheetSelect([]); renderTable();
      }
    });

    $('#imSheet').addEventListener('change', async () => {
      state.selectedSheet = $('#imSheet').value || null;
      await buildPreview();
    });

    $('#imImport').addEventListener('click', async () => {
      const idxs = Array.from(state.selectedIdx.values()).sort((a, b) => a - b);
      if (!idxs.length) return alert('Please select at least one row.');
      try {
        $('#imImport').textContent = 'Importing…';
        $('#imImport').disabled = true;
        const selectedRows = idxs.map(i => state.rows[i]).filter(Boolean);
        const payload = {
          location,
          company,
          sheetName: state.selectedSheet || 'Data',
          sections: state.sections,
          headers: state.headers,
          rows: selectedRows,
          assetType
        };
        const res = await window.electronAPI.importSelection(payload);
        if (!res || res.success === false) return alert(res?.message || 'Import failed.');
        if (typeof window.electronAPI.invalidateStationCache === 'function') {
          await window.electronAPI.invalidateStationCache();
        }
        await window.refreshFilters?.();
        await window.refreshMarkers?.();
        await window.renderList?.();
        alert(`Successfully imported ${res.added} row(s) into “${assetType}”.`);
        closePanel();
      } catch (e) {
        console.error('[importMore] import failed', e);
        alert('Unexpected import error. See console.');
      } finally {
        $('#imImport').textContent = 'Import Selected';
        setButtons();
      }
    });

    // initial empty render
    renderTable();
  }

  // Create Assets - Updated with schema conformance + virtualization
  async function openCreateAssetsWizard(company, location) {
    const view = `
      <div class="panel-form" id="assetsPanel">
        <h2 style="margin-top:0;">Create Assets</h2>

        <div class="card">
          <div class="card-title">Context</div>
          <div class="kv">
            <div><strong>Company:</strong> ${company || '—'}</div>
            <div><strong>Location:</strong> ${location || '—'}</div>
          </div>
        </div>

        <div class="form-row">
          <label>Asset Name*</label>
          <input type="text" id="assetName2" placeholder="Enter asset name" />
        </div>

        <div class="form-row">
          <label>Excel File</label>
          <div class="filepicker">
            <input type="file" id="excelFile2" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
            <span id="excelFile2Label">Select Excel File</span>
          </div>
        </div>

        <div class="form-row">
          <label>Select sheet</label>
          <select id="sheetSelect2" disabled>
            <option>Select Excel file first</option>
          </select>
        </div>

        <hr style="margin:1rem 0;">

        <h3>Select data</h3>
        <div class="table-toolbar">
          <div>
            <button id="btnSelectAll2" class="btn btn-ghost">Select all</button>
            <button id="btnDeselectAll2" class="btn btn-ghost">Deselect all</button>
          </div>
          <div id="rowCount2" class="badge">0 selected</div>
        </div>

        <div class="table-scroll">
          <table id="previewTable2" class="data-table">
            <thead></thead>
            <tbody></tbody>
          </table>
        </div>

        <div class="wizard-footer" style="justify-content:flex-end;">
          <button id="btnCancel2" class="btn btn-ghost">Cancel</button>
          <button id="btnImport2" class="btn btn-primary" disabled>Import Selected</button><button id="btnManual2" class="btn btn-ghost" style="margin-left:.5rem;">Create Manually…</button>
        </div>
      </div>`;
    const host = showPanel(view);
    if (!host) return;

    const $ = sel => host.querySelector(sel);
    const thead = $('#previewTable2 thead');
    const tbody = $('#previewTable2 tbody');

    const state = {
      excelB64: null,
      sheets: [],
      selectedSheet: null,
      headers: [],
      sections: [],
      rows: [],
      selectedIdx: new Set()
    };

    let vt2 = null;
    let bound = false;

    function updateBadge() { $('#rowCount2').textContent = `${state.selectedIdx.size} selected`; }
    function setButtonsState() {
      const hasExcel = !!(state.rows && state.rows.length);
      $('#btnImport2').disabled = !hasExcel || !state.selectedIdx.size;
      $('#btnManual2').disabled = !($('#assetName2')?.value || '').trim();
    }
    function setHeaderTriState() {
      const chkAll = thead.querySelector('#chkAll2');
      if (!chkAll) return;
      const total = state.rows.length;
      const sel = state.selectedIdx.size;
      chkAll.checked = sel > 0 && sel === total;
      chkAll.indeterminate = sel > 0 && sel < total;
    }

    function renderTable() {
      const scroller = tbody.closest('.table-scroll');
      let empty = host.querySelector('#caEmptyNote');
      if (!empty) {
        empty = document.createElement('div');
        empty.id = 'caEmptyNote';
        empty.className = 'empty-note';
        empty.textContent = 'Select an Excel file and sheet to preview rows.';
        scroller.parentNode.insertBefore(empty, scroller);
      }

      thead.innerHTML = '';
      if (!vt2) tbody.innerHTML = '';

      if (!state.rows.length) {
        scroller.classList.add('is-hidden');
        empty.classList.add('show');
        if (vt2) { vt2.destroy(); vt2 = null; }
        tbody.innerHTML = '';
        updateBadge(); setButtonsState();
        return;
      }

      scroller.classList.remove('is-hidden');
      empty.classList.remove('show');

      // section header
      const trSec = document.createElement('tr');
      const thLead = document.createElement('th');
      thLead.style.width = '36px';
      thLead.innerHTML = '<input id="chkAll2" type="checkbox"/>';
      trSec.appendChild(thLead);

      let i = 0;
      while (i < state.headers.length) {
        const sec = state.sections[i] || '';
        let span = 1;
        while (i + span < state.headers.length && (state.sections[i + span] || '') === sec) span++;
        const th = document.createElement('th');
        th.colSpan = span;
        th.textContent = sec || '';
        trSec.appendChild(th);
        i += span;
      }
      thead.appendChild(trSec);

      // field header
      const trFld = document.createElement('tr');
      trFld.innerHTML = '<th></th>' + state.headers.map(h => `<th>${esc(h)}</th>`).join('');
      thead.appendChild(trFld);

      const chkAll = thead.querySelector('#chkAll2');
      if (chkAll) {
        chkAll.addEventListener('change', () => {
          state.selectedIdx = chkAll.checked ? new Set(state.rows.map((_, i) => i)) : new Set();
          updateBadge(); setHeaderTriState(); setButtonsState(); vt2?.refresh();
        });
      }

      state.selectedIdx = new Set(state.rows.map((_, idx) => idx));

      const renderRowHTML = (row, i) => {
        const checked = state.selectedIdx.has(i) ? 'checked' : '';
        let cells = `<td><input type="checkbox" class="rowchk2" ${checked}></td>`;
        for (let idx = 0; idx < state.headers.length; idx++) {
          const h = state.headers[idx];
          const sec = state.sections[idx] || '';
          const key = sec ? `${sec} – ${h}` : h;
          const val = (row?.[key] ?? row?.[h] ?? '');
          cells += `<td>${esc(val)}</td>`;
        }
        return cells;
      };

      if (!vt2) {
        vt2 = mountVirtualizedTable({
          rows: state.rows,
          tbody,
          renderRowHTML,
          rowHeight: 44,
          overscan: 10,
          adaptiveHeight: true, // <-- key line
          maxViewport: 520,
          minViewport: 0
        });
      } else {
        vt2.update(state.rows);
      }
      requestAnimationFrame(() => vt2 && vt2.refresh());

      if (!bound) {
        bound = true;
        tbody.addEventListener('change', (e) => {
          const t = e.target;
          if (!(t instanceof HTMLInputElement) || !t.classList.contains('rowchk2')) return;
          const tr = t.closest('tr'); if (!tr) return;
          const idx = Number(tr.dataset.index); if (Number.isNaN(idx)) return;
          if (t.checked) state.selectedIdx.add(idx); else state.selectedIdx.delete(idx);
          updateBadge(); setHeaderTriState(); setButtonsState();
        });
      }

      updateBadge(); setHeaderTriState(); setButtonsState();
    }

    async function buildPreview() {
      if (!state.excelB64 || !state.selectedSheet) {
        state.rows = [];
        renderTable();
        return;
      }
      try {
        const res = await window.electronAPI.excelParseRowsFromSheet(state.excelB64, state.selectedSheet);
        if (!res || res.success === false) {
          console.error('[assets] parseRowsFromSheet failed:', res?.message);
          state.rows = [];
          renderTable();
          return;
        }
        state.rows = res.rows || [];
        state.headers = res.headers || (state.rows.length ? Object.keys(state.rows[0]) : []);
        state.sections = res.sections || state.headers.map(() => '');
        renderTable();
      } catch (e) {
        console.error('[assets] buildPreview error', e);
        state.rows = [];
        renderTable();
      }
    }

    // Bind UI
    $('#btnCancel2')?.addEventListener('click', () => closePanel());
    $('#btnSelectAll2')?.addEventListener('click', () => {
      state.selectedIdx = new Set(state.rows.map((_, i) => i));
      updateBadge(); setHeaderTriState(); setButtonsState(); vt2?.refresh();
    });
    $('#btnDeselectAll2')?.addEventListener('click', () => {
      state.selectedIdx.clear();
      updateBadge(); setHeaderTriState(); setButtonsState(); vt2?.refresh();
    });

    host.querySelector('#assetName2')?.addEventListener('input', setButtonsState);

    $('#btnManual2')?.addEventListener('click', () => {
      const assetName = ($('#assetName2')?.value || '').trim();
      if (!assetName) return alert('Please enter an asset name first.');
      openManualInstanceWizard(company, location, assetName);
    });

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const rdr = new FileReader();
        rdr.onload = () => {
          const s = String(rdr.result || '');
          const i = s.indexOf(',');
          resolve(i >= 0 ? s.slice(i + 1) : s);
        };
        rdr.onerror = reject;
        rdr.readAsDataURL(file);
      });
    }

    function populateSheetSelect(names) {
      const sel = $('#sheetSelect2');
      sel.innerHTML = '';
      if (!names || !names.length) {
        sel.appendChild(new Option('No sheets detected', '', true, true));
        sel.disabled = true;
        return;
      }
      names.forEach((n, i) => sel.appendChild(new Option(n, n, i===0, i===0)));
      sel.disabled = false;
      state.selectedSheet = sel.value || null;
    }

    $('#excelFile2')?.addEventListener('change', async (e) => {
      const f = (e.target.files || [])[0];
      if (!f) {
        state.excelB64 = null; state.sheets = []; populateSheetSelect([]); renderTable(); return;
      }
      $('#excelFile2Label').textContent = f.name || 'Selected Excel';
      try {
        state.excelB64 = await fileToBase64(f);
        const res = await window.electronAPI.excelListSheets(state.excelB64);
        state.sheets = (res && res.sheets) || [];
        populateSheetSelect(state.sheets);
        await buildPreview();
      } catch (err) {
        console.error('[assets] list sheets failed', err);
        populateSheetSelect([]); renderTable();
      }
    });

    $('#sheetSelect2')?.addEventListener('change', async () => {
      state.selectedSheet = $('#sheetSelect2').value || null;
      await buildPreview();
    });

    $('#btnImport2')?.addEventListener('click', async () => {
      const assetName = ($('#assetName2')?.value || '').trim();
      if (!assetName) return alert('Please enter an asset name.');
      if (!state.rows.length) return alert('No rows to import (select a sheet).');
      const idxs = Array.from(state.selectedIdx.values()).sort((a,b) => a-b);
      if (!idxs.length) return alert('Please select at least one row.');

      try {
        $('#btnImport2').textContent = 'Importing...';
        $('#btnImport2').disabled = true;

        const up = await window.electronAPI.upsertAssetType(assetName, location);
        if (!up || up.success === false) return alert('Failed to create asset type.');

        const selectedRows = idxs.map(i => state.rows[i]).filter(Boolean);

        const payload = {
          location,
          company,
          sheetName: state.selectedSheet || 'Data',
          sections: state.sections,
          headers: state.headers,
          rows: selectedRows,
          assetType: assetName,
        };

        const res = await window.electronAPI.importSelection(payload);
        if (!res || res.success === false) {
          alert('Import failed.');
          return;
        }

        if (typeof window.invalidateStationData === 'function') window.invalidateStationData();
        if (typeof window.electronAPI.invalidateStationCache === 'function') {
          await window.electronAPI.invalidateStationCache();
        }
        await window.refreshFilters?.();
        await window.refreshMarkers?.();
        await window.renderList?.();

        alert(`Successfully imported ${res.added} row(s). Data will be synchronized with existing ${assetName} schema if applicable.`);
        closePanel();

      } catch (e) {
        console.error('[assets] import failed', e);
        alert('Unexpected import error. See console.');
      } finally {
        $('#btnImport2').textContent = 'Import Selected';
        setButtonsState();
      }
    });

    // initial empty render
    renderTable();
  }

  // Bootstrapping & Nav bindings
  document.addEventListener('DOMContentLoaded', () => {
    const navNewCompany = document.getElementById('navNewCompany');
    if (navNewCompany && !navNewCompany.dataset.boundNew) {
      navNewCompany.addEventListener('click', (e) => {
        e.preventDefault();
        openCreateCompanyForm();
      });
      navNewCompany.dataset.boundNew = '1';
    }

    const navMap  = document.getElementById('navMap');
    const navList = document.getElementById('navList');
    const navDash = document.getElementById('navDash');
    const navSettings = document.getElementById('navSettings');

    if (navMap && !navMap.dataset.bound) {
      navMap.addEventListener('click', (e) => { e.preventDefault(); showMapView(); });
      navMap.dataset.bound = '1';
    }
    if (navList && !navList.dataset.bound) {
      navList.addEventListener('click', (e) => { e.preventDefault(); showListView(); });
      navList.dataset.bound = '1';
    }
    if (navDash && !navDash.dataset.bound) {
      navDash.addEventListener('click', (e) => { e.preventDefault(); showDocsView(); });
      navDash.dataset.bound = '1';
    }
    if (navSettings && !navSettings.dataset.bound) {
      navSettings.addEventListener('click', (e) => { e.preventDefault(); showSettingsView(); });
      navSettings.dataset.bound = '1';
    }
  });

  // Expose for filters.js [+] actions
  window.openCreateCompanyForm  = window.openCreateCompanyForm  || openCreateCompanyForm;
  window.openCreateLocationForm = window.openCreateLocationForm || openCreateLocationForm;
  window.openCreateAssetsWizard = window.openCreateAssetsWizard || openCreateAssetsWizard;
  window.openManualInstanceWizard = window.openManualInstanceWizard || openManualInstanceWizard;
  window.openImportMoreForAsset = window.openImportMoreForAsset || openImportMoreForAsset;

  // Also expose view switches
  window.showMapView   = window.showMapView   || showMapView;
  window.showListView  = window.showListView  || showListView;
  window.showDocsView  = window.showDocsView  || showDocsView;
  window.showSettingsView = window.showSettingsView || showSettingsView;

})();
