// frontend/js/inspection_history.js
(() => {
  function parseFrequencyYearsFromStation(stn) {
    if (!stn) return null;
    // Find any key that mentions both "inspection" and "frequency"
    const keys = Object.keys(stn);
    const k = keys.find(
      (key) => /inspection/i.test(key) && /frequency/i.test(key)
    ) || keys.find(
      (key) => /^inspection\s*frequency$/i.test(String(key).replace(/.* – /, '')) // handles "General Information – Inspection Frequency"
    );
    if (!k) return null;
    const raw = String(stn[k] ?? '').trim();
    if (!raw) return null;
    const m = raw.match(/(\d+(?:\.\d+)?)/); // first number
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return null;
    // You only mentioned years, so treat any unit as years.
    return Math.round(n); // keep it an integer year count
  }
  
  function titleCase(s) {
    return String(s || '')
      .replace(/[_\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
  }

  function parseDateFromFolder(name, fallbackMs) {
    // Accept: 2020, 2020-05, 2020_05, 2020-05-17, 2020_Cableway_...
    const canon = String(name || '').trim();
    const m = canon.match(/^(\d{4})(?:[ _-]?(\d{2}))?(?:[ _-]?(\d{2}))?/);
    let d;
    if (m) {
      const y = Number(m[1]);
      const mo = m[2] ? Number(m[2]) : 1;
      const da = m[3] ? Number(m[3]) : 1;
      if (y >= 1900 && y <= 3000) {
        d = new Date(y, (mo || 1) - 1, (da || 1));
      }
    }
    if (!d) d = new Date(fallbackMs || Date.now());
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return { date: d, human: m && m[3] ? `${yyyy}-${mm}-${dd}` : (m && m[2] ? `${yyyy}-${mm}` : `${yyyy}`) };
  }

  function openPhotoLightbox(url) {
    const lb = document.querySelector('#photoLightbox');
    const img = document.querySelector('#lightboxImg');
    if (!lb || !img) return;
    img.src = url;
    lb.classList.add('open');
    document.documentElement.classList.add('modal-open');
    document.body.classList.add('modal-open');
  }
  function closePhotoLightbox() {
    const lb = document.querySelector('#photoLightbox');
    const img = document.querySelector('#lightboxImg');
    if (!lb) return;
    lb.classList.remove('open');
    document.documentElement.classList.remove('modal-open');
    document.body.classList.remove('modal-open');
    if (img) img.removeAttribute('src');
  }

  function openPdfModal(url, title = 'Inspection Report') {
    const modal = document.querySelector('#pdfModal');
    const frame = document.querySelector('#pdfFrame');
    const head = document.querySelector('#pdfTitle');
    const close = document.querySelector('#pdfClose');
    if (!modal || !frame) return;
    frame.src = url;
    if (head) head.textContent = title;
    modal.style.display = 'flex';
    // one-time close wiring per open
    const closer = () => {
      modal.style.display = 'none';
      frame.removeAttribute('src');
      close?.removeEventListener('click', closer);
      modal.removeEventListener('click', backdropCloser);
      document.removeEventListener('keydown', escCloser);
    };
    const backdropCloser = (e) => { if (e.target === modal) closer(); };
    const escCloser = (e) => { if (e.key === 'Escape') closer(); };
    close?.addEventListener('click', closer);
    modal.addEventListener('click', backdropCloser);
    document.addEventListener('keydown', escCloser);
  }

  async function fetchTemplateInto(container) {
    const host = container.querySelector('#inspection-history');
    if (!host) return null;
    const resp = await fetch('inspection_history.html');
    if (!resp.ok) throw new Error('Failed to load inspection_history.html');
    host.innerHTML = await resp.text();
    return host;
  }

  function renderItem(host, stn, item) {
    const wrap = document.createElement('div');
    wrap.className = 'inspection-item';
    wrap.style.border = '1px solid var(--border)';
    wrap.style.borderRadius = '10px';
    wrap.style.padding = '10px 12px';
    wrap.style.background = '#fff';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.gap = '8px';

    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.fontSize = '14px';
    title.textContent = `${item.displayName} - ${item.dateHuman}`;
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const reportBtn = document.createElement('button');
    reportBtn.className = 'btn';
    reportBtn.textContent = 'Inspection Report';
    reportBtn.disabled = !item.reportUrl;
    reportBtn.title = item.reportUrl ? 'Open report PDF' : 'No report found';
    reportBtn.addEventListener('click', () => {
      if (item.reportUrl) openPdfModal(item.reportUrl, `${item.displayName} — Report`);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'Delete Inspection';
    delBtn.title = 'Delete this inspection folder';
    delBtn.addEventListener('click', async () => {
      const ok = await appConfirm(`Delete the "${item.folderName}" inspection (this deletes the folder and its files)?`);
      if (!ok) return;
      try {
        const res = await window.electronAPI.deleteInspection(stn.name, stn.station_id, item.folderName);
        if (res && res.success) {
          wrap.remove();
        } else {
          appAlert('Failed to delete inspection folder.' + (res?.message ? `\n\n${res.message}` : ''));
        }
      } catch (e) {
        console.error('[deleteInspection] failed', e);
        appAlert('Failed to delete inspection folder.');
      }
    });

    actions.appendChild(reportBtn);
    actions.appendChild(delBtn);
    header.appendChild(actions);

    const photosRow = document.createElement('div');
    photosRow.className = 'photo-row';
    photosRow.style.marginTop = '10px';
    photosRow.style.alignItems = 'center';

    if (item.photos && item.photos.length) {
      item.photos.forEach(p => {
        const a = document.createElement('a');
        a.href = p.url;
        a.className = 'photo-link';
        a.title = p.name || 'Inspection photo';
        const img = document.createElement('img');
        img.src = p.url;
        img.alt = p.name || 'Inspection photo';
        img.className = 'photo-thumb';
        a.appendChild(img);
        a.addEventListener('click', (e) => {
          e.preventDefault();
          openPhotoLightbox(p.url);
        });
        photosRow.appendChild(a);
      });
      const extra = Number(item.moreCount || 0);
      if (extra > 0) {
        const more = document.createElement('div');
        more.textContent = `+ ${extra} more`;
        more.style.marginLeft = '8px';
        more.style.fontWeight = '700';
        more.style.color = '#374151';
        photosRow.appendChild(more);
      }
    } else {
      const empty = document.createElement('div');
      empty.className = 'photo-empty';
      empty.textContent = 'No photos found in this inspection';
      photosRow.appendChild(empty);
    }

    wrap.appendChild(header);
    wrap.appendChild(photosRow);
    host.appendChild(wrap);
  }

  async function renderList(host, stn) {
    const list = host.querySelector('#ihList');
    if (!list) return;
    list.innerHTML = '';
    // skeletons
    for (let i = 0; i < 2; i++) {
      const s = document.createElement('div');
      s.className = 'inspection-skel';
      s.style.height = '86px';
      s.style.border = '1px solid var(--border)';
      s.style.borderRadius = '10px';
      s.style.background = 'linear-gradient(90deg,#f3f4f6,#eceff3,#f3f4f6)';
      s.style.backgroundSize = '200% 100%';
      s.style.animation = 'photo-skeleton 1.4s ease infinite';
      list.appendChild(s);
    }

    let items = [];
    try {
      items = await window.electronAPI.listInspections(stn.name, stn.station_id);
    } catch (e) {
      console.warn('[listInspections] failed', e);
    }
    list.innerHTML = '';

    if (!items || !items.length) {
      const empty = document.createElement('div');
      empty.className = 'photo-empty';
      empty.textContent = 'No inspections found for this station';
      list.appendChild(empty);
      return;
    }

    // sort newest first by folder-name date (backend provides dateMs)
    items.sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));

    for (const it of items) renderItem(list, stn, it);

    try {
      const freqYears = parseFrequencyYearsFromStation(stn);
      const nextSpan = host.querySelector('.ih-next span');
      if (freqYears && nextSpan && items[0]?.dateMs) {
        const d = new Date(items[0].dateMs); // most recent folder-name date
        const nextYear = d.getUTCFullYear() + freqYears;
        nextSpan.textContent = String(nextYear);
      } // else leave as "DATE"
    } catch (e) {
      console.warn('[ih next-due compute] failed:', e);
    }

  }

  async function initInspectionHistoryTab(container, stn) {
    const tabBtn = container.querySelector('.tab[data-target="inspection-history"]');
    const host = await fetchTemplateInto(container);
    if (!host) return;

    // Lightbox close wiring
    const lbClose = document.querySelector('#lightboxClose');
    const lbBackdrop = document.querySelector('.photo-lightbox__backdrop');
    lbClose?.addEventListener('click', closePhotoLightbox);
    lbBackdrop?.addEventListener('click', closePhotoLightbox);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePhotoLightbox(); });

    // Lazy render on first open
    let loaded = false;
    const ensureLoad = async () => {
      if (loaded) return;
      loaded = true;
      await renderList(host, stn);
    };
    tabBtn?.addEventListener('click', ensureLoad);
    const content = container.querySelector('#inspection-history');
    if (content?.classList.contains('active')) await ensureLoad();

    // ---- NEW: Add Inspection modal logic ----
    const addBtn = host.querySelector('#ihAddBtn');
    const modal  = document.querySelector('#ihModal');
    const closeModal = () => { if (modal) modal.style.display = 'none'; };
    const openModal  = () => {
      if (modal) {
        modal.style.display = 'flex';
        // Autofill year with the current year if empty or invalid, but keep it editable
        primeYearField();
        primeNameField();
        setTimeout(()=>yearEl?.focus(),50);
      }
    };

    const yearEl      = document.querySelector('#ihYear');
    const nameEl      = document.querySelector('#ihName');
    const inspEl      = document.querySelector('#ihInspector');
    const commEl      = document.querySelector('#ihComment');
    const errEl       = document.querySelector('#ihError');
    const createEl    = document.querySelector('#ihCreateBtn');
    const cancelEl    = document.querySelector('#ihCancelBtn');
    const pickPhotos  = document.querySelector('#ihPickPhotos');
    const photosSum   = document.querySelector('#ihPhotosSummary');
    const pickReport  = document.querySelector('#ihPickReport');
    const reportSum   = document.querySelector('#ihReportSummary');
    const ihRepName     = document.querySelector('#ihRepName');
    const ihRepSeverity = document.querySelector('#ihRepSeverity');
    const ihRepPriority = document.querySelector('#ihRepPriority');
    const ihRepCost     = document.querySelector('#ihRepCost');
    const ihRepCategory = document.querySelector('#ihRepCategory');
    const ihAddRepairBtn= document.querySelector('#ihAddRepairBtn');
    const ihRepairsTbody= document.querySelector('#ihRepairsTbody');


    let selectedPhotos = [];
    let selectedReport = null;
    let pendingRepairs = []; // {name,severity,priority,cost,category}

    // ---- helpers ----
    function primeYearField() {
      if (!yearEl) return;
      const raw = String(yearEl.value || '').trim();
      const n = Number(raw);
      if (raw === '' || !Number.isInteger(n) || n < 1000 || n > 9999) {
        yearEl.value = String(new Date().getFullYear());
      }
    }

    function primeNameField() {
      if (!nameEl) return;
      const raw = String(nameEl.value || '').trim();
      if (raw === '') {
        nameEl.value = 'Cableway Engineering Inspection';
      }
    }


    function setError(msg) {
      if (!errEl) return;
      if (msg) { errEl.textContent = msg; errEl.style.display = 'block'; }
      else { errEl.textContent = ''; errEl.style.display = 'none'; }
    }

    function validate() {
      const year = Number(yearEl?.value || '');
      const name = String(nameEl?.value || '').trim();
      if (!Number.isInteger(year) || year < 1000 || year > 9999) {
        return 'Enter a valid 4-digit year (1000–9999).';
      }
      if (!name || !/inspection/i.test(name)) {
        return 'Name is required and must include the word "inspection".';
      }
      return null;
    }

    function fmtCostCell(v) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v); }
        catch { return `$${Math.round(v).toLocaleString()}`; }
      }
      const s = String(v ?? '').trim();
      return s || '—';
    }

    function readRepairForm() {
      const name = String(ihRepName?.value || '').trim();
      const severity = String(ihRepSeverity?.value || '').trim();
      const priority = String(ihRepPriority?.value || '').trim();
      const rawCost = String(ihRepCost?.value || '').trim();
      const category = (ihRepCategory?.value || 'Capital');
      let cost = rawCost ? Number(rawCost.replace(/[, ]/g, '')) : '';
      if (!Number.isFinite(cost)) cost = rawCost;
      return { name, severity, priority, cost, category };
    }
    function validateRepair(it) {
      if (!it.name) return 'Repair Name is required.';
      if (!/^Capital$|^O&?M$/i.test(it.category)) return 'Select a valid Category.';
      return null;
    }
    function clearRepairForm() {
      if (ihRepName) ihRepName.value = '';
      if (ihRepSeverity) ihRepSeverity.value = '';
      if (ihRepPriority) ihRepPriority.value = '';
      if (ihRepCost) ihRepCost.value = '';
      if (ihRepCategory) ihRepCategory.value = 'Capital';
    }
    function renderPendingRepairs() {
      if (!ihRepairsTbody) return;
      ihRepairsTbody.innerHTML = '';
      if (!pendingRepairs.length) {
        const tr = document.createElement('tr');
        tr.className = 'ih-repairs-empty';
        const td = document.createElement('td');
        td.colSpan = 6; td.style.textAlign = 'center'; td.style.color = '#6b7280';
        td.textContent = 'No repairs added';
        tr.appendChild(td);
        ihRepairsTbody.appendChild(tr);
        return;
      }
      pendingRepairs.forEach((it, idx) => {
        const tr = document.createElement('tr');
        const c1 = document.createElement('td'); c1.textContent = it.name || '—';
        const c2 = document.createElement('td'); c2.textContent = it.severity || '—';
        const c3 = document.createElement('td'); c3.textContent = it.priority || '—';
        const c4 = document.createElement('td'); c4.textContent = fmtCostCell(it.cost);
        const c5 = document.createElement('td'); c5.textContent = it.category || '—';
        const c6 = document.createElement('td');
        const del = document.createElement('button');
        del.className = 'btn btn-ghost btn-sm btn-danger';
        del.textContent = '✕';
        del.title = 'Remove';
        del.addEventListener('click', () => {
          pendingRepairs.splice(idx, 1);
          renderPendingRepairs();
        });
        c6.appendChild(del);
        tr.appendChild(c1); tr.appendChild(c2); tr.appendChild(c3); tr.appendChild(c4); tr.appendChild(c5); tr.appendChild(c6);
        ihRepairsTbody.appendChild(tr);
      });
    }

    addBtn?.removeAttribute('disabled');
    addBtn?.removeAttribute('title');
    addBtn?.addEventListener('click', () => {
      setError('');
      selectedPhotos = [];
      selectedReport = null;
      pendingRepairs = [];
      if (photosSum) photosSum.textContent = '0 selected';
      if (reportSum) reportSum.textContent = 'None';
      clearRepairForm();
      renderPendingRepairs();
      openModal();
    });

    cancelEl?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    pickPhotos?.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const res = await window.electronAPI.pickInspectionPhotos();
        selectedPhotos = Array.isArray(res?.filePaths) ? res.filePaths : [];
        if (photosSum) photosSum.textContent = `${selectedPhotos.length} selected`;
      } catch (_) {}
    });

    pickReport?.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const res = await window.electronAPI.pickInspectionReport();
        selectedReport = res?.filePath || null;
        if (reportSum) reportSum.textContent = selectedReport ? '1 PDF selected' : 'None';
      } catch (_) {}
    });

    ihAddRepairBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      const it = readRepairForm();
      const err = validateRepair(it);
      if (err) {
        setError(err);
        return;
      }
      setError('');
      pendingRepairs.push(it);
      renderPendingRepairs();
      clearRepairForm();
    });

    createEl?.addEventListener('click', async () => {
      const err = validate();
      if (err) { setError(err); return; }
      setError('');
      createEl.disabled = true; createEl.textContent = 'Creating…';

      try {
        const payload = {
          year: Number(yearEl.value),
          name: String(nameEl.value || '').trim(),
          inspector: String(inspEl?.value || '').trim(),
          comment: String(commEl?.value || '').trim(),
          photos: selectedPhotos,
          report: selectedReport
        };
        const res = await window.electronAPI.createInspection(stn.name, stn.station_id, payload);
        if (!res?.success) {
          setError(res?.message || 'Failed to create inspection.');
          return;
        }

        // If repairs were added in the modal, append them to the Repairs sheet now.
        if (pendingRepairs.length) {
          try {
            const current = await window.electronAPI.listRepairs(stn.name, stn.station_id);
            const merged = Array.isArray(current) ? current.concat(pendingRepairs) : pendingRepairs.slice();
            const save = await window.electronAPI.saveRepairs(stn.name, stn.station_id, merged);
            if (!save?.success) {
              appAlert(save?.message || 'Inspection created, but failed to save repairs.');
            } else {
              // Refresh the Repairs tab so changes are visible immediately.
              if (typeof window.initRepairsTab === 'function') {
                await window.initRepairsTab(container, stn);
              }
            }
          } catch (repErr) {
            console.warn('[ih:create -> saveRepairs] failed:', repErr);
            appAlert('Inspection created, but failed to save repairs.');
          }
        }

        closeModal();
        await renderList(host, stn); // refresh list (and recompute Next Due)
      } catch (e) {
        console.error('[createInspection] failed', e);
        setError('Failed to create inspection.');
      } finally {
        createEl.disabled = false; createEl.textContent = 'Create';
      }
    });
  }


  // expose
  window.initInspectionHistoryTab = initInspectionHistoryTab;
})();
