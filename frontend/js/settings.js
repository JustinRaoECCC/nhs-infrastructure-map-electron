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
    // NEW:
    statusColors: { inactive:'#8e8e8e', mothballed:'#a87ecb', unknown:'#999999' },
    applyStatusColorsOnMap: false,
    applyRepairColorsOnMap: false,
    statusChanged: new Set(), // keys added here when changed
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
  // NEW: Status Overrides rendering/binding
  function renderStatusUI() {
    const map = state.statusColors || {};
    const set = (id, key) => {
      const el = document.getElementById(`statusColor-${key}`);
      const code = document.querySelector(`code.hex[data-for="${key}"]`);
      const hex = normalizeHex(map[key]);
      if (el) el.value = hex;
      if (code) code.textContent = hex;
    };
    set('statusColor-inactive', 'inactive');
    set('statusColor-mothballed', 'mothballed');
    set('statusColor-unknown', 'unknown');

    const chkStatus = document.getElementById('applyStatusColorsChk');
    if (chkStatus) chkStatus.checked = !!state.applyStatusColorsOnMap;

    const chkRepair = document.getElementById('applyRepairColorsChk');
    if (chkRepair) chkRepair.checked = !!state.applyRepairColorsOnMap;
  }

  function bindStatusInputs() {
    const keys = ['inactive','mothballed','unknown'];
    keys.forEach(k => {
      const el = document.getElementById(`statusColor-${k}`);
      if (!el || el.dataset.bound) return;
      el.addEventListener('input', (e) => {
        const hex = normalizeHex(e.target.value);
        state.statusColors[k] = hex;
        const code = document.querySelector(`code.hex[data-for="${k}"]`);
        if (code) code.textContent = hex;
        state.statusChanged.add(k);
      });
      el.dataset.bound = '1';
    });

    const chkStatus = document.getElementById('applyStatusColorsChk');
    if (chkStatus && !chkStatus.dataset.bound) {
      chkStatus.addEventListener('change', (e) => {
        state.applyStatusColorsOnMap = !!e.target.checked;
        state.togglesChanged.add('applyStatus');
      });
      chkStatus.dataset.bound = '1';
    }
    const chkRepair = document.getElementById('applyRepairColorsChk');
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
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        btns.forEach(b => b.classList.toggle('active', b === btn));
        root.querySelectorAll('.tab-panel').forEach(p => {
          p.style.display = (p.dataset.tab === target) ? 'block' : 'none';
        });
      });
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Save / Cancel
  async function handleSave(root) {
    const saveBtn = root.querySelector('#settingsSaveBtn');
    const cancelBtn = root.querySelector('#settingsCancelBtn');
    const status = root.querySelector('#settingsSaveStatus');
    if (!saveBtn) return;

    const entries = Array.from(state.changes.values());
    const statusChanged = Array.from(state.statusChanged.values());

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

    // 2) Status colors
    for (const key of statusChanged) {
      const res = await setStatusColor(key, state.statusColors[key]);
      res && res.success ? ok++ : fail++;
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
    state.statusColors = {
      inactive: normalizeHex(s?.statusColors?.inactive || '#8e8e8e'),
      mothballed: normalizeHex(s?.statusColors?.mothballed || '#a87ecb'),
      unknown: normalizeHex(s?.statusColors?.unknown || '#999999')
    };
    state.applyStatusColorsOnMap = !!s.applyStatusColorsOnMap;
    state.applyRepairColorsOnMap = !!s.applyRepairColorsOnMap;

    renderStatusUI();
    bindStatusInputs();
  }

  function initSettingsView() {
    const root = document.getElementById('settingsPage');
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    bindTabs(root);

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
