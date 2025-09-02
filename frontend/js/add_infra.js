// frontend/js/add_infra.js
// Wires the 4-step wizard so that Steps 1–3 persist via backend upserts,
// and Step 3's sheet picker is populated from the chosen Excel file.
// Step 4 intentionally remains unimplemented.
(function () {
  'use strict';

  const WIZARD_ROOT_ID = 'addInfraPage';
  const NAV_IDS = ['navMap', 'navList', 'navDash', 'navNewCompany'];

  function createState() {
    return {
      current: 0,
      company: '',
      location: '',
      assetName: '',
      excelB64: null,
      sheetNames: [],
      selectedSheet: null,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Nav helpers: set active tab & show the requested view
  // ──────────────────────────────────────────────────────────────────────────
  function setActiveNav(activeId) {
    try {
      // Remove 'active' from all left-nav items
      document
        .querySelectorAll('.left-panel .nav-item')
        .forEach(li => li.classList.remove('active'));
      // Add to the requested one (if present)
      const el = document.getElementById(activeId);
      if (el) el.classList.add('active');
    } catch (_) {}
  }

  // Generic show/hide with graceful fallbacks
  function showViews({ map = false, list = false, docs = false, wizard = false, settings = false }) {
    const mapEl   = document.getElementById('mapContainer');
    const listEl  = document.getElementById('listContainer');              // may not exist yet
    const docsEl  = document.getElementById('dashboardContentContainer');  // may not exist yet
    const wizWrap = document.getElementById('addInfraContainer');
    const settingsEl = document.getElementById('settingsContainer');
    const station = document.getElementById('stationContentContainer');    // station detail

    if (mapEl)   mapEl.style.display   = map   ? 'block' : 'none';
    if (listEl)  listEl.style.display  = list  ? 'block' : 'none';
    if (docsEl)  docsEl.style.display  = docs  ? 'block' : 'none';
    if (wizWrap) wizWrap.style.display = wizard? 'block' : 'none';
    if (settingsEl) settingsEl.style.display = settings ? 'block' : 'none';
    // If station page is open, hide it unless we're explicitly in that flow
    if (station && (map || list || docs || wizard || settings)) station.style.display = 'none';
  }

  // Public-ish view switches used by nav bindings
  async function showMapView() {
    setActiveNav('navMap');
    showViews({ map: true, list: false, docs: false, wizard: false });
    // small nudge so Leaflet recalculates sizes if coming back from wizard
    if (window.map && typeof window.map.invalidateSize === 'function') {
      setTimeout(() => { try { window.map.invalidateSize(); } catch(_) {} }, 50);
    }
    if (typeof window.refreshMarkers === 'function') setTimeout(() => window.refreshMarkers(), 0);
  }

  async function showListView() {
    setActiveNav('navList');
    showViews({ map: false, list: true, docs: false, wizard: false });

    const listEl = document.getElementById('listContainer');
    if (!listEl) return;

    if (!listEl.dataset.loaded) {
      try {
        const resp = await fetch('list.html');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        listEl.innerHTML = await resp.text();
        listEl.dataset.loaded = '1';

        // Now that the table exists, boot the list JS
        if (window.initListView) requestAnimationFrame(() => window.initListView());
      } catch (e) {
        console.error('[showListView] failed to load list.html:', e);
        // Fallback: create the markup inline so we can still render
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
            <p class="hint" style="opacity:.75;margin-top:.5rem;">Tip: Click a column header to sort. Hover a row to see quick details on the right.</p>
          </div>`;
        if (window.initListView) requestAnimationFrame(() => window.initListView());
      }
    } else {
      // Already loaded; ensure it’s initialized
      if (window.initListView) window.initListView();
    }
  }

  // Settings
  async function showSettingsView() {
    setActiveNav('navSettings');
    showViews({ map: false, list: false, docs: false, wizard: false, settings: true });

    const container = document.getElementById('settingsContainer');
    if (!container) return;

    if (!container.dataset.loaded) {
      try {
        const resp = await fetch('settings.html');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        container.innerHTML = await resp.text();
        container.dataset.loaded = '1';

        // Boot the settings JS
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
    showViews({ map: false, list: false, docs: true, wizard: false });
    if (!document.getElementById('dashboardContentContainer')) showMapView();
  }

  // Initialize wizard *inside the given root element* (which contains the wizard markup).
  function initWizard(root) {
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    // Elements (scoped to root so we don't query before the markup exists)
    const stepEls       = Array.from(root.querySelectorAll('.wizard-step'));
    const stepIndicator = Array.from(root.querySelectorAll('#wizSteps .step'));
    const btnBack       = root.querySelector('#wizBack');
    const btnNext       = root.querySelector('#wizNext');
    const btnCancel     = root.querySelector('#wizCancel');

    // Step 1
    const inputCompanyName = root.querySelector('#companyName');
    // Step 2
    const inputProjectName = root.querySelector('#projectName'); // Location
    const inputProjectExcel= root.querySelector('#projectExcel');
    const lblProjectExcel  = root.querySelector('#projectExcelLabel');
    // Step 3
    const chkMethodImport  = root.querySelector('#methodImport');
    const inputAssetName   = root.querySelector('#assetName');
    const selectSheet      = root.querySelector('#sheetSelect');
    // Step 4
    const table            = root.querySelector('#sheetPreviewTable');
    const thead            = table ? table.querySelector('thead') : null;
    const tbody            = table ? table.querySelector('tbody') : null;
    const btnSelAll        = root.querySelector('#btnSelectAllRows');
    const btnDeselAll      = root.querySelector('#btnDeselectAllRows');
    const rowCountBadge    = root.querySelector('#rowCountBadge');

    // NEW: mode toggles + selects
    const coModeExisting  = root.querySelector('#coModeExisting');
    const coModeNew       = root.querySelector('#coModeNew');
    const rowCompanySelect= root.querySelector('#rowCompanySelect');
    const rowCompanyName  = root.querySelector('#rowCompanyName');
    const companySelect   = root.querySelector('#companySelect');

    const locModeExisting = root.querySelector('#locModeExisting');
    const locModeNew      = root.querySelector('#locModeNew');
    const rowLocationSelect = root.querySelector('#rowLocationSelect');
    const rowLocationName   = root.querySelector('#rowLocationName');
    const locationSelect  = root.querySelector('#locationSelect');

    const atModeExisting  = root.querySelector('#atModeExisting');
    const atModeNew       = root.querySelector('#atModeNew');
    const rowAssetTypeSelect = root.querySelector('#rowAssetTypeSelect');
    const assetTypeSelect = root.querySelector('#assetTypeSelect');

    const state = createState();
    state.previewRows = [];
    state.previewHeaders = [];
    state.previewSections = [];
    state.selectedRowIdx = new Set();
    
    // Extend state
    state.modes = { company: 'new', location: 'new', asset: 'new' };
    state.lookups = { companies: [], locationsByCompany: {}, assetsByLocation: {} };

    function setActiveStep(idx) {
      state.current = Math.max(0, Math.min(stepEls.length - 1, idx));
      stepEls.forEach((el, i) => el.classList.toggle('active', i === state.current));
      stepIndicator.forEach((el, i) => el.classList.toggle('active', i === state.current));
      if (btnBack) btnBack.disabled = state.current === 0;
      if (btnNext) btnNext.textContent = (state.current === stepEls.length - 1) ? 'IMPORT SELECTED' : 'NEXT';

      // If we've just navigated to Step 4, load the preview table
      if (state.current === 3) {
        buildPreview();
      }
    }

    function alertUser(msg) { alert(msg); }

    function updateSelectedBadge() {
      if (!rowCountBadge) return;
      rowCountBadge.textContent = `${state.selectedRowIdx.size} selected`;
    }

    function renderPreview(sections, headers, rows) {
      if (!thead || !tbody) return;
      thead.innerHTML = '';
      tbody.innerHTML = '';
      // ── Top header row: Sections (with colspans) + leading checkbox col
      const trSec = document.createElement('tr');
      const thLead = document.createElement('th');
      thLead.style.width = '36px';
      thLead.innerHTML = '<input id="chkAllRows" type="checkbox"/>';
      trSec.appendChild(thLead);
      // group contiguous identical section names
      let i = 0;
      while (i < headers.length) {
        const sec = sections[i] || '';
        let span = 1;
        while (i + span < headers.length && (sections[i + span] || '') === sec) span++;
        const th = document.createElement('th');
        th.colSpan = span;
        th.textContent = sec || '';
        trSec.appendChild(th);
        i += span;
      }
      thead.appendChild(trSec);
      // ── Second header row: Fields
      const trFld = document.createElement('tr');
      trFld.innerHTML = '<th></th>' + headers.map(h => `<th>${h}</th>`).join('');
      thead.appendChild(trFld);

      const chkAll = trSec.querySelector('#chkAllRows');
      if (chkAll) {
        chkAll.addEventListener('change', () => {
          if (chkAll.checked) {
            state.selectedRowIdx = new Set(rows.map((_, i) => i));
          } else {
            state.selectedRowIdx.clear();
          }
          // Update all row checkboxes
          tbody.querySelectorAll('input[type=checkbox].rowchk').forEach((cb, i) => {
            cb.checked = chkAll.checked;
          });
          updateSelectedBadge();
        });
      }
      // body rows
      rows.forEach((r, i) => {
        const tr = document.createElement('tr');
        const c0 = document.createElement('td');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'rowchk';
        cb.checked = true; // default selected
        state.selectedRowIdx.add(i);
        cb.addEventListener('change', () => {
          if (cb.checked) state.selectedRowIdx.add(i); else state.selectedRowIdx.delete(i);
          updateSelectedBadge();
        });
        c0.appendChild(cb);
        tr.appendChild(c0);
        headers.forEach((h, idx) => {
          const sec = sections[idx] || '';
          const key = sec ? `${sec} – ${h}` : h;
          const td = document.createElement('td');
          td.textContent = (r?.[key] ?? r?.[h] ?? '');
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      updateSelectedBadge();
    }

    async function buildPreview() {
      if (!state.excelB64 || !state.selectedSheet) {
        if (thead) thead.innerHTML = '';
        if (tbody) tbody.innerHTML = '<tr><td colspan="99" style="opacity:.7;padding:.75em;">Select an Excel file and sheet first.</td></tr>';
        return;
      }
      try {
        const res = await window.electronAPI.excelParseRowsFromSheet(state.excelB64, state.selectedSheet);
        if (!res || res.success === false) {
          console.error('[wizard] parseRowsFromSheet failed:', res?.message);
          if (tbody) tbody.innerHTML = `<tr><td colspan="99">Failed to read sheet "${state.selectedSheet}".</td></tr>`;
          return;
        }
        const rows    = res.rows || [];
        const headers = res.headers || (rows.length ? Object.keys(rows[0]) : []);
        const sections= res.sections || headers.map(()=>'');

        state.previewRows     = rows;
        state.previewHeaders  = headers;
        state.previewSections = sections;
        state.selectedRowIdx = new Set(rows.map((_, i) => i)); // default: all selected
        renderPreview(sections, headers, rows);
      } catch (e) {
        console.error('[wizard] buildPreview error', e);
      }
    }

    async function handleNext() {
      try {
        if (state.current === 0) {
          // STEP 1: Company (new or existing)
          if (state.modes.company === 'existing') {
            const val = (companySelect?.value || '').trim();
            if (!val) return alertUser('Please select a company.');
            state.company = val;
          } else {
            const name = (inputCompanyName?.value || '').trim();
            if (!name) return alertUser('Please enter a company name.');
            const res = await window.electronAPI.upsertCompany(name, true);
            if (!res || res.success === false) return alertUser('Failed to create company.');
            state.company = name;
            if (typeof window.refreshFilters === 'function') setTimeout(window.refreshFilters, 0);
            // reflect in lookups for downstream selects
            await loadLookups();
          }
          setActiveStep(1);
          return;
        }

        if (state.current === 1) {
          // STEP 2: Location (new or existing)
          if (!state.company) return alertUser('Please complete Step 1 (Company) first.');

          if (state.modes.location === 'existing') {
            const loc = (locationSelect?.value || '').trim();
            if (!loc) return alertUser('Please select a location.');
            state.location = loc;
          } else {
            const loc = (inputProjectName?.value || '').trim();
            if (!loc) return alertUser('Please enter a location.');
            const res = await window.electronAPI.upsertLocation(loc, state.company);
            if (!res || res.success === false) return alertUser('Failed to create location.');
            state.location = loc;
            if (typeof window.refreshFilters === 'function') setTimeout(window.refreshFilters, 0);
            // refresh lookups and asset types under the new location
            await loadLookups();
            refreshLocationSelect();
          }

          setActiveStep(2);
          return;
        }

        if (state.current === 2) {
          // STEP 3: Asset Type (new or existing)
          if (!chkMethodImport?.checked) return alertUser('Currently only "Import from Sheet" is supported.');
          if (!state.location) return alertUser('Please complete Step 2 (Location) first.');

          if (state.modes.asset === 'existing') {
            const at = (assetTypeSelect?.value || '').trim();
            if (!at) return alertUser('Please select an asset type.');
            state.assetName = at;
          } else {
            const assetName = (inputAssetName?.value || '').trim();
            if (!assetName) return alertUser('Please enter an asset name.');
            const up = await window.electronAPI.upsertAssetType(assetName, state.location);
            if (!up || up.success === false) return alertUser('Failed to create asset type.');
            state.assetName = assetName;
            if (typeof window.refreshFilters === 'function') setTimeout(window.refreshFilters, 0);
            await loadLookups();
            refreshAssetTypeSelect();
          }

          // Selecting a sheet doesn't import yet (Step 4 will do that later)
          state.selectedSheet = (selectSheet && selectSheet.value) ? selectSheet.value : null;
          setActiveStep(3);
          return;
        }

        if (state.current === 3) {
          // STEP 4: Import selected rows → file & pins
          if (!state.previewRows.length) return alertUser('Nothing to import.');
          const idxs = Array.from(state.selectedRowIdx.values()).sort((a,b)=>a-b);
          if (!idxs.length) return alertUser('Please select at least one row.');
          const selected = idxs.map(i => state.previewRows[i]).filter(Boolean);
          const payload = {
            location: state.location,
            sheetName: state.selectedSheet || 'Data',
            sections: state.previewSections,
            headers: state.previewHeaders,
            rows: selected,
            // NEW: ensure Category is exactly what was typed in Step 3
            assetType: state.assetName,
          };
          const res = await window.electronAPI.importSelection(payload);
          if (!res || res.success === false) {
            return alertUser('Import failed.');
          }
          // Update UI: clear renderer data → refresh filters/pins/list → go back to map
          if (typeof window.invalidateStationData === 'function') window.invalidateStationData();
          if (typeof window.electronAPI.invalidateStationCache === 'function') {
            await window.electronAPI.invalidateStationCache();
          }
          if (typeof window.refreshFilters === 'function') setTimeout(window.refreshFilters, 0);
          if (typeof window.refreshMarkers === 'function') setTimeout(window.refreshMarkers, 0);
          if (typeof window.renderList === 'function') setTimeout(window.renderList, 0);
          alertUser(`Imported ${res.added} row(s).`);
          handleCancel();           // reset wizard
          setActiveNav('navMap');   // show map
          showViews({ map:true, wizard:false });
          return;
        }

      } catch (err) {
        console.error('[wizard] NEXT failed', err);
        alertUser('Unexpected error. See console for details.');
      }
    }

    function handleBack() { setActiveStep(state.current - 1); }

    function handleCancel() {
      if (inputCompanyName) inputCompanyName.value = '';
      if (inputProjectName) inputProjectName.value = '';
      if (inputAssetName)   inputAssetName.value = '';
      if (selectSheet) {
        selectSheet.innerHTML = '<option>Select Excel file in previous step</option>';
        selectSheet.disabled = true;
      }
      if (lblProjectExcel) lblProjectExcel.textContent = 'Select Excel File';
      Object.assign(state, createState());

      state.modes = { company:'new', location:'new', asset:'new' };
      if (coModeNew) coModeNew.checked = true;
      if (locModeNew) locModeNew.checked = true;
      if (atModeNew)  atModeNew.checked  = true;
      setCompanyMode('new');
      setLocationMode('new');
      setAssetMode('new');
      fillSelect(companySelect, state.lookups.companies || [], 'Select company');
      fillSelect(locationSelect, [], 'Select a company first');
      fillSelect(assetTypeSelect, [], 'Select a location first');

      setActiveStep(0);
    }

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
      if (!selectSheet) return;
      selectSheet.innerHTML = '';
      if (!names || !names.length) {
        const opt = document.createElement('option');
        opt.textContent = 'No sheets detected';
        opt.disabled = true;
        opt.selected = true;
        selectSheet.appendChild(opt);
        selectSheet.disabled = true;
        return;
      }
      names.forEach((n, idx) => {
        const opt = document.createElement('option');
        opt.value = n;
        opt.textContent = n;
        if (idx === 0) opt.selected = true;
        selectSheet.appendChild(opt);
      });
      selectSheet.disabled = false;
    }

    // Hook file picker (Step 2) to list sheets for Step 3
    if (inputProjectExcel) {
      inputProjectExcel.addEventListener('change', async (e) => {
        try {
          const f = (e.target.files || [])[0];
          if (!f) {
            populateSheetSelect([]);
            if (lblProjectExcel) lblProjectExcel.textContent = 'Select Excel File';
            state.excelB64 = null;
            return;
          }
          if (lblProjectExcel) lblProjectExcel.textContent = f.name || 'Selected Excel';

          const b64 = await fileToBase64(f);
          state.excelB64 = b64;

          const res = await window.electronAPI.excelListSheets(b64);
          if (!res || res.success === false) {
            console.error('[wizard] list sheets failed', res?.message);
            populateSheetSelect([]);
            alert('Could not read the Excel file. Please ensure it is a valid .xlsx.');
            return;
          }
          state.sheetNames = res.sheets || [];
          populateSheetSelect(state.sheetNames);
        } catch (err) {
          console.error('[wizard] file selection failed', err);
          populateSheetSelect([]);
          alert('Unexpected error while reading the Excel file.');
        }
      });
    }

    if (selectSheet) {
      selectSheet.addEventListener('change', () => {
        state.selectedSheet = selectSheet.value || null;
      });
    }

    if (btnSelAll) {
      btnSelAll.addEventListener('click', () => {
        state.selectedRowIdx = new Set(state.previewRows.map((_, i) => i));
        tbody?.querySelectorAll('input[type=checkbox].rowchk').forEach(cb => cb.checked = true);
        updateSelectedBadge();
      });
    }
    if (btnDeselAll) {
      btnDeselAll.addEventListener('click', () => {
        state.selectedRowIdx.clear();
        tbody?.querySelectorAll('input[type=checkbox].rowchk').forEach(cb => cb.checked = false);
        updateSelectedBadge();
      });
    }


    if (btnNext)   btnNext.addEventListener('click', handleNext);
    if (btnBack)   btnBack.addEventListener('click', handleBack);
    if (btnCancel) btnCancel.addEventListener('click', handleCancel);

    function fillSelect(sel, items, placeholder='Select…') {
      if (!sel) return;
      sel.innerHTML = '';
      if (!items || !items.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = placeholder;
        opt.disabled = true; opt.selected = true;
        sel.appendChild(opt);
        sel.disabled = true;
        return;
      }
      const opt0 = document.createElement('option');
      opt0.value = ''; opt0.textContent = placeholder; opt0.disabled = true; opt0.selected = true;
      sel.appendChild(opt0);
      items.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = v;
        sel.appendChild(opt);
      });
      sel.disabled = false;
    }

    async function loadLookups() {
      try {
        if (window.electronAPI?.getLookupTree) {
          const t = await window.electronAPI.getLookupTree();
          if (t && Array.isArray(t.companies)) {
            state.lookups = {
              companies: t.companies || [],
              locationsByCompany: t.locationsByCompany || {},
              assetsByLocation: t.assetsByLocation || {}
            };
          }
        }
      } catch (e) {
        console.error('[wizard] getLookupTree failed', e);
      }

      // Populate company select
      fillSelect(companySelect, (state.lookups.companies || []).slice().sort((a,b)=>a.localeCompare(b)), 'Select company');
    }

    function setCompanyMode(mode) {
      state.modes.company = mode;
      if (mode === 'existing') {
        rowCompanySelect.style.display = '';
        rowCompanyName.style.display = 'none';
      } else {
        rowCompanySelect.style.display = 'none';
        rowCompanyName.style.display = '';
      }
    }

    function setLocationMode(mode) {
      state.modes.location = mode;
      if (mode === 'existing') {
        rowLocationSelect.style.display = '';
        rowLocationName.style.display = 'none';
      } else {
        rowLocationSelect.style.display = 'none';
        rowLocationName.style.display = '';
      }
    }

    function setAssetMode(mode) {
      state.modes.asset = mode;
      if (mode === 'existing') {
        rowAssetTypeSelect.style.display = '';
        rowAssetName.style.display = 'none';
      } else {
        rowAssetTypeSelect.style.display = 'none';
        rowAssetName.style.display = '';
      }
    }

    // Populate location select based on chosen company
    function refreshLocationSelect() {
      const co = state.company || companySelect?.value || '';
      const locs = (state.lookups.locationsByCompany?.[co] || []).slice().sort((a,b)=>a.localeCompare(b));
      fillSelect(locationSelect, locs, co ? 'Select location' : 'Select a company first');
    }

    // Populate asset type select based on chosen location
    function refreshAssetTypeSelect() {
      const loc = state.location || locationSelect?.value || '';
      const ats = (state.lookups.assetsByLocation?.[loc] || []).slice().sort((a,b)=>a.localeCompare(b));
      fillSelect(assetTypeSelect, ats, loc ? 'Select asset type' : 'Select a location first');
    }

    // Default modes
    setCompanyMode('new');
    setLocationMode('new');
    setAssetMode('new');

    // Toggle handlers
    coModeExisting?.addEventListener('change', () => { if (coModeExisting.checked) setCompanyMode('existing'); });
    coModeNew?.addEventListener('change',      () => { if (coModeNew.checked)      setCompanyMode('new'); });

    locModeExisting?.addEventListener('change', () => { if (locModeExisting.checked) setLocationMode('existing'); });
    locModeNew?.addEventListener('change',      () => { if (locModeNew.checked)      setLocationMode('new'); });

    atModeExisting?.addEventListener('change', () => { if (atModeExisting.checked) setAssetMode('existing'); });
    atModeNew?.addEventListener('change',      () => { if (atModeNew.checked)      setAssetMode('new'); });

    // Select dependencies
    companySelect?.addEventListener('change', () => {
      state.company = companySelect.value || '';
      refreshLocationSelect();
      // Clear downstream when company changes
      state.location = '';
      fillSelect(assetTypeSelect, [], 'Select a location first');
    });

    locationSelect?.addEventListener('change', () => {
      state.location = locationSelect.value || '';
      refreshAssetTypeSelect();
    });

    assetTypeSelect?.addEventListener('change', () => {
      // just store name; import payload uses state.assetName
      state.assetName = assetTypeSelect.value || '';
    });

    // Load lookups initially
    loadLookups();

    // Kick off at step 0
    setActiveStep(0);
  }

  // Load add_infra.html into the container and initialize the wizard.
  async function showAddInfraWizard() {
    try {
      const container = document.getElementById('addInfraContainer');
      if (!container) return;
      // If already present, just show it.
      let root = document.getElementById(WIZARD_ROOT_ID);

      // Mark the nav as active *before* fetch so user sees instant feedback
      setActiveNav('navNewCompany');
      // Hide other views immediately; wizard will be shown after injection
      showViews({ map: false, list: false, docs: false, wizard: true });

      if (!root) {
        const resp = await fetch('add_infra.html');
        if (!resp.ok) {
          alert('Failed to load Add Infrastructure view.');
          return;
        }
        container.innerHTML = await resp.text();
        root = document.getElementById(WIZARD_ROOT_ID);
      }
      // Show wizard, hide other main areas
      showViews({ map: false, list: false, docs: false, wizard: true });

      initWizard(root);
    } catch (e) {
      console.error('[add_infra] showAddInfraWizard failed', e);
      alert('Unexpected error loading the New Company wizard.');
    }
  }

  // Try to init if the wizard is already in DOM (e.g., pre-injected)
  function tryInitIfPresent() {
    const root = document.getElementById(WIZARD_ROOT_ID);
    if (root) initWizard(root);
  }

  // Observe container for late injection of the wizard HTML
  function watchForWizardInjection() {
    const container = document.getElementById('addInfraContainer') || document.body;
    const mo = new MutationObserver(() => {
      const root = document.getElementById(WIZARD_ROOT_ID);
      if (root && root.dataset.bound !== '1') {
        initWizard(root);
      }
    });
    mo.observe(container, { childList: true, subtree: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Wire up the left-nav "＋ New Company" item to load/show the wizard.
    const navNewCompany = document.getElementById('navNewCompany');
    if (navNewCompany && !navNewCompany.dataset.bound) {
      navNewCompany.addEventListener('click', (e) => {
        e.preventDefault();
        showAddInfraWizard();
      });
      navNewCompany.dataset.bound = '1';
    }

    // Wire up Map/List/Docs to bring those views back and set active color
    const navMap  = document.getElementById('navMap');
    const navList = document.getElementById('navList');
    const navDash = document.getElementById('navDash');

    if (navMap && !navMap.dataset.bound) {
      navMap.addEventListener('click', (e) => {
        e.preventDefault();
        showMapView();
      });
      navMap.dataset.bound = '1';
    }
    if (navList && !navList.dataset.bound) {
      navList.addEventListener('click', (e) => {
        e.preventDefault();
        showListView();
      });
      navList.dataset.bound = '1';
    }
    if (navDash && !navDash.dataset.bound) {
      navDash.addEventListener('click', (e) => {
        e.preventDefault();
        showDocsView();
      });
      navDash.dataset.bound = '1';
    }

    // Wire up Settings → open settings page
    const navSettings = document.getElementById('navSettings');
    if (navSettings && !navSettings.dataset.bound) {
      navSettings.addEventListener('click', (e) => {
        e.preventDefault();
        showSettingsView();
      });
      navSettings.dataset.bound = '1';
    }

    tryInitIfPresent();
    watchForWizardInjection();
  });
})();
