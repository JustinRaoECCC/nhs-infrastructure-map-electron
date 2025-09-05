// frontend/js/add_infra.js
// New LHS-driven flows (no legacy wizard):
// - ＋ New Company → simple form panel
// - Company [+]   → Create Project/Location (via window.openCreateLocationForm)
// - Location [+]  → Create Assets (Excel upload → select sheet → select rows → import)
// Also preserves Map/List/Docs/Settings navigation and safe fallbacks.

(function () {
  'use strict';

  // ────────────────────────────────────────────────────────────────────────────
  // Utilities
  // ────────────────────────────────────────────────────────────────────────────
  const debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // Safe wrappers: honor global helpers if present, else no-op / gentle fallback
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

  // ────────────────────────────────────────────────────────────────────────────
  // Nav helpers: set active tab & show the requested view
  // ────────────────────────────────────────────────────────────────────────────
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

    // Hide station page when switching to any main view
    if (stationEl && (map || list || docs || wizard || settings)) stationEl.style.display = 'none';
  }

  // Public-ish view switches used by nav bindings
  async function showMapView() {
    setActiveNav('navMap');
    showViews({ map: true, list: false, docs: false, wizard: false, settings: false });
    safeDisableFullWidthMode();
    // Nudge Leaflet
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
        // Minimal inline fallback
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

  // ────────────────────────────────────────────────────────────────────────────
  // New LHS-driven creation flows
  // ────────────────────────────────────────────────────────────────────────────

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
    // Nudge the map to repaint properly after layout shift
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

  // Create Project/Location (company context fixed)
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

  // Create Assets under a given company+location
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
          <button id="btnImport2" class="btn btn-primary" disabled>Import Selected</button>
        </div>
      </div>`;
    const host = showPanel(view);
    if (!host) return;

    const $ = sel => host.querySelector(sel);

    // Local state
    const state = {
      excelB64: null,
      sheets: [],
      selectedSheet: null,
      headers: [],
      sections: [],
      rows: [],
      selectedIdx: new Set(),
    };

    const thead = $('#previewTable2 thead');
    const tbody = $('#previewTable2 tbody');

    function updateBadge() { $('#rowCount2').textContent = `${state.selectedIdx.size} selected`; }

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

    function renderPreview() {
      if (!thead || !tbody) return;
      thead.innerHTML = ''; tbody.innerHTML = '';
      if (!state.rows.length) {
        tbody.innerHTML = `<tr><td colspan="99" style="opacity:.7;padding:.75em;">Select an Excel file and sheet first.</td></tr>`;
        updateBadge(); return;
      }

      // Build grouped headers from sections/headers
      const trSec = document.createElement('tr');
      const thLead = document.createElement('th'); thLead.style.width = '36px';
      thLead.innerHTML = '<input id="chkAll2" type="checkbox"/>'; trSec.appendChild(thLead);
      let i = 0;
      while (i < state.headers.length) {
        const sec = state.sections[i] || '';
        let span = 1;
        while (i + span < state.headers.length && (state.sections[i + span] || '') === sec) span++;
        const th = document.createElement('th'); th.colSpan = span; th.textContent = sec || '';
        trSec.appendChild(th); i += span;
      }
      thead.appendChild(trSec);

      const trFld = document.createElement('tr');
      trFld.innerHTML = '<th></th>' + state.headers.map(h => `<th>${h}</th>`).join('');
      thead.appendChild(trFld);

      const chkAll = thead.querySelector('#chkAll2');
      if (chkAll) {
        chkAll.addEventListener('change', () => {
          state.selectedIdx = chkAll.checked ? new Set(state.rows.map((_, i) => i)) : new Set();
          tbody.querySelectorAll('input.rowchk2[type=checkbox]').forEach((cb, i) => cb.checked = chkAll.checked);
          updateBadge();
        });
      }

      tbody.innerHTML = '';
      state.selectedIdx = new Set(state.rows.map((_, i) => i)); // default all
      state.rows.forEach((r, i) => {
        const tr = document.createElement('tr');
        const c0 = document.createElement('td');
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.className = 'rowchk2'; cb.checked = true;
        cb.addEventListener('change', () => {
          if (cb.checked) state.selectedIdx.add(i); else state.selectedIdx.delete(i);
          updateBadge();
        });
        c0.appendChild(cb); tr.appendChild(c0);
        state.headers.forEach((h, idx) => {
          const sec = state.sections[idx] || '';
          const key = sec ? `${sec} – ${h}` : h;
          const td = document.createElement('td');
          td.textContent = (r?.[key] ?? r?.[h] ?? '');
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      updateBadge();
    }

    async function buildPreview() {
      if (!state.excelB64 || !state.selectedSheet) { state.rows = []; renderPreview(); return; }
      try {
        const res = await window.electronAPI.excelParseRowsFromSheet(state.excelB64, state.selectedSheet);
        if (!res || res.success === false) {
          console.error('[assets] parseRowsFromSheet failed:', res?.message);
          state.rows = []; renderPreview(); return;
        }
        state.rows     = res.rows || [];
        state.headers  = res.headers || (state.rows.length ? Object.keys(state.rows[0]) : []);
        state.sections = res.sections || state.headers.map(()=> '');
        renderPreview();
      } catch (e) {
        console.error('[assets] buildPreview error', e); state.rows = []; renderPreview();
      }
    }

    // Bind UI
    $('#btnCancel2')?.addEventListener('click', () => closePanel());
    $('#btnSelectAll2')?.addEventListener('click', () => {
      state.selectedIdx = new Set(state.rows.map((_, i) => i));
      tbody?.querySelectorAll('input.rowchk2').forEach(cb => cb.checked = true);
      updateBadge();
    });
    $('#btnDeselectAll2')?.addEventListener('click', () => {
      state.selectedIdx.clear();
      tbody?.querySelectorAll('input.rowchk2').forEach(cb => cb.checked = false);
      updateBadge();
    });

    $('#excelFile2')?.addEventListener('change', async (e) => {
      const f = (e.target.files || [])[0];
      if (!f) {
        state.excelB64 = null; state.sheets = []; populateSheetSelect([]); renderPreview(); return;
      }
      $('#excelFile2Label').textContent = f.name || 'Selected Excel';
      try {
        state.excelB64 = await fileToBase64(f);
        const res = await window.electronAPI.excelListSheets(state.excelB64);
        state.sheets = (res && res.sheets) || [];
        populateSheetSelect(state.sheets);
        $('#btnImport2').disabled = false;
        await buildPreview();
      } catch (err) {
        console.error('[assets] list sheets failed', err);
        populateSheetSelect([]); renderPreview();
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
      const idxs = Array.from(state.selectedIdx.values()).sort((a,b)=>a-b);
      if (!idxs.length) return alert('Please select at least one row.');

      try {
        // Ensure asset type exists under the location
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
        if (!res || res.success === false) return alert('Import failed.');

        // Refresh UI
        if (typeof window.invalidateStationData === 'function') window.invalidateStationData();
        if (typeof window.electronAPI.invalidateStationCache === 'function') await window.electronAPI.invalidateStationCache();
        await window.refreshFilters?.();
        await window.refreshMarkers?.();
        await window.renderList?.();

        alert(`Imported ${res.added} row(s).`);
        closePanel();
      } catch (e) {
        console.error('[assets] import failed', e);
        alert('Unexpected import error. See console.');
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Bootstrapping & Nav bindings
  // ────────────────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    // Left-nav: ＋ New Company → open our new form (no legacy wizard)
    const navNewCompany = document.getElementById('navNewCompany');
    if (navNewCompany && !navNewCompany.dataset.boundNew) {
      navNewCompany.addEventListener('click', (e) => {
        e.preventDefault();
        openCreateCompanyForm();
      });
      navNewCompany.dataset.boundNew = '1';
    }

    // Map/List/Docs/Settings toggles
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

  // Also expose view switches if other modules want to use them
  window.showMapView   = window.showMapView   || showMapView;
  window.showListView  = window.showListView  || showListView;
  window.showDocsView  = window.showDocsView  || showDocsView;
  window.showSettingsView = window.showSettingsView || showSettingsView;

})();
