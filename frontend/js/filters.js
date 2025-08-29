// frontend/js/filters.js
// Collapsible, tri-state filter tree:
// Company ▸ Locations ▸ Asset Types, with blue checkboxes.
(function () {
  'use strict';

  const filterTree = document.getElementById('filterTree');
  if (!filterTree) return;

  const debounce = (fn, ms = 120) => {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  const el = (tag, attrs = {}, ...children) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined) continue;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else n.setAttribute(k, v);
    }
    children.flat().forEach(c => {
      if (c == null) return;
      if (c.nodeType) n.appendChild(c); else n.appendChild(document.createTextNode(String(c)));
    });
    return n;
  };

  function uniq(arr) { return Array.from(new Set((arr || []).filter(Boolean))); }

  async function fetchTree() {
    // Primary: read from lookups workbook (Companies/Locations/AssetTypes)
    try {
      if (window.electronAPI?.getLookupTree) {
        const t = await window.electronAPI.getLookupTree();
        if (t && Array.isArray(t.companies) && t.companies.length) return t;
      }
    } catch (e) {
      console.error('[filters] getLookupTree failed', e);
    }
    // Fallback: infer from current stations (one “NHS” company).
    try {
      const data = await window.electronAPI.getStationData({});
      const norm = s => String(s ?? '').trim();
      const locs = uniq((data || []).map(s => norm(s.province || s.location || s.location_file)).filter(Boolean))
        .sort((a, b) => a.localeCompare(b));
      const assetsByLocation = {};
      (data || []).forEach(s => {
        const loc = norm(s.province || s.location || s.location_file || '');
        const at  = norm(s.asset_type || '');
        if (!loc || !at) return;
        (assetsByLocation[loc] ||= new Set()).add(at);
      });
      Object.keys(assetsByLocation).forEach(k => {
        assetsByLocation[k] = Array.from(assetsByLocation[k]).sort((a, b) => a.localeCompare(b));
      });
      const companies = locs.length ? ['NHS'] : [];
      return { companies, locationsByCompany: { 'NHS': locs }, assetsByLocation };
    } catch (e) {
      console.error('[filters] fallback build failed', e);
      return { companies: [], locationsByCompany: {}, assetsByLocation: {} };
    }
  }

  function render(tree) {
    filterTree.innerHTML = '';
    const frag = document.createDocumentFragment();

    const companies     = tree.companies || [];
    const locsByCompany = tree.locationsByCompany || {};
    const assetsByLoc   = tree.assetsByLocation || {};

    companies.forEach(company => {
      const co = el('details', { class: 'ft-company', open: '' });
      const coSummary = el('summary', { class: 'ft-row' },
        el('label', { class: 'ft-label' },
          el('input', {
            type: 'checkbox',
            class: 'filter-checkbox company',
            'data-company': company,
            checked: ''
          }),
          el('span', { class: 'ft-text' }, company)
        )
      );
      co.appendChild(coSummary);

      const locWrap = el('div', { class: 'ft-children' });
      (locsByCompany[company] || []).forEach(loc => {
        const locDet = el('details', { class: 'ft-location', open: '' });
        const locSum = el('summary', { class: 'ft-row' },
          el('label', { class: 'ft-label' },
            el('input', {
              type: 'checkbox',
              class: 'filter-checkbox location',
              value: loc,
              'data-company': company,
              checked: ''
            }),
            el('span', { class: 'ft-text' }, loc)
          )
        );
        locDet.appendChild(locSum);

        const atWrap = el('div', { class: 'ft-children' });
        (assetsByLoc[loc] || []).forEach(at => {
          const row = el('div', { class: 'ft-row ft-asset' },
            el('label', { class: 'ft-label' },
              el('input', {
                type: 'checkbox',
                class: 'filter-checkbox asset-type',
                value: at,
                'data-company': company,
                'data-location': loc,
                checked: ''
              }),
              el('span', { class: 'ft-text' }, at)
            )
          );
          atWrap.appendChild(row);
        });
        locDet.appendChild(atWrap);
        locWrap.appendChild(locDet);
      });
      co.appendChild(locWrap);
      frag.appendChild(co);
    });

    if (!companies.length) {
      frag.appendChild(
        el('div', { class: 'ft-empty' },
          'No filters yet — add a company to get started.')
      );
    }
    filterTree.appendChild(frag);
    filterTree.querySelectorAll('input.filter-checkbox').forEach(cb => { cb.checked = true; cb.indeterminate = false; });
    updateTriState(filterTree);
  }

  function updateTriState(scope) {
    // Location box reflects its asset-type children
    scope.querySelectorAll('details.ft-location').forEach(d => {
      const locCb = d.querySelector('input.location');
      const assetCbs = d.querySelectorAll('input.asset-type');
      if (!locCb || !assetCbs.length) return;
      const total = assetCbs.length;
      const checked = Array.from(assetCbs).filter(cb => cb.checked).length;
      locCb.indeterminate = checked > 0 && checked < total;
      locCb.checked = checked === total;
    });
    // Company box reflects all descendant locations/assets
    scope.querySelectorAll('details.ft-company').forEach(d => {
      const coCb = d.querySelector('input.company');
      if (!coCb) return;
      const assetCbs = d.querySelectorAll('input.asset-type');
      const locCbs   = d.querySelectorAll('input.location');
      const pool = assetCbs.length ? assetCbs : locCbs;
      const total = pool.length;
      if (!total) { coCb.indeterminate = false; coCb.checked = false; return; }
      const allChecked = Array.from(pool).every(cb => cb.checked);
      const anyChecked = Array.from(pool).some(cb => cb.checked);
      coCb.indeterminate = anyChecked && !allChecked;
      coCb.checked = allChecked;
    });
  }

  const dispatchChange = debounce(() => {
    // Let map_view/list_view listen and redraw
    filterTree.dispatchEvent(new Event('change', { bubbles: true }));
  }, 50);

  function onTreeChange(e) {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== 'checkbox') return;
    if (t.classList.contains('company')) {
      const details = t.closest('details.ft-company');
      if (details) {
        details.querySelectorAll('input.location, input.asset-type').forEach(cb => {
          cb.checked = t.checked; cb.indeterminate = false;
        });
      }
    } else if (t.classList.contains('location')) {
      const locDet = t.closest('details.ft-location');
      if (locDet) {
        locDet.querySelectorAll('input.asset-type').forEach(cb => { cb.checked = t.checked; });
      }
    }
    updateTriState(filterTree);
    dispatchChange();
  }

  async function build() {
    const tree = await fetchTree();
    render(tree);
    updateTriState(filterTree);
    // kick the world once so map/list sync with initial “all checked” state
    filterTree.dispatchEvent(new Event('change', { bubbles: true }));
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Top-of-drawer shortcuts open the wizard
    const openWizard = () => {
      const el = document.getElementById('navNewCompany');
      if (el) el.dispatchEvent(new Event('click', { bubbles: true }));
    };
    document.getElementById('btnAddCompany')?.addEventListener('click', openWizard);
    document.getElementById('btnAddLocation')?.addEventListener('click', openWizard);
    document.getElementById('btnAddAssetType')?.addEventListener('click', openWizard);

    filterTree.addEventListener('change', onTreeChange);
    build();
  });

  // Allow other modules (e.g., add_infra) to refresh the tree after upserts
  window.refreshFilters = build;
})();