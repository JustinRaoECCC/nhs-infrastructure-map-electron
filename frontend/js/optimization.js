// frontend/js/optimization.js
document.addEventListener('DOMContentLoaded', () => {

  const dashPlaceholder    = document.getElementById('dashboardContentContainer');
  const mapContainer       = document.getElementById('mapContainer');
  const rightPanel         = document.getElementById('rightPanel');
  const stationPlaceholder = document.getElementById('stationContentContainer');

  const navOpt = document.getElementById('navOpt');
  if (navOpt && !navOpt._wired) {
    navOpt.addEventListener('click', (e) => {
      e.preventDefault();
      showOptimization();
    });
    navOpt._wired = true;
  }

  function resetOptimizationViews() {
    if (!dashPlaceholder || !dashPlaceholder.innerHTML.trim()) return;
    const filterResults = document.getElementById('filteringResults');
    const scoringResults = document.getElementById('scoringResults');
    if (filterResults) filterResults.innerHTML = '';
    if (scoringResults) scoringResults.innerHTML = '';
  }

  async function showOptimization() {
    if (mapContainer)       mapContainer.style.display = 'none';
    if (rightPanel)         rightPanel.style.display   = 'none';
    if (stationPlaceholder) stationPlaceholder.style.display = 'none';
    if (document && document.body) document.body.dataset.suppressRhs = '1';
    const filtersPanel = document.querySelector('.left-panel');
    if (filtersPanel) filtersPanel.style.display = '';
    const rightToggleBtn = document.getElementById('toggleRight');
    if (rightToggleBtn) rightToggleBtn.style.display = 'none';

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
    const tabs     = document.querySelectorAll('.dashboard-tab');
    const contents = document.querySelectorAll('.dashboard-content');

    // Tab switching
    tabs.forEach(tab => {
      tab.addEventListener('click', async () => {
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.target).classList.add('active');
        if (tab.dataset.target === 'workplan') await loadWorkplan();
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // FIXED PARAMETERS (NEW)
    // ═══════════════════════════════════════════════════════════════════════
    const fixedParamContainer = document.getElementById('fixedParamContainer');
    const addFixedParamBtn = document.getElementById('addFixedParamBtn');
    const saveFixedParamsBtn = document.getElementById('saveFixedParamsBtn');
    const addFixedParamModal = document.getElementById('addFixedParamModal');
    const closeAddFixedParamModal = document.getElementById('closeAddFixedParamModal');
    const cancelFixedParamBtn = document.getElementById('cancelFixedParamBtn');
    const saveFixedParamBtn = document.getElementById('saveFixedParamBtn');
    const fixedParamNameInput = document.getElementById('fixedParamNameInput');
    const fixedParamTypeSelect = document.getElementById('fixedParamTypeSelect');

    const fixedParamDataSource = document.getElementById('fixedParamDataSource');
    const fixedParamMatchUsing = document.getElementById('fixedParamMatchUsing');
    const matchUsingContainer = document.getElementById('matchUsingContainer');

    // Constraint-specific fields
    const geographicalFields = document.getElementById('geographicalFields');
    const temporalFields = document.getElementById('temporalFields');
    const monetaryFields = document.getElementById('monetaryFields');
    const designationFields = document.getElementById('designationFields');

    // Toggle constraint fields AND match using based on type
    fixedParamTypeSelect.addEventListener('change', () => {
      document.querySelectorAll('.constraint-fields').forEach(el => el.style.display = 'none');
      const type = fixedParamTypeSelect.value;
      if (type === 'geographical') geographicalFields.style.display = 'block';
      if (type === 'temporal') temporalFields.style.display = 'block';
      if (type === 'monetary') monetaryFields.style.display = 'block';
      if (type === 'designation') designationFields.style.display = 'block';
      
      // Only show "Match Using" for types that have a field_name
      const hasFieldName = type === 'monetary' || type === 'designation';
      matchUsingContainer.style.display = hasFieldName ? 'block' : 'none';
    });

    const geoValuesList = document.getElementById('geoValuesList');
    const addGeoValueBtn = document.getElementById('addGeoValueBtn');

    function makeGeoValueRow(value = '') {
      const row = document.createElement('div');
      row.className = 'geo-value-row';
      row.style = 'display:flex; align-items:center; gap:0.5em; margin-bottom:0.5em;';
      row.innerHTML = `
        <input type="text" class="geo-value" placeholder="Enter value" 
               style="flex:1; padding:0.5em;" value="${value}" />
        <button class="deleteGeoValueBtn" style="color:red;">×</button>
      `;
      row.querySelector('.deleteGeoValueBtn').addEventListener('click', () => row.remove());
      return row;
    }

    addGeoValueBtn.addEventListener('click', () => {
      geoValuesList.appendChild(makeGeoValueRow());
    });

    function makeFixedParamDisplayRow(param) {
      const row = document.createElement('div');
      row.className = 'fixed-param-row';
      row.style = 'border:1px solid #ddd; padding:1em; margin-bottom:1em; border-radius:4px; background:#f9f9f9;';
      
      let detailsHTML = '';
      const dataSourceLabel = param.data_source === 'station' ? 'Station Data' : 'Repair Fields';
      if (param.type === 'geographical') {
        detailsHTML = `<div><strong>Type:</strong> Geographical</div>
                       <div><strong>Data Source:</strong> ${dataSourceLabel}</div>
                       <div><strong>Allowed Values:</strong> ${param.values.join(', ')}</div>`;
      } else if (param.type === 'temporal') {
        detailsHTML = `<div><strong>Type:</strong> Temporal</div>
                       <div><strong>Data Source:</strong> ${dataSourceLabel}</div>
                       <div><strong>Scope:</strong> ${param.scope}</div>
                       <div><strong>Value:</strong> ${param.value}</div>
                       <div><strong>Unit:</strong> ${param.unit}</div>`;
      } else if (param.type === 'monetary') {
        const matchLabel = param.match_using === 'field_name' ? 'Field Name' : 'Fixed Parameter Name';
        detailsHTML = `<div><strong>Type:</strong> Monetary</div>
                       <div><strong>Data Source:</strong> ${dataSourceLabel}</div>
                       <div><strong>Match Using:</strong> ${matchLabel}</div>
                       <div><strong>Field:</strong> ${param.field_name}</div>
                       <div><strong>Condition:</strong> ${param.conditional} ${param.value} ${param.unit}</div>`;
      } else if (param.type === 'designatino') {
        const matchLabel = param.match_using === 'field_name' ? 'Field Name' : 'Fixed Parameter Name';
        detailsHTML = `<div><strong>Type:</strong> Designation</div>
                       <div><strong>Data Source:</strong> ${dataSourceLabel}</div>
                       <div><strong>Match Using:</strong> ${matchLabel}</div>
                       <div><strong>Condition:</strong> ${param.condition}</div>
                       <div><strong>Field:</strong> ${param.field_name}</div>`;
      }

      row.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:start;">
          <div>
            <h4 style="margin:0 0 0.5em 0;">${param.name}</h4>
            ${detailsHTML}
          </div>
          <button class="deleteFixedParamBtn" style="color:red; font-size:1.5em; border:none; background:none; cursor:pointer;">×</button>
        </div>
      `;

      row.querySelector('.deleteFixedParamBtn').addEventListener('click', () => row.remove());
      row.dataset.paramData = JSON.stringify(param);
      return row;
    }

    // Load existing fixed parameters
    async function loadFixedParameters() {
      const existing = await window.electronAPI.getFixedParameters();
      fixedParamContainer.innerHTML = '';
      (existing || []).forEach(param => {
        fixedParamContainer.appendChild(makeFixedParamDisplayRow(param));
      });
    }

    // Open add fixed parameter modal
    addFixedParamBtn.addEventListener('click', () => {
      fixedParamNameInput.value = '';
      fixedParamDataSource.value = 'repair';
      fixedParamMatchUsing.value = 'parameter_name';
      fixedParamTypeSelect.value = 'geographical';
      geoValuesList.innerHTML = '';
      geoValuesList.appendChild(makeGeoValueRow());
      document.getElementById('temporalScope').value = 'per_day';
      document.getElementById('temporalValue').value = '';
      document.getElementById('temporalUnit').value = 'hours';
      document.getElementById('monetaryFieldName').value = '';
      document.getElementById('monetaryConditional').value = '<';
      document.getElementById('monetaryValue').value = '';
      document.getElementById('monetaryUnit').value = '';
      document.getElementById('designationCondition').value = 'None';
      document.getElementById('designationFieldName').value = '';
      document.querySelectorAll('.constraint-fields').forEach(el => el.style.display = 'none');
      geographicalFields.style.display = 'block';
      matchUsingContainer.style.display = 'none';
      addFixedParamModal.style.display = 'flex';
    });

    closeAddFixedParamModal.addEventListener('click', () => addFixedParamModal.style.display = 'none');
    cancelFixedParamBtn.addEventListener('click', () => addFixedParamModal.style.display = 'none');
    addFixedParamModal.addEventListener('click', e => {
      if (e.target === addFixedParamModal) addFixedParamModal.style.display = 'none';
    });

    // Save new fixed parameter
    saveFixedParamBtn.addEventListener('click', () => {
      const name = fixedParamNameInput.value.trim();
      const type = fixedParamTypeSelect.value;
      const dataSource = fixedParamDataSource.value;
      const matchUsing = fixedParamMatchUsing.value;
      
      if (!name) {
        alert('Please enter a parameter name');
        return;
      }

      const param = { name, type, data_source: dataSource };

      if (type === 'geographical') {
        const values = Array.from(geoValuesList.querySelectorAll('.geo-value'))
          .map(input => input.value.trim())
          .filter(v => v);
        if (!values.length) {
          alert('Please add at least one geographical value');
          return;
        }
        param.values = values;
      } else if (type === 'temporal') {
        param.scope = document.getElementById('temporalScope').value;
        param.value = document.getElementById('temporalValue').value;
        param.unit = document.getElementById('temporalUnit').value;
        if (!param.value) {
          alert('Please enter a temporal value');
          return;
        }
      } else if (type === 'monetary') {
        param.match_using = matchUsing;
        param.field_name = document.getElementById('monetaryFieldName').value.trim();
        param.conditional = document.getElementById('monetaryConditional').value;
        param.value = document.getElementById('monetaryValue').value;
        param.unit = document.getElementById('monetaryUnit').value.trim();
        if (!param.field_name || !param.value) {
          alert('Please fill in all monetary constraint fields');
          return;
        }
      } else if (type === 'designation') {
        param.match_using = matchUsing;
        param.condition = document.getElementById('designationCondition').value;
        param.field_name = document.getElementById('designationFieldName').value.trim();
        if (!param.field_name) {
          alert('Please enter a field name for the designation constraint');
          return;
        }
      }

      fixedParamContainer.appendChild(makeFixedParamDisplayRow(param));
      addFixedParamModal.style.display = 'none';
    });

    // Save all fixed parameters
    saveFixedParamsBtn.addEventListener('click', async () => {
      const params = Array.from(fixedParamContainer.querySelectorAll('.fixed-param-row'))
        .map(row => JSON.parse(row.dataset.paramData));
      await window.electronAPI.saveFixedParameters(params);
      appAlert('Fixed parameters saved successfully');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // SOFT PARAMETERS (RENAMED FROM PARAMETERS)
    // ═══════════════════════════════════════════════════════════════════════
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

    // Load existing soft parameters
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
      await populateWorkplanFromRepairs();
      closeAddParamModal();
    });

    // save edited parameter selections
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
      await populateWorkplanFromRepairs();
      const total = toSave.reduce((s,p)=>s+(p.weight||0),0);
      statsDiv.innerHTML = `<p><strong>Total weight:</strong> ${total}</p>`;
    });

    // ═══════════════════════════════════════════════════════════════════════
    // WORKPLAN
    // ═══════════════════════════════════════════════════════════════════════
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
      const consts = await window.electronAPI.getWorkplanConstants();
      constantsContainer.innerHTML = '';
      (consts || []).forEach(c => constantsContainer.append(makeConstantRow(c.field, c.value||'')));

      const params = await window.electronAPI.getAlgorithmParameters();
      const uniqueParams = [...new Set((params||[]).map(p => p.parameter))];

      const hdrRow = dashPlaceholder.querySelector('#workplanHeaders');
      hdrRow.innerHTML = '';
      const headers = ['Site Name','Station Number','Operation', ...uniqueParams];
      headers.forEach(text => { const th=document.createElement('th'); th.textContent=text; hdrRow.appendChild(th); });

      dashPlaceholder.querySelector('#workplanBody').innerHTML = '';
      await populateWorkplanFromRepairs();
    }

    async function populateWorkplanFromRepairs() {
      const allRepairs = await window.electronAPI.getAllRepairs();
      if (!allRepairs || !allRepairs.length) return;

      const hdrRow = dashPlaceholder.querySelector('#workplanHeaders');
      const tbody  = dashPlaceholder.querySelector('#workplanBody'); if (!hdrRow || !tbody) return;
      const headers = Array.from(hdrRow.querySelectorAll('th')).map(th => th.textContent.trim());
      const paramSet = new Set(headers.slice(3));
      const stationList = await window.electronAPI.getStationData();
      const siteByStation = new Map((stationList || []).map(s => [String(s.station_id), String(s.name || '')]));
      tbody.innerHTML = '';
      
      allRepairs.forEach(repair => {
        const tr = document.createElement('tr');
        headers.forEach(h => {
          const td = document.createElement('td'); let val = '';
          if (h === 'Site Name') {
            val = siteByStation.get(repair.station_id) || '';
          } else if (h === 'Station Number') {
            val = repair.station_id || '';
          } else if (h === 'Operation') {
            val = repair.name || '';
          } else if (paramSet.has(h)) {
            val = '';
          }
          td.textContent = val == null ? '' : String(val); tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // OPTIMIZATION I (NEW - CONSTRAINT FILTERING)
    // ═══════════════════════════════════════════════════════════════════════
    const runFilteringBtn = document.getElementById('runFilteringBtn');
    const filteringResults = document.getElementById('filteringResults');

    if (runFilteringBtn) {
      runFilteringBtn.addEventListener('click', async () => {
        const fixedParams = Array.from(fixedParamContainer.querySelectorAll('.fixed-param-row'))
          .map(row => JSON.parse(row.dataset.paramData));
        
        const allRepairs = await window.electronAPI.getAllRepairs();
        if (!allRepairs || !allRepairs.length) {
          filteringResults.innerHTML = '<div class="opt2-note">No repairs found to filter.</div>';
          return;
        }

        // Get all station data to pass to the algorithm
        const stationList = await window.electronAPI.getStationData();
        const stationDataMap = {};
        
        // Build a map of station_id -> all station fields
        (stationList || []).forEach(station => {
          const stationId = station.station_id || station['Station ID'] || station.id;
          if (stationId) {
            stationDataMap[stationId] = station;
          }
        });

        filteringResults.innerHTML = '<div class="opt2-note">Filtering repairs...</div>';

        const result = await window.electronAPI.runConstraintFiltering({
          repairs: allRepairs,
          fixed_parameters: fixedParams,
          station_data: stationDataMap
        });

        if (!result.success) {
          filteringResults.innerHTML = `<div class="opt2-error">${result.message || 'Filtering failed'}</div>`;
          return;
        }

        renderFilteringResults(result);
      });
    }

    function renderFilteringResults(result) {
      filteringResults.innerHTML = '';

      const summary = document.createElement('div');
      summary.className = 'opt2-header';
      summary.innerHTML = `
        <div class="opt2-title">Constraint Filtering Results</div>
        <div class="opt2-summary">
          <span class="chip">Total: ${result.total_repairs}</span>
          <span class="chip" style="background:#4CAF50;">Kept: ${result.kept.length}</span>
          <span class="chip" style="background:#f44336;">Filtered Out: ${result.filtered_out.length}</span>
        </div>
      `;
      filteringResults.appendChild(summary);

      // Kept repairs table
      const keptSection = document.createElement('section');
      keptSection.className = 'opt2-trip';
      keptSection.innerHTML = `
        <div class="trip-title" style="background:#4CAF50; color:white;">✓ Repairs Meeting All Constraints</div>
      `;
      const keptTable = makeRepairTable(result.kept);
      keptSection.appendChild(keptTable);
      filteringResults.appendChild(keptSection);

      // Filtered out repairs table
      const filteredSection = document.createElement('section');
      filteredSection.className = 'opt2-trip';
      filteredSection.innerHTML = `
        <div class="trip-title" style="background:#f44336; color:white;">✗ Repairs Filtered Out</div>
      `;
      const filteredTable = makeRepairTable(result.filtered_out, true);
      filteredSection.appendChild(filteredTable);
      filteringResults.appendChild(filteredSection);
    }

    function makeRepairTable(repairs, showReasons = false) {
      const table = document.createElement('table');
      table.className = 'opt2-table';
      
      let headers = '<th>#</th><th>Station ID</th><th>Operation</th><th>Type</th><th>Cost</th>';
      if (showReasons) headers += '<th>Reason Filtered</th>';
      
      table.innerHTML = `<thead><tr>${headers}</tr></thead><tbody></tbody>`;
      const tbody = table.querySelector('tbody');

      repairs.forEach((repair, i) => {
        const tr = document.createElement('tr');
        let cells = `
          <td class="rank">${i + 1}</td>
          <td>${repair.station_id || ''}</td>
          <td>${repair.name || ''}</td>
          <td>${repair.type || ''}</td>
          <td>${repair.cost || ''}</td>
        `;
        if (showReasons) {
          cells += `<td>${repair.filter_reason || 'Did not meet constraints'}</td>`;
        }
        tr.innerHTML = cells;
        tbody.appendChild(tr);
      });

      return table;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // OPTIMIZATION II (OLD OPTIMIZATION I - SCORING)
    // ═══════════════════════════════════════════════════════════════════════
    const optimizeBtn = document.getElementById('optimizeBtn');
    const scoringResults = document.getElementById('scoringResults');

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

        const params = await window.electronAPI.getAlgorithmParameters();
        
        scoringResults.innerHTML = '<div class="opt2-note">Scoring repairs...</div>';
        
        const result = await window.electronAPI.optimizeWorkplan({
          workplan_rows: workplanRows,
          param_overall: overall,
          parameters: params
        });

        if (!result.success) {
          scoringResults.innerHTML = `<div class="opt2-error">${result.notes || 'Scoring failed'}</div>`;
          return;
        }

        renderScoringResults(result);
      });
    }

    function renderScoringResults(result) {
      scoringResults.innerHTML = '';

      const summary = document.createElement('div');
      summary.className = 'opt2-header';
      summary.innerHTML = `
        <div class="opt2-title">Scoring & Ranking Results</div>
        <div class="opt2-summary">
          <span class="chip">Total Repairs: ${result.optimized_count}</span>
        </div>
      `;
      scoringResults.appendChild(summary);

      const section = document.createElement('section');
      section.className = 'opt2-trip';
      
      const table = document.createElement('table');
      table.className = 'opt2-table';
      table.innerHTML = `
        <thead>
          <tr>
            <th>Rank</th>
            <th>Station ID</th>
            <th>Site Name</th>
            <th>Operation</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;
      
      const tbody = table.querySelector('tbody');
      (result.ranking || []).forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="rank">${item.rank}</td>
          <td>${item.station_number || ''}</td>
          <td>${item.site_name || ''}</td>
          <td>${item.operation || ''}</td>
          <td class="num">${Number(item.score).toFixed(2)}%</td>
        `;
        tbody.appendChild(tr);
      });

      section.appendChild(table);
      scoringResults.appendChild(section);
    }

    // Initialize
    await loadFixedParameters();
    await loadWorkplan();
    await populateWorkplanFromRepairs();
    recalcPercentageTotal();

    window.populateWorkplanFromRepairs = populateWorkplanFromRepairs;
  }

  window.__openOptimization = showOptimization;
});