// frontend/js/add_infra.js - Updated with schema conformance on import
(function () {
  'use strict';

  // Utilities
  const debounce = (fn, ms = 150) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  // View helpers
  function isDocsActive() {
    const el = document.getElementById('dashboardContentContainer');
    return !!(el && el.style.display !== 'none' && el.offsetParent !== null);
  }
  function hideRightPanel() {
    const right = document.getElementById('rightPanel');
    if (right) right.style.display = 'none';
  }

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

  // ===== RHS Panel Restoration Functions =====
  function restoreRHSPanel() {
    // Do NOT restore while docs/optimization is active or suppression flag set
    if (isDocsActive() || document.body?.dataset?.suppressRhs === '1') {
      hideRightPanel();
      return;
    }
    const rightPanel = document.getElementById('rightPanel');
    const stationContentContainer = document.getElementById('stationContentContainer');
    
    // If station view is hidden/not active and RHS panel exists
    if (rightPanel && stationContentContainer && 
        (stationContentContainer.style.display === 'none' || !stationContentContainer.style.display)) {
      
      // Show the RHS panel
      rightPanel.style.display = '';
      
      // Reset the RHS title to default state
      if (typeof setRhsTitle === 'function') {
        setRhsTitle('Station Details');
      }
      
      // Clear any stale content
      const container = document.getElementById('station-details');
      if (container) {
        container.innerHTML = '<p><em>Click a pin to see details</em></p>';
      }
    }
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
    const statsEl    = document.getElementById('statisticsContainer');
    const rightToggleBtn = document.getElementById('toggleRight');
    const rightPanel = document.getElementById('rightPanel');

    if (mapEl)      mapEl.style.display      = map    ? 'block' : 'none';
    if (listEl)     listEl.style.display     = list   ? 'block' : 'none';
    if (docsEl)     docsEl.style.display     = docs   ? 'block' : 'none';
    if (wizardWrap) wizardWrap.style.display = wizard ? 'block' : 'none';
    if (settingsEl) settingsEl.style.display = settings ? 'block' : 'none';
    if (statsEl)    statsEl.style.display    = arguments[0]?.stats ? 'block' : 'none';

    if (stationEl && (map || list || docs || wizard || settings || arguments[0]?.stats))
      stationEl.style.display = 'none';

    // Hide the right toggle while on Optimization (docs), show it otherwise
    if (rightToggleBtn) rightToggleBtn.style.display = docs ? 'none' : '';

    // Suppress RHS while in docs; allow restore in other views
    if (docs) {
      document.body.dataset.suppressRhs = '1';
      hideRightPanel();
    } else {
      delete document.body.dataset.suppressRhs;
    }
  }

  async function showMapView() {
    setActiveNav('navMap');
    showViews({ map: true, list: false, docs: false, wizard: false, settings: false });
    safeDisableFullWidthMode();

    // Leaving docs: allow RHS to restore again
    delete document.body.dataset.suppressRhs;

    // Restore RHS panel when returning to map view
    restoreRHSPanel();

    if (window.map && typeof window.map.invalidateSize === 'function') {
      setTimeout(() => { try { window.map.invalidateSize(); } catch(_) {} }, 50);
    }
    if (typeof window.refreshMarkers === 'function') setTimeout(() => window.refreshMarkers(), 0);
  }

  async function showListView() {
    setActiveNav('navList');
    showViews({ map: false, list: true, docs: false, wizard: false, settings: false });
    safeDisableFullWidthMode();

    // Leaving docs: allow RHS to restore again
    delete document.body.dataset.suppressRhs;

    // Restore RHS panel when returning to list view
    restoreRHSPanel();

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

  async function showOptView() {
    setActiveNav('navOpt');
    showViews({ map: false, list: false, docs: true, wizard: false, settings: false });
    // Optimization/dashboard docs should be full-width; no RHS gutter
    safeEnableFullWidthMode();
    hideRightPanel();
    if (!document.getElementById('dashboardContentContainer')) showMapView();
  }

  async function showStatisticsView() {
    setActiveNav('navDash'); // "Statistics" has become "Dashboard"
    showViews({ map: false, list: false, docs: false, wizard: false, settings: false, stats: true });
    safeEnableFullWidthMode();

    // Optional: hide RHS panel content while in full-width stats view
    try {
      const right = document.getElementById('rightPanel');
      if (right) right.style.display = '';
    } catch(_) {}

    const container = document.getElementById('statisticsContainer');
    if (!container) return;

    if (!container.dataset.loaded) {
      try {
        const resp = await fetch('dashboard.html');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        container.innerHTML = await resp.text();
        container.dataset.loaded = '1';
        if (window.initStatisticsView) requestAnimationFrame(() => window.initStatisticsView());
      } catch (e) {
        console.error('[showStatisticsView] failed to load dashboard.html:', e);
        container.innerHTML = `<div class="panel"><div class="panel-title">Statistics</div><p>Failed to load.</p></div>`;
      }
    } else if (window.initStatisticsView) {
      window.initStatisticsView();
    }
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
      if (!name) return appAlert('Please enter a company name.');
      try {
        const res = await window.electronAPI.upsertCompany(name, true);
        if (!res || res.success === false) return appAlert('Failed to create company.');
        await window.refreshFilters?.();
        closePanel();
      } catch (e) {
        console.error('[CreateCompany] failed', e); appAlert('Unexpected error.');
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
        <div class="form-row">
          <label>Base folder link (optional)</label>
          <input type="text" id="locLink" placeholder="\\\\\\server\\share\\Stations  or  C:\\\\Users\\\\name\\\\Stations" />
          <div class="hint" style="opacity:.75;margin-top:.25rem;">
            Use the same format as your current base (UNC path or absolute Windows path).
          </div>
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
      if (!loc) return appAlert('Please enter a location.');
      try {
        const res = await window.electronAPI.upsertLocation(loc, company);
        // Only proceed if upsert succeeded
        if (!res || res.success === false) return appAlert('Failed to create location.');
        // Save optional link (if any) after upsert succeeds
        const link = ($('#locLink')?.value || '').trim();
        if (link) {
          try {
            await window.electronAPI.setLocationLink(company, loc, link);
          } catch (_) {
            /* non-fatal */
          }
        }
        await window.refreshFilters?.();
        closePanel();
      } catch (e) {
        console.error('[CreateLocation] failed', e); appAlert('Unexpected error.');
      }
    });
  }

  // Manual Instance Wizard
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

        <!-- Step 1: General -->
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

        <!-- Step 2: Sections editor (ALWAYS editing) -->
        <div id="mStep2" class="wizard-step" style="display:none;">
          <h3>Additional Sections & Fields</h3>
          <p class="hint" style="margin-top:.25rem;">
            Add a <strong>Section</strong>, then add <strong>Fields</strong> inside it. Values are optional.
          </p>

          <div id="mSectionsEditor"></div>

          <div class="main-actions" style="margin-top:.5rem;">
            <button id="mAddSection" class="btn">+ Add Section</button>
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
    const sectionsHost = $('#mSectionsEditor');

    // ── Helpers (no edit toggle; sections start and remain in editing) ──
    function createFieldRow(fieldName, value) {
      const fieldDiv = document.createElement('div');
      fieldDiv.className = 'field-row';
      fieldDiv.dataset.fieldName = fieldName || '';

      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.className = 'field-label-input';
      labelInput.value = fieldName || '';
      labelInput.placeholder = 'Field name';

      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.className = 'field-value-input';
      valueInput.value = value || '';
      valueInput.placeholder = 'Enter value…';

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-ghost btn-sm btn-danger edit-only';
      delBtn.textContent = '✕';
      delBtn.title = 'Delete Field';
      delBtn.addEventListener('click', async () => {
        const ok = await appConfirm('Delete this field?');
        if (!ok) return;
        fieldDiv.remove();
      });

      fieldDiv.appendChild(labelInput);
      fieldDiv.appendChild(valueInput);
      fieldDiv.appendChild(delBtn);
      return fieldDiv;
    }

    function addFieldToSection(sectionDiv) {
      const fieldsContainer = sectionDiv.querySelector('.section-fields');
      const newField = createFieldRow('New Field', '');
      fieldsContainer.appendChild(newField);
      const label = newField.querySelector('.field-label-input');
      label.focus(); label.select();
    }

    async function deleteSection(sectionDiv) {
      const title = sectionDiv.querySelector('.section-title-input')?.value?.trim() || 'this section';
      const ok = await appConfirm(`Delete "${title}"?`);
      if (!ok) return;
      sectionDiv.remove();
    }

    function createSection(sectionName, fieldsObj = {}) {
      const sectionDiv = document.createElement('div');
      sectionDiv.className = 'station-section editable-section editing'; // ← ALWAYS editing

      const headerDiv = document.createElement('div');
      headerDiv.className = 'section-header';
      headerDiv.style.display = 'flex';
      headerDiv.style.justifyContent = 'space-between';
      headerDiv.style.alignItems = 'center';

      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'section-title-input';
      titleInput.value = sectionName || 'New Section';
      titleInput.placeholder = 'Section name';

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'section-actions';

      // No edit toggle button — just show edit-only controls all the time
      const addFieldBtn = document.createElement('button');
      addFieldBtn.className = 'btn btn-ghost btn-sm edit-only';
      addFieldBtn.textContent = '+ Add Field';
      addFieldBtn.addEventListener('click', () => addFieldToSection(sectionDiv));

      const deleteSectionBtn = document.createElement('button');
      deleteSectionBtn.className = 'btn btn-danger btn-sm edit-only';
      deleteSectionBtn.textContent = 'Delete Section';
      deleteSectionBtn.title = 'Delete Section';
      deleteSectionBtn.addEventListener('click', () => deleteSection(sectionDiv));

      actionsDiv.appendChild(addFieldBtn);
      actionsDiv.appendChild(deleteSectionBtn);

      headerDiv.appendChild(titleInput);
      headerDiv.appendChild(actionsDiv);

      const fieldsDiv = document.createElement('div');
      fieldsDiv.className = 'section-fields';

      Object.entries(fieldsObj || {}).forEach(([fname, val]) => {
        fieldsDiv.appendChild(createFieldRow(fname, val));
      });

      sectionDiv.appendChild(headerDiv);
      sectionDiv.appendChild(fieldsDiv);
      return sectionDiv;
    }

    function addNewSection() {
      const s = createSection('New Section', {});
      sectionsHost.appendChild(s);
      const title = s.querySelector('.section-title-input');
      title.focus(); title.select();
    }

    // ── Nav bindings ──
    $('#mCancel').addEventListener('click', () => closePanel());

    $('#mNext').addEventListener('click', () => {
      const stationId = ($('#mStationId')?.value || '').trim();
      const siteName  = ($('#mSiteName')?.value || '').trim();
      const lat       = ($('#mLat')?.value || '').trim();
      const lon       = ($('#mLon')?.value || '').trim();
      if (!stationId || !siteName || !lat || !lon) {
        return appAlert('Please fill Station ID, Site Name, Latitude, and Longitude.');
      }
      if (isNaN(Number(lat)) || isNaN(Number(lon))) {
        return appAlert('Latitude and Longitude must be numeric.');
      }

      // switch steps
      $('#mStep1').style.display = 'none';
      $('#mStep1').classList.remove('active');
      $('#mStep2').style.display = '';
      $('#mStep2').classList.add('active');
      $('#mBack').disabled = false;
      $('#mNext').style.display = 'none';
      $('#mSave').style.display = '';

      // start with one empty section to guide users
      if (!sectionsHost.children.length) addNewSection();
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

    $('#mAddSection').addEventListener('click', addNewSection);

    // ── Save: same payload shape as before ──
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
        return appAlert('General Information is incomplete.');
      }
      if (isNaN(Number(payload.general.lat)) || isNaN(Number(payload.general.lon))) {
        return appAlert('Latitude and Longitude must be numeric.');
      }

      // Gather sections/fields
      const sectionEls = Array.from(sectionsHost.querySelectorAll('.editable-section'));
      for (const sec of sectionEls) {
        const sectionTitle = sec.querySelector('.section-title-input')?.value?.trim() || '';
        const fieldRows = Array.from(sec.querySelectorAll('.field-row'));
        for (const row of fieldRows) {
          const fld = row.querySelector('.field-label-input')?.value?.trim() || '';
          const val = row.querySelector('.field-value-input')?.value?.trim() || '';
          if (!sectionTitle && !fld && !val) continue;
          if (!sectionTitle || !fld) {
            return appAlert('Each field requires both a Section name and a Field name.');
          }
          payload.extras.push({ section: sectionTitle, field: fld, value: val });
        }
      }

      try {
        $('#mSave').disabled = true;
        $('#mSave').textContent = 'Saving…';
        const res = await window.electronAPI.manualCreateInstance(payload);
        if (!res || res.success === false) {
          appAlert(res?.message || 'Failed to create instance.');
          return;
        }
        if (typeof window.electronAPI.invalidateStationCache === 'function') {
          await window.electronAPI.invalidateStationCache();
        }
        await window.refreshFilters?.();
        await window.refreshMarkers?.();
        await window.renderList?.();
        await window.refreshStatisticsView?.();
        appAlert('Asset created.');
        closePanel();
      } catch (e) {
        console.error('[manualCreate] failed', e);
        appAlert('Unexpected error while creating the asset.');
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
      if (!idxs.length) return appAlert('Please select at least one row.');
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
        if (!res || res.success === false) return appAlert(res?.message || 'Import failed.');
        if (typeof window.electronAPI.invalidateStationCache === 'function') {
          await window.electronAPI.invalidateStationCache();
        }
        await window.refreshFilters?.();
        await window.refreshMarkers?.();
        await window.renderList?.();
        await window.refreshStatisticsView?.();
        appAlert(`Successfully imported ${res.added} row(s) into “${assetType}”.`);
        closePanel();
      } catch (e) {
        console.error('[importMore] import failed', e);
        appAlert('Unexpected import error. See console.');
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
          <label>Base folder link (optional)</label>
          <input type="text" id="assetLink2" placeholder="\\\\server\\share\\folder" />
          <div class="hint" style="opacity:.75;margin-top:.25rem;">
            If provided, this link will be used for this asset type at this location (overrides the location link).
          </div>
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

    // Save per-asset-type link if the user provided one
    async function saveAssetTypeLinkIfAny(assetName) {
      const link = (host.querySelector('#assetLink2')?.value || '').trim();
      if (!link || !assetName) return;
      try { await window.electronAPI.setAssetTypeLink(assetName, company, location, link); }
      catch (_) {}
    }

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

    $('#btnManual2')?.addEventListener('click', async () => {
      const assetName = ($('#assetName2')?.value || '').trim();
      if (!assetName) return appAlert('Please enter an asset name first.');
      // Save optional per-asset-type link before opening manual wizard
      await saveAssetTypeLinkIfAny(assetName);
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
      if (!assetName) return appAlert('Please enter an asset name.');
      if (!state.rows.length) return appAlert('No rows to import (select a sheet).');
      const idxs = Array.from(state.selectedIdx.values()).sort((a,b) => a-b);
      if (!idxs.length) return appAlert('Please select at least one row.');

      try {
        $('#btnImport2').textContent = 'Importing...';
        $('#btnImport2').disabled = true;

        // Persist optional per-asset-type link before creating/upserting type
        await saveAssetTypeLinkIfAny(assetName);

        const up = await window.electronAPI.upsertAssetType(assetName, location);
        if (!up || up.success === false) return appAlert('Failed to create asset type.');

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
          appAlert('Import failed.');
          return;
        }

        if (typeof window.invalidateStationData === 'function') window.invalidateStationData();
        if (typeof window.electronAPI.invalidateStationCache === 'function') {
          await window.electronAPI.invalidateStationCache();
        }
        await window.refreshFilters?.();
        await window.refreshMarkers?.();
        await window.renderList?.();
        await window.refreshStatisticsView?.();
        
        appAlert(`Successfully imported ${res.added} row(s). Data will be synchronized with existing ${assetName} schema if applicable.`);
        closePanel();

      } catch (e) {
        console.error('[assets] import failed', e);
        appAlert('Unexpected import error. See console.');
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
    // Monitor station container visibility changes
    const stationContainerObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          const container = mutation.target;
          // If station container was just hidden, restore RHS panel
          if (container.style.display === 'none' || !container.style.display) {
            // Skip restoration while docs active or explicitly suppressed
            if (!isDocsActive() && document.body?.dataset?.suppressRhs !== '1') {
              restoreRHSPanel();
            }
          }
        }
      });
    });
    
    const stationContainer = document.getElementById('stationContentContainer');
    if (stationContainer) {
      stationContainerObserver.observe(stationContainer, {
        attributes: true,
        attributeFilter: ['style']
      });
    }
    
    // Initial restoration check
    if (!isDocsActive()) restoreRHSPanel();

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
    const navOpt  = document.getElementById('navOpt');
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
    if (navOpt && !navOpt.dataset.bound) {
      navOpt.addEventListener('click', (e) => { e.preventDefault(); showOptView(); });
      navOpt.dataset.bound = '1';
    }
    if (navDash && !navDash.dataset.bound) {
      navDash.addEventListener('click', (e) => { e.preventDefault(); showStatisticsView(); });
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
  window.showOptView  = window.showOptView  || showOptView;
  window.showStatisticsView = window.showStatisticsView || showStatisticsView;
  window.showSettingsView = window.showSettingsView || showSettingsView;

})();
