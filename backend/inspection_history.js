// backend/inspection_history.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pathToFileURL } = require('url');
const { PHOTOS_BASE, IMAGE_EXTS } = require('./config');

// Local copy (matches app.js); consider moving to a shared util if you like.
function folderNameFor(siteName, stationId) {
  const site = String(siteName ?? '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  const id = String(stationId ?? '').toUpperCase();
  return `${site}_${id}`;
}

function containsInspectionWord(s) {
  const x = String(s || '').toLowerCase();
  return x.includes('inspection') || x.includes('assessment');
}

function titleCase(s) {
  return String(s || '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
}

function toFileUrl(p) { try { return pathToFileURL(p).href; } catch { return null; } }

async function findStationDir(siteName, stationId) {
  if (!PHOTOS_BASE) return null;
  const targetFolder = folderNameFor(siteName, stationId);
  const exactDir = path.join(PHOTOS_BASE, targetFolder);

  try {
    const st = await fsp.stat(exactDir);
    if (st.isDirectory()) return exactDir;
  } catch (_) {}

  const idUpper = String(stationId ?? '').toUpperCase();
  try {
    const entries = await fsp.readdir(PHOTOS_BASE, { withFileTypes: true });
    const cand = entries.find(d => d.isDirectory() && d.name.toUpperCase().endsWith('_' + idUpper));
    if (cand) return path.join(PHOTOS_BASE, cand.name);
  } catch (_) {}

  return null;
}

async function collectFilesRecursive(dir, accept) {
  const files = [];
  const seen = new Set();
  async function walk(d) {
    if (seen.has(d)) return; seen.add(d);
    let ents;
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) { await walk(full); continue; }
      if (!accept || accept(full, ent.name)) {
        try { const st = await fsp.stat(full); files.push({ path: full, name: ent.name, mtimeMs: st.mtimeMs }); }
        catch { /* ignore */ }
      }
    }
  }
  await walk(dir);
  return files;
}

/** List inspection folders + up to 5 recent photos + report PDF URL */
async function listInspections(siteName, stationId, perPhotos = 5) {
  try {
    const stnDir = await findStationDir(siteName, stationId);
    if (!stnDir) return [];

    let entries = [];
    try { entries = await fsp.readdir(stnDir, { withFileTypes: true }); } catch (_) {}
    const folders = entries
      .filter(e => e.isDirectory() && containsInspectionWord(e.name))
      .map(e => e.name);

    const out = [];
    for (const folderName of folders) {
      const full = path.join(stnDir, folderName);
      const stat = await fsp.stat(full).catch(() => null);
      const mtimeMs = stat?.mtimeMs || 0;

      // Pretty display name (strip leading date chunk if present)
      const m = folderName.match(/^(\d{4})(?:[ _-]?(\d{2}))?(?:[ _-]?(\d{2}))?(.*)$/);
      const tail = m ? (m[4] || '') : folderName;
      const displayName = titleCase((tail || folderName).replace(/^[_\-\s]+/, '').replace(/[_\-]+/g, ' ').trim());

      // Photos
      const imgs = await collectFilesRecursive(full, (_p, n) => IMAGE_EXTS.includes(path.extname(n).toLowerCase()));
      imgs.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const photos = imgs.slice(0, perPhotos).map(f => ({ url: toFileUrl(f.path), name: f.name, mtimeMs: f.mtimeMs }));
      const moreCount = Math.max(0, imgs.length - photos.length);

      // Report PDF (prefer names containing 'report', else 'inspection', newest first)
      const pdfs = await collectFilesRecursive(full, (_p, n) => /\.pdf$/i.test(n));
      pdfs.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const rep = pdfs.find(f => /report/i.test(f.name)) || pdfs.find(f => /inspection/i.test(f.name)) || pdfs[0] || null;

      // Date to show
      let dateHuman = '';
      if (m) {
        const y = m[1], mo = m[2], da = m[3];
        dateHuman = da ? `${y}-${mo}-${da}` : (mo ? `${y}-${mo}` : `${y}`);
      } else {
        const d = new Date(mtimeMs || Date.now());
        dateHuman = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      }

      out.push({
        folderName,
        fullPath: full,
        displayName: displayName || folderName,
        dateHuman,
        sortMs: mtimeMs,
        photos,
        moreCount,
        reportUrl: rep ? toFileUrl(rep.path) : null
      });
    }

    out.sort((a, b) => (b.sortMs || 0) - (a.sortMs || 0));
    return out;
  } catch (e) {
    console.error('[inspection_history:listInspections] failed:', e);
    return [];
  }
}

/** Delete an inspection folder (recursive), confined to the station directory. */
async function deleteInspectionFolder(siteName, stationId, folderName) {
  try {
    const stnDir = await findStationDir(siteName, stationId);
    if (!stnDir) return { success: false, message: 'Station folder not found' };

    const target = path.join(stnDir, folderName);
    const rel = path.relative(stnDir, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      return { success: false, message: 'Invalid folder path' };
    }

    await fsp.rm(target, { recursive: true, force: true });
    return { success: true };
  } catch (e) {
    console.error('[inspection_history:deleteInspectionFolder] failed:', e);
    return { success: false, message: String(e) };
  }
}

module.exports = {
  listInspections,
  deleteInspectionFolder,
};
