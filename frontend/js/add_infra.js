// frontend/js/add_infra.js
// Wires the 4-step wizard so that Steps 1–3 persist via backend upserts,
// and Step 3's sheet picker is populated from the chosen Excel file.
// Step 4 intentionally remains unimplemented.
(function () {
  'use strict';

  const WIZARD_ROOT_ID = 'addInfraPage';
  const NAV_IDS = ['navMap', 'navList', 'navDocs', 'navNewCompany'];

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
  function showViews({ map = false, list = false, docs = false, wizard = false }) {
    const mapEl   = document.getElementById('mapContainer');
    const listEl  = document.getElementById('listContainer');              // may not exist yet
    const docsEl  = document.getElementById('dashboardContentContainer');  // may not exist yet
    const wizWrap = document.getElementById('addInfraContainer');
    const station = document.getElementById('stationContentContainer');    // station detail

    if (mapEl)   mapEl.style.display   = map   ? 'block' : 'none';
    if (listEl)  listEl.style.display  = list  ? 'block' : 'none';
    if (docsEl)  docsEl.style.display  = docs  ? 'block' : 'none';
    if (wizWrap) wizWrap.style.display = wizard? 'block' : 'none';
    // If station page is open, hide it unless we're explicitly in that flow
    if (station && (map || list || docs || wizard)) station.style.display = 'none';
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
    // If listContainer doesn't exist yet, just fall back to map (graceful)
    if (!document.getElementById('listContainer')) showMapView();
  }

  async function showDocsView() {
    setActiveNav('navDocs');
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

    const state = createState();

    function setActiveStep(idx) {
      state.current = Math.max(0, Math.min(stepEls.length - 1, idx));
      stepEls.forEach((el, i) => el.classList.toggle('active', i === state.current));
      stepIndicator.forEach((el, i) => el.classList.toggle('active', i === state.current));
      if (btnBack) btnBack.disabled = state.current === 0;
      if (btnNext) btnNext.textContent = (state.current === stepEls.length - 1) ? 'FINISH' : 'NEXT';
    }

    function alertUser(msg) { alert(msg); }

    async function handleNext() {
      try {
        if (state.current === 0) {
          // STEP 1: Create Company
          const name = (inputCompanyName?.value || '').trim();
          if (!name) return alertUser('Please enter a company name.');
          const res = await window.electronAPI.upsertCompany(name, true);
          if (!res || res.success === false) return alertUser('Failed to create company.');
          state.company = name;
          setActiveStep(1);
          return;
        }

        if (state.current === 1) {
          // STEP 2: Create Project (Location)
          const loc = (inputProjectName?.value || '').trim();
          if (!loc) return alertUser('Please enter a location.');
          if (!state.company) return alertUser('Company is missing. Please complete Step 1 first.');
          const res = await window.electronAPI.upsertLocation(loc, state.company);
          if (!res || res.success === false) return alertUser('Failed to create location.');
          state.location = loc;
          setActiveStep(2);
          return;
        }

        if (state.current === 2) {
          // STEP 3: Create Assets
          if (!chkMethodImport?.checked) return alertUser('Currently only "Import from Sheet" is supported.');
          const assetName = (inputAssetName?.value || '').trim();
          if (!assetName) return alertUser('Please enter an asset name.');
          if (!state.location) return alertUser('Location is missing. Please complete Step 2 first.');

          const up = await window.electronAPI.upsertAssetType(assetName, state.location);
          if (!up || up.success === false) return alertUser('Failed to create asset type.');
          state.assetName = assetName;

          // Selecting a sheet doesn't import yet (Step 4 will do that later)
          state.selectedSheet = (selectSheet && selectSheet.value) ? selectSheet.value : null;
          setActiveStep(3);
          return;
        }

        if (state.current === 3) {
          // STEP 4: (intentionally left as-is)
          alertUser('Step 4 is not implemented yet.');
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

    if (btnNext)   btnNext.addEventListener('click', handleNext);
    if (btnBack)   btnBack.addEventListener('click', handleBack);
    if (btnCancel) btnCancel.addEventListener('click', handleCancel);

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
    const navDocs = document.getElementById('navDocs');

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
    if (navDocs && !navDocs.dataset.bound) {
      navDocs.addEventListener('click', (e) => {
        e.preventDefault();
        showDocsView();
      });
      navDocs.dataset.bound = '1';
    }

    tryInitIfPresent();
    watchForWizardInjection();
  });
})();