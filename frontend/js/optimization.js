// frontend/js/optimization.js (COMPLETE REWRITE)
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
    const opt1Results = document.getElementById('opt1Results');
    const opt2Results = document.getElementById('opt2Results');
    const opt3Results = document.getElementById('opt3Results');
    if (opt1Results) opt1Results.innerHTML = '';
    if (opt2Results) opt2Results.innerHTML = '';
    if (opt3Results) opt3Results.innerHTML = '';
    window._scoredRepairs = null;
    window._tripsData = null;
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

  // ══════════════════════════════════════════════════════════════════════════
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
      });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // SOFT PARAMETERS (Optimization 1 - Scoring)
    // ═══════════════════════════════════════════════════════════════════════
    const paramContainer     = document.querySelector('#paramContainer');
    const addBtn             = document.querySelector('#addParamBtn');
    const saveParamsBtn      = document.querySelector('#saveParamsBtn');
    const addParamModal      = document.querySelector('#addParamModal');
    const closeModalBtn      = document.querySelector('#closeAddParamModal');
    const cancelParamBtn     = document.querySelector('#cancelParamBtn');
    const saveParamBtn       = document.querySelector('#saveParamBtn');
    const paramNameInput     = document.querySelector('#paramNameInput');
    const paramDataSource    = document.querySelector('#paramDataSource');
    const paramConditionSel  = document.querySelector('#paramConditionSelect');
    const paramMaxWeightInp  = document.querySelector('#paramMaxWeight');
    const addOptionBtn       = document.querySelector('#addOptionBtn');
    const optionsList        = document.querySelector('#optionsList');

    function recalcPercentageTotal() {
      const all = document.querySelectorAll('.param-percentage');
      let sum = 0; 
      all.forEach(inp => sum += parseInt(inp.value,10) || 0);
      const el = document.getElementById('percentageTotal');
      if (!el) return;
      el.textContent = sum;
      el.style.color = sum === 100 ? '' : 'red';
    }

    function makeDisplayRow({ parameter, data_source, condition, max_weight, options }) {
      const row = document.createElement('div');
      row.className = 'param-row';
      row.dataset.dataSource = data_source;
      row.dataset.maxWeight = max_weight;
      row.innerHTML = `
        <input type="text" class="param-name" value="${parameter}" disabled />
        <span class="param-source">${data_source === 'station' ? 'Station' : 'Repair'}</span>
        <select class="param-condition" disabled>
          <option value="${condition}" selected>${condition}</option>
        </select>
        <select class="param-options"></select>
        <span class="param-weight-display"></span>
        <input type="number" class="param-percentage" min="0" max="100" value="0"
               style="width:60px; margin-left:0.5em;" title="Enter % (total should sum to 100)" />%
        <button class="deleteParamBtn">×</button>
      `;
      const condSel = row.querySelector('.param-condition'); 
      condSel.disabled = true;
      const optSel = row.querySelector('.param-options');
      const weightDisplay = row.querySelector('.param-weight-display');
      options.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.weight; 
        opt.textContent = o.label;
        if (o.selected) { 
          opt.selected = true; 
          weightDisplay.textContent = o.weight; 
        }
        optSel.appendChild(opt);
      });
      if (!options.some(o=>o.selected) && options.length) {
        optSel.selectedIndex = 0; 
        weightDisplay.textContent = options[0].weight;
      }
      optSel.addEventListener('change', () => { 
        weightDisplay.textContent = optSel.value; 
      });
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
          opt.value = opt.textContent = i; 
          weightSelect.appendChild(opt);
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
    paramContainer.innerHTML = '';
    const grouped = {};
    (existing || []).forEach(e => {
      const key = `${e.parameter}||${e.condition}||${e.data_source}`;
      if (!grouped[key]) {
        grouped[key] = {
          parameter: e.parameter,
          data_source: e.data_source,
          condition: e.condition, 
          max_weight: e.max_weight, 
          options: []
        };
      }
      grouped[key].options.push({ 
        label: e.option, 
        weight: e.weight, 
        selected: !!e.selected 
      });
    });
    Object.values(grouped).forEach(grp => paramContainer.appendChild(makeDisplayRow(grp)));

    addOptionBtn.addEventListener('click', () => optionsList.appendChild(makeOptionRow()));
    
    function closeAddParamModal(){ addParamModal.style.display='none'; }
    
    addBtn.addEventListener('click', () => {
      paramNameInput.value=''; 
      paramDataSource.value='repair';
      paramConditionSel.value='IF'; 
      paramMaxWeightInp.value='3';
      optionsList.innerHTML=''; 
      optionsList.appendChild(makeOptionRow());
      addParamModal.style.display='flex';
    });
    
    closeModalBtn.addEventListener('click', closeAddParamModal);
    cancelParamBtn.addEventListener('click', closeAddParamModal);
    addParamModal.addEventListener('click', e => { 
      if (e.target === addParamModal) closeAddParamModal(); 
    });

    // Save new parameter
    saveParamBtn.addEventListener('click', async () => {
      const parameter = paramNameInput.value.trim();
      const dataSource = paramDataSource.value;
      const condition = paramConditionSel.value;
      const maxWeight = parseInt(paramMaxWeightInp.value, 10) || 1;
      const options = Array.from(optionsList.querySelectorAll('.option-row')).map(r => ({
        label:  r.querySelector('.option-name').value.trim(),
        weight: parseInt(r.querySelector('.option-weight').value, 10)
      }));

      const rows = [];
      options.forEach(o => {
        rows.push({
          parameter, 
          data_source: dataSource,
          condition, 
          max_weight: maxWeight, 
          option: o.label, 
          weight: o.weight
        });
      });
      
      await window.electronAPI.saveAlgorithmParameters(rows, { append: true });
      
      paramContainer.appendChild(makeDisplayRow({
        parameter, 
        data_source: dataSource,
        condition, 
        max_weight: maxWeight, 
        options
      }));
      
      closeAddParamModal();
    });

    // Save edited parameter selections
    saveParamsBtn.addEventListener('click', async () => {
      const toSave = Array.from(paramContainer.querySelectorAll('.param-row')).flatMap(r => {
        const dataSource = r.dataset.dataSource;
        const maxW    = parseInt(r.dataset.maxWeight, 10);
        const param   = r.querySelector('.param-name').value.trim();
        const cond    = r.querySelector('.param-condition').value;
        return Array.from(r.querySelectorAll('.param-options option')).map(opt => ({
          parameter: param,
          data_source: dataSource,
          condition: cond,
          max_weight: maxW, 
          option: opt.textContent, 
          weight: parseInt(opt.value,10), 
          selected: opt.selected
        }));
      });
      await window.electronAPI.saveAlgorithmParameters(toSave, { replace: true });
      appAlert('Soft parameters saved successfully');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // FIXED PARAMETERS (Optimization 3 - Yearly Constraints)
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

    // Toggle IF condition section
    const enableIfCondition = document.getElementById('enableIfCondition');
    const ifConditionFields = document.getElementById('ifConditionFields');
    
    enableIfCondition.addEventListener('change', () => {
      ifConditionFields.style.display = enableIfCondition.checked ? 'block' : 'none';
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
      row.style = 'border:1px solid #ddd; padding:1em; margin-bottom:1.5em; border-radius:4px; background:#f9f9f9;';
      
      // Store cumulative flag in dataset for extraction
      if (param.type === 'monetary' || param.type === 'temporal') {
        row.dataset.cumulative = param.cumulative ? 'true' : 'false';
      }

      const dataSourceLabel = param.data_source === 'station' ? 'Station Data' : 'Repair Fields';
      const years = param.years ? Object.keys(param.years).sort() : [];
      
      // Left side: Parameter info
      let infoHTML = `
        <div style="margin-bottom:1em;">
          <h4 style="margin:0 0 0.5em 0;">${param.name}</h4>
          <div><strong>Type:</strong> ${param.type}</div>
          <div><strong>Data Source:</strong> ${dataSourceLabel}</div>
      `;
      
      if (param.type === 'geographical') {
        infoHTML += `<div><strong>Base Values:</strong> ${(param.values || []).join(', ')}</div>`;
      } else if (param.type === 'temporal') {
        infoHTML += `<div><strong>Scope:</strong> ${param.scope}</div>
                     <div><strong>Unit:</strong> ${param.unit}</div>
                     <div><strong>Mode:</strong> ${param.cumulative ? 'Cumulative (Total)' : 'Per Repair'}</div>`;
      } else if (param.type === 'monetary') {
        const matchLabel = param.match_using === 'field_name' ? 'Field Name' : 'Fixed Parameter Name';
        infoHTML += `<div><strong>Match Using:</strong> ${matchLabel}</div>
                     <div><strong>Field:</strong> ${param.field_name}</div>
                     <div><strong>Conditional:</strong> ${param.conditional}</div>
                     <div><strong>Unit:</strong> ${param.unit}</div>
                     <div><strong>Mode:</strong> ${param.cumulative ? 'Cumulative Budget' : 'Per Repair'}</div>`;
      } else if (param.type === 'designation') {
        const matchLabel = param.match_using === 'field_name' ? 'Field Name' : 'Fixed Parameter Name';
        infoHTML += `<div><strong>Match Using:</strong> ${matchLabel}</div>
                     <div><strong>Condition:</strong> ${param.condition}</div>
                     <div><strong>Field:</strong> ${param.field_name}</div>`;
      }

      // Show IF condition if it exists
      if (param.if_condition) {
        infoHTML += `<div style="margin-top:0.5em; padding:0.5em; background:#fff3cd; border-left:3px solid #ffc107;">
                      <strong>IF Condition:</strong><br/>
                      ${param.if_condition.field} ${param.if_condition.operator} "${param.if_condition.value}"
                      <span style="font-size:0.85em; color:#666;">(${param.if_condition.data_source === 'station' ? 'Station' : 'Repair'})</span>
                    </div>`;
      }

      infoHTML += `</div>`;
      
      // Right side: Yearly values (horizontal layout)
      let yearsHTML = '<div style="display:flex; gap:1em; align-items:start; flex-wrap:wrap;">';
      
      years.forEach(year => {
        const yearData = param.years[year];
        yearsHTML += `<div class="year-column" data-year="${year}" style="border:1px solid #ccc; padding:0.5em; border-radius:4px; min-width:150px;">`;
        yearsHTML += `<div style="font-weight:bold; margin-bottom:0.5em; display:flex; justify-content:space-between; align-items:center;">
                        <span>Year ${year}</span>
                        <button class="deleteYearBtn" data-year="${year}" style="color:red; border:none; background:none; cursor:pointer; font-size:1.2em;">×</button>
                      </div>`;
        
        if (param.type === 'geographical') {
          const vals = yearData.values || param.values || [];
          yearsHTML += `<label style="font-size:0.9em;">Allowed Values:</label><br/>
                        <textarea class="year-geo-values" rows="3" style="width:100%; font-size:0.85em; padding:0.3em;">${vals.join('\n')}</textarea>`;
        } else if (param.type === 'temporal') {
          yearsHTML += `<label style="font-size:0.9em;">Max Value:</label><br/>
                        <input type="number" class="year-value" value="${yearData.value || ''}" style="width:100%; padding:0.3em;"/>`;
        } else if (param.type === 'monetary') {
          yearsHTML += `<label style="font-size:0.9em;">Budget:</label><br/>
                        <input type="number" class="year-value" value="${yearData.value || ''}" style="width:100%; padding:0.3em;"/>`;
        } else if (param.type === 'designation') {
          // Designation probably doesn't change per year, just show it's active
          yearsHTML += `<div style="font-size:0.9em; color:#666;">Active this year</div>`;
        }
        
        yearsHTML += `</div>`;
      });
      
      // Add Year button
      yearsHTML += `<div style="display:flex; align-items:center;">
                      <button class="addYearColumnBtn" style="padding:0.5em 1em; border:1px dashed #999; background:#fff; cursor:pointer; border-radius:4px;">
                        + Year
                      </button>
                    </div>`;
      yearsHTML += '</div>';
      
      row.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:1em;">
          ${infoHTML}
          <button class="deleteFixedParamBtn" style="color:red; font-size:1.5em; border:none; background:none; cursor:pointer;">×</button>
        </div>
        ${yearsHTML}
      `;

      // Store IF condition in dataset for extraction
      if (param.if_condition) {
        row.dataset.ifCondition = JSON.stringify(param.if_condition);
      }
      
      // Event handlers
      row.querySelector('.deleteFixedParamBtn').addEventListener('click', () => row.remove());
      
      row.querySelector('.addYearColumnBtn').addEventListener('click', () => {
        // Show add year modal
        const addYearModal = document.getElementById('addYearModal');
        const yearInput = document.getElementById('yearInput');
        const confirmBtn = document.getElementById('confirmAddYearBtn');
        const cancelBtn = document.getElementById('cancelAddYearBtn');
        const closeBtn = document.getElementById('closeAddYearModal');
        
        yearInput.value = new Date().getFullYear() + 1;
        addYearModal.style.display = 'flex';
        setTimeout(() => yearInput.focus(), 100);
        
        const cleanup = () => {
          addYearModal.style.display = 'none';
          confirmBtn.replaceWith(confirmBtn.cloneNode(true));
          cancelBtn.replaceWith(cancelBtn.cloneNode(true));
          closeBtn.replaceWith(closeBtn.cloneNode(true));
        };
        
        document.getElementById('confirmAddYearBtn').addEventListener('click', () => {
          const newYear = yearInput.value.trim();
          
          if (!newYear || !/^\d{4}$/.test(newYear)) {
            appAlert('Please enter a valid 4-digit year');
            return;
          }
          
          const paramData = extractParamData(row);
          if (paramData.years[newYear]) {
            appAlert('Year already exists');
            return;
          }
          
          // Add new year with default values
          if (paramData.type === 'geographical') {
            paramData.years[newYear] = { values: paramData.values || [] };
          } else if (paramData.type === 'temporal' || paramData.type === 'monetary') {
            paramData.years[newYear] = { value: 0 };
            // Preserve cumulative flag
            if (paramData.cumulative !== undefined) {
              // Already in paramData from extractParamData
            }
          } else if (paramData.type === 'designation') {
            paramData.years[newYear] = {};
          }
          
          // Rebuild the row
          const newRow = makeFixedParamDisplayRow(paramData);
          row.replaceWith(newRow);
          
          cleanup();
        });
        
        document.getElementById('cancelAddYearBtn').addEventListener('click', cleanup);
        document.getElementById('closeAddYearModal').addEventListener('click', cleanup);
        
        addYearModal.addEventListener('click', (e) => {
          if (e.target === addYearModal) cleanup();
        });
        
        yearInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            document.getElementById('confirmAddYearBtn').click();
          }
        });
      });
      
      row.querySelectorAll('.deleteYearBtn').forEach(btn => {
        btn.addEventListener('click', () => {
          const year = btn.dataset.year;
          if (!confirm(`Delete year ${year}?`)) return;
          
          const paramData = extractParamData(row);
          delete paramData.years[year];
          
          const newRow = makeFixedParamDisplayRow(paramData);
          row.replaceWith(newRow);
        });
      });
      
      return row;
    }
    
    function extractParamData(row) {
      // Extract parameter data from the DOM
      const name = row.querySelector('h4').textContent;
      const typeText = Array.from(row.querySelectorAll('div')).find(d => d.textContent.startsWith('Type:'))?.textContent || '';
      const type = typeText.replace('Type:', '').trim().toLowerCase();
      
      const param = { name, type };

      // Extract cumulative flag for monetary/temporal
      if (type === 'monetary' || type === 'temporal') {
        param.cumulative = row.dataset.cumulative === 'true';
      }
      
      // Extract basic fields from info section
      const infoDiv = row.querySelector('div');
      Array.from(infoDiv.querySelectorAll('div')).forEach(div => {
        const text = div.textContent;
        if (text.includes('Data Source:')) {
          param.data_source = text.includes('Station Data') ? 'station' : 'repair';
        } else if (text.includes('Scope:')) {
          param.scope = text.replace('Scope:', '').trim();
        } else if (text.includes('Unit:') && type === 'temporal') {
          param.unit = text.replace('Unit:', '').trim();
        } else if (text.includes('Unit:') && type === 'monetary') {
          param.unit = text.replace('Unit:', '').trim();
        } else if (text.includes('Match Using:')) {
          param.match_using = text.includes('Field Name') ? 'field_name' : 'parameter_name';
        } else if (text.includes('Field:')) {
          param.field_name = text.replace('Field:', '').trim();
        } else if (text.includes('Conditional:')) {
          param.conditional = text.replace('Conditional:', '').trim();
        } else if (text.includes('Condition:')) {
          param.condition = text.replace('Condition:', '').trim();
        } else if (text.includes('Base Values:')) {
          param.values = text.replace('Base Values:', '').trim().split(',').map(v => v.trim());
        }
      });
      
      // Extract yearly data
      param.years = {};
      row.querySelectorAll('.year-column').forEach(col => {
        const year = col.dataset.year;
        param.years[year] = {};
        
        if (type === 'geographical') {
          const textarea = col.querySelector('.year-geo-values');
          if (textarea) {
            param.years[year].values = textarea.value.split('\n').map(v => v.trim()).filter(v => v);
          }
        } else if (type === 'temporal' || type === 'monetary') {
          const input = col.querySelector('.year-value');
          if (input) {
            param.years[year].value = parseFloat(input.value) || 0;
          }
        }
      });

      // Extract IF condition if displayed
      const ifCondDiv = Array.from(infoDiv.querySelectorAll('div')).find(d => 
        d.textContent.includes('IF Condition:')
      );
      if (ifCondDiv) {
        // Parse from displayed text - this is a fallback, actual data comes from dataset
        const rowData = row.dataset.ifCondition;
        if (rowData) {
          param.if_condition = JSON.parse(rowData);
        }
      }
      
      return param;
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
      document.getElementById('temporalCumulative').checked = false;
      document.getElementById('monetaryFieldName').value = '';
      document.getElementById('monetaryConditional').value = '<';
      document.getElementById('monetaryValue').value = '';
      document.getElementById('monetaryUnit').value = '';
      document.getElementById('monetaryCumulative').checked = false;
      document.getElementById('designationCondition').value = 'None';
      document.getElementById('designationFieldName').value = '';
      
      // Reset IF condition
      document.getElementById('enableIfCondition').checked = false;
      document.getElementById('ifConditionFields').style.display = 'none';
      document.getElementById('ifDataSource').value = 'repair';
      document.getElementById('ifFieldName').value = '';
      document.getElementById('ifOperator').value = '=';
      document.getElementById('ifValue').value = '';
      
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
        appAlert('Please enter a parameter name');
        return;
      }

      const param = { name, type, data_source: dataSource };
      const currentYear = new Date().getFullYear();
      param.years = {};

      // Capture IF condition if enabled
      if (document.getElementById('enableIfCondition').checked) {
        const ifField = document.getElementById('ifFieldName').value.trim();
        const ifValue = document.getElementById('ifValue').value.trim();
        
        if (!ifField || !ifValue) {
          appAlert('Please fill in IF condition field and value, or uncheck the IF condition option');
          return;
        }
        
        param.if_condition = {
          data_source: document.getElementById('ifDataSource').value,
          field: ifField,
          operator: document.getElementById('ifOperator').value,
          value: ifValue
        };
      }

      if (type === 'geographical') {
        const values = Array.from(geoValuesList.querySelectorAll('.geo-value'))
          .map(input => input.value.trim())
          .filter(v => v);
        if (!values.length) {
          appAlert('Please add at least one geographical value');
          return;
        }
        param.values = values;
        param.years[currentYear] = { values };
      } else if (type === 'temporal') {
        param.scope = document.getElementById('temporalScope').value;
        const value = document.getElementById('temporalValue').value;
        param.unit = document.getElementById('temporalUnit').value;
        param.cumulative = document.getElementById('temporalCumulative').checked;
        if (!value) {
          appAlert('Please enter a temporal value');
          return;
        }
        param.years[currentYear] = { value: parseFloat(value) };
      } else if (type === 'monetary') {
        param.match_using = matchUsing;
        param.field_name = document.getElementById('monetaryFieldName').value.trim();
        param.conditional = document.getElementById('monetaryConditional').value;
        const value = document.getElementById('monetaryValue').value;
        param.unit = document.getElementById('monetaryUnit').value.trim();
        param.cumulative = document.getElementById('monetaryCumulative').checked;
        if (!param.field_name || !value) {
          appAlert('Please fill in all monetary constraint fields');
          return;
        }
        param.years[currentYear] = { value: parseFloat(value) };
      } else if (type === 'designation') {
        param.match_using = matchUsing;
        param.condition = document.getElementById('designationCondition').value;
        param.field_name = document.getElementById('designationFieldName').value.trim();
        if (!param.field_name) {
          appAlert('Please enter a field name for the designation constraint');
          return;
        }
        param.years[currentYear] = {};
      }

      fixedParamContainer.appendChild(makeFixedParamDisplayRow(param));
      addFixedParamModal.style.display = 'none';
    });

    // Save all fixed parameters
    saveFixedParamsBtn.addEventListener('click', async () => {
      const params = Array.from(fixedParamContainer.querySelectorAll('.fixed-param-row'))
        .map(row => extractParamData(row));
      await window.electronAPI.saveFixedParameters(params);
      appAlert('Fixed parameters saved successfully');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // OPTIMIZATION 1 - Scoring
    // ═══════════════════════════════════════════════════════════════════════
    const runOpt1Btn = document.getElementById('runOpt1Btn');
    const opt1Results = document.getElementById('opt1Results');

    if (runOpt1Btn) {
      runOpt1Btn.addEventListener('click', async () => {
        const allRepairs = await window.electronAPI.getAllRepairs();
        if (!allRepairs || !allRepairs.length) {
          opt1Results.innerHTML = '<div class="opt-note">No repairs found.</div>';
          return;
        }

        // Get station data for matching
        const stationList = await window.electronAPI.getStationData();
        const stationDataMap = {};
        (stationList || []).forEach(station => {
          const stationId = station.station_id || station['Station ID'] || station.id;
          if (stationId) stationDataMap[stationId] = station;
        });

        // Build overall weights
        const overall = {};
        document.querySelectorAll('.param-row').forEach(row => {
          const pname = row.querySelector('.param-name')?.value?.trim();
          const pct   = parseFloat(row.querySelector('.param-percentage')?.value || '0');
          if (pname) overall[pname] = isFinite(pct) ? pct : 0;
        });

        const params = await window.electronAPI.getAlgorithmParameters();
        
        opt1Results.innerHTML = '<div class="opt-note">Scoring repairs...</div>';

        const result = await window.electronAPI.optimizeWorkplan({
          repairs: allRepairs,
          station_data: stationDataMap,
          param_overall: overall,
          parameters: params
        });

        if (!result.success) {
          opt1Results.innerHTML = `<div class="opt-error">${result.notes || 'Scoring failed'}</div>`;
          return;
        }

        window._scoredRepairs = result.ranking;
        renderOpt1Results(result);
      });
    }

    function renderOpt1Results(result) {
      opt1Results.innerHTML = '';

      const summary = document.createElement('div');
      summary.className = 'opt-header';
      summary.innerHTML = `
        <div class="opt-title">Optimization 1: Scored Repairs</div>
        <div class="opt-summary">
          <span class="chip">Total Repairs: ${result.optimized_count}</span>
        </div>
      `;
      opt1Results.appendChild(summary);

      const table = document.createElement('table');
      table.className = 'opt-table';
      table.innerHTML = `
        <thead>
          <tr>
            <th>Rank</th>
            <th>Station ID</th>
            <th>Location</th>
            <th>Asset Type</th>
            <th>Repair</th>
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
          <td>${item.station_id || ''}</td>
          <td>${item.location || ''}</td>
          <td>${item.asset_type || ''}</td>
          <td>${item.repair_name || ''}</td>
          <td class="num">${Number(item.score).toFixed(2)}%</td>
        `;
        tbody.appendChild(tr);
      });

      opt1Results.appendChild(table);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // OPTIMIZATION 2 - Trip Grouping
    // ═══════════════════════════════════════════════════════════════════════
    const runOpt2Btn = document.getElementById('runOpt2Btn');
    const opt2Results = document.getElementById('opt2Results');

    if (runOpt2Btn) {
      runOpt2Btn.addEventListener('click', async () => {
        if (!window._scoredRepairs) {
          opt2Results.innerHTML = '<div class="opt-error">⚠️ Please run Optimization 1 first.</div>';
          return;
        }

        const stationList = await window.electronAPI.getStationData();
        const stationDataMap = {};
        (stationList || []).forEach(station => {
          const stationId = station.station_id || station['Station ID'] || station.id;
          if (stationId) stationDataMap[stationId] = station;
        });

        opt2Results.innerHTML = '<div class="opt-note">Grouping repairs into trips...</div>';

        const result = await window.electronAPI.groupRepairsIntoTrips({
          scored_repairs: window._scoredRepairs,
          station_data: stationDataMap
        });

        if (!result.success) {
          opt2Results.innerHTML = `<div class="opt-error">${result.message || 'Trip grouping failed'}</div>`;
          return;
        }

        window._tripsData = result.trips;
        renderOpt2Results(result);
      });
    }

    function renderOpt2Results(result) {
      opt2Results.innerHTML = '';

      const summary = document.createElement('div');
      summary.className = 'opt-header';
      summary.innerHTML = `
        <div class="opt-title">Optimization 2: Trip Grouping</div>
        <div class="opt-summary">
          <span class="chip">Total Trips: ${result.trips.length}</span>
        </div>
      `;
      opt2Results.appendChild(summary);

      result.trips.forEach((trip, idx) => {
        const tripSection = document.createElement('section');
        tripSection.className = 'opt-trip';
        tripSection.innerHTML = `
          <div class="trip-title">Trip ${idx + 1}: ${trip.trip_location} (${trip.access_type})</div>
          <div class="trip-summary">
            <span class="chip">Total Days: ${trip.total_days}</span>
            <span class="chip">Stations: ${trip.stations.length}</span>
            <span class="chip">Repairs: ${trip.repairs.length}</span>
          </div>
        `;

        const table = document.createElement('table');
        table.className = 'opt-table';
        table.innerHTML = `
          <thead>
            <tr>
              <th>Station ID</th>
              <th>Site Name</th>
              <th>City of Travel</th>
              <th>Time to Site (hr)</th>
              <th>Repairs</th>
              <th>Days</th>
            </tr>
          </thead>
          <tbody></tbody>
        `;

        const tbody = table.querySelector('tbody');
        trip.stations.forEach(station => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${station.station_id}</td>
            <td>${station.site_name || ''}</td>
            <td>${station.city_of_travel || ''}</td>
            <td>${station.time_to_site || ''}</td>
            <td>${station.repair_count}</td>
            <td>${station.total_days}</td>
          `;
          tbody.appendChild(tr);
        });

        tripSection.appendChild(table);
        opt2Results.appendChild(tripSection);
      });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // OPTIMIZATION 3 - Yearly Assignment
    // ═══════════════════════════════════════════════════════════════════════
    const runOpt3Btn = document.getElementById('runOpt3Btn');
    const opt3Results = document.getElementById('opt3Results');

    if (runOpt3Btn) {
      runOpt3Btn.addEventListener('click', async () => {
        if (!window._tripsData) {
          opt3Results.innerHTML = '<div class="opt-error">⚠️ Please run Optimization 2 first.</div>';
          return;
        }

        const fixedParams = Array.from(fixedParamContainer.querySelectorAll('.fixed-param-row'))
          .map(row => extractParamData(row));

        opt3Results.innerHTML = '<div class="opt-note">Assigning trips to years...</div>';

        const result = await window.electronAPI.assignTripsToYears({
          trips: window._tripsData,
          fixed_parameters: fixedParams
        });

        if (!result.success) {
          opt3Results.innerHTML = `<div class="opt-error">${result.message || 'Year assignment failed'}</div>`;
          return;
        }

        renderOpt3Results(result);
      });
    }

    function renderOpt3Results(result) {
      opt3Results.innerHTML = '';

      const summary = document.createElement('div');
      summary.className = 'opt-header';
      summary.innerHTML = `
        <div class="opt-title">Optimization 3: Yearly Assignment</div>
      `;
      opt3Results.appendChild(summary);

      Object.keys(result.assignments).sort().forEach(year => {
        const trips = result.assignments[year];
        
        const yearSection = document.createElement('section');
        yearSection.className = 'opt-trip';
        yearSection.innerHTML = `
          <div class="trip-title">Year ${year}</div>
          <div class="trip-summary">
            <span class="chip">Trips: ${trips.length}</span>
            <span class="chip">Total Days: ${trips.reduce((sum, t) => sum + t.total_days, 0)}</span>
          </div>
        `;

        const table = document.createElement('table');
        table.className = 'opt-table';
        table.innerHTML = `
          <thead>
            <tr>
              <th>Priority</th>
              <th>Trip Location</th>
              <th>Access Type</th>
              <th>Days</th>
              <th>Stations</th>
            </tr>
          </thead>
          <tbody></tbody>
        `;

        const tbody = table.querySelector('tbody');
        trips.forEach((trip, idx) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${idx + 1}</td>
            <td>${trip.trip_location}</td>
            <td>${trip.access_type}</td>
            <td>${trip.total_days}</td>
            <td>${trip.stations.length}</td>
          `;
          tbody.appendChild(tr);
        });

        yearSection.appendChild(table);
        opt3Results.appendChild(yearSection);
      });
    }

    // Initialize
    await loadFixedParameters();
    recalcPercentageTotal();
  }

  window.__openOptimization = showOptimization;
});