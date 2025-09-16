// frontend/js/repairs.js
(() => {
  const CATS = ['Capital', 'O&M'];
  const TYPES = ['Repair', 'Monitoring'];

  function fmtCost(v) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v); }
      catch { return `$${Math.round(v).toLocaleString()}`; }
    }
    const s = String(v ?? '').trim();
    return s ? s : '—';
  }

  function fmtDate(d) {
    const s = String(d ?? '').trim();
    if (!s) return '—';
    // Expecting ISO YYYY-MM-DD; if not, just show raw
    return s.length === 10 ? s : s;
  }

  async function fetchInto(container, url, targetSelector) {
    const panel = container.querySelector(targetSelector);
    if (!panel) return null;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    panel.innerHTML = await resp.text();
    return panel;
  }

  // entries: array of [item, globalIndex]
  function renderTable(tbody, entries, state) {
    tbody.innerHTML = '';
    entries.forEach(([it, idx]) => {
      const tr = document.createElement('tr');
      tr.dataset.index = String(idx);

      const c0 = document.createElement('td'); c0.textContent = fmtDate(it.date);
      const c1 = document.createElement('td'); c1.textContent = it.name || '—';
      const c2 = document.createElement('td'); c2.textContent = it.severity || '—';
      const c3 = document.createElement('td'); c3.textContent = it.priority || '—';
      const c4 = document.createElement('td'); c4.textContent = fmtCost(it.cost);
      const c5 = document.createElement('td'); c5.textContent = it.category || '—';

      tr.appendChild(c0); tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3); tr.appendChild(c4); tr.appendChild(c5);

      if (state.resolveMode) {
        tr.classList.add('resolve-selectable');
        if (state.selected.has(idx)) tr.classList.add('resolve-selected');
        tr.addEventListener('click', () => {
          if (!state.resolveMode) return;
          if (state.selected.has(idx)) state.selected.delete(idx);
          else state.selected.add(idx);
          tr.classList.toggle('resolve-selected');
          updateDirtyBadge(state);
        });
      }
      tbody.appendChild(tr);
    });
  }

  function updateDirtyBadge(state) {
    const saveBtn = document.querySelector('#repSaveBtn');
    if (!saveBtn) return;
    if (!state.editMode) { saveBtn.classList.remove('btn-warning'); return; }
    if (state.resolveMode && state.selected.size > 0) {
      saveBtn.classList.add('btn-warning');
    } else if (state.dirty) {
      saveBtn.classList.add('btn-warning');
    } else {
      saveBtn.classList.remove('btn-warning');
    }
  }

  function openModal() {
    const m = document.querySelector('#repAddModal');
    if (!stateRef?.editMode) return; // gate on edit mode
    if (!m) return;
    m.style.display = 'flex';
    setTimeout(() => document.querySelector('#repName')?.focus(), 40);
  }
  function closeModal() {
    const m = document.querySelector('#repAddModal');
    if (!m) return;
    m.style.display = 'none';
  }

  function readForm() {
    const name = String(document.querySelector('#repName')?.value || '').trim();
    const severity = String(document.querySelector('#repSeverity')?.value || '').trim();
    const priority = String(document.querySelector('#repPriority')?.value || '').trim();
    const costRaw = String(document.querySelector('#repCost')?.value || '').trim();
    const category = String(document.querySelector('#repCategory')?.value || 'Capital');
    const type = String(document.querySelector('#repType')?.value || 'Repair');
    let cost = costRaw ? Number(costRaw.replace(/[, ]/g, '')) : '';
    if (!Number.isFinite(cost)) cost = costRaw; // keep as string if not numeric
    // date is auto-added on create
    const date = new Date().toISOString().slice(0, 10);
    return { date, name, severity, priority, cost, category, type };
  }

  function validateForm(data) {
    if (!data.name) return 'Repair Name is required.';
    if (!CATS.includes(data.category)) return 'Select a valid Category.';
    if (!TYPES.includes(data.type)) return 'Select a valid Type.';
    return null;
  }

  let stateRef = null; // small hack so openModal can gate on edit

  async function initRepairsTab(container, stn) {
    // Inject template into #repairs panel
    const host = await fetchInto(container, 'repairs.html', '#repairs');
    if (!host) return;

    const state = {
      items: [],
      resolveMode: false,
      selected: new Set(), // indices to delete
      dirty: false,
      editMode: false,
    };
    stateRef = state;

    const repairsTbody = host.querySelector('#repairsTbody');
    const monitoringTbody = host.querySelector('#monitoringTbody');

    const editBtn = host.querySelector('#repEditBtn');
    const actionsBlock = host.querySelector('#repActionsBlock');

    const addBtn = host.querySelector('#repAddBtn');
    const saveBtn = host.querySelector('#repSaveBtn');
    const resolveBtn = host.querySelector('#repResolveBtn');
    const exportBtn = host.querySelector('#repExportBtn');

    const modal = document.querySelector('#repAddModal');
    const cancelBtn = document.querySelector('#repCancel');
    const createBtn = document.querySelector('#repCreate');
    const errorEl = document.querySelector('#repFormError');

    function entriesByType(type) {
      return state.items
        .map((it, idx) => [it, idx])
        .filter(([it]) => (String(it.type || 'Repair') === type));
    }

    function renderAll() {
      renderTable(repairsTbody, entriesByType('Repair'), state);
      renderTable(monitoringTbody, entriesByType('Monitoring'), state);
    }

    async function load() {
      try {
        const arr = await window.electronAPI.listRepairs(stn.name, stn.station_id);
        state.items = Array.isArray(arr) ? arr.map(x => ({
          date: x.date || '', // could be empty for legacy rows
          name: x.name || '',
          severity: x.severity || '',
          priority: x.priority || '',
          cost: x.cost,
          category: x.category || 'Capital',
          type: /^monitor/i.test(x.type) ? 'Monitoring' : 'Repair',
        })) : [];
      } catch (e) {
        console.warn('[repairs:list] failed', e);
        state.items = [];
      }
      state.selected.clear();
      state.resolveMode = false;
      state.dirty = false;
      state.editMode = false;
      actionsBlock.style.display = 'none';
      resolveBtn.textContent = 'Resolve Items';
      resolveBtn.classList.remove('btn-danger');
      renderAll();
      updateDirtyBadge(state);
    }

    // initial load
    await load();

    // --- Edit toggle
    editBtn?.addEventListener('click', () => {
      state.editMode = !state.editMode;
      if (!state.editMode) {
        // leaving edit resets resolve mode UI (no deletions applied)
        state.resolveMode = false;
        state.selected.clear();
        resolveBtn.textContent = 'Resolve Items';
        resolveBtn.classList.remove('btn-danger');
      }
      actionsBlock.style.display = state.editMode ? 'flex' : 'none';
      renderAll();
      updateDirtyBadge(state);
      editBtn.textContent = state.editMode ? 'Done' : 'Edit';
    });

    // --- Add Repair/Monitoring modal
    addBtn?.addEventListener('click', () => {
      if (!state.editMode) return;
      errorEl.style.display = 'none';
      document.querySelector('#repName').value = '';
      document.querySelector('#repSeverity').value = '';
      document.querySelector('#repPriority').value = '';
      document.querySelector('#repCost').value = '';
      document.querySelector('#repCategory').value = 'Capital';
      document.querySelector('#repType').value = 'Repair';
      openModal();
    });

    cancelBtn?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    createBtn?.addEventListener('click', () => {
      if (!state.editMode) return;
      const data = readForm();
      const err = validateForm(data);
      if (err) {
        errorEl.textContent = err;
        errorEl.style.display = 'block';
        return;
      }
      state.items.push(data);
      state.dirty = true;
      renderAll();
      updateDirtyBadge(state);
      closeModal();
    });

    // --- Resolve mode (applies to both tables)
    resolveBtn?.addEventListener('click', () => {
      if (!state.editMode) return;
      if (!state.resolveMode) {
        state.resolveMode = true;
        state.selected.clear();
        resolveBtn.textContent = 'Exit Resolve Mode';
        resolveBtn.classList.add('btn-danger');
        renderAll();
      } else {
        // Exit without saving deletions
        state.resolveMode = false;
        state.selected.clear();
        resolveBtn.textContent = 'Resolve Items';
        resolveBtn.classList.remove('btn-danger');
        renderAll();
        updateDirtyBadge(state);
      }
    });

    // --- Save Changes (apply additions and deletions)
    saveBtn?.addEventListener('click', async () => {
      if (!state.editMode) return;
      try {
        const toKeep = state.resolveMode
          ? state.items.filter((_it, idx) => !state.selected.has(idx))
          : state.items.slice();

        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
        const res = await window.electronAPI.saveRepairs(stn.name, stn.station_id, toKeep);
        if (!res?.success) {
          appAlert(res?.message || 'Failed to save items.');
          return;
        }
        await load(); // reload from disk to be sure
        // stay in view mode after save
        saveBtn.classList.add('btn-success');
        setTimeout(() => saveBtn.classList.remove('btn-success'), 900);
      } catch (e) {
        console.error('[repairs:save] failed', e);
        appAlert('Failed to save items.');
      } finally {
        saveBtn.disabled = false; saveBtn.textContent = 'Save Changes';
      }
    });

    // --- Export (placeholder)
    exportBtn?.addEventListener('click', () => {
      if (!state.editMode) return;
      appAlert('Export Repairs/Monitoring to Dashboard — not implemented yet.');
    });
  }

  // expose to station.js
  window.initRepairsTab = initRepairsTab;
})();
