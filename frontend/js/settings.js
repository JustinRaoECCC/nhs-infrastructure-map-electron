// Settings view: Map Pin colors (per asset_type, per location) stored in Lookups/AssetTypes
(function () {
  'use strict';

  const HEX_DEFAULT = '#4b5563'; // slate-ish fallback

  function normalizeHex(s) {
    // Ensure a valid #RRGGBB; fix common #RRGGg (6th missing) by padding.
    let v = String(s || '').trim();
    if (!v) return HEX_DEFAULT;
    if (v[0] !== '#') v = '#' + v;
    if (v.length === 7) return v.toLowerCase();
    if (v.length === 6) return ('#' + v.slice(1) + '0').toLowerCase();
    if (v.length === 4) { // #RGB → #RRGGBB
      return ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase();
    }
    // Anything else: best-effort strip non-hex and pad
    const hex = v.replace(/[^0-9a-fA-F]/g, '');
    const padded = (hex + '000000').slice(0, 6);
    return ('#' + padded).toLowerCase();
  }

  function rowKey(assetType, location) {
    return `${assetType}@@${location}`;
  }

  async function getColorMapFromBackend() {
    // Use real lookup color maps (byLocation + global) from backend
    const api = window.electronAPI || {};
    if (typeof api.getColorMaps !== 'function') return {};
    try {
      const maps = await api.getColorMaps(); // { global: Map, byLocation: Map<Location, Map<AT, Color>> }
      const out = {};
      if (maps && maps.byLocation) {
        // maps.byLocation can arrive as plain objects depending on IPC
        const byLoc = maps.byLocation instanceof Map ? maps.byLocation : new Map(Object.entries(maps.byLocation));
        for (const [loc, inner] of byLoc.entries()) {
          const innerMap = inner instanceof Map ? inner : new Map(Object.entries(inner));
          for (const [at, color] of innerMap.entries()) {
            out[rowKey(at, loc)] = normalizeHex(color);
          }
        }
      }
      // Fill from global if a per-location override is missing
      if (maps && maps.global) {
        const g = maps.global instanceof Map ? maps.global : new Map(Object.entries(maps.global));
        for (const [at, color] of g.entries()) {
          // Use a special '*' location key only if no per-location color exists
          const k = rowKey(at, '*');
          if (!out[k]) out[k] = normalizeHex(color);
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
    } catch (e) {
      console.error('[settings] getLookupTree failed:', e);
    }
    return empty;
  }

  async function persistColorChange(assetType, location, color) {
    const api = window.electronAPI || {};
    // 1) Preferred: per-location setter
    if (typeof api.setAssetTypeColorForLocation === 'function') {
      try {
        const res = await api.setAssetTypeColorForLocation(assetType, location, color);
        if (res && res.success !== false) return true;
      } catch (e) {
        console.warn('[settings] setAssetTypeColorForLocation failed', e);
      }
    }
    // 2) Fallback: global color (if your schema sometimes ignores location)
    if (typeof api.setAssetTypeColor === 'function') {
      try {
        const res = await api.setAssetTypeColor(assetType, color);
        if (res && res.success !== false) return true;
      } catch (e) {
        console.warn('[settings] setAssetTypeColor failed', e);
      }
    }
    // 3) Last resort: upsert the row with color if your backend supports it
    if (typeof api.upsertAssetType === 'function') {
      try {
        // Some backends accept a third "color" arg; if not, this will no-op but stay safe
        const res = await api.upsertAssetType(assetType, location, color);
        if (res && res.success !== false) return true;
      } catch (e) {
        console.warn('[settings] upsertAssetType(color) fallback failed', e);
      }
    }
    return false;
  }

  // State
  const state = {
    rows: [],       // [{asset_type, location, color}]
    changes: new Map(), // k=rowKey → {asset_type, location, color}
  };

  function renderRows(tbody) {
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    state.rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
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
      const val = normalizeHex(inp.value);
      // keep the hex text beside the picker in sync
      const code = inp.parentElement?.querySelector('code');
      if (code) code.textContent = val;

      const k = rowKey(at, loc);
      state.changes.set(k, { asset_type: at, location: loc, color: val });
    }, { passive: true });
  }

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

  async function handleSave(root) {
    const saveBtn = root.querySelector('#settingsSaveBtn');
    const cancelBtn = root.querySelector('#settingsCancelBtn');
    const status = root.querySelector('#settingsSaveStatus');
    if (!saveBtn) return;

    const entries = Array.from(state.changes.values());
    if (!entries.length) {
      if (status) status.textContent = 'No changes.';
      return;
    }

    saveBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;
    if (status) status.textContent = 'Saving…';

    let ok = 0, fail = 0;
    for (const { asset_type, location, color } of entries) {
      const success = await persistColorChange(asset_type, location, color);
      if (success) ok++; else fail++;
    }

    // Refresh caches/UI after save
    try {
      if (typeof window.electronAPI?.invalidateStationCache === 'function') {
        await window.electronAPI.invalidateStationCache();
      }
    } catch (e) {
      console.warn('[settings] invalidateStationCache failed', e);
    }
    if (typeof window.refreshFilters === 'function') setTimeout(window.refreshFilters, 0);
    if (typeof window.refreshMarkers === 'function') setTimeout(window.refreshMarkers, 0);
    if (typeof window.renderList === 'function') setTimeout(window.renderList, 0);

    if (status) status.textContent = fail ? `Saved ${ok}, ${fail} failed.` : `Saved ${ok} change${ok === 1 ? '' : 's'}.`;
    saveBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
    if (!fail) state.changes.clear();
  }

  async function loadAndRender(root) {
    const tbody = root.querySelector('#mapPinTbody');
    if (!tbody) return;

    const lookups = await getLookupTreeSafe();
    const colorMap = await getColorMapFromBackend();

    // Build rows from lookups tree (authoritative for which pairs exist)
    const rows = [];
    const locs = lookups.assetsByLocation || {};
    Object.keys(locs).sort((a, b) => a.localeCompare(b)).forEach(loc => {
      (locs[loc] || []).slice().sort((a, b) => a.localeCompare(b)).forEach(at => {
        const key = rowKey(at, loc);
        let color = colorMap[key];
        if (!color) {
          // fallback to global if present
          const g = colorMap[rowKey(at, '*')];
          color = g || HEX_DEFAULT;
        }
        color = normalizeHex(color);
        rows.push({ asset_type: at, location: loc, color });
      });
    });

    state.rows = rows;
    state.changes.clear();
    renderRows(tbody);
    bindColorInputs(tbody);
  }

  function initSettingsView() {
    const root = document.getElementById('settingsPage');
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    bindTabs(root);

    // Buttons
    const saveBtn = root.querySelector('#settingsSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', () => handleSave(root));
    const cancelBtn = root.querySelector('#settingsCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => loadAndRender(root)); // revert to disk

    loadAndRender(root);
  }

  // Public API for add_infra.js
  window.initSettingsView = window.initSettingsView || initSettingsView;

  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('settingsPage')) initSettingsView();
  });
})();
