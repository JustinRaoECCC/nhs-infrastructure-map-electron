// preload.js
// Expose a minimal, explicit API surface to the renderer.

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Stations ────────────────────────────────────────────────────────────
  getStationData:         (opts) => ipcRenderer.invoke('stations:get', opts || {}),
  invalidateStationCache: () => ipcRenderer.invoke('stations:invalidate'),

  // ─── Manual instance creation ───────────────────────────────────────────
  manualCreateInstance:   (payload) => ipcRenderer.invoke('manual:addInstance', payload),

  // ─── Lookups (reads) ────────────────────────────────────────────────────
  // Drives the hierarchical filter tree (Company ▸ Locations ▸ Asset Types).
  // Lookups / colors
  getColorMaps:       () => ipcRenderer.invoke('getColorMaps'),
  setAssetTypeColor:  (assetType, color) => ipcRenderer.invoke('setAssetTypeColor', assetType, color),
  setAssetTypeColorForLocation: (assetType, location, color) =>
    ipcRenderer.invoke('setAssetTypeColorForLocation', assetType, location, color),
  setAssetTypeColorForCompanyLocation: (assetType, company, location, color) =>
    ipcRenderer.invoke('setAssetTypeColorForCompanyLocation', assetType, company, location, color),
  getLookupTree:      () => ipcRenderer.invoke('lookups:getTree'),

  // ─── Lookups (writes only — used by Add Infrastructure wizard) ──────────
  upsertCompany:   (name, active = true, description, email) =>
    ipcRenderer.invoke('lookups:upsertCompany', name, !!active, description, email),
  upsertLocation:  (location, company)   => ipcRenderer.invoke('lookups:upsertLocation', location, company),
  upsertAssetType: (assetType, company, location) => ipcRenderer.invoke('lookups:upsertAssetType', assetType, company, location),

  setLocationLink:  (company, location, link) =>
    ipcRenderer.invoke('lookups:setLocationLink', company, location, link),
  setAssetTypeLink: (assetType, company, location, link) =>
    ipcRenderer.invoke('lookups:setAssetTypeLink', assetType, company, location, link),

  // ─── Excel helper for Step 3 sheet picker ───────────────────────────────
  excelListSheets:            (b64)                 => ipcRenderer.invoke('excel:listSheets', b64),
  excelParseRowsFromSheet:    (b64, sheetName)      => ipcRenderer.invoke('excel:parseRowsFromSheet', b64, sheetName),

  // ─── Boot progress from the worker (UI progress bar) ────────────────────
  onExcelProgress: (handler) => {
    const listener = (_evt, payload) => { try { handler(payload); } catch (_) {} };
    ipcRenderer.on('excel:progress', listener);
    // return an unsubscribe in case you want to detach later
    return () => ipcRenderer.removeListener('excel:progress', listener);
  },

  // ─── Selections → file + pins ───────────────────────────────────────────
  importSelection: (payload) => ipcRenderer.invoke('stations:importSelection', payload),

  getRecentPhotos: (siteName, stationId, limit = 5) =>
    ipcRenderer.invoke('photos:getRecent', { siteName, stationId, limit }),

  // ─── Station Updates ─────────────────────────────────────────────────────
  updateStationData: (stationData, schema) => ipcRenderer.invoke('stations:update', stationData, schema),

  // ─── Schema synchronization ──────────────────────────────────────────────
  syncAssetTypeSchema: (assetType, schema, excludeStationId) =>
    ipcRenderer.invoke('schema:sync', assetType, schema, excludeStationId),

  getExistingSchema: (assetType) =>
    ipcRenderer.invoke('schema:getExisting', assetType),

  // ─── Excel worker extensions ────────────────────────────────────────────
  readLocationWorkbook: (company, locationName) =>
    ipcRenderer.invoke('excel:readLocationWorkbook', company, locationName),

  readSheetData: (company, locationName, sheetName) =>
    ipcRenderer.invoke('excel:readSheetData', company, locationName, sheetName),

  updateAssetTypeSchema: (assetType, schema, excludeStationId) =>
    ipcRenderer.invoke('excel:updateAssetTypeSchema', assetType, schema, excludeStationId),

  // ─── Inspections ─────────────────────────────────────────────────────────
  // Optional third arg `opts` (e.g., { keywords: ['inspection','assessment'] })
  listInspections: (siteName, stationId, opts) =>
    ipcRenderer.invoke('inspections:list', siteName, stationId, opts),

  // Inspection History keywords (global, stored in lookups.xlsx)
  getInspectionKeywords: () =>
    ipcRenderer.invoke('inspectionKeywords:get'),
  setInspectionKeywords: (keywords) =>
    ipcRenderer.invoke('inspectionKeywords:set', Array.isArray(keywords) ? keywords : []),

  deleteInspection: (siteName, stationId, folderName) =>
    ipcRenderer.invoke('inspections:delete', siteName, stationId, folderName),

  pickInspectionPhotos: () =>
    ipcRenderer.invoke('inspections:pickPhotos'),

  pickInspectionReport: () =>
    ipcRenderer.invoke('inspections:pickReport'),

  createInspection: (siteName, stationId, payload) =>
    ipcRenderer.invoke('inspections:create', siteName, stationId, payload),

  // ─── Projects ────────────────────────────────────────────────────────────
  listProjects: (siteName, stationId, opts) =>
    ipcRenderer.invoke('projects:list', siteName, stationId, opts),

  // Project History keywords (global, stored in lookups.xlsx)
  getProjectKeywords: () =>
    ipcRenderer.invoke('projectKeywords:get'),
  setProjectKeywords: (keywords) =>
    ipcRenderer.invoke('projectKeywords:set', Array.isArray(keywords) ? keywords : []),

  deleteProject: (siteName, stationId, folderName) =>
    ipcRenderer.invoke('projects:delete', siteName, stationId, folderName),

  pickProjectPhotos: () =>
    ipcRenderer.invoke('projects:pickPhotos'),

  pickProjectReport: () =>
    ipcRenderer.invoke('projects:pickReport'),

  createProject: (siteName, stationId, payload) =>
    ipcRenderer.invoke('projects:create', siteName, stationId, payload),

  // ─── Repairs ─────────────────────────────────────────────────────────────
  listRepairs: (siteName, stationId) =>
    ipcRenderer.invoke('repairs:list', siteName, stationId),

  saveRepairs: (siteName, stationId, items) =>
    ipcRenderer.invoke('repairs:save', siteName, stationId, items),

  appendRepair: (payload) => ipcRenderer.invoke('append-repair', payload),

  // Global repairs functions for dashboard
  getAllRepairs: () =>
    ipcRenderer.invoke('repairs:getAll'),

  addRepairToLocation: (location, assetType, repair) =>
    ipcRenderer.invoke('repairs:add', location, assetType, repair),

  // Status / Repair settings
  getStatusRepairSettings: () => ipcRenderer.invoke('status:get'),
  setStatusColor:          (statusKey, color) => ipcRenderer.invoke('status:setColor', statusKey, color),
  deleteStatus:            (statusKey) => ipcRenderer.invoke('status:delete', statusKey),
  setApplyStatusColors:    (flag) => ipcRenderer.invoke('status:setApply', !!flag),
  setApplyRepairColors:    (flag) => ipcRenderer.invoke('repair:setApply', !!flag),

  // ─── Nuke ────────────────────────────────────────────────────────────────
  nukeProgram: () => ipcRenderer.invoke('nuke:run'),
  deleteCompany: (companyName) => ipcRenderer.invoke('nuke:deleteCompany', companyName),
  deleteLocation: (companyName, locationName) => 
    ipcRenderer.invoke('nuke:deleteLocation', companyName, locationName),
  deleteAssetType: (companyName, locationName, assetTypeName) => 
    ipcRenderer.invoke('nuke:deleteAssetType', companyName, locationName, assetTypeName),

  getPhotosBase: (ctx) => ipcRenderer.invoke('getPhotosBase', ctx),

  browseForFolder: () => ipcRenderer.invoke('browseForFolder'),


  // Excel import
  importRepairsExcel: (b64) => ipcRenderer.invoke('excel:importRepairsExcel', b64),
  // Algorithm parameters
  getAlgorithmParameters: () => ipcRenderer.invoke('excel:getAlgorithmParameters'),
  saveAlgorithmParameters: (rows) => ipcRenderer.invoke('excel:saveAlgorithmParameters', rows),
  getWorkplanConstants: () => ipcRenderer.invoke('excel:getWorkplanConstants'),
  saveWorkplanConstants: (rows) => ipcRenderer.invoke('excel:saveWorkplanConstants', rows),
  getCustomWeights: () => ipcRenderer.invoke('excel:getCustomWeights'),
  addCustomWeight: (weight, active=true) => ipcRenderer.invoke('excel:addCustomWeight', weight, !!active),
  // Fixed parameters (for Optimization I constraint filtering)
  getFixedParameters: () => ipcRenderer.invoke('excel:getFixedParameters'),
  saveFixedParameters: (params) => ipcRenderer.invoke('excel:saveFixedParameters', params),
  // Optimization I / II
  optimizeWorkplan: (payload) => ipcRenderer.invoke('algo:optimizeWorkplan', payload),
  groupRepairsIntoTrips: (payload) => ipcRenderer.invoke('algo:groupRepairsIntoTrips', payload),
  assignTripsToYears: (payload) => ipcRenderer.invoke('algo:assignTripsToYears', payload),

  assignRepairsToYearsIndividually: (params) => ipcRenderer.invoke('assignRepairsToYearsIndividually', params),
  assignRepairsToYearsWithDeadlines: (params) => ipcRenderer.invoke('assign-repairs-to-years-with-deadlines', params),
  groupTripsWithinYears: (params) => ipcRenderer.invoke('groupTripsWithinYears', params),

  // ─── Database Config ─────────────────────────────────────────────────────
  getDbConfig: () => ipcRenderer.invoke('db:getConfig'),

  // ─── Test Algorithm Config ───────────────────────────────────────────────
  getTestTabEnabled: () => ipcRenderer.invoke('test:getTabEnabled'),

  // ─── Authentication ──────────────────────────────────────────────────────
  hasUsers: () => ipcRenderer.invoke('auth:hasUsers'),
  createUser: (userData) => ipcRenderer.invoke('auth:createUser', userData),
  loginUser: (name, password) => ipcRenderer.invoke('auth:login', name, password),
  logoutUser: () => ipcRenderer.invoke('auth:logout'),
  getCurrentUser: () => ipcRenderer.invoke('auth:getCurrentUser'),
  getAllUsers: () => ipcRenderer.invoke('auth:getAllUsers'),
  navigateToMain: () => ipcRenderer.invoke('auth:navigateToMain'),

  getFundingSettings: (company, location) => 
    ipcRenderer.invoke('excel:getFundingSettings', company, location),
  saveFundingSettings: (company, location, settings) => 
    ipcRenderer.invoke('excel:saveFundingSettings', company, location, settings),
  saveFundingSettingsForAssetType: (company, location, assetType, settings) => 
    ipcRenderer.invoke('excel:saveFundingSettingsForAssetType', company, location, assetType, settings),
  getAllFundingSettings: (company) =>
    ipcRenderer.invoke('excel:getAllFundingSettings', company),
  normalizeFundingOverrides: () =>
    ipcRenderer.invoke('excel:normalizeFundingOverrides'),
  // Field catalog from the active workbook (sheet-qualified headers)
  getWorkbookFieldCatalog: (company, location) =>
    ipcRenderer.invoke('excel:getWorkbookFieldCatalog', company, location),

  // Photo tab methods
  getStationPhotoStructure: (siteName, stationId, subPath) => 
    ipcRenderer.invoke('getStationPhotoStructure', siteName, stationId, subPath),
  
  createPhotoFolder: (siteName, stationId, folderPath) => 
    ipcRenderer.invoke('createPhotoFolder', siteName, stationId, folderPath),
  
  savePhotos: (siteName, stationId, folderPath, files) => 
    ipcRenderer.invoke('savePhotos', siteName, stationId, folderPath, files),
  
  getPhotoUrl: (siteName, stationId, photoPath) => 
    ipcRenderer.invoke('getPhotoUrl', siteName, stationId, photoPath),
  
  deletePhoto: (siteName, stationId, photoPath) => 
    ipcRenderer.invoke('deletePhoto', siteName, stationId, photoPath),
  
  deleteFolder: (siteName, stationId, folderPath) => 
    ipcRenderer.invoke('deleteFolder', siteName, stationId, folderPath),

  // Document tab methods
  getStationDocumentStructure: (siteName, stationId, subPath) => 
    ipcRenderer.invoke('getStationDocumentStructure', siteName, stationId, subPath),
  
  createDocumentFolder: (siteName, stationId, folderPath) => 
    ipcRenderer.invoke('createDocumentFolder', siteName, stationId, folderPath),
  
  saveDocuments: (siteName, stationId, folderPath, files) => 
    ipcRenderer.invoke('saveDocuments', siteName, stationId, folderPath, files),
  
  openDocument: (siteName, stationId, docPath) => 
    ipcRenderer.invoke('openDocument', siteName, stationId, docPath),
  
  revealDocument: (siteName, stationId, docPath) => 
    ipcRenderer.invoke('revealDocument', siteName, stationId, docPath),
  
  deleteDocument: (siteName, stationId, docPath) => 
    ipcRenderer.invoke('deleteDocument', siteName, stationId, docPath),
  
  deleteDocumentFolder: (siteName, stationId, folderPath) => 
    ipcRenderer.invoke('deleteDocumentFolder', siteName, stationId, folderPath),

  chatbotQuery: (message) => ipcRenderer.invoke('chatbot:query', message),
  getAvailableData: () => ipcRenderer.invoke('chatbot:get-available-data'),
});

// Non-blocking modal to avoid Windows focus issues caused by alert().
const ALERT_CSS = `
.app-alert-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);z-index:2147483646}
.app-alert-overlay.show{display:flex}
.app-alert-modal{max-width:520px;width:calc(100% - 32px);background:#fff;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:20px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.4}
.app-alert-title{margin:0 0 8px;font-size:18px;font-weight:600}
.app-alert-message{margin:0 0 16px;white-space:pre-wrap;word-wrap:break-word}
.app-alert-actions{display:flex;justify-content:flex-end;gap:8px}
.app-alert-btn{appearance:none;border:0;border-radius:10px;padding:10px 14px;font-weight:600;cursor:pointer}
.app-alert-btn:focus{outline:2px solid #4c9ffe;outline-offset:2px}
.app-alert-ok{background:#111;color:#fff}
@media (prefers-color-scheme: dark){
  .app-alert-modal{background:#1d1f23;color:#e6e6e6}
  .app-alert-ok{background:#e6e6e6;color:#111}
}
`;

function ensureAlertStyles() {
  if (document.getElementById('app-alert-styles')) return;
  const inject = () => {
    if (document.getElementById('app-alert-styles')) return;
    const s = document.createElement('style');
    s.id = 'app-alert-styles';
    s.textContent = ALERT_CSS;
    document.head.appendChild(s);
  };
  if (document.head) inject();
  else window.addEventListener('DOMContentLoaded', inject, { once: true });
}

let alertNodes = null; // cached DOM nodes
function ensureAlertDOM() {
  if (alertNodes) return alertNodes;
  ensureAlertStyles();

  // Build nodes immediately; append now or when DOM is ready.
  const overlay = document.createElement('div');
  overlay.className = 'app-alert-overlay';
  overlay.setAttribute('role', 'presentation');

  const modal = document.createElement('div');
  modal.className = 'app-alert-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const title = document.createElement('h2');
  title.className = 'app-alert-title';
  title.id = 'app-alert-title';
  modal.setAttribute('aria-labelledby', title.id);

  const msg = document.createElement('div');
  msg.className = 'app-alert-message';

  const actions = document.createElement('div');
  actions.className = 'app-alert-actions';

  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = 'app-alert-btn app-alert-ok';
  ok.textContent = 'OK';
  actions.appendChild(ok);

  modal.appendChild(title);
  modal.appendChild(msg);
  modal.appendChild(actions);
  overlay.appendChild(modal);

  const appendNow = () => document.body.appendChild(overlay);
  if (document.body) appendNow();
  else window.addEventListener('DOMContentLoaded', appendNow, { once: true });

  alertNodes = { overlay, modal, title, msg, ok };
  return alertNodes;
}

function appAlert(message, opts = {}) {
  const { title = 'Notice', okText = 'OK', closeOnBackdrop = true, timeout = null } = opts || {};
  const { overlay, title: titleEl, msg, ok } = ensureAlertDOM();
  titleEl.textContent = String(title);
  msg.textContent = message == null ? '' : String(message);
  ok.textContent = okText;

  return new Promise((resolve) => {
    let onKeyDown;
    const cleanup = () => {
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.classList.remove('show');
      document.body && (document.body.style.overflow = '');
      resolve();
    };
    onKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        cleanup();
      }
    };
    ok.onclick = cleanup;
    overlay.onclick = (e) => {
      if (closeOnBackdrop && e.target === overlay) cleanup();
    };

    overlay.classList.add('show');
    if (document.body) document.body.style.overflow = 'hidden';
    // focus after paint
    setTimeout(() => { try { ok.focus(); } catch (_) {} }, 0);
    if (timeout && Number.isFinite(timeout)) setTimeout(cleanup, timeout);

    document.addEventListener('keydown', onKeyDown, true);
  });
}

// Expose globally so all renderers can call it directly: appAlert('hello')
try {
  contextBridge.exposeInMainWorld('appAlert', appAlert);
} catch {
  // Fallback (if contextIsolation is off)
  // eslint-disable-next-line no-undef
  window.appAlert = appAlert;
}
// --- END: appAlert ---


// --- BEGIN: appConfirm (styled, Promise<boolean>, no options required) ---
let _confirmNodes = null;

function ensureConfirmDOM() {
  if (_confirmNodes) return _confirmNodes;

  const overlay = document.createElement('div');
  overlay.className = 'app-confirm-overlay';
  overlay.setAttribute('role', 'presentation');

  const modal = document.createElement('div');
  modal.className = 'app-confirm-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const titleEl = document.createElement('h2');
  titleEl.className = 'app-confirm-title';
  titleEl.id = 'app-confirm-title';
  titleEl.textContent = 'Confirm';
  modal.setAttribute('aria-labelledby', titleEl.id);

  const msgEl = document.createElement('div');
  msgEl.className = 'app-confirm-message';

  const actions = document.createElement('div');
  actions.className = 'app-confirm-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'app-confirm-btn app-confirm-cancel';
  cancelBtn.textContent = 'Cancel';

  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.className = 'app-confirm-btn app-confirm-ok';
  okBtn.textContent = 'OK';

  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);
  modal.appendChild(titleEl);
  modal.appendChild(msgEl);
  modal.appendChild(actions);
  overlay.appendChild(modal);

  const append = () => document.body.appendChild(overlay);
  if (document.body) append();
  else window.addEventListener('DOMContentLoaded', append, { once: true });

  _confirmNodes = { overlay, modal, titleEl, msgEl, okBtn, cancelBtn };
  return _confirmNodes;
}

/**
 * appConfirm(message: string) -> Promise<boolean>
 * Looks like your custom alert; Enter = OK, Esc/Backdrop = Cancel.
 * Heuristic: if message looks destructive (delete/nuke/etc), apply "danger" style.
 */
function appConfirm(message) {
  const text = String(message ?? '');
  const { overlay, modal, titleEl, msgEl, okBtn, cancelBtn } = ensureConfirmDOM();

  // Style tweak for destructive operations
  const isDanger = /(delete|warning|permanent|nuke)/i.test(text);
  modal.classList.toggle('app-confirm--danger', isDanger);

  titleEl.textContent = 'Confirm';
  msgEl.textContent = text;

  return new Promise((resolve) => {
    const prevOverflow = document.body ? document.body.style.overflow : '';
    const active = document.activeElement;

    const cleanup = (result) => {
      document.removeEventListener('keydown', onKeyDown, true);
      overlay.removeEventListener('click', onBackdrop, true);
      okBtn.removeEventListener('click', onOK, true);
      cancelBtn.removeEventListener('click', onCancel, true);
      overlay.classList.remove('show');
      if (document.body) document.body.style.overflow = prevOverflow;
      try { active && active.focus && active.focus(); } catch(_) {}
      resolve(result);
    };

    const onOK = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (e) => { if (e.target === overlay) cleanup(false); };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false); }
      else if (e.key === 'Enter') { e.preventDefault(); cleanup(true); }
    };

    okBtn.addEventListener('click', onOK, true);
    cancelBtn.addEventListener('click', onCancel, true);
    overlay.addEventListener('click', onBackdrop, true);
    document.addEventListener('keydown', onKeyDown, true);

    overlay.classList.add('show');
    if (document.body) document.body.style.overflow = 'hidden';
    // Focus default button (OK) after paint, to match native confirm semantics
    setTimeout(() => { try { okBtn.focus(); } catch(_) {} }, 0);
  });
}

// Expose globally (and alias)
try {
  contextBridge.exposeInMainWorld('appConfirm', appConfirm);
  contextBridge.exposeInMainWorld('showConfirm', appConfirm);
} catch {
  // eslint-disable-next-line no-undef
  window.appConfirm = appConfirm;
  // eslint-disable-next-line no-undef
  window.showConfirm = appConfirm;
}
// --- END: appConfirm ---
