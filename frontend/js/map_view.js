// frontend/js/map_view.js
// Full Map View (Electron) — Leaflet + filters + quick-view + global import
// (psst: invisible hogs fixed your 0-width lane)

// ────────────────────────────────────────────────────────────────────────────
// Strict mode & utilities
// ────────────────────────────────────────────────────────────────────────────
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
let mapStationData = []; // in-memory copy for quick redraws

// ────────────────────────────────────────────────────────────────────────────
// Init
// ────────────────────────────────────────────────────────────────────────────
function initMap() {
  console.log('[map] initMap()');

  const mapEl = document.getElementById('map');
  const mapCol = document.getElementById('mapContainer');

  if (!mapEl || !mapCol) {
    console.error('[map] map elements missing');
    return;
  }

  // Hard guards vs 0 width columns due to grid sizing
  // (win-condition: the center column must have a measurable width)
  const ensureColumnWidth = () => {
    const w = mapCol.offsetWidth;
    const h = mapCol.offsetHeight;
    console.log('[map] container dims (pre-init): ' + JSON.stringify({ width: w, height: h }));
    if (w === 0) {
      console.warn('[map] map column width is 0 — forcing min widths');
      mapCol.style.minWidth = '400px';
      mapCol.style.width = '100%';
      // Also ensure #map fills whatever we give it
      mapEl.style.width = '100%';
    }
  };
  ensureColumnWidth();

  // Create map
  map = L.map('map', {
    maxBounds: [[-90, -180], [90, 180]],
    maxBoundsViscosity: 1.0,
    zoomControl: true
  }).setView([54.5, -119], 5);

  // Basemap
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    noWrap: true
  }).addTo(map);
  console.log('[map] tile layer added');

  // Grey outside maxBounds
  (function addGreyMask() {
    const bounds = map.options.maxBounds;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const outer = [[-90,-360],[90,-360],[90,360],[-90,360]];
    const inner = [[sw.lat, sw.lng],[sw.lat, ne.lng],[ne.lat, ne.lng],[ne.lat, sw.lng]];
    L.polygon([outer, inner], {
      fillRule:'evenodd', fillColor:'#DDD', fillOpacity:1, stroke:false, interactive:false
    }).addTo(map);
  })();

  // Markers layer
  canvasRenderer = L.canvas({ padding: 0.5 });
  markersLayer = L.layerGroup().addTo(map);
  console.log('[map] markers layer ready');

  // Resizing — keep the map fresh after layout changes
  const ensureMapSize = () => {
    try {
      map.invalidateSize();
      const dims = { w: mapEl.offsetWidth, h: mapEl.offsetHeight };
      // Rage Barbarian: log once in a while
      // console.log('[map] invalidateSize()', dims);
    } catch (_) {}
  };

  // Observe column size changes (e.g., when filters drawer opens)
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

  // Also watch the drawer toggles
  const drawer = document.getElementById('filterDrawer');
  if (drawer) {
    new MutationObserver(() => setTimeout(ensureMapSize, 120))
      .observe(drawer, { attributes:true, attributeFilter:['class'] });
  }

  // Click map clears right panel placeholder
  map.on('click', () => {
    const container = document.getElementById('station-details');
    if (container) container.innerHTML = `<p><em>Click a pin to see details</em></p>`;
  });

  map.on('tileload', () => {
    // Mini Pekka approves.
  });
  map.on('tileerror', (e) => {
    console.error('[map] tile error', e);
  });

  // A couple more reflows for late fonts/GPU
  setTimeout(ensureMapSize, 300);
  setTimeout(ensureMapSize, 800);
}

// ────────────────────────────────────────────────────────────────────────────
// Filters state
// ────────────────────────────────────────────────────────────────────────────
function getActiveFilters() {
  const locations = Array
    .from(document.querySelectorAll('.filter-checkbox.location:checked'))
    .map(cb => cb.value);
  const assetTypes = Array
    .from(document.querySelectorAll('.filter-checkbox.asset-type:checked'))
    .map(cb => cb.value);
  return { locations, assetTypes };
}

// ────────────────────────────────────────────────────────────────────────────
// Icons & station details
// ────────────────────────────────────────────────────────────────────────────
// Pretty tri-ring pin: thin BLACK outer ring -> slightly thicker WHITE ring -> COLORED core
// Returns the top (interactive) inner marker so we can bind popups/clicks.
function addTriRingMarker(lat, lon, color) {
  const rCore = 4;                 // center radius
  const ringBlack = 1;     // very thin black outline
  const ringWhite = 1;     // slightly thicker white ring than black

  // Outer black ring (no fill)
  const outer = L.circleMarker([lat, lon], {
    renderer: canvasRenderer,
    radius: rCore + ringWhite + (ringBlack * 0.5),
    color: '#000',
    weight: ringBlack,
    fill: false
  });

  // Inner white ring (no fill)
  const mid = L.circleMarker([lat, lon], {
    renderer: canvasRenderer,
    radius: rCore + (ringWhite * 0.5),
    color: '#fff',
    weight: ringWhite,
    fill: false
  });

  // Colored core (fill only)
  const inner = L.circleMarker([lat, lon], {
    renderer: canvasRenderer,
    radius: rCore,
    fill: true,
    fillColor: color || '#4b5563',
    fillOpacity: 1,
    stroke: false
  });

  // Add all three; return the interactive top layer
  outer.addTo(markersLayer);
  mid.addTo(markersLayer);
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

  let html = '';
  html += '<div class="station-section">';
  html += '<h3>General Information</h3><table>';
  fixedOrder.forEach(([label, val]) => {
    html += `<tr><th>${label}:</th><td>${val ?? ''}</td></tr>`;
  });
  html += '</table></div>';

  Object.entries(extras).forEach(([section, fields]) => {
    html += `<div class="station-section"><h3>${section}</h3><table>`;
    Object.entries(fields).forEach(([fld, val]) => {
      html += `<tr><th>${fld}:</th><td>${val ?? ''}</td></tr>`;
    });
    html += '</table></div>';
  });

  body.innerHTML = html;
}

window.showStationDetails = window.showStationDetails || showStationDetails;

// ────────────────────────────────────────────────────────────────────────────
// Markers
// ────────────────────────────────────────────────────────────────────────────
async function refreshMarkers() {
  try {
    mapStationData = await window.electronAPI.getStationData();

    markersLayer.clearLayers();
    const { locations, assetTypes } = getActiveFilters();

    const rows = mapStationData || [];
    const batchSize = 1000; // yield every N to keep UI responsive
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      batch.forEach(stn => {
        const lat = parseFloat(stn.lat);
        const lon = parseFloat(stn.lon);
        if (!isFiniteCoord(lat) || !isFiniteCoord(lon)) return;

        if (locations.length && !locations.includes(stn.province)) return;
        if (assetTypes.length && !assetTypes.includes(stn.asset_type)) return;

        const marker = addTriRingMarker(lat, lon, stn.color);
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
      });
      // yield to the renderer so first paint isn’t blocked
      /* eslint-disable no-await-in-loop */
      await new Promise(r => setTimeout(r, 0));
    }

  } catch (err) {
    console.error('[map_view] refreshMarkers failed:', err);
  } finally {
    try { map.invalidateSize(); } catch(_) {}
  }
}
window.refreshMarkers = debounce(refreshMarkers, 50);

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

        if (typeof window.electronAPI.invalidateStationCache === 'function') {
          window.electronAPI.invalidateStationCache();
        }

        await window.refreshMarkers();
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

    setTimeout(() => window.refreshMarkers(), 0);

    // Extra reflows to handle late layout/font/GPU changes
    setTimeout(() => { try { map.invalidateSize(); } catch(_) {} }, 300);
    setTimeout(() => { try { map.invalidateSize(); } catch(_) {} }, 800);

    // Re-render when filters change
    const filterTree = document.getElementById('filterTree');
    if (filterTree) {
      filterTree.addEventListener('change', () => window.refreshMarkers());
    }
  };

  // Poll until Leaflet is present (handles slow disk/IO)
  (function waitForLeaflet(tries = 0){
    if (window.L && typeof window.L.map === 'function') {
      console.log('[map] Leaflet detected, boot now');
      boot();
    } else if (tries < 60) {
      setTimeout(() => waitForLeaflet(tries + 1), 50);
    } else {
      console.error('[map] Leaflet failed to load — check vendor copy or CDN reachability.');
    }
  })();
});
