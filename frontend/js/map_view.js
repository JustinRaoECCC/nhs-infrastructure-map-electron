// frontend/js/map_view.js - FINAL FIX
// The issue is in the filter evaluation logic during full render

'use strict';

const debounce = (fn, ms = 150) => {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

function isFiniteCoord(v) {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= 180;
}

// ────────────────────────────────────────────────────────────────────────────
// Map bootstrap vars
// ────────────────────────────────────────────────────────────────────────────
let map;                 // Leaflet map
let markersLayer;        // Layer group for pins
let canvasRenderer;      // Canvas renderer instance
let mapStationData = []; // we'll reload this from disk every refresh
let FAST_BOOT = true;           // first couple seconds: simple pins, limited count
const MAX_INITIAL_PINS = 800;   // tune for your dataset
let DID_FIT_BOUNDS = false;     // only fit once on first real data
let RENDER_IN_PROGRESS = false; // Prevent concurrent renders

// ────────────────────────────────────────────────────────────────────────────
// Init (same as before)
// ────────────────────────────────────────────────────────────────────────────
function initMap() {
  console.log('[map] initMap()');

  const mapEl = document.getElementById('map');
  const mapCol = document.getElementById('mapContainer');

  if (!mapEl || !mapCol) {
    console.error('[map] map elements missing');
    return;
  }

  const ensureColumnWidth = () => {
    const w = mapCol.offsetWidth;
    const h = mapCol.offsetHeight;
    console.log('[map] container dims (pre-init): ' + JSON.stringify({ width: w, height: h }));
    if (w === 0) {
      console.warn('[map] map column width is 0 — forcing min widths');
      mapCol.style.minWidth = '400px';
      mapCol.style.width = '100%';
      mapEl.style.width = '100%';
    }
  };
  ensureColumnWidth();

  map = L.map('map', {
    maxBounds: [[-90, -180], [90, 180]],
    maxBoundsViscosity: 1.0,
    zoomControl: true
  }).setView([54.5, -119], 5);

  function addTiles() {
    try {
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        noWrap: true
      }).addTo(map);
    } catch (e) {
      console.warn('[map] tile layer add failed, retrying shortly…', e);
      setTimeout(() => {
        try {
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            noWrap: true
          }).addTo(map);
        } catch (e2) {
          console.error('[map] tile layer final failure', e2);
        }
      }, 500);
    }
  }
  addTiles();

  const maskPane = map.createPane('maskPane');
  maskPane.style.zIndex = 350;

  (function addGreyMask() {
    const bounds = map.options.maxBounds;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const outer = [[-90,-360],[90,-360],[90,360],[-90,360]];
    const inner = [[sw.lat, sw.lng],[sw.lat, ne.lng],[ne.lat, ne.lng],[ne.lat, sw.lng]];
    L.polygon([outer, inner], {
      pane: 'maskPane',
      fillRule: 'evenodd',
      fillColor: '#DDD',
      fillOpacity: 1,
      stroke: false,
      interactive: false
    }).addTo(map);
  })();

  canvasRenderer = L.canvas({ 
    pane: 'markerPane', 
    padding: 0.5,
    tolerance: 0
  });
  
  markersLayer = L.layerGroup();
  markersLayer.addTo(map);
  
  console.log('[map] markers layer and canvas renderer ready');

  const ensureMapSize = () => {
    try {
      map.invalidateSize();
    } catch (_) {}
  };

  const resizeObs = new ResizeObserver(() => {
    if (mapCol.offsetWidth === 0) {
      mapCol.style.minWidth = '400px';
      mapCol.style.width = '100%';
      mapEl.style.width = '100%';
    }
    ensureMapSize();
  });
  resizeObs.observe(mapCol);

  setTimeout(ensureMapSize, 0);
  window.addEventListener('load', () => setTimeout(ensureMapSize, 0));
  window.addEventListener('resize', ensureMapSize);

  const drawer = document.getElementById('filterDrawer');
  if (drawer) {
    new MutationObserver(() => setTimeout(ensureMapSize, 120))
      .observe(drawer, { attributes:true, attributeFilter:['class'] });
  }

  map.on('click', () => {
    const container = document.getElementById('station-details');
    if (container) container.innerHTML = `<p><em>Click a pin to see details</em></p>`;
  });

  map.on('tileload', () => {});
  map.on('tileerror', (e) => {
    console.error('[map] tile error', e);
  });

  setTimeout(ensureMapSize, 300);
  setTimeout(ensureMapSize, 800);
}

// ────────────────────────────────────────────────────────────────────────────
// FIXED: Improved filter state detection
// ────────────────────────────────────────────────────────────────────────────
function getActiveFilters() {
  const norm = s => String(s ?? '').trim().toLowerCase();
  const locCbs = Array.from(document.querySelectorAll('.filter-checkbox.location'));
  const atCbs  = Array.from(document.querySelectorAll('.filter-checkbox.asset-type'));
  
  // CRITICAL FIX: Handle case where checkboxes exist but aren't checked yet
  const locations = new Set();
  const assetTypes = new Set();
  
  locCbs.forEach(cb => {
    if (cb.checked) locations.add(norm(cb.value));
  });
  
  atCbs.forEach(cb => {
    if (cb.checked) assetTypes.add(norm(cb.value));
  });
  
  const allLocationsSelected  = locCbs.length > 0 && locations.size === locCbs.length;
  const allAssetTypesSelected = atCbs.length  > 0 && assetTypes.size === atCbs.length;
  
  console.log('[map] Filter state:', {
    locCbs: locCbs.length,
    atCbs: atCbs.length,
    locationsSelected: locations.size,
    assetTypesSelected: assetTypes.size,
    allLocationsSelected,
    allAssetTypesSelected
  });
  
  return { locations, assetTypes, allLocationsSelected, allAssetTypesSelected, totalLocs: locCbs.length, totalAts: atCbs.length, _norm: norm };
}

// Check if filters are actually restricting anything
function areFiltersActuallyRestricting() {
  const filterTreeEl = document.getElementById('filterTree');
  
  // If no filter tree, no restriction
  if (!filterTreeEl || filterTreeEl.dataset.ready !== '1') {
    console.log('[map] Filters not ready, no restriction');
    return false;
  }
  
  const { locations, assetTypes, totalLocs, totalAts } = getActiveFilters();
  
  // If no checkboxes exist yet, no restriction
  if (totalLocs === 0 && totalAts === 0) {
    console.log('[map] No filter checkboxes exist, no restriction');
    return false;
  }
  
  // If nothing is selected *but checkboxes exist*, that's an active restriction (show none)
  if ((totalLocs + totalAts) > 0 && locations.size === 0 && assetTypes.size === 0) {
    console.log('[map] Nothing selected => restriction (show none)');
    return true;
  }
  
  // If everything is selected, no restriction
  if ((totalLocs === 0 || locations.size === totalLocs) && 
      (totalAts === 0 || assetTypes.size === totalAts)) {
    console.log('[map] Everything selected in filters, no restriction');
    return false;
  }
  
  // Otherwise, we are restricting
  console.log('[map] Filters are actively restricting');
  return true;
}

function addTriRingMarker(lat, lon, color) {
  const rCore = FAST_BOOT ? 3 : 4;
  const ringBlack = 1;
  const ringWhite = 1;

  if (!FAST_BOOT) {
    const outer = L.circleMarker([lat, lon], {
      renderer: canvasRenderer,
      radius: rCore + ringWhite + (ringBlack * 0.5),
      color: '#000',
      weight: ringBlack,
      fill: false,
      interactive: false
    });

    const mid = L.circleMarker([lat, lon], {
      renderer: canvasRenderer,
      radius: rCore + (ringWhite * 0.5),
      color: '#fff',
      weight: ringWhite,
      fill: false,
      interactive: false
    });
    
    outer.addTo(markersLayer);
    mid.addTo(markersLayer);
  }

  const inner = L.circleMarker([lat, lon], {
    renderer: canvasRenderer,
    radius: rCore,
    fill: true,
    fillColor: color || '#4b5563',
    fillOpacity: 1,
    stroke: false,
    interactive: true
  });

  inner.addTo(markersLayer);
  return inner;
}

function showStationDetails(stn) {
  const container = document.getElementById('station-details');
  if (!container) return;

  const placeholder = container.querySelector('p');
  if (placeholder) placeholder.remove();

  let body = container.querySelector('.station-details-body');
  if (!body) {
    body = document.createElement('div');
    body.className = 'station-details-body';
    container.appendChild(body);
  }

  const fixedOrder = [
    ['Station ID', stn.station_id],
    ['Category',   stn.asset_type],
    ['Site Name',  stn.name],
    ['Province',   stn.province],
    ['Latitude',   stn.lat],
    ['Longitude',  stn.lon],
    ['Status',     stn.status],
  ];

  const extras = {};
  const SEP = ' – ';
  Object.keys(stn || {}).forEach(k => {
    if (!k.includes(SEP)) return;
    const [section, field] = k.split(SEP);
    (extras[section] ||= {})[field] = stn[k];
  });

  // Filter out fields from an imported "General Information" section that are already
  // displayed in the main General Information table above.
  const GI_NAME = 'general information';
  const GI_SHOWN_FIELDS = new Set([
    'station id', 'category',
    // Treat Station Name == Site Name
    'site name', 'station name',
    'province', 'latitude', 'longitude', 'status'
  ]);
  Object.keys(extras).forEach(sectionName => {
    if (String(sectionName).trim().toLowerCase() !== GI_NAME) return;
    const filtered = {};
    Object.entries(extras[sectionName] || {}).forEach(([fld, val]) => {
      const key = String(fld).trim().toLowerCase();
      if (!GI_SHOWN_FIELDS.has(key)) filtered[fld] = val;
    });
    if (Object.keys(filtered).length) extras[sectionName] = filtered;
    else delete extras[sectionName]; // nothing left to show for imported GI
  });

  let html = '';
  html += '<div class="station-section">';
  html += '<h3>General Information</h3><table>';
  fixedOrder.forEach(([label, val]) => {
    html += `<tr><th>${label}:</th><td>${val ?? ''}</td></tr>`;
  });
  html += '</table></div>';

  Object.entries(extras).forEach(([section, fields]) => {
    const title =
      String(section).trim().toLowerCase() === GI_NAME
        ? 'Extra General Information'
        : section;
    html += `<div class="station-section"><h3>${title}</h3><table>`;
    Object.entries(fields).forEach(([fld, val]) => {
      html += `<tr><th>${fld}:</th><td>${val ?? ''}</td></tr>`;
    });
    html += '</table></div>';
  });

  body.innerHTML = html;
}

window.showStationDetails = window.showStationDetails || showStationDetails;

// ────────────────────────────────────────────────────────────────────────────
// FIXED: Completely rewritten filter logic
// ────────────────────────────────────────────────────────────────────────────
async function refreshMarkers() {
  if (RENDER_IN_PROGRESS) {
    console.log('[map] Refresh already in progress, skipping');
    return;
  }
  
  RENDER_IN_PROGRESS = true;
  console.log('[map] refreshMarkers called, FAST_BOOT:', FAST_BOOT);
  
  try {
    // Load station data
    if (typeof window.electronAPI?.getStationData === 'function') {
      mapStationData = await window.electronAPI.getStationData(
        FAST_BOOT ? { skipColors: true } : {}
      );
    }

    // Validate coordinates
    const allValid = (mapStationData || []).filter(stn => {
      const lat = Number(stn.lat), lon = Number(stn.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) &&
             Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    });

    console.log('[map] Valid stations with coords:', allValid.length);

    // CRITICAL FIX: Default to showing ALL stations, only filter if explicitly restricting
    let filtered = allValid;
    
    // Only apply filters if they are actually restricting something
    if (areFiltersActuallyRestricting()) {
      const { locations, assetTypes, totalLocs, totalAts, _norm } = getActiveFilters();
      
      console.log('[map] Applying active filters');
      
      filtered = allValid.filter(stn => {
        // Location filter
        let locOk = true;
        if (locations.size > 0) {
          const locCandidates = [
            _norm(stn.province),
            _norm(stn.location),
            _norm(stn.location_file)
          ].filter(Boolean);
          locOk = locCandidates.some(v => locations.has(v));
        } else if (totalLocs > 0) {
          // Nothing selected but location filters exist => exclude all by location
          locOk = false;
        }
        
        // Asset type filter
        let atOk = true;
        if (assetTypes.size > 0) {
          atOk = assetTypes.has(_norm(stn.asset_type));
        } else if (totalAts > 0) {
          // Nothing selected but asset-type filters exist => exclude all by asset type
          atOk = false;
        }
        
        return locOk && atOk;
      });
      
      console.log('[map] After filtering:', filtered.length, 'stations');
    } else {
      console.log('[map] No active filters, showing all', filtered.length, 'stations');
    }

    // Fast-boot trimming for initial render performance
    let rows = filtered;
    if (FAST_BOOT && map) {
      const inView = [];
      const b = map.getBounds();
      for (const stn of filtered) {
        if (b.contains([Number(stn.lat), Number(stn.lon)])) inView.push(stn);
        if (inView.length >= MAX_INITIAL_PINS) break;
      }
      rows = inView.length ? inView : filtered.slice(0, MAX_INITIAL_PINS);
    }

    console.log('[map] Drawing', rows.length, 'markers');

    // Clear existing markers
    markersLayer.clearLayers();
    
    // Small delay to ensure canvas is ready
    await new Promise(resolve => setTimeout(resolve, 10));

    // Draw markers
    const batchSize = 200;
    let markersAdded = 0;
    
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      
      for (const stn of batch) {
        const lat = Number(stn.lat);
        const lon = Number(stn.lon);
        
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

        try {
          const marker = addTriRingMarker(lat, lon, stn.color);
          if (marker) {
            marker.bindPopup(
              `<a href="#" class="popup-link" data-id="${stn.station_id}">${stn.name || stn.station_id}</a>`
            );

            marker.on('click', (e) => {
              if (e.originalEvent && e.originalEvent.target.tagName === 'A') return;
              marker.openPopup();
              showStationDetails(stn);
            });

            marker.on('popupopen', () => {
              const link = document.querySelector('.leaflet-popup a.popup-link');
              if (link) {
                link.addEventListener('click', (ev) => {
                  ev.preventDefault();
                  if (window.loadStationPage) window.loadStationPage(stn.station_id);
                }, { once: true });
              }
            });
            
            markersAdded++;
          }
        } catch (error) {
          console.error('[map] Error adding marker for station:', stn.station_id, error);
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    
    console.log('[map] Successfully added', markersAdded, 'markers to map');

    // Fit bounds once
    if (!DID_FIT_BOUNDS && filtered.length && map) {
      const latlngs = filtered.map(s => [Number(s.lat), Number(s.lon)]);
      try {
        map.fitBounds(latlngs, { padding: [24, 24] });
        DID_FIT_BOUNDS = true;
        console.log('[map] Bounds fitted');
      } catch (e) {
        console.error('[map] Error fitting bounds:', e);
      }
    }

  } catch (err) {
    console.error('[map_view] refreshMarkers failed:', err);
  } finally {
    RENDER_IN_PROGRESS = false;
    try { 
      map.invalidateSize(); 
    } catch(_) {}
  }
}

const debouncedRefreshMarkers = debounce(refreshMarkers, 200);
window.refreshMarkers = debouncedRefreshMarkers;

window.invalidateStationData = function invalidateStationData() {
  try { 
    mapStationData = []; 
  } catch (_) {}
};

// ────────────────────────────────────────────────────────────────────────────
function bindGlobalImportToolbar() {
  const btn  = document.getElementById('btnImportDataGlobal');
  const file = document.getElementById('fileImportDataGlobal');
  if (!btn || !file) return;

  if (!btn.dataset.bound) {
    btn.addEventListener('click', () => file.click());
    btn.dataset.bound = '1';
  }
  if (!file.dataset.bound) {
    file.addEventListener('change', async (e) => {
      const f = (e.target.files || [])[0];
      if (!f) return;
      try {
        const b64 = await new Promise((resolve, reject) => {
          const rdr = new FileReader();
          rdr.onload = () => {
            const s = String(rdr.result || '');
            const i = s.indexOf(',');
            resolve(i >= 0 ? s.slice(i + 1) : s);
          };
          rdr.onerror = reject;
          rdr.readAsDataURL(f);
        });

        const res = await window.electronAPI.importMultipleStations(b64);
        if (!res || !res.success) {
          alert('Import failed: ' + (res?.message || 'Unknown error'));
          return;
        }

        if (typeof window.invalidateStationData === 'function') window.invalidateStationData();
        if (typeof window.electronAPI.invalidateStationCache === 'function') {
          await window.electronAPI.invalidateStationCache();
        }

        await refreshMarkers();
        if (typeof window.renderList === 'function') await window.renderList();
      } catch (err) {
        console.error('[GlobalImport] unexpected error:', err);
        alert('Unexpected error during import. See console.');
      } finally {
        e.target.value = '';
      }
    });
    file.dataset.bound = '1';
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Startup
// ────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const boot = () => {
    if (!window.L || typeof L.map !== 'function') {
      console.error('[map] Leaflet still undefined at boot');
      return;
    }
    console.log('[map] booting with Leaflet', L.version);

    initMap();
    bindGlobalImportToolbar();

    console.log('[map] Starting initial fast render');
    refreshMarkers();

    const filterTree = document.getElementById('filterTree');
    if (filterTree) {
      filterTree.addEventListener('change', () => {
        console.log('[map] Filter change detected, refreshing markers');
        debouncedRefreshMarkers();
      });
    }

    // Switch to full render mode
    setTimeout(async () => {
      console.log('[map] Switching to full render mode');
      FAST_BOOT = false;
      
      try {
        if (typeof window.electronAPI?.getStationData === 'function') {
          mapStationData = await window.electronAPI.getStationData({});
        }
      } catch (e) {
        console.error('[map] Error reloading station data:', e);
      }
      
      await refreshMarkers();
    }, 2000);

    setTimeout(() => { try { map.invalidateSize(); } catch(_) {} }, 500);
    setTimeout(() => { try { map.invalidateSize(); } catch(_) {} }, 1000);
  };

  (function waitForLeaflet(tries = 0){
    if (window.L && typeof window.L.map === 'function') {
      console.log('[map] Leaflet detected, starting boot');
      boot();
    } else if (tries < 60) {
      setTimeout(() => waitForLeaflet(tries + 1), 50);
    } else {
      console.error('[map] Leaflet failed to load');
    }
  })();
});