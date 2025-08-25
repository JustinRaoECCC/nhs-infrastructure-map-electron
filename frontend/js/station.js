// frontend/js/station.js
async function loadStationPage(stationId) {
  // Fetch station data
  const all = await window.electronAPI.getStationData();
  const stn = (all || []).find(s => String(s.station_id) === String(stationId));
  if (!stn) return alert('Station not found: ' + stationId);

  // Load HTML
  const container = document.getElementById('stationContentContainer');
  const mainMap  = document.getElementById('mapContainer');
  const listCont = document.getElementById('listContainer');
  const dashboardCont = document.getElementById('dashboardContentContainer');

  const resp = await fetch('station_specific.html');
  const html = await resp.text();
  container.innerHTML = html;

  // Show station view, hide others
  if (mainMap) mainMap.style.display = 'none';
  if (listCont) listCont.style.display = 'none';
  if (dashboardCont) dashboardCont.style.display = 'none';
  container.style.display = 'block';

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

  // Back button
  const backBtn = container.querySelector('#backButton');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      container.style.display = 'none';
      if (mainMap) mainMap.style.display = 'block';
      if (listCont) listCont.style.display = ''; // let CSS handle
    });
  }
}

// expose
window.loadStationPage = loadStationPage;
