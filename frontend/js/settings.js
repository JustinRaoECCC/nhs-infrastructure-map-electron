// Settings view: Map Pin colors + Status Overrides (+ Repair stub)
(function () {
  'use strict';

  const HEX_DEFAULT = '#4b5563'; // UI fallback only

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  function normalizeHex(s) {
    let v = String(s || '').trim();
    if (!v) return HEX_DEFAULT;
    if (v[0] !== '#') v = '#' + v;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(v)) {
      return ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase();
    }
    const hex = v.replace(/[^0-9a-fA-F]/g, '');
    const padded = (hex + '000000').slice(0, 6);
    return ('#' + padded).toLowerCase();
  }
  function rowKey(assetType, company, location) {
    return `${assetType}@@${company}@@${location}`;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // IPC wrappers
  async function getColorMapFromBackend() {
    const api = window.electronAPI || {};
    if (typeof api.getColorMaps !== 'function') return {};
    try {
      const maps = await api.getColorMaps();
      const out = {};
      if (maps && maps.byCompanyLocation) {
        const byCo = maps.byCompanyLocation instanceof Map ? maps.byCompanyLocation : new Map(Object.entries(maps.byCompanyLocation));
        for (const [co, locMapLike] of byCo.entries()) {
          const locMap = locMapLike instanceof Map ? locMapLike : new Map(Object.entries(locMapLike));
          for (const [loc, innerLike] of locMap.entries()) {
            const inner = innerLike instanceof Map ? innerLike : new Map(Object.entries(innerLike));
            for (const [at, color] of inner.entries()) {
              out[rowKey(at, co, loc)] = normalizeHex(color);
            }
          }
        }
      }
      return out;
    } catch (e) { console.error('[settings] getColorMaps failed', e); return {}; }
  }
  async function getLookupTreeSafe() {
    const api = window.electronAPI || {};
    const empty = { companies: [], locationsByCompany: {}, assetsByLocation: {} };
    if (typeof api.getLookupTree !== 'function') return empty;
    try {
      const t = await api.getLookupTree();
      if (t && Array.isArray(t.companies)) return {
        companies: t.companies || [],
        locationsByCompany: t.locationsByCompany || {},
        assetsByLocation: t.assetsByLocation || {}
      };
    } catch (e) { console.error('[settings] getLookupTree failed:', e); }
    return empty;
  }
  async function persistColorChange(assetType, company, location, color) {
    const api = window.electronAPI || {};
    if (typeof api.setAssetTypeColorForCompanyLocation === 'function') {
      try {
        const res = await api.setAssetTypeColorForCompanyLocation(assetType, company, location, color);
        if (res && res.success !== false) return true;
      } catch (e) { console.warn('[settings] setAssetTypeColorForCompanyLocation failed', e); }
    }
    return false;
  }

  // NEW: Status/Repair settings IPC
  async function getStatusRepairSettings() {
    try { return await window.electronAPI.getStatusRepairSettings(); }
    catch (e) { console.warn('[settings] getStatusRepairSettings failed', e); return {
      statusColors: { inactive:'#999999', mothballed:'#999999', unknown:'#999999' },
      applyStatusColorsOnMap: false,
      repairColors: {},
      applyRepairColorsOnMap: false
    }; }
  }
  async function setStatusColor(statusKey, hex) {
    try { return await window.electronAPI.setStatusColor(statusKey, hex); }
    catch (e) { console.warn('[settings] setStatusColor failed', e); return { success:false }; }
  }
  async function setApplyStatusColors(flag) {
    try { return await window.electronAPI.setApplyStatusColors(flag); }
    catch (e) { console.warn('[settings] setApplyStatusColors failed', e); return { success:false }; }
  }
  async function setApplyRepairColors(flag) {
    try { return await window.electronAPI.setApplyRepairColors(flag); }
    catch (e) { console.warn('[settings] setApplyRepairColors failed', e); return { success:false }; }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // State
  const state = {
    rows: [],              // Map pin rows
    changes: new Map(),    // k=rowKey -> {asset_type, company, location, color}
    // NEW (dynamic status rows):
    statusRows: [],        // [{label:'Inactive', color:'#8e8e8e', _origKey:'inactive'}]
    deletedStatusKeys: new Set(), // lowercased labels the user removed
    isStatusEditMode: false,
    // Legacy fallback (not used after migration, kept for backward compatibility)
    statusColors: { inactive:'#8e8e8e', mothballed:'#a87ecb', unknown:'#999999' },
    applyStatusColorsOnMap: false,
    applyRepairColorsOnMap: false,
    statusChanged: new Set(), // lowercased keys that changed color/label
    togglesChanged: new Set() // 'applyStatus','applyRepair'
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Rendering (Map pin)
  function renderRows(tbody) {
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    state.rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.company}</td>
        <td>${r.asset_type}</td>
        <td>${r.location}</td>
        <td>
          <input type="color" value="${r.color}" data-asset="${r.asset_type}" data-location="${r.location}" style="width:42px;height:28px;border:0;background:transparent;cursor:pointer;" />
          <code style="margin-left:.5rem;opacity:.8;">${r.color}</code>
        </td>
      `;
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }
  function bindColorInputs(tbody) {
    tbody.addEventListener('input', (e) => {
      const inp = e.target;
      if (!(inp instanceof HTMLInputElement) || inp.type !== 'color') return;
      const at  = inp.dataset.asset || '';
      const loc = inp.dataset.location || '';
      const co  = inp.closest('tr')?.children?.[0]?.textContent?.trim() || '';
      const val = normalizeHex(inp.value);
      const code = inp.parentElement?.querySelector('code');
      if (code) code.textContent = val;
      const k = rowKey(at, co, loc);
      state.changes.set(k, { asset_type: at, company: co, location: loc, color: val });
    }, { passive: true });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // NEW: Status Overrides (dynamic) rendering/binding
  function renderStatusTable() {
    const tbody = document.getElementById('statusColorTbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    state.statusRows.forEach((row, idx) => {
      const tr = document.createElement('tr');
      tr.dataset.idx = String(idx);
      tr.innerHTML = `
        <td>
          <div class="status-row">
            <input class="status-label" type="text" value="${escapeHtml(row.label)}"
                   placeholder="Status label (e.g., Inactive)" ${state.isStatusEditMode ? '' : 'readonly'}
                   style="width: 100%;" />
          </div>
        </td>
        <td>
          <div class="status-color-wrap" style="display:flex;align-items:center;gap:.5rem;">
            <input class="status-color" type="color" value="${normalizeHex(row.color)}"
                   ${state.isStatusEditMode ? '' : ''} 
                   style="width:42px;height:28px;border:0;background:transparent;cursor:pointer;" />
            <code class="hex">${normalizeHex(row.color)}</code>
          </div>
        </td>
        <td class="status-actions" style="${state.isStatusEditMode ? '' : 'display:none;'};text-align:right;">
          <button class="btn btn-ghost btn-icon status-remove" title="Remove row" aria-label="Remove row">✕</button>
        </td>`;
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
    // Bind color/label/remove handlers
    tbody.querySelectorAll('input.status-color').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const tr = inp.closest('tr');
        const idx = Number(tr?.dataset?.idx || -1);
        if (idx < 0) return;
        const hex = normalizeHex(e.target.value);
        tr.querySelector('code.hex').textContent = hex;
        state.statusRows[idx].color = hex;
        state.statusChanged.add((state.statusRows[idx]._origKey || state.statusRows[idx].label).toLowerCase());
      });
    });
    tbody.querySelectorAll('input.status-label').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const tr = inp.closest('tr');
        const idx = Number(tr?.dataset?.idx || -1);
        if (idx < 0) return;
        state.statusRows[idx].label = String(e.target.value || '').trim();
        state.statusChanged.add((state.statusRows[idx]._origKey || '').toLowerCase());
      });
    });
    tbody.querySelectorAll('button.status-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        const idx = Number(tr?.dataset?.idx || -1);
        if (idx < 0) return;
        const row = state.statusRows[idx];
        if (row && row._origKey) state.deletedStatusKeys.add(row._origKey.toLowerCase());
        state.statusRows.splice(idx, 1);
        renderStatusTable();
     });
    });
  }

  function bindStatusToolbar() {
    const editBtn = document.getElementById('statusEditBtn');
    const addBtn  = document.getElementById('statusAddBtn');
    const chkStatus = document.getElementById('applyStatusColorsChk');
    const chkRepair = document.getElementById('applyRepairColorsChk');

    if (editBtn && !editBtn.dataset.bound) {
      editBtn.addEventListener('click', () => {
        state.isStatusEditMode = !state.isStatusEditMode;
        editBtn.classList.toggle('active', state.isStatusEditMode);
        editBtn.textContent = state.isStatusEditMode ? 'Done' : 'Edit';
        if (addBtn) addBtn.style.display = state.isStatusEditMode ? '' : 'none';
        renderStatusTable();
      });
      editBtn.dataset.bound = '1';
    }
    if (addBtn && !addBtn.dataset.bound) {
      addBtn.addEventListener('click', () => {
        state.statusRows.push({ label: 'New Status', color: '#999999', _origKey: '' });
        state.isStatusEditMode = true;
        if (editBtn) { editBtn.classList.add('active'); editBtn.textContent = 'Done'; }
        addBtn.style.display = '';
        renderStatusTable();
      });
      addBtn.dataset.bound = '1';
    }
    if (chkStatus && !chkStatus.dataset.bound) {
      chkStatus.addEventListener('change', (e) => {
        state.applyStatusColorsOnMap = !!e.target.checked;
        state.togglesChanged.add('applyStatus');
      });
      chkStatus.dataset.bound = '1';
    }
    if (chkRepair && !chkRepair.dataset.bound) {
      chkRepair.addEventListener('change', (e) => {
        state.applyRepairColorsOnMap = !!e.target.checked;
        state.togglesChanged.add('applyRepair');
      });
      chkRepair.dataset.bound = '1';
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Tabs
  function bindTabs(root) {
    const btns = root.querySelectorAll('.tab-btn');
    const footer = root.querySelector('.settings-footer');
    const showTab = (target) => {
      btns.forEach(b => b.classList.toggle('active', b.dataset.tab === target));
      root.querySelectorAll('.tab-panel').forEach(p => {
        p.style.display = (p.dataset.tab === target) ? 'block' : 'none';
      });
    // Hide footer only on Nuke (no CSS class; do it directly)
    if (footer) footer.style.display = (target === 'nuke') ? 'none' : '';
    };
    btns.forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
    // Initialize the correct state on first paint
    const initial = [...btns].find(b => b.classList.contains('active'))?.dataset.tab || 'mapPin';
    showTab(initial);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Save / Cancel
  async function handleSave(root) {
    const saveBtn = root.querySelector('#settingsSaveBtn');
    const cancelBtn = root.querySelector('#settingsCancelBtn');
    const status = root.querySelector('#settingsSaveStatus');
    if (!saveBtn) return;

    const entries = Array.from(state.changes.values());
    const statusChanged = Array.from(state.statusChanged.values()); // legacy marker; we’ll compute diffs below
    const deleted = Array.from(state.deletedStatusKeys.values());   // lowercased keys to delete

    if (!entries.length && !statusChanged.length && state.togglesChanged.size === 0) {
      if (status) status.textContent = 'No changes.';
      return;
    }

    saveBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (status) status.textContent = 'Saving…';

    let ok = 0, fail = 0;

    // 1) Map pin color changes
    for (const { asset_type, company, location, color } of entries) {
      const success = await persistColorChange(asset_type, company, location, color);
      success ? ok++ : fail++;
    }

    // 2) Status colors (add/update + deletes)
    // Build a normalized final map of label->color from rows
    const finalMap = {};
    state.statusRows.forEach(r => {
      const key = String(r.label || '').trim();
      if (!key) return;
      finalMap[key] = normalizeHex(r.color || '#999999');
    });

    // Upserts for all rows
    for (const [label, hex] of Object.entries(finalMap)) {
      try {
        const res = await setStatusColor(label, hex); // upsert
        res && res.success ? ok++ : fail++;
      } catch (e) { fail++; }
    }
    // Deletes for removed originals
    if (typeof window.electronAPI?.deleteStatus === 'function') {
      for (const k of deleted) {
        try {
          // Only delete if that old key no longer exists in final set (case-insensitive)
          const stillExists = Object.keys(finalMap)
            .some(lbl => lbl.toLowerCase() === k);
          if (!stillExists) {
            const res = await window.electronAPI.deleteStatus(k);
            res && res.success ? ok++ : fail++;
          }
        } catch (e) { fail++; }
      }
    }

    // 3) Toggles
    if (state.togglesChanged.has('applyStatus')) {
      const res = await setApplyStatusColors(!!state.applyStatusColorsOnMap);
      res && res.success ? ok++ : fail++;
    }
    if (state.togglesChanged.has('applyRepair')) {
      const res = await setApplyRepairColors(!!state.applyRepairColorsOnMap);
      res && res.success ? ok++ : fail++;
    }

    // Refresh caches/UI after save
    try {
      if (typeof window.electronAPI?.invalidateStationCache === 'function') {
        await window.electronAPI.invalidateStationCache();
      }
    } catch (e) { console.warn('[settings] invalidateStationCache failed', e); }

    if (typeof window.refreshFilters === 'function') setTimeout(window.refreshFilters, 0);
    if (typeof window.refreshMarkers === 'function') setTimeout(window.refreshMarkers, 0);
    if (typeof window.renderList === 'function') setTimeout(window.renderList, 0);

    if (status) status.textContent = fail ? `Saved ${ok}, ${fail} failed.` : `Saved ${ok} change${ok === 1 ? '' : 's'}.`;
    saveBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
    if (!fail) {
      state.changes.clear();
      state.statusChanged.clear();
      state.deletedStatusKeys.clear();
      state.togglesChanged.clear();
    }
  }

  async function loadAndRender(root) {
    const tbody = root.querySelector('#mapPinTbody');
    if (!tbody) return;

    // Load lookups for main table
    const lookups = await getLookupTreeSafe();
    const colorMap = await getColorMapFromBackend();

    const rows = [];
    const byCo = lookups.locationsByCompany || {};
    Object.keys(byCo).sort().forEach(company => {
      (byCo[company] || []).slice().sort().forEach(loc => {
        const ats = (lookups.assetsByLocation?.[loc] || []).slice().sort();
        ats.forEach(at => {
          const c = colorMap[rowKey(at, company, loc)];
          const color = normalizeHex(c || HEX_DEFAULT);
          rows.push({ company, asset_type: at, location: loc, color });
        });
      });
    });

    state.rows = rows;
    state.changes.clear();
    renderRows(tbody);
    bindColorInputs(tbody);

    // NEW: Load status/repair settings and render
    const s = await getStatusRepairSettings();
    // Convert map → rows, preserving original keys for delete-diff
    const rows2 = [];
    const sc = s?.statusColors || {};
    const entries = Object.entries(sc);
    if (entries.length === 0) {
      rows2.push({ label:'Inactive',   color:'#8e8e8e', _origKey:'inactive' });
      rows2.push({ label:'Mothballed', color:'#a87ecb', _origKey:'mothballed' });
      rows2.push({ label:'Unknown',    color:'#999999', _origKey:'unknown' });
    } else {
      for (const [k, v] of entries) {
        const label = k && k.trim() ? k : 'Unnamed';
        rows2.push({ label, color: normalizeHex(v), _origKey: k.toLowerCase() });
      }
    }
    state.statusRows = rows2;
    state.applyStatusColorsOnMap = !!s.applyStatusColorsOnMap;
    state.applyRepairColorsOnMap = !!s.applyRepairColorsOnMap;

    // Render dynamic table + bind toolbar/toggles
    renderStatusTable();
    const chkStatus = document.getElementById('applyStatusColorsChk');
    if (chkStatus) chkStatus.checked = !!state.applyStatusColorsOnMap;
    const chkRepair = document.getElementById('applyRepairColorsChk');
    if (chkRepair) chkRepair.checked = !!state.applyRepairColorsOnMap;
    bindStatusToolbar();
  }

  function initSettingsView() {
    const root = document.getElementById('settingsPage');
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    bindTabs(root);
    // Ensure footer is visible at start (belt & suspenders)
    const footer = root.querySelector('.settings-footer');
    if (footer) footer.style.display = '';


    const saveBtn = root.querySelector('#settingsSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', () => handleSave(root));

    const cancelBtn = root.querySelector('#settingsCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => loadAndRender(root));

    loadAndRender(root);
    window.addEventListener('lookups:changed', () => loadAndRender(root));
  }

  window.initSettingsView = window.initSettingsView || initSettingsView;
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('settingsPage')) initSettingsView();
  });
})();

// Small helper kept local to this module for escaping label values
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str ?? '');
  return div.innerHTML;
}