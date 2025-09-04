// frontend/js/filters.js
// Collapsible, tri-state filter tree:
// Company ▸ Locations ▸ Asset Types, with blue checkboxes.
// FIXED: Prevents initial change event from clearing map pins
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
   
  // Remember the user's explicit choice for company/location checkboxes so
  // asset-type toggles can't visually override them later.
  function setUserChecked(cb, val) {
    if (!cb) return;
    cb.dataset.userchecked = val ? '1' : '0';
  }

  async function fetchTree() {
    // 1) Try Lookups first (source of truth for hierarchy)
    let treeFromLookups = null;
    try {
      if (window.electronAPI?.getLookupTree) {
        const t = await window.electronAPI.getLookupTree();
        if (t && Array.isArray(t.companies)) treeFromLookups = t;
      }
    } catch (e) {
      console.error('[filters] getLookupTree failed', e);
    }

    // 2) Always read current stations so we can union file-derived locations
    //    (ensures the filter UI contains values that actually exist on disk).
    let dataLocs = [], assetsByLocData = {};
    try {
      const data = await window.electronAPI.getStationData({});
      const norm = s => String(s ?? '').trim();
      dataLocs = uniq((data || [])
        .map(s => norm(s.province || s.location || s.location_file))
        .filter(Boolean)).sort((a, b) => a.localeCompare(b));
      (data || []).forEach(s => {
        const loc = norm(s.province || s.location || s.location_file || '');
        const at  = norm(s.asset_type || '');
        if (!loc || !at) return;
        (assetsByLocData[loc] ||= new Set()).add(at);
      });
      Object.keys(assetsByLocData).forEach(k => {
        assetsByLocData[k] = Array.from(assetsByLocData[k]).sort((a, b) => a.localeCompare(b));
      });
    } catch (e) {
      console.error('[filters] data introspection failed', e);
    }

    // 3) If we have a Lookups tree, merge in data-derived locations/assets.
    if (treeFromLookups && treeFromLookups.companies.length) {
      const tree = {
        companies: [...treeFromLookups.companies],
        locationsByCompany: { ...(treeFromLookups.locationsByCompany || {}) },
        assetsByLocation:   { ...(treeFromLookups.assetsByLocation   || {}) },
      };
      // Ensure there is a bucket to drop data-only locations into.
      if (!tree.companies.includes('NHS')) tree.companies.push('NHS');
      tree.locationsByCompany['NHS'] ||= [];

      dataLocs.forEach(loc => {
        const exists = Object.values(tree.locationsByCompany)
          .some(arr => Array.isArray(arr) && arr.includes(loc));
        if (!exists) {
          tree.locationsByCompany['NHS'].push(loc);
          tree.locationsByCompany['NHS'].sort((a,b)=>a.localeCompare(b));
        }
        if (!tree.assetsByLocation[loc]) {
          tree.assetsByLocation[loc] = assetsByLocData[loc] || [];
        }
      });
      return tree;
    }

    // 4) If no Lookups hierarchy yet, fall back to a simple inferred tree.
    const companies = dataLocs.length ? ['NHS'] : [];
    return { companies,
             locationsByCompany: dataLocs.length ? { 'NHS': dataLocs } : {},
             assetsByLocation: assetsByLocData };
  }

  // ADDED: Flag to track if this is the initial render
  let INITIAL_RENDER = true;

  function render(tree) {
    
    filterTree.innerHTML = '';
    const frag = document.createDocumentFragment();
    // mark UI as "not ready" while we build (map should ignore)
    filterTree.dataset.ready = '0';

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
    
    // Force a known-good starting state (EVERYTHING CHECKED) before we signal ready.
    const all = filterTree.querySelectorAll('input.filter-checkbox');
    all.forEach(cb => { cb.checked = true; cb.indeterminate = false; });

    // Initialize user intent on parents as "checked"
    filterTree.querySelectorAll('input.company, input.location').forEach(cb => {
      setUserChecked(cb, true);
    });
    // Paint parent visuals from remembered user intent
    updateTriState(filterTree);

    // CRITICAL FIX: Only fire initial change event after map has had time to render
    requestAnimationFrame(() => {
      filterTree.dataset.ready = '1';
      
      // FIXED: Don't fire change event on initial render - let the map render first
      if (!INITIAL_RENDER) {
        filterTree.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        // Mark initial render as complete, future renders will fire change events
        INITIAL_RENDER = false;
        
        // OPTIONAL: Fire change event after a longer delay to allow map to fully render
        setTimeout(() => {
          filterTree.dispatchEvent(new Event('change', { bubbles: true }));
        }, 3000); // 3 second delay to ensure map is fully rendered
      }
    });
  }

  function updateTriState(scope) {
    // Keep Company/Location visual state exactly as the user last set it.
    // Do NOT flip parent .checked when children change; avoid indeterminate dash.

    // Restore user's last explicit choice on locations
    scope.querySelectorAll('input.location').forEach(locCb => {
      const mark = locCb.dataset.userchecked;
      if (mark != null) locCb.checked = (mark === '1');
      locCb.indeterminate = false; // no dash visuals
    });

    // Restore user's last explicit choice on companies
    scope.querySelectorAll('input.company').forEach(coCb => {
      const mark = coCb.dataset.userchecked;
      if (mark != null) coCb.checked = (mark === '1');
      coCb.indeterminate = false; // no dash visuals
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
      // Remember user's explicit company choice
      setUserChecked(t, t.checked);
      if (details) {
        // Cascade visual + value to all descendants
        details.querySelectorAll('input.location, input.asset-type').forEach(cb => {
          cb.checked = t.checked; cb.indeterminate = false;
        });
        // CRITICAL: also remember user's intent for all descendant LOCATIONS,
        // so updateTriState() doesn't restore an old "off" state after a company toggle.
        details.querySelectorAll('input.location').forEach(locCb => {
          setUserChecked(locCb, t.checked);
        });
      }
    } else if (t.classList.contains('location')) {
      const locDet = t.closest('details.ft-location');
      setUserChecked(t, t.checked); // remember user's explicit location choice
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
    // tri-state is handled in render(); initial change may fire after delay
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
