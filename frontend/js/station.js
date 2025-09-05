// frontend/js/station.js
async function loadStationPage(stationId, origin = 'map') {
  // Fetch station data
  const all = await window.electronAPI.getStationData();
  const stn = (all || []).find(s => String(s.station_id) === String(stationId));
  if (!stn) return alert('Station not found: ' + stationId);

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
  // Remember where we came from
  container.dataset.origin = origin === 'list' ? 'list' : 'map';
  if (mainMap) mainMap.style.display = 'none';
  if (listCont) listCont.style.display = 'none';
  if (dashboardCont) dashboardCont.style.display = 'none';
  container.style.display = 'block';
  // Hide the RHS quick-view panel while in the station page
  if (rightPanel) rightPanel.style.display = 'none';

  // Populate basics
  const setVal = (id, v) => { const el = container.querySelector('#'+id); if (el) el.value = v ?? ''; };
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
  (function setHeaderPills() {
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
  })();

  // Photos: simple placeholders for now
  (function renderPhotoPlaceholders() {
    const row = container.querySelector('#photosRow');
    if (!row) return;
    row.innerHTML = '';
    const N = 5;
   for (let i = 0; i < N; i++) {
      const d = document.createElement('div');
      d.className = 'photo-thumb skeleton';
      row.appendChild(d);
    }
  })();

  // Lightbox helpers (one-time wiring for this page)
  function setupPhotoLightbox() {
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
    }, { once: false });

    // return opener so renderRecentPhotos can use it
    return openLightbox;
  }
  const openLightbox = setupPhotoLightbox();

  // Fetch and render recent photos for this station — only in the "Recent Photos" strip
  (async function renderRecentPhotos() {
    const row = container.querySelector('#photosRow');
    try {
      const photos = await window.electronAPI.getRecentPhotos(stn.name, stn.station_id, 5);
      if (!row) return;
      row.innerHTML = '';

      if (!photos || photos.length === 0) {
        row.innerHTML = '<div class="photo-empty">No photos found</div>';
      } else {
        for (const p of photos) {
          const a = document.createElement('a');
          a.href = p.url;                       // keep for right-click "Open in new tab"
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

        // Open lightbox in-place instead of a new window
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
  })();

  // Collapsible Extra Sections (accordion), same grouping as RHS quick view
  (function renderExtrasAccordion() {
    const host = container.querySelector('#extraAccordion');
    if (!host) return;
    const SEP = ' – ';

    // Build groups from keys like "Section – Field"
    const extras = {};
    Object.keys(stn || {}).forEach(k => {
      if (!k.includes(SEP)) return;
      const [section, field] = k.split(SEP);
      (extras[String(section).trim()] ||= {})[field] = stn[k];
    });

    // Remove duplicates already shown in Site Information (formerly General Information)
    const GI_NAME = 'general information';
    const GI_SHOWN_FIELDS = new Set(['station id','category','site name','station name','province','latitude','longitude','status']);
    Object.keys(extras).forEach(sectionName => {
      if (String(sectionName).trim().toLowerCase() !== GI_NAME) return;
      const filtered = {};
      Object.entries(extras[sectionName]).forEach(([fld, val]) => {
        if (!GI_SHOWN_FIELDS.has(String(fld).trim().toLowerCase())) filtered[fld] = val;
      });
      if (Object.keys(filtered).length) extras[sectionName] = filtered;
      else delete extras[sectionName];
    });

    // Render accordion items as pretty stacked rows (label over value)
    const escape = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    const fmt = (v) => (v === null || v === undefined || String(v).trim() === '') ? '<span class="kv-empty">—</span>' : escape(v);
    const toRows = (fields) => {
      let rows = '';
      Object.entries(fields).forEach(([fld, val]) => {
        rows += `
          <li class="kv-row">
            <div class="kv-label">${escape(fld)}</div>
            <div class="kv-value">${fmt(val)}</div>
          </li>`;
      });
      return `<ul class="kv-list">${rows}</ul>`;
    };

    let html = '';
    Object.entries(extras).forEach(([section, fields]) => {
      const title = String(section).trim().toLowerCase() === GI_NAME ? 'Extra General Information' : section;
      html += `
        <div class="accordion-item">
          <button type="button" class="accordion-header">${title}<span class="chev"></span></button>
          <div class="accordion-content">${toRows(fields)}</div>
        </div>`;
    });
    host.innerHTML = html;

    // Bind toggles
    host.querySelectorAll('.accordion-item .accordion-header').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.accordion-item');
        item.classList.toggle('open');
      });
    });
  })();

  // Back button
  const backBtn = container.querySelector('#backButton');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      container.style.display = 'none';
      const from = container.dataset.origin || 'map';
      if (from === 'list') {
        if (listCont) listCont.style.display = '';    // return to list
        if (mainMap)  mainMap.style.display  = 'none';
      } else {
        if (mainMap)  mainMap.style.display  = 'block'; // return to map
        if (listCont) listCont.style.display = 'none';
      }
      // Restore RHS quick-view panel
      if (rightPanel) rightPanel.style.display = '';
    });
  }
}

// expose
window.loadStationPage = loadStationPage;
