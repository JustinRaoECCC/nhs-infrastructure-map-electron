// frontend/js/station.js
let currentStationData = null;
let hasUnsavedChanges = false;
let generalInfoUnlocked = false;

// Track deletions for delta
let _deletedSchemaPairs = [];  // [{ section: 'General Info', field: 'Foo' }, ...]

// Normalize helpers for schema keys
const SEP = ' – ';
function normTxt(s){ return String(s||'').trim(); }
function pairKey(section, field){ 
  const s = normTxt(section), f = normTxt(field);
  return s ? `${s}${SEP}${f}` : f;
}

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
  sectionDiv.dataset.originalSectionName = sectionName;

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
  deleteSectionBtn.className = 'delete-section-btn'; // Changed class
  deleteSectionBtn.textContent = 'Delete Section'; // Changed from trash icon
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
  fieldDiv.dataset.originalFieldName = fieldName;

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
  deleteBtn.textContent = '✕'; // Changed from '🗑️' to red X
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
  newField.dataset.originalFieldName = '';
  fieldsContainer.appendChild(newField);
  
  // Focus on the new field name input
  const labelInput = newField.querySelector('.field-label-input');
  labelInput.focus();
  labelInput.select();
  
  markUnsavedChanges();
}

function deleteField(fieldDiv) {
  if (confirm('Are you sure you want to delete this field?')) {
    const sectionDiv = fieldDiv.closest('.editable-section');
    const origSection = sectionDiv?.dataset.originalSectionName || '';
    const origField = fieldDiv.dataset.originalFieldName || '';
    if (origField) _deletedSchemaPairs.push({ section: origSection, field: origField });
    fieldDiv.remove();
    markUnsavedChanges();
  }
}

function deleteSection(sectionDiv) {
  const sectionName = sectionDiv.dataset.sectionName;
  if (confirm(`Are you sure you want to delete the "${sectionName}" section?`)) {
    const origSection = sectionDiv.dataset.originalSectionName || '';
    if (origSection) {
      sectionDiv.querySelectorAll('.field-row').forEach(fr => {
        const origField = fr.dataset.originalFieldName || '';
        if (origField) _deletedSchemaPairs.push({ section: origSection, field: origField });
      });
    }
    sectionDiv.remove();
    markUnsavedChanges();
  }
}

function addNewSection() {
  const container = document.getElementById('stationContentContainer');
  const sectionsContainer = container.querySelector('#dynamicSections');
  
  const newSection = createEditableSection('New Section', {});
  newSection.dataset.originalSectionName = '';
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
  if (!container) {
    console.error('saveStationChanges: #stationContentContainer not found');
    alert('Could not find the station editor container.');
    return;
  }
  if (!hasUnsavedChanges) return;

  // Ensure deleted-schema tracking array exists (used by some UIs to record hard deletes)
  if (typeof window._deletedSchemaPairs === 'undefined' || !Array.isArray(window._deletedSchemaPairs)) {
    window._deletedSchemaPairs = [];
  }

  // --- Helpers (scoped) ------------------------------------------------------
  const COMPOSITE_SEP = ' – '; // NOTE: en dash with spaces, matches existing data

  const trimText = (s) => (typeof s === 'string' ? s.trim() : '');
  const normalizeSpaces = (s) => trimText(s).replace(/\s+/g, ' ');
  const compositeKey = (section, field) => `${normalizeSpaces(section)}${COMPOSITE_SEP}${normalizeSpaces(field)}`;
  const parseCompositeKey = (key) => {
    const idx = key.indexOf(COMPOSITE_SEP);
    if (idx === -1) return { section: '', field: '' };
    return {
      section: key.slice(0, idx),
      field: key.slice(idx + COMPOSITE_SEP.length),
    };
  };

  const getValueById = (root, id) => {
    const el = root.querySelector('#' + id);
    return el ? trimText(el.value ?? el.textContent ?? '') : '';
  };


  const readDynamicSectionsFromDOM = (root) => {
    const sections = Array.from(root.querySelectorAll('.editable-section'));
    const values = {};
    const schemaPairs = [];
    const sectionsOrder = [];
    const fieldsOrderBySection = {};

    sections.forEach((sectionDiv) => {
      const sectionInput = sectionDiv.querySelector('.section-title-input');
      const sectionTitle = normalizeSpaces(sectionInput ? sectionInput.value : '');
      if (!sectionTitle) return;

      sectionsOrder.push(sectionTitle);
      fieldsOrderBySection[sectionTitle] = [];

      const fieldRows = Array.from(sectionDiv.querySelectorAll('.field-row'));
      fieldRows.forEach((fieldRow) => {
        const fieldLabelInput = fieldRow.querySelector('.field-label-input');
        const fieldValueInput = fieldRow.querySelector('.field-value-input');

        const fieldName = normalizeSpaces(fieldLabelInput ? fieldLabelInput.value : '');
        const fieldValue = trimText(fieldValueInput ? (fieldValueInput.value ?? fieldValueInput.textContent ?? '') : '');

        if (!fieldName) return;

        const key = compositeKey(sectionTitle, fieldName);
        values[key] = fieldValue;
        fieldsOrderBySection[sectionTitle].push(fieldName);

        // Look for original key hints to detect renames (placed by UI when editing)
        const originalKeyAttr =
          fieldRow.getAttribute('data-original-key') ||
          (fieldLabelInput && fieldLabelInput.getAttribute('data-original-key')) ||
          (fieldValueInput && fieldValueInput.getAttribute('data-original-key')) ||
          '';

        const pair = { key, section: sectionTitle, field: fieldName };
        if (trimText(originalKeyAttr)) pair.originalKey = normalizeSpaces(originalKeyAttr);
        schemaPairs.push(pair);
      });
    });

    return { values, schemaPairs, order: { sections: sectionsOrder, fieldsBySection: fieldsOrderBySection } };
  };

  const buildSchemaDelta = (assetTypeNow) => {
    // Old schema pairs from current data
    const oldSchemaKeys = Object.keys(currentStationData || {}).filter((k) => k.includes(COMPOSITE_SEP));
    const oldSet = new Set(oldSchemaKeys);

    // New schema from DOM
    const { schemaPairs, order } = readDynamicSectionsFromDOM(container);
    const newSchemaKeys = schemaPairs.map((p) => p.key);
    const newSet = new Set(newSchemaKeys);

    // Compute raw adds/removes
    const rawAdded = [];
    const rawRemoved = [];

    newSchemaKeys.forEach((key) => {
      if (!oldSet.has(key)) {
        const { section, field } = parseCompositeKey(key);
        rawAdded.push({ section, field, key });
      }
    });

    oldSchemaKeys.forEach((key) => {
      if (!newSet.has(key)) {
        const { section, field } = parseCompositeKey(key);
        rawRemoved.push({ section, field, key });
      }
    });

    // Incorporate explicit deletes from UI, if any (ensure normalized & unique)
    const uiDeleted = Array.from(new Set((window._deletedSchemaPairs || []).map(normalizeSpaces))).filter(Boolean);
    uiDeleted.forEach((key) => {
      if (!rawRemoved.find((r) => r.key === key)) {
        const { section, field } = parseCompositeKey(key);
        rawRemoved.push({ section, field, key });
      }
    });

    // Detect renames via data-original-key hints:
    // If a row provides originalKey and it existed before, and differs from current key => rename.
    const renamed = [];
    const removeKeysSet = new Set(rawRemoved.map((r) => r.key));
    const addKeysSet = new Set(rawAdded.map((a) => a.key));

    schemaPairs.forEach((p) => {
      if (!p.originalKey) return;
      const fromKey = p.originalKey;
      const toKey = p.key;
      if (fromKey === toKey) return;
      if (!oldSet.has(fromKey)) return; // original didn't exist previously -> treat as add only

      const from = { ...parseCompositeKey(fromKey), key: fromKey };
      const to = { ...parseCompositeKey(toKey), key: toKey };
      renamed.push({ from, to });

      // If we have both a remove(fromKey) and add(toKey), cancel them out from added/removed
      if (removeKeysSet.has(fromKey)) {
        removeKeysSet.delete(fromKey);
      }
      if (addKeysSet.has(toKey)) {
        addKeysSet.delete(toKey);
      }
    });

    // Rebuild added/removed without those covered by rename
    const added = Array.from(addKeysSet).map((key) => ({ ...parseCompositeKey(key), key }));
    const removed = Array.from(removeKeysSet).map((key) => ({ ...parseCompositeKey(key), key }));

    return { added, removed, renamed, order };
  };

  // --- Main save flow ---------------------------------------------------------
  let saveBtn = null;

  try {
    // Disable & indicate saving
    saveBtn = container.querySelector('#saveChangesBtn');
    if (saveBtn) {
      saveBtn.textContent = 'Saving...';
      saveBtn.disabled = true;
    }

    // 1) Assemble updated station object (values only)
    const updatedData = { ...(currentStationData || {}) };

    // General Information (if unlocked)
    if (typeof generalInfoUnlocked === 'undefined' || generalInfoUnlocked) {
      updatedData.station_id = getValueById(container, 'giStationId');
      updatedData.asset_type = getValueById(container, 'giCategory');
      updatedData.name = getValueById(container, 'giSiteName');
      updatedData.province = getValueById(container, 'giProvince');
      updatedData.lat = getValueById(container, 'giLatitude');
      updatedData.lon = getValueById(container, 'giLongitude');
      updatedData.status = getValueById(container, 'giStatus');
    }

    // Remove old composite "Section – Field" keys from values before rebuilding
    Object.keys(updatedData).forEach((key) => {
      if (key.includes(COMPOSITE_SEP)) delete updatedData[key];
    });

    // Rebuild composite values from DOM (dynamic sections)
    const { values: newCompositeValues } = readDynamicSectionsFromDOM(container);
    Object.assign(updatedData, newCompositeValues);

    // 2) Build and apply SCHEMA DELTA (only schema, not values)
    const assetTypeNow = updatedData.asset_type || (currentStationData ? currentStationData.asset_type : '');
    const delta = buildSchemaDelta(assetTypeNow);

    if (assetTypeNow && window.electronAPI && typeof window.electronAPI.applyAssetTypeSchemaDelta === 'function') {
      try {
        await window.electronAPI.applyAssetTypeSchemaDelta(assetTypeNow, delta);
      } catch (err) {
        console.warn('[schema] applyAssetTypeSchemaDelta failed:', err);
        // Proceed with value save even if schema propagation fails
      }
    }

    // 3) Save the edited station's values to its location file
    const result = await window.electronAPI.updateStationData(updatedData);

    if (result && result.success) {
      hasUnsavedChanges = false;
      currentStationData = { ...updatedData };

      // Reset deletion tracking after a successful save
      try {
        // Keep compatibility if some code references bare _deletedSchemaPairs
        if (typeof _deletedSchemaPairs !== 'undefined') {
          _deletedSchemaPairs = [];
        }
      } catch (_) {
        // no-op
      }
      window._deletedSchemaPairs = [];

      if (saveBtn) {
        saveBtn.classList.add('btn-success-flash');
        saveBtn.classList.remove('btn-warning');
        saveBtn.textContent = 'Saved';
        setTimeout(() => {
          saveBtn.classList.remove('btn-success-flash');
          saveBtn.textContent = 'Save Changes';
        }, 2000);
      }

      // Refresh the main map/list if needed
      await window.electronAPI.invalidateStationCache?.();
    } else {
      throw new Error((result && result.message) || 'Save failed');
    }
  } catch (error) {
    console.error('Save failed:', error);
    alert('Failed to save changes: ' + (error && error.message ? error.message : String(error)));
  } finally {
    // Re-enable save button
    const btn = document.querySelector('#saveChangesBtn');
    if (btn) {
      btn.disabled = false;
      if (btn.textContent === 'Saving...') {
        btn.textContent = 'Save Changes';
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
      
      if (rightPanel) {
        rightPanel.style.display = '';
        // Reload RHS quick view with the last selected station (if any)
        try {
          if (window._lastSelectedStation && typeof window.showStationDetails === 'function') {
            window.showStationDetails(window._lastSelectedStation);
          } else {
            // fallback: clear to placeholder
            const sd = document.getElementById('station-details');
            if (sd) sd.innerHTML = '<p><em>Click a pin to see details</em></p>';
          }
        } catch (_) {}
      }
      disableFullWidthMode();

      // Reset editing state
      hasUnsavedChanges = false;
      generalInfoUnlocked = false;
    });
  }
}

function buildSchemaDelta(assetType) {
  const renames = [];
  const adds    = [];
  const removes = [..._deletedSchemaPairs]; // already original pairs

  // For every remaining field row, compare original vs current labels
  document.querySelectorAll('.editable-section').forEach(sectionDiv => {
    const newSection = normTxt(sectionDiv.querySelector('.section-title-input')?.value);
    const origSection = normTxt(sectionDiv.dataset.originalSectionName || '');
    sectionDiv.querySelectorAll('.field-row').forEach(fr => {
      const newField = normTxt(fr.querySelector('.field-label-input')?.value);
      const origField = normTxt(fr.dataset.originalFieldName || '');
      if (!newField) return;

      if (!origField) {
        // brand-new field -> add
        adds.push({ section: newSection, field: newField });
      } else if (origSection !== newSection || origField !== newField) {
        // rename from original pair to current pair
        renames.push({
          from: { section: origSection, field: origField },
          to:   { section: newSection,  field: newField  }
        });
      }
    });
  });

  return { assetType: assetType || '', renames, adds, removes };
}


// expose
window.loadStationPage = loadStationPage;