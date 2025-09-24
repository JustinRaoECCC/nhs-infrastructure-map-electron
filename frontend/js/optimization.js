// frontend/js/optimization.js
document.addEventListener('DOMContentLoaded', () => {

  const dashPlaceholder    = document.getElementById('dashboardContentContainer');
  const mapContainer       = document.getElementById('mapContainer');
  const rightPanel         = document.getElementById('rightPanel');
  const stationPlaceholder = document.getElementById('stationContentContainer');

  // optional left-nav hook (if your nav has an item with this id)
  const navOpt = document.getElementById('navOpt');
  if (navOpt && !navOpt._wired) {
    navOpt.addEventListener('click', (e) => {
      e.preventDefault();
      showOptimization();
    });
    navOpt._wired = true;
  }

  // Utilities
  function resetOptimizationViews() {
    if (!dashPlaceholder || !dashPlaceholder.innerHTML.trim()) return;
    const optRoot  = dashPlaceholder.querySelector('#optimization');
    const optPane  = optRoot && (optRoot.querySelector('.opt-container') || optRoot);
    const opt2Pane = dashPlaceholder.querySelector('#optimization2 .opt2-container')
                   || dashPlaceholder.querySelector('#optimization2');
    const optBtn = dashPlaceholder.querySelector('#optimizeBtn');
    const geoBtn = dashPlaceholder.querySelector('#optimizeGeoBtn');
    const hero   = dashPlaceholder.querySelector('#optimization2 .opt2-hero');
    if (optBtn) optBtn.style.display = '';
    if (geoBtn) geoBtn.style.display = '';
    if (hero) hero.style.display = '';
    if (optPane)  optPane.querySelectorAll('pre, ol, table.opt-table').forEach(el => el.remove());
    if (opt2Pane) opt2Pane.innerHTML = '';
  }

  async function showOptimization() {
    // hide map/right/station, show our docs area
    if (mapContainer)       mapContainer.style.display = 'none';
    if (rightPanel)         rightPanel.style.display   = 'none';
    if (stationPlaceholder) stationPlaceholder.style.display = 'none';
    const filtersPanel = document.querySelector('.left-panel');
    if (filtersPanel) filtersPanel.style.display = '';
    const rightToggleBtn = document.getElementById('toggleRight');
    if (rightToggleBtn) rightToggleBtn.style.display = 'none';

    // lazy inject HTML once
    if (!dashPlaceholder.innerHTML.trim()) {
      const html = await fetch('optimization.html').then(r => r.text());
      dashPlaceholder.innerHTML = html;
      await initDashboardUI();
    }
    dashPlaceholder.style.display = 'block';
    resetOptimizationViews();
  }

  // ──────────────────────────────────────────────────────────────────────────
  async function initDashboardUI() {
    const tabs               = document.querySelectorAll('.dashboard-tab');
    const contents           = document.querySelectorAll('.dashboard-content');
    const paramContainer     = document.querySelector('#paramContainer');
    const statsDiv           = document.querySelector('#paramStats');
    const addBtn             = document.querySelector('#addParamBtn');
    const saveParamsBtn      = document.querySelector('#saveParamsBtn');
    const addParamModal      = document.querySelector('#addParamModal');
    const closeModalBtn      = document.querySelector('#closeAddParamModal');
    const cancelParamBtn     = document.querySelector('#cancelParamBtn');
    const saveParamBtn       = document.querySelector('#saveParamBtn');
    const paramNameInput     = document.querySelector('#paramNameInput');
    const paramConditionSel  = document.querySelector('#paramConditionSelect');
    const paramMaxWeightInp  = document.querySelector('#paramMaxWeight');
    const addOptionBtn       = document.querySelector('#addOptionBtn');
    const optionsList        = document.querySelector('#optionsList');
    const paramAssetFilter   = document.querySelector('#paramAssetFilter');

    // tabs
    tabs.forEach(tab => {
      tab.addEventListener('click', async () => {
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.target).classList.add('active');
        if (tab.dataset.target === 'workplan') await loadWorkplan();
      });
    });

    // ─── Helpers
    function recalcPercentageTotal() {
      const all = document.querySelectorAll('.param-percentage');
      let sum = 0; all.forEach(inp => sum += parseInt(inp.value,10) || 0);
      const el = document.getElementById('percentageTotal');
      if (!el) return;
      el.textContent = sum;
      el.style.color = sum === 100 ? '' : 'red';
    }
    function makeDisplayRow({ applies_to, parameter, condition, max_weight, options }) {
      const row = document.createElement('div');
      row.className = 'param-row';
      row.dataset.appliesto = applies_to;
      row.dataset.maxWeight = max_weight;
      row.innerHTML = `
        <input type="text" class="param-name" value="${parameter}" disabled />
        <select class="param-condition" disabled>
          <option value="${condition}" selected>${condition}</option>
        </select>
        <select class="param-options"></select>
        <span class="param-weight-display"></span>
        <input type="number" class="param-percentage" min="0" max="100" value="0"
               style="width:60px; margin-left:0.5em;" title="Enter % (total should sum to 100)" />%
        <button class="deleteParamBtn">×</button>
      `;
      const condSel = row.querySelector('.param-condition'); condSel.disabled = true;
      ['IF'].forEach(optVal => {
        const opt = document.createElement('option'); opt.value = opt.textContent = optVal;
        if (optVal === condition) opt.selected = true; condSel.appendChild(opt);
      });
      const optSel = row.querySelector('.param-options');
      const weightDisplay = row.querySelector('.param-weight-display');
      options.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.weight; opt.textContent = o.label;
        if (o.selected) { opt.selected = true; weightDisplay.textContent = o.weight; }
        optSel.appendChild(opt);
      });
      if (!options.some(o=>o.selected) && options.length) {
        optSel.selectedIndex = 0; weightDisplay.textContent = options[0].weight;
      }
      optSel.addEventListener('change', () => { weightDisplay.textContent = optSel.value; });
      row.querySelector('.param-percentage').addEventListener('input', recalcPercentageTotal);
      row.querySelector('.deleteParamBtn').addEventListener('click', () => row.remove());
      return row;
    }

    function makeOptionRow(label = '', weight = 0) {
      const row = document.createElement('div');
      row.className = 'option-row';
      row.style = 'display:flex; align-items:center; margin-top:0.5em;';
      row.innerHTML = `
        <input type="text" class="option-name" placeholder="Option label"
               style="flex:1; margin-right:0.5em;" />
        <select class="option-weight" style="width:5em; margin-right:0.5em;"></select>
        <button class="deleteOptionBtn" style="color:red;">×</button>
      `;
      const weightSelect = row.querySelector('.option-weight');
      function populateWeights(max = Math.max(1, parseInt(paramMaxWeightInp.value) ||0)) {
        const prev = parseInt(weightSelect.value,10) || weight;
        weightSelect.innerHTML = '';
        for (let i=0; i<=max; i++) {
          const opt = document.createElement('option');
          opt.value = opt.textContent = i; weightSelect.appendChild(opt);
        }
        weightSelect.value = Math.min(prev, max);
      }
      paramMaxWeightInp.addEventListener('change', () => populateWeights());
      populateWeights();
      row.querySelector('.option-name').value = label;
      row.querySelector('.deleteOptionBtn').addEventListener('click', () => row.remove());
      return row;
    }

    // ===== Load existing parameters (from lookups.xlsx) =====
    const existing = await window.electronAPI.getAlgorithmParameters();
    statsDiv.innerHTML = ''; paramContainer.innerHTML = '';
    const grouped = {};
    (existing || []).forEach(e => {
      const key = `${e.parameter}||${e.condition}`;
      if (!grouped[key]) {
        grouped[key] = {
          applies_to: e.applies_to, parameter: e.parameter,
          condition: e.condition, max_weight: e.max_weight, options: []
        };
      }
      grouped[key].options.push({ label: e.option, weight: e.weight, selected: !!e.selected });
    });
    Object.values(grouped).forEach(grp => paramContainer.appendChild(makeDisplayRow(grp)));

    // ===== Applies-To (clone filter tree if present) =====
    function populateParamAssetFilter() {
      paramAssetFilter.innerHTML = '';
      const filterTree = document.getElementById('filterTree');
      if (!filterTree) return;
      filterTree.querySelectorAll('.filter-checkbox.asset-type').forEach(box => {
        const cb = document.createElement('input');
        cb.type='checkbox'; cb.checked = box.checked;
        cb.dataset.company = box.dataset.company;
        cb.dataset.location = box.dataset.location;
        cb.dataset.assetType = box.value;
        const lbl = document.createElement('label');
        lbl.style.marginLeft = '0.3em';
        lbl.textContent = `${box.dataset.company} → ${box.dataset.location} → ${box.value}`;
        const row = document.createElement('div'); row.append(cb, lbl);
        paramAssetFilter.appendChild(row);
      });
    }

    // ===== Modal wiring =====
    addOptionBtn.addEventListener('click', () => optionsList.appendChild(makeOptionRow()));
    function closeAddParamModal(){ addParamModal.style.display='none'; }
    addBtn.addEventListener('click', () => {
      paramNameInput.value=''; paramConditionSel.value='IF'; paramMaxWeightInp.value='3';
      optionsList.innerHTML=''; optionsList.appendChild(makeOptionRow());
      populateParamAssetFilter();
      addParamModal.style.display='flex';
    });
    closeModalBtn.addEventListener('click', closeAddParamModal);
    cancelParamBtn.addEventListener('click', closeAddParamModal);
    addParamModal.addEventListener('click', e => { if (e.target === addParamModal) closeAddParamModal(); });

    // custom weight sub-modal
    const btnOpenCustomWeightModal = document.getElementById('addCustomWeightBtn');
    const customWeightModal        = document.getElementById('customWeightModal');
    const closeCustomWeightModal   = document.getElementById('closeCustomWeightModal');
    const cancelCustomWeight       = document.getElementById('cancelCustomWeight');
    const confirmCustomWeight      = document.getElementById('confirmCustomWeight');
    const selectCustomWeight       = document.getElementById('selectCustomWeight');
    const inputNewCustomWeight     = document.getElementById('inputNewCustomWeight');
    const btnSaveCustomWeight      = document.getElementById('btnSaveCustomWeight');

    btnOpenCustomWeightModal.addEventListener('click', async () => {
      selectCustomWeight.innerHTML = '<option value="">-- select weight --</option>';
      const weights = await window.electronAPI.getCustomWeights();
      (weights || []).forEach(w => {
        const opt = document.createElement('option');
        opt.value = opt.textContent = w.weight; selectCustomWeight.appendChild(opt);
      });
      inputNewCustomWeight.value = '';
      customWeightModal.style.display = 'flex';
    });
    btnSaveCustomWeight.addEventListener('click', async () => {
      const newWt = inputNewCustomWeight.value.trim();
      if (!newWt) return alert('Please enter a custom weight.');
      await window.electronAPI.addCustomWeight(newWt, true);
      const opt = document.createElement('option'); opt.value = opt.textContent = newWt;
      selectCustomWeight.appendChild(opt); selectCustomWeight.value = newWt;
    });
    confirmCustomWeight.addEventListener('click', () => {
      const chosen = selectCustomWeight.value;
      if (!chosen) return alert('Please select or add a custom weight.');
      document.querySelectorAll('.option-weight').forEach(sel => {
        if (![...sel.options].some(o => o.value === chosen)) {
          const o = document.createElement('option'); o.value = o.textContent = chosen; sel.appendChild(o);
        }
        sel.value = chosen;
      });
      customWeightModal.style.display = 'none';
    });
    [closeCustomWeightModal, cancelCustomWeight].forEach(btn =>
      btn.addEventListener('click', () => customWeightModal.style.display='none')
    );
    customWeightModal.addEventListener('click', e => { if (e.target === customWeightModal) customWeightModal.style.display='none'; });

    // save new parameter rows
    saveParamBtn.addEventListener('click', async () => {
      const parameter = paramNameInput.value.trim();
      const condition = paramConditionSel.value;
      const maxWeight = parseInt(paramMaxWeightInp.value, 10) || 1;
      const options = Array.from(optionsList.querySelectorAll('.option-row')).map(r => ({
        label:  r.querySelector('.option-name').value.trim(),
        weight: parseInt(r.querySelector('.option-weight').value, 10)
      }));
      const applies = Array.from(paramAssetFilter.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => ({ company: cb.dataset.company, location: cb.dataset.location, assetType: cb.dataset.assetType }));
      const rows = [];
      applies.forEach(a => {
        options.forEach(o => {
          rows.push({
            applies_to:  `${a.company} → ${a.location} → ${a.assetType}`,
            parameter, condition, max_weight: maxWeight, option: o.label, weight: o.weight
          });
        });
      });
      await window.electronAPI.saveAlgorithmParameters(rows, { append: true });
      const applies_to_str = applies.map(a => `${a.company} → ${a.location} → ${a.assetType}`).join(', ');
      paramContainer.appendChild(makeDisplayRow({
        applies_to: applies_to_str, parameter, condition, max_weight: maxWeight, options
      }));
      await loadWorkplan();
      await populateWorkplanFromImport();
      closeAddParamModal();
    });

    // save edited parameter selections (Selected flag)
    saveParamsBtn.addEventListener('click', async () => {
      const toSave = Array.from(paramContainer.querySelectorAll('.param-row')).flatMap(r => {
        const applies = r.dataset.appliesto;
        const maxW    = parseInt(r.dataset.maxWeight, 10);
        const param   = r.querySelector('.param-name').value.trim();
        const cond    = r.querySelector('.param-condition').value;
        return Array.from(r.querySelectorAll('.param-options option')).map(opt => ({
          applies_to: applies, parameter: param, condition: cond,
          max_weight: maxW, option: opt.textContent, weight: parseInt(opt.value,10), selected: opt.selected
        }));
      });
      await window.electronAPI.saveAlgorithmParameters(toSave, { replace: true });
      await loadWorkplan();
      await populateWorkplanFromImport();
      const total = toSave.reduce((s,p)=>s+(p.weight||0),0);
      statsDiv.innerHTML = `<p><strong>Total weight:</strong> ${total}</p>`;
    });

    // ===== Workplan =====
    const wpContainer        = dashPlaceholder.querySelector('#workplanContainer');
    const constantsContainer = wpContainer.querySelector('#constantsContainer');
    const saveWPBtn          = dashPlaceholder.querySelector('#saveWorkplanBtn');
    const addConstBtn        = dashPlaceholder.querySelector('#addConstantBtn');

    function makeConstantRow(field='', value='') {
      const row = document.createElement('div');
      row.className = 'const-row';
      row.style = 'display:flex; align-items:center; gap:.5em; margin-bottom:.5em;';
      const fld = document.createElement('input'); fld.type='text'; fld.className='const-field';
      fld.value = field; fld.placeholder='Field'; fld.style = 'border:none; flex:1;';
      const val = document.createElement('input'); val.type='text'; val.className='const-value';
      val.value = value; val.placeholder='Value'; val.style = 'flex:1;';
      const del = document.createElement('button'); del.textContent='×'; del.addEventListener('click', () => row.remove());
      row.append(fld, val, del);
      return row;
    }

    if (saveWPBtn) {
      saveWPBtn.addEventListener('click', async () => {
        const toSave = Array.from(constantsContainer.querySelectorAll('.const-row'))
          .map(r => ({ field: r.querySelector('.const-field').value.trim(),
                       value: r.querySelector('.const-value').value }));
        await window.electronAPI.saveWorkplanConstants(toSave);
      });
      addConstBtn.addEventListener('click', () => constantsContainer.append(makeConstantRow()));
    }

    async function loadWorkplan() {
      // constants
      const consts = await window.electronAPI.getWorkplanConstants();
      constantsContainer.innerHTML = '';
      (consts || []).forEach(c => constantsContainer.append(makeConstantRow(c.field, c.value||'')));

      // params → unique list for columns
      const params = await window.electronAPI.getAlgorithmParameters();
      const uniqueParams = [...new Set((params||[]).map(p => p.parameter))];

      const hdrRow = dashPlaceholder.querySelector('#workplanHeaders');
      hdrRow.innerHTML = '';
      const headers = ['Site Name','Station Number','Operation', ...uniqueParams];
      headers.forEach(text => { const th=document.createElement('th'); th.textContent=text; hdrRow.appendChild(th); });

      dashPlaceholder.querySelector('#workplanBody').innerHTML = '';
      await populateWorkplanFromImport();
    }

    // ===== Optimization I
    const optimizeBtn = document.getElementById('optimizeBtn');
    if (optimizeBtn) {
      optimizeBtn.addEventListener('click', async () => {
        const hdrRow = document.querySelector('#workplanHeaders');
        const body   = document.querySelector('#workplanBody');
        const headers = Array.from(hdrRow.querySelectorAll('th')).map(th => th.textContent.trim());
        const workplanRows = Array.from(body.querySelectorAll('tr')).map(tr => {
          const cells = Array.from(tr.querySelectorAll('td')); const rec = {};
          headers.forEach((h, i) => { rec[h] = (cells[i] ? cells[i].textContent : '') || ''; });
          return rec;
        });
        const overall = {};
        document.querySelectorAll('.param-row').forEach(row => {
          const pname = row.querySelector('.param-name')?.value?.trim();
          const pct   = parseFloat(row.querySelector('.param-percentage')?.value || '0');
          if (pname) overall[pname] = isFinite(pct) ? pct : 0;
        });

        // Pass the same parameter rows the UI is using, so backend can’t miss them
        const params = await window.electronAPI.getAlgorithmParameters();
        const result = await window.electronAPI.optimizeWorkplan({
          workplan_rows: workplanRows,
          param_overall: overall,
          parameters: params
        });
        optimizeBtn.style.display = 'none';

        const optPane = document.querySelector('#optimization .opt-container');
        // Clear any previous output (including earlier table renders)
        optPane.querySelectorAll('pre, ol, table.opt-table').forEach(el => el.remove());
        // (Numbered list removed — we render only the nice table below)

        // Add a minimal table that Opt II expects to read
        const tbl = document.createElement('table');
        tbl.className = 'opt-table';
        tbl.innerHTML = `
          <thead>
            <tr>
              <th>Station ID</th>
              <th>Operation</th>
              <th>Summed Value</th>
            </tr>
          </thead>
          <tbody></tbody>`;
        (result?.ranking || []).forEach(item => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${item.station_number ?? ''}</td>
            <td>${item.operation ?? ''}</td>
            <td>${Number(item.score).toFixed(2)}%</td>`;
          tbl.querySelector('tbody').appendChild(tr);
        });
        optPane.appendChild(tbl);
      });
    }

    // ===== Optimization II (geographical)
    const geoBtn = dashPlaceholder.querySelector('#optimizeGeoBtn');
    if (geoBtn && !geoBtn._wired) {
      geoBtn.addEventListener('click', async () => {
        geoBtn.style.display = 'none';
        const hero = dashPlaceholder.querySelector('#optimization2 .opt2-hero'); if (hero) hero.style.display = 'none';
        const optRoot = dashPlaceholder.querySelector('#optimization');
        const optPane = optRoot && (optRoot.querySelector('.opt-container') || optRoot);
        const opt2Pane = dashPlaceholder.querySelector('#optimization2 .opt2-container')
                       || dashPlaceholder.querySelector('#optimization2');
        const table = optPane && optPane.querySelector('table.opt-table');
        if (!table) { opt2Pane.innerHTML = `<div class="opt2-note">Run Optimization I first, then click Optimization II.</div>`; return; }

        const headers = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
        const idxStation = headers.findIndex(h => /Station ID/i.test(h));
        const idxOp      = headers.findIndex(h => /Operation/i.test(h));
        const idxScore   = headers.findIndex(h => /Summed Value/i.test(h));

        const wpHdrs = [...(document.querySelectorAll('#workplanHeaders th') || [])].map(th => th.textContent.trim());
        const wpIdxStation = wpHdrs.findIndex(h => /Station Number/i.test(h));
        const wpIdxOp      = wpHdrs.findIndex(h => /Operation/i.test(h));
        const wpIdxDays    = wpHdrs.findIndex(h => /^Days$/i.test(h));
        const wpRows = [...(document.querySelectorAll('#workplanBody tr') || [])];
        const wpDaysByKey = new Map();
        if (wpIdxStation >= 0 && wpIdxOp >= 0 && wpIdxDays >= 0) {
          wpRows.forEach(tr => {
            const tds = [...tr.querySelectorAll('td')];
            const sid = (tds[wpIdxStation]?.textContent || '').trim();
            const op  = (tds[wpIdxOp]?.textContent || '').trim();
            const daysRaw = (tds[wpIdxDays]?.textContent || '').trim();
            const key = sid + '||' + op;
            const val = Number.parseFloat(daysRaw);
            if (sid && op && Number.isFinite(val)) wpDaysByKey.set(key, Math.max(1, Math.ceil(val)));
          });
        }

        const items = [...table.querySelectorAll('tbody tr')].map(tr => {
          const tds = [...tr.querySelectorAll('td')];
          const sid = (tds[idxStation]?.textContent || '').trim();
          const op  = (tds[idxOp]?.textContent || '').trim();
          const sc  = parseFloat((tds[idxScore]?.textContent || '').replace('%','')) || 0;
          const key = sid + '||' + op;
          const out = { station_id: sid, operation: op, score: sc };
          if (wpDaysByKey.has(key)) out.days = wpDaysByKey.get(key);
          return out;
        }).filter(x => x.station_id);

        const stationList = await window.electronAPI.getStationData();
        const nameById = new Map((stationList || []).map(s => [String(s.station_id), String(s.name || '')]));
        opt2Pane.innerHTML = `<div class="opt2-note">Planning…</div>`;

        let res;
        try { res = await window.electronAPI.runGeographicalAlgorithm({ items }); }
        catch { opt2Pane.innerHTML = `<div class="opt2-error">Optimization II failed.</div>`; return; }
        if (!res || !res.success) {
          opt2Pane.innerHTML = `<div class="opt2-error">${(res && res.message) || 'Optimization II failed.'}</div>`;
          return;
        }
        renderGeoPlan(opt2Pane, res, nameById);
      });
      geoBtn._wired = true;
    }

    function renderGeoPlan(root, data, nameById) {
      root.innerHTML = '';
      const hdr = document.createElement('div');
      hdr.className = 'opt2-header';
      hdr.innerHTML = `
        <div class="opt2-title">${data.plan_name || 'Geographical Plan'}</div>
        <div class="opt2-summary">
          <span class="chip">Trips: ${data.totals.trip_count}</span>
          <span class="chip">Planned items: ${data.totals.planned}</span>
          <span class="chip">Unplanned: ${data.totals.unplanned}</span>
        </div>`;
      root.appendChild(hdr);

      (data.trips || []).forEach(trip => {
        const sec = document.createElement('section'); sec.className = 'opt2-trip';
        sec.innerHTML = `
          <div class="opt2-trip-head">
            <div class="trip-title">${trip.trip_name}</div>
            <div class="trip-meta">
              <span class="pill">Days: ${trip.days}</span>
              <span class="pill">Items: ${trip.count}</span>
              <span class="pill">Drive: ${trip.drive_count}</span>
              <span class="pill">Heli: ${trip.helicopter_count}</span>
            </div>
          </div>`;
        const table = document.createElement('table'); table.className = 'opt2-table';
        table.innerHTML = `
          <thead>
            <tr>
              <th>#</th><th>Day</th><th>Station Name</th>
              <th class="station-id">Station ID</th><th>Operation</th>
              <th class="num">Score</th><th>Mode</th>
            </tr>
          </thead><tbody></tbody>`;
        const tbody = table.querySelector('tbody');
        trip.schedule.forEach((r, i) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td class="rank">${i+1}</td>
            <td>${r.day}</td>
            <td>${nameById.get(String(r.station_id)) || ''}</td>
            <td class="station-id">${r.station_id}</td>
            <td>${r.operation || ''}</td>
            <td class="num">${Number.isFinite(r.score) ? r.score.toFixed(2) + '%' : ''}</td>
            <td>${r.mode === 'helicopter' ? '🚁 helicopter' : '🚗 drive'}</td>`;
          tbody.appendChild(tr);
        });
        sec.appendChild(table); root.appendChild(sec);
      });

      if ((data.unplanned || []).length) {
        const sec = document.createElement('section'); sec.className = 'opt2-trip';
        const title = document.createElement('div'); title.className='trip-title'; title.textContent = 'Unplanned / Not In Trip Plan';
        sec.appendChild(title);
        const table = document.createElement('table'); table.className='opt2-table';
        table.innerHTML = `
          <thead>
            <tr><th>#</th><th>Station Name</th><th class="station-id">Station ID</th>
                <th>Operation</th><th class="num">Score</th></tr>
          </thead><tbody></tbody>`;
        const tbody = table.querySelector('tbody');
        data.unplanned.forEach((r,i) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td class="rank">${i+1}</td>
            <td>${nameById.get(String(r.station_id)) || ''}</td>
            <td class="station-id">${r.station_id}</td>
            <td>${r.operation || ''}</td>
            <td class="num">${Number.isFinite(r.score) ? r.score.toFixed(2) + '%' : ''}</td>`;
          tbody.appendChild(tr);
        });
        sec.appendChild(table); root.appendChild(sec);
      }
    }

    // ===== Workplan import (bottom of container) =====
    const importBar = document.createElement('div');
    importBar.style = 'margin-top:12px; display:flex; gap:10px; align-items:center;';
    const importBtn = document.createElement('button'); importBtn.id='btnImportRepairs'; importBtn.textContent='Import Repairs'; importBtn.className='btn';
    const importInfo = document.createElement('span'); importInfo.style='opacity:.75; font-size:12px;'; importInfo.textContent='No file imported';
    const fileInput = document.createElement('input'); fileInput.type='file';
    fileInput.accept='.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'; fileInput.style.display='none';
    importBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const f = (e.target.files || [])[0]; if (!f) return;
      const buf = await f.arrayBuffer(); const bytes = new Uint8Array(buf);
      let bin=''; for (let b of bytes) bin += String.fromCharCode(b);
      const b64 = btoa(bin);
      const res = await window.electronAPI.importRepairsExcel(b64);
      if (!res || !res.success) { alert('Import failed: ' + (res && res.message ? res.message : 'Unknown error')); return; }
      window.__repairsImportCache = res.rows || [];
      importInfo.textContent = `Imported ${window.__repairsImportCache.length} rows`;
      await loadWorkplan();
      await populateWorkplanFromImport();
    });
    importBar.append(importBtn, importInfo, fileInput);
    const wpContainerEl = dashPlaceholder.querySelector('#workplanContainer');
    if (wpContainerEl) wpContainerEl.appendChild(importBar);

    async function populateWorkplanFromImport() {
      const rows = window.__repairsImportCache || []; if (!rows.length) return;
      const hdrRow = dashPlaceholder.querySelector('#workplanHeaders');
      const tbody  = dashPlaceholder.querySelector('#workplanBody'); if (!hdrRow || !tbody) return;
      const headers = Array.from(hdrRow.querySelectorAll('th')).map(th => th.textContent.trim());
      const paramSet = new Set(headers.slice(3));
      const stationList = await window.electronAPI.getStationData();
      const siteByStation = new Map((stationList || []).map(s => [String(s.station_id), String(s.name || '')]));
      tbody.innerHTML = '';
      rows.forEach(r => {
        const tr = document.createElement('tr');
        headers.forEach(h => {
          const td = document.createElement('td'); let val = '';
          if (h === 'Site Name') {
            const stn = r['Station Number'] != null ? String(r['Station Number'])
                       : (r['Station ID'] != null ? String(r['Station ID']) : '');
            val = siteByStation.get(stn) || '';
          } else if (h === 'Station Number') {
            val = r['Station Number'] != null ? r['Station Number'] : (r['Station ID'] || '');
          } else if (h === 'Operation') {
            val = (r['Operation'] != null) ? r['Operation'] : (r['Repair Name'] != null ? r['Repair Name'] : '');
          } else if (paramSet.has(h)) {
            val = r.hasOwnProperty(h) && r[h] != null ? r[h] : '';
          }
          td.textContent = val == null ? '' : String(val); tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }

    await loadWorkplan();
    recalcPercentageTotal();
  }

  // expose a quick global opener if you want to call from HTML
  window.__openOptimization = showOptimization;
});
