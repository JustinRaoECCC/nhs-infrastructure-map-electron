// frontend/js/add_infra.js
// Pure-frontend wizard for "+ New Company" (Create Company → Project → Assets → Select data)
// (psst: invisible hogs ensure smooth step transitions)
(function () {
  const navNewCompany = document.getElementById('navNewCompany');
  const mapContainer  = document.getElementById('mapContainer');
  const rightPanel    = document.getElementById('rightPanel');
  const mount         = document.getElementById('addInfraContainer');

  if (!navNewCompany || !mount) return;

  async function openWizard() {
    mount.style.gridColumn = '2 / 4';
    // load the partial HTML
    try {
      const resp = await fetch('add_infra.html', { cache: 'no-store' });
      if (!resp.ok) throw new Error('Failed to load add_infra.html');
      mount.innerHTML = await resp.text();
    } catch (e) {
      console.error('[AddInfra] load failed:', e);
      return;
    }
    // show wizard, hide map/right panel
    if (mapContainer) mapContainer.style.display = 'none';
    if (rightPanel)   rightPanel.style.display   = 'none';
    mount.style.display = 'block';
    mount.setAttribute('aria-expanded', 'true');
    initWizard(mount);
  }

  function closeWizard() {
    mount.style.display = 'none';
    if (mapContainer) mapContainer.style.display = 'block';
    if (rightPanel)   rightPanel.style.display   = '';
    mount.removeAttribute('aria-expanded');
    mount.innerHTML = ''; // cleanup
  }

  function initWizard(root) {
    // scoped queries inside the injected HTML
    const stepsEl     = root.querySelector('#wizSteps');
    const stepPanels  = Array.from(root.querySelectorAll('.wizard-step'));
    const btnBack     = root.querySelector('#wizBack');
    const btnCancel   = root.querySelector('#wizCancel');
    const btnNext     = root.querySelector('#wizNext');

    const projectExcel    = root.querySelector('#projectExcel');
    const projectExcelLbl = root.querySelector('#projectExcelLabel');
    const sheetSelect     = root.querySelector('#sheetSelect');

    let current = 0;          // step index 0..3
    let excelFile = null;     // File object
    let sheetNames = [];      // from Excel if available

    function setActive(idx) {
      current = Math.max(0, Math.min(stepPanels.length - 1, idx));
      stepPanels.forEach((p,i) => p.classList.toggle('active', i === current));
      Array.from(stepsEl.querySelectorAll('.step')).forEach((s,i) => {
        s.classList.toggle('active', i === current);
        s.classList.toggle('done',   i < current);
      });
      btnBack.disabled = current === 0;
      btnNext.textContent = (current === stepPanels.length - 1) ? 'FINISH' : 'NEXT';
    }

    // footer buttons
    btnBack.addEventListener('click', () => setActive(current - 1));
    btnCancel.addEventListener('click', closeWizard);
    btnNext.addEventListener('click', () => {
      if (current < stepPanels.length - 1) setActive(current + 1);
      else closeWizard(); // FINISH returns to main view
    });

    // file → sheet names
    if (projectExcel && projectExcelLbl) {
      projectExcel.addEventListener('change', async (e) => {
        excelFile = (e.target.files || [])[0] || null;
        projectExcelLbl.textContent = excelFile ? excelFile.name : 'Select Excel File';
        sheetSelect.disabled = true;
        sheetSelect.innerHTML = `<option>Loading sheets…</option>`;
        sheetNames = [];
        try {
          // If ExcelJS browser build is present, use it to get real sheet names.
          if (window.ExcelJS && excelFile) {
            const wb = new ExcelJS.Workbook();
            const buf = await excelFile.arrayBuffer();
            await wb.xlsx.load(buf);
            sheetNames = wb.worksheets.map(ws => ws?.name).filter(Boolean);
          } else {
            // Fallback placeholders when ExcelJS not included (UI-only)
            sheetNames = ['Sheet1', 'Sheet2', 'Sheet3'];
          }
        } catch (err) {
          console.error('[AddInfra] workbook read failed:', err);
          sheetNames = ['Sheet1'];
        }
        sheetSelect.innerHTML = sheetNames.map(n => `<option>${n}</option>`).join('');
        sheetSelect.disabled = sheetNames.length === 0;
      });
    }

    // Start
    setActive(0);
  }

  // Left-nav hook
  if (!navNewCompany.dataset.bound) {
    navNewCompany.addEventListener('click', openWizard);
    navNewCompany.dataset.bound = '1';
  }
})();