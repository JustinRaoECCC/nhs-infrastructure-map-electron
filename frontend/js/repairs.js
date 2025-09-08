// frontend/js/repairs.js
(() => {
  const CATS = ['Capital', 'O&M'];

  function fmtCost(v) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v); }
      catch { return `$${Math.round(v).toLocaleString()}`; }
    }
    const s = String(v ?? '').trim();
    return s ? s : '—';
  }

  async function fetchInto(container, url, targetSelector) {
    const panel = container.querySelector(targetSelector);
    if (!panel) return null;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    panel.innerHTML = await resp.text();
    return panel;
  }

  function renderTable(tbody, items, state) {
    tbody.innerHTML = '';
    items.forEach((it, idx) => {
      const tr = document.createElement('tr');
      tr.dataset.index = String(idx);

      const c1 = document.createElement('td'); c1.textContent = it.name || '—';
      const c2 = document.createElement('td'); c2.textContent = it.severity || '—';
      const c3 = document.createElement('td'); c3.textContent = it.priority || '—';
      const c4 = document.createElement('td'); c4.textContent = fmtCost(it.cost);
      const c5 = document.createElement('td'); c5.textContent = it.category || '—';

      tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3); tr.appendChild(c4); tr.appendChild(c5);

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
    let cost = costRaw ? Number(costRaw.replace(/[, ]/g, '')) : '';
    if (!Number.isFinite(cost)) cost = costRaw; // keep as string if not numeric
    return { name, severity, priority, cost, category };
  }

  function validateForm(data) {
    if (!data.name) return 'Repair Name is required.';
    if (!CATS.includes(data.category)) return 'Select a valid Category.';
    return null;
  }

  async function initRepairsTab(container, stn) {
    // Inject template into #repairs panel
    const host = await fetchInto(container, 'repairs.html', '#repairs');
    if (!host) return;

    const state = {
      items: [],
      resolveMode: false,
      selected: new Set(), // indices to delete
      dirty: false,
    };

    const tbody = host.querySelector('#repairsTbody');
    const addBtn = host.querySelector('#repAddBtn');
    const saveBtn = host.querySelector('#repSaveBtn');
    const resolveBtn = host.querySelector('#repResolveBtn');
    const exportBtn = host.querySelector('#repExportBtn');
    const modal = document.querySelector('#repAddModal');
    const cancelBtn = document.querySelector('#repCancel');
    const createBtn = document.querySelector('#repCreate');
    const errorEl = document.querySelector('#repFormError');

    async function load() {
      try {
        const arr = await window.electronAPI.listRepairs(stn.name, stn.station_id);
        state.items = Array.isArray(arr) ? arr : [];
      } catch (e) {
        console.warn('[repairs:list] failed', e);
        state.items = [];
      }
      state.selected.clear();
      state.resolveMode = false;
      state.dirty = false;
      renderTable(tbody, state.items, state);
      // reset button labels
      resolveBtn.textContent = 'Resolve Repairs';
      resolveBtn.classList.remove('btn-danger');
      updateDirtyBadge(state);
    }

    // initial load when the tab is shown the first time
    // If tab was already active (e.g. direct click), we still load immediately.
    await load();

    // --- Add Repair modal
    addBtn?.addEventListener('click', () => {
      errorEl.style.display = 'none';
      document.querySelector('#repName').value = '';
      document.querySelector('#repSeverity').value = '';
      document.querySelector('#repPriority').value = '';
      document.querySelector('#repCost').value = '';
      document.querySelector('#repCategory').value = 'Capital';
      openModal();
    });

    cancelBtn?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    createBtn?.addEventListener('click', () => {
      const data = readForm();
      const err = validateForm(data);
      if (err) {
        errorEl.textContent = err;
        errorEl.style.display = 'block';
        return;
      }
      state.items.push(data);
      state.dirty = true;
      renderTable(tbody, state.items, state);
      updateDirtyBadge(state);
      closeModal();
    });

    // --- Resolve mode
    resolveBtn?.addEventListener('click', () => {
      if (!state.resolveMode) {
        state.resolveMode = true;
        state.selected.clear();
        resolveBtn.textContent = 'Exit Resolve Mode';
        resolveBtn.classList.add('btn-danger');
        renderTable(tbody, state.items, state);
      } else {
        // Exit without saving deletions
        state.resolveMode = false;
        state.selected.clear();
        resolveBtn.textContent = 'Resolve Repairs';
        resolveBtn.classList.remove('btn-danger');
        renderTable(tbody, state.items, state);
        updateDirtyBadge(state);
      }
    });

    // --- Save Changes (apply additions and deletions)
    saveBtn?.addEventListener('click', async () => {
      try {
        const toKeep = state.resolveMode
          ? state.items.filter((_it, idx) => !state.selected.has(idx))
          : state.items.slice();

        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
        const res = await window.electronAPI.saveRepairs(stn.name, stn.station_id, toKeep);
        if (!res?.success) {
          alert(res?.message || 'Failed to save repairs.');
          return;
        }
        // reload from disk to be sure
        await load();
        saveBtn.classList.add('btn-success');
        setTimeout(() => saveBtn.classList.remove('btn-success'), 900);
      } catch (e) {
        console.error('[repairs:save] failed', e);
        alert('Failed to save repairs.');
      } finally {
        saveBtn.disabled = false; saveBtn.textContent = 'Save Changes';
      }
    });

    // --- Export (placeholder)
    exportBtn?.addEventListener('click', () => {
      alert('Export Repairs to Dashboard — not implemented yet.');
    });
  }

  // expose to station.js
  window.initRepairsTab = initRepairsTab;
})();
