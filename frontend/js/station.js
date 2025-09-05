// frontend/js/station.js
let currentStationData = null;
let hasUnsavedChanges = false;
let generalInfoUnlocked = false;

async function loadStationPage(stationId, origin = 'map') {
  // Fetch station data
  const all = await window.electronAPI.getStationData();
  const stn = (all || []).find(s => String(s.station_id) === String(stationId));
  if (!stn) return alert('Station not found: ' + stationId);

  currentStationData = { ...stn }; // Store copy for editing

  // Load HTML
  const container = document.getElementById('stationContentContainer');
  const mainMap  = document.getElementById('mapContainer');
  const listCont = document.getElementById('listContainer');
  const dashboardCont = document.getElementById('dashboardContentContainer');
  const rightPanel = document.getElementById('rightPanel');

  const resp = await fetch('station_specific.html');
  if (!resp.ok) {
    alert('Failed to load station detail view.');
   return;
  }
  const html = await resp.text();
  container.innerHTML = html;

  // Show station view, hide others
  container.dataset.origin = origin === 'list' ? 'list' : 'map';
  if (mainMap) mainMap.style.display = 'none';
  if (listCont) listCont.style.display = 'none';
  if (dashboardCont) dashboardCont.style.display = 'none';
  container.style.display = 'block';
  if (rightPanel) rightPanel.style.display = 'none';
  enableFullWidthMode();

  // Setup UI
  setupStationDetailUI(container, stn);
}

function setupStationDetailUI(container, stn) {
  // Populate basic info
  const setVal = (id, v) => { 
    const el = container.querySelector('#'+id); 
    if (el) el.value = v ?? ''; 
  };
  
  const setTitle = (name, id) => {
    const el = container.querySelector('#stationTitle');
    if (el) el.textContent = `${name || 'Station'} (${id})`;
  };

  setTitle(stn.name, stn.station_id);
  setVal('giStationId', stn.station_id);
  setVal('giCategory',  stn.asset_type);
  setVal('giSiteName',  stn.name);
  setVal('giProvince',  stn.province);
  setVal('giLatitude',  stn.lat);
  setVal('giLongitude', stn.lon);
  
  const statusSel = container.querySelector('#giStatus');
  if (statusSel) statusSel.value = stn.status || 'Unknown';

  // Status + Type pills
  setHeaderPills(container, stn);

  // Photos
  renderPhotoPlaceholders(container);
  setupPhotoLightbox(container);
  renderRecentPhotos(container, stn);

  // Dynamic sections
  renderDynamicSections(container, stn);

  // Setup event handlers
  setupEventHandlers(container, stn);

  // Back button
  setupBackButton(container);
}

function setHeaderPills(container, stn) {
  const pill = container.querySelector('#statusPill');
  const type = container.querySelector('#typePill');
  const sRaw = stn.status || 'Unknown';
  const s = String(sRaw).trim().toLowerCase();
  
  if (pill) {
    pill.textContent = sRaw;
    pill.classList.remove('pill--green','pill--red','pill--amber');
    pill.classList.add(s === 'active' ? 'pill--green' : s === 'inactive' ? 'pill--red' : 'pill--amber');
  }
  if (type) type.textContent = stn.asset_type || '—';
}

function renderPhotoPlaceholders(container) {
  const row = container.querySelector('#photosRow');
  if (!row) return;
  row.innerHTML = '';
  const N = 5;
  for (let i = 0; i < N; i++) {
    const d = document.createElement('div');
    d.className = 'photo-thumb skeleton';
    row.appendChild(d);
  }
}

function setupPhotoLightbox(container) {
  const lb = container.querySelector('#photoLightbox');
  const lbImg = container.querySelector('#lightboxImg');
  const lbClose = container.querySelector('#lightboxClose');
  const lbBackdrop = container.querySelector('.photo-lightbox__backdrop');
  if (!lb || !lbImg) return;

  function openLightbox(url) {
    lbImg.src = url;
    lb.classList.add('open');
    document.documentElement.classList.add('modal-open');
    document.body.classList.add('modal-open');
  }
  
  function closeLightbox() {
    lb.classList.remove('open');
    document.documentElement.classList.remove('modal-open');
    document.body.classList.remove('modal-open');
    lbImg.removeAttribute('src');
  }
  
  lbClose?.addEventListener('click', closeLightbox);
  lbBackdrop?.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lb.classList.contains('open')) closeLightbox();
  });

  return openLightbox;
}

async function renderRecentPhotos(container, stn) {
  const row = container.querySelector('#photosRow');
  const openLightbox = setupPhotoLightbox(container);
  
  try {
    const photos = await window.electronAPI.getRecentPhotos(stn.name, stn.station_id, 5);
    if (!row) return;
    row.innerHTML = '';

    if (!photos || photos.length === 0) {
      row.innerHTML = '<div class="photo-empty">No photos found</div>';
    } else {
      for (const p of photos) {
        const a = document.createElement('a');
        a.href = p.url;
        a.className = 'photo-link';
        a.dataset.url = p.url;
        a.title = p.name || `${stn.name} photo`;
        const img = document.createElement('img');
        img.className = 'photo-thumb';
        img.alt = `${stn.name} photo`;
        img.src = p.url;
        a.appendChild(img);
        row.appendChild(a);
      }

      row.addEventListener('click', (ev) => {
        const link = ev.target.closest('.photo-link');
        if (!link) return;
        ev.preventDefault();
        if (typeof openLightbox === 'function') openLightbox(link.dataset.url);
      });
    }
  } catch (e) {
    console.warn('[renderRecentPhotos] failed:', e);
    if (row) row.innerHTML = '<div class="photo-empty">Photos unavailable</div>';
  }
}

function renderDynamicSections(container, stn) {
  const sectionsContainer = container.querySelector('#dynamicSections');
  if (!sectionsContainer) return;

  const SEP = ' – ';
  const sections = {};

  // Group fields by section
  Object.keys(stn || {}).forEach(k => {
    if (!k.includes(SEP)) return;
    const [section, field] = k.split(SEP, 2);
    const sectionName = String(section).trim();
    const fieldName = String(field).trim();
    if (!sections[sectionName]) sections[sectionName] = {};
    sections[sectionName][fieldName] = stn[k];
  });

  // Filter out General Information fields already shown
  const GI_NAME = 'general information';
  const GI_SHOWN_FIELDS = new Set(['station id','category','site name','station name','province','latitude','longitude','status']);
  
  Object.keys(sections).forEach(sectionName => {
    if (String(sectionName).trim().toLowerCase() !== GI_NAME) return;
    const filtered = {};
    Object.entries(sections[sectionName]).forEach(([fld, val]) => {
      if (!GI_SHOWN_FIELDS.has(String(fld).trim().toLowerCase())) {
        filtered[fld] = val;
      }
    });
    if (Object.keys(filtered).length) {
      sections[sectionName] = filtered;
    } else {
      delete sections[sectionName];
    }
  });

  // Render sections
  sectionsContainer.innerHTML = '';
  Object.entries(sections).forEach(([sectionName, fields]) => {
    const sectionDiv = createEditableSection(sectionName, fields);
    sectionsContainer.appendChild(sectionDiv);
  });
}

function createEditableSection(sectionName, fields) {
  const sectionDiv = document.createElement('div');
  sectionDiv.className = 'station-section editable-section';
  sectionDiv.dataset.sectionName = sectionName;

  const headerDiv = document.createElement('div');
  headerDiv.className = 'section-header';
  headerDiv.style.display = 'flex';
  headerDiv.style.justifyContent = 'space-between';
  headerDiv.style.alignItems = 'center';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'section-title-input';
  titleInput.value = sectionName;
  titleInput.addEventListener('input', markUnsavedChanges);

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'section-actions';

  const addFieldBtn = document.createElement('button');
  addFieldBtn.className = 'btn btn-ghost btn-sm';
  addFieldBtn.textContent = '+ Add Field';
  addFieldBtn.addEventListener('click', () => addFieldToSection(sectionDiv));

  const deleteSectionBtn = document.createElement('button');
  deleteSectionBtn.className = 'btn btn-ghost btn-sm';
  deleteSectionBtn.textContent = 'Delete Section';
  deleteSectionBtn.title = 'Delete Section';
  deleteSectionBtn.addEventListener('click', () => deleteSection(sectionDiv));

  actionsDiv.appendChild(addFieldBtn);
  actionsDiv.appendChild(deleteSectionBtn);
  headerDiv.appendChild(titleInput);
  headerDiv.appendChild(actionsDiv);

  const fieldsDiv = document.createElement('div');
  fieldsDiv.className = 'section-fields';

  // Create field rows
  Object.entries(fields).forEach(([fieldName, value]) => {
    const fieldRow = createEditableField(fieldName, value);
    fieldsDiv.appendChild(fieldRow);
  });

  sectionDiv.appendChild(headerDiv);
  sectionDiv.appendChild(fieldsDiv);

  return sectionDiv;
}

function createEditableField(fieldName, value) {
  const fieldDiv = document.createElement('div');
  fieldDiv.className = 'field-row';
  fieldDiv.dataset.fieldName = fieldName;

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'field-label-input';
  labelInput.value = fieldName;
  labelInput.addEventListener('input', markUnsavedChanges);

  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.className = 'field-value-input';
  valueInput.value = value || '';
  valueInput.placeholder = 'Enter value...';
  valueInput.addEventListener('input', markUnsavedChanges);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn-ghost btn-sm btn-danger';
  deleteBtn.textContent = '🗑️';
  deleteBtn.title = 'Delete Field';
  deleteBtn.addEventListener('click', () => deleteField(fieldDiv));

  fieldDiv.appendChild(labelInput);
  fieldDiv.appendChild(valueInput);
  fieldDiv.appendChild(deleteBtn);

  return fieldDiv;
}

function addFieldToSection(sectionDiv) {
  const fieldsContainer = sectionDiv.querySelector('.section-fields');
  const newField = createEditableField('New Field', '');
  fieldsContainer.appendChild(newField);
  
  // Focus on the new field name input
  const labelInput = newField.querySelector('.field-label-input');
  labelInput.focus();
  labelInput.select();
  
  markUnsavedChanges();
}

function deleteField(fieldDiv) {
  if (confirm('Are you sure you want to delete this field?')) {
    fieldDiv.remove();
    markUnsavedChanges();
  }
}

function deleteSection(sectionDiv) {
  const sectionName = sectionDiv.dataset.sectionName;
  if (confirm(`Are you sure you want to delete the "${sectionName}" section?`)) {
    sectionDiv.remove();
    markUnsavedChanges();
  }
}

function addNewSection() {
  const container = document.getElementById('stationContentContainer');
  const sectionsContainer = container.querySelector('#dynamicSections');
  
  const newSection = createEditableSection('New Section', {});
  sectionsContainer.appendChild(newSection);
  
  // Focus on the section title input
  const titleInput = newSection.querySelector('.section-title-input');
  titleInput.focus();
  titleInput.select();
  
  markUnsavedChanges();
}

function markUnsavedChanges() {
  hasUnsavedChanges = true;
  const saveBtn = document.querySelector('#saveChangesBtn');
  if (saveBtn) {
    saveBtn.style.display = 'inline-block';
    saveBtn.classList.add('btn-warning');
  }
}

function setupEventHandlers(container, stn) {
  // Add Section button
  const addSectionBtn = container.querySelector('#addSectionBtn');
  if (addSectionBtn) {
    addSectionBtn.addEventListener('click', addNewSection);
  }

  // Save Changes button
  const saveBtn = container.querySelector('#saveChangesBtn');
  if (saveBtn) {
    saveBtn.addEventListener('click', saveStationChanges);
  }

  // Unlock editing button
  const unlockBtn = container.querySelector('#unlockEditing');
  if (unlockBtn) {
    unlockBtn.addEventListener('click', showPasswordModal);
  }

  // Password modal
  setupPasswordModal(container);

  // General Information input listeners (when unlocked)
  const generalInputs = container.querySelectorAll('#giStationId, #giCategory, #giSiteName, #giProvince, #giLatitude, #giLongitude, #giStatus');
  generalInputs.forEach(input => {
    input.addEventListener('input', () => {
      if (!input.disabled) markUnsavedChanges();
    });
  });
}

function setupPasswordModal(container) {
  const modal = container.querySelector('#passwordModal');
  const passwordInput = container.querySelector('#passwordInput');
  const confirmBtn = container.querySelector('#confirmPassword');
  const cancelBtn = container.querySelector('#cancelPassword');

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      const password = passwordInput.value;
      if (password === '1234') {
        unlockGeneralInformation(container);
        hidePasswordModal(container);
        passwordInput.value = '';
      } else {
        alert('Incorrect password. Please try again.');
        passwordInput.focus();
      }
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      hidePasswordModal(container);
      passwordInput.value = '';
    });
  }

  if (passwordInput) {
    passwordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        confirmBtn.click();
      } else if (e.key === 'Escape') {
        cancelBtn.click();
      }
    });
  }
}

function showPasswordModal() {
  const modal = document.querySelector('#passwordModal');
  const passwordInput = document.querySelector('#passwordInput');
  if (modal) {
    modal.style.display = 'flex';
    setTimeout(() => passwordInput?.focus(), 100);
  }
}

function hidePasswordModal() {
  const modal = document.querySelector('#passwordModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function unlockGeneralInformation(container) {
  generalInfoUnlocked = true;
  const inputs = container.querySelectorAll('#giStationId, #giCategory, #giSiteName, #giProvince, #giLatitude, #giLongitude, #giStatus');
  inputs.forEach(input => {
    input.disabled = false;
    input.style.backgroundColor = '#fff3cd'; // Light yellow to indicate editable
  });

  const unlockBtn = container.querySelector('#unlockEditing');
  if (unlockBtn) {
    unlockBtn.textContent = '🔓 Editing Unlocked';
    unlockBtn.disabled = true;
    unlockBtn.style.opacity = '0.6';
  }
}

async function saveStationChanges() {
  const container = document.getElementById('stationContentContainer');
  if (!hasUnsavedChanges) return;

  try {
    const saveBtn = container.querySelector('#saveChangesBtn');
    if (saveBtn) {
      saveBtn.textContent = 'Saving...';
      saveBtn.disabled = true;
    }

    // Collect all changes
    const updatedData = { ...currentStationData };

    // General Information changes (if unlocked)
    if (generalInfoUnlocked) {
      const getValue = (id) => {
        const el = container.querySelector('#' + id);
        return el ? el.value.trim() : '';
      };

      updatedData.station_id = getValue('giStationId');
      updatedData.asset_type = getValue('giCategory');
      updatedData.name = getValue('giSiteName');
      updatedData.province = getValue('giProvince');
      updatedData.lat = getValue('giLatitude');
      updatedData.lon = getValue('giLongitude');
      updatedData.status = getValue('giStatus');
    }

    // Dynamic sections data
    const sections = container.querySelectorAll('.editable-section');
    
    // First, remove old section data from updatedData
    Object.keys(updatedData).forEach(key => {
      if (key.includes(' – ')) {
        delete updatedData[key];
      }
    });

    // Add new section data
    sections.forEach(sectionDiv => {
      const sectionTitle = sectionDiv.querySelector('.section-title-input').value.trim();
      const fieldRows = sectionDiv.querySelectorAll('.field-row');
      
      fieldRows.forEach(fieldRow => {
        const fieldName = fieldRow.querySelector('.field-label-input').value.trim();
        const fieldValue = fieldRow.querySelector('.field-value-input').value.trim();
        
        if (sectionTitle && fieldName) {
          const compositeKey = `${sectionTitle} – ${fieldName}`;
          updatedData[compositeKey] = fieldValue;
        }
      });
    });

    // Send to backend
    const result = await window.electronAPI.updateStationData(updatedData);
    
    if (result.success) {
      hasUnsavedChanges = false;
      currentStationData = { ...updatedData };
      
      if (saveBtn) {
        saveBtn.textContent = '✅ Saved';
        saveBtn.classList.remove('btn-warning');
        saveBtn.classList.add('btn-success');
        setTimeout(() => {
          saveBtn.style.display = 'none';
          saveBtn.classList.remove('btn-success');
          saveBtn.textContent = '💾 Save Changes';
        }, 2000);
      }

      // Refresh the main map/list if needed
      await window.electronAPI.invalidateStationCache();
      
    } else {
      throw new Error(result.message || 'Save failed');
    }

  } catch (error) {
    console.error('Save failed:', error);
    alert('Failed to save changes: ' + error.message);
  } finally {
    const saveBtn = container.querySelector('#saveChangesBtn');
    if (saveBtn) {
      saveBtn.disabled = false;
      if (saveBtn.textContent === 'Saving...') {
        saveBtn.textContent = '💾 Save Changes';
      }
    }
  }
}

function setupBackButton(container) {
  const backBtn = container.querySelector('#backButton');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (hasUnsavedChanges) {
        if (!confirm('You have unsaved changes. Are you sure you want to leave?')) {
          return;
        }
      }

      container.style.display = 'none';
      const from = container.dataset.origin || 'map';
      const mainMap = document.getElementById('mapContainer');
      const listCont = document.getElementById('listContainer');
      const rightPanel = document.getElementById('rightPanel');

      if (from === 'list') {
        if (listCont) listCont.style.display = '';
        if (mainMap) mainMap.style.display = 'none';
      } else {
        if (mainMap) mainMap.style.display = 'block';
        if (listCont) listCont.style.display = 'none';
      }
      
      if (rightPanel) rightPanel.style.display = '';
      disableFullWidthMode();

      // Reset editing state
      hasUnsavedChanges = false;
      generalInfoUnlocked = false;
    });
  }
}

// expose
window.loadStationPage = loadStationPage;