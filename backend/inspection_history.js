// backend/inspection_history.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pathToFileURL } = require('url');
const { PHOTOS_BASE, IMAGE_EXTS } = require('./config');
const { ensureDir } = require('./utils/fs_utils');

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

function sanitizeSegment(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\-_ ]+/gu, ' ')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function uniquePath(dir, baseName) {
  let candidate = path.join(dir, baseName);
  let i = 0;
  for (;;) {
    try { await fsp.access(candidate); i++; candidate = path.join(dir, `${baseName}_${i}`); }
    catch { return candidate; }
  }
}

async function copyWithUniqueName(src, destDir) {
  const base = path.basename(src);
  const name = base.replace(/\.[^.]+$/, '');
  const ext  = path.extname(base);
  let target = path.join(destDir, base);
  let i = 0;
  for (;;) {
    try { await fsp.access(target); i++; target = path.join(destDir, `${name} (${i})${ext}`); }
    catch { break; }
  }
  await fsp.copyFile(src, target);
  return target;
}

function containsInspectionWord(s) {
  const x = String(s || '').toLowerCase();
  return x.includes('inspection') || x.includes('assessment');
}

function parseDateFromFolderName(name) {
  const s = String(name || '').trim();
  // Accept: YYYY, YYYY[-_ ]MM, YYYY[-_ ]MM[-_ ]DD (e.g., 2020, 2020-05, 2020_05_17, 2020 Cableway ...)
  const m = s.match(/^(\d{4})(?:[ _-]?(\d{2}))?(?:[ _-]?(\d{2}))?/);
  if (!m) return null;
  const y = Number(m[1]);
  let mo = m[2] ? Number(m[2]) : 1;
  let da = m[3] ? Number(m[3]) : 1;
  if (Number.isNaN(y) || y < 1900 || y > 3000) return null;
  // Clamp to safe ranges
  if (!Number.isFinite(mo) || mo < 1 || mo > 12) mo = 1;
  if (!Number.isFinite(da) || da < 1 || da > 31) da = 1;
  const dateMs = Date.UTC(y, mo - 1, da);
  const human = m[3] ? `${y}-${String(mo).padStart(2,'0')}-${String(da).padStart(2,'0')}`
            : m[2] ? `${y}-${String(mo).padStart(2,'0')}`
            : `${y}`;
  return { dateMs, human };
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
      const parsedDate = parseDateFromFolderName(folderName);
      const dateMs = parsedDate ? parsedDate.dateMs : Number.NEGATIVE_INFINITY;

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

      // Date to show (from folder name only)
      const dateHuman = parsedDate ? parsedDate.human : '';

      out.push({
        folderName,
        fullPath: full,
        displayName: displayName || folderName,
        dateHuman,
        dateMs,
        photos,
        moreCount,
        reportUrl: rep ? toFileUrl(rep.path) : null
      });
    }

    out.sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));
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

/** Create a new inspection folder and populate photos/report/comment.txt */
async function createInspectionFolder(siteName, stationId, payload) {
  try {
    const year = Number(payload?.year);
    const name = String(payload?.name || '').trim();
    const inspector = String(payload?.inspector || '').trim();
    const comment = String(payload?.comment || '').trim();
    const photos = Array.isArray(payload?.photos) ? payload.photos : [];
    const report = payload?.report || null;

    if (!Number.isInteger(year) || year < 1000 || year > 9999) {
      return { success: false, message: 'Invalid year. Must be 4 digits between 1000 and 9999.' };
    }
    if (!name || !/inspection/i.test(name)) {
      return { success: false, message: 'Name is required and must include the word "inspection".' };
    }

    // Station directory — prefer the canonical exact folder, create if missing.
    if (!PHOTOS_BASE) return { success: false, message: 'PHOTOS_BASE is not configured.' };
    const stationDir = path.join(PHOTOS_BASE, folderNameFor(siteName, stationId));
    ensureDir(stationDir);

    // New inspection folder: "YYYY_<Name…>"
    const desiredName = `${year}_${sanitizeSegment(name)}`;
    const targetDir = await uniquePath(stationDir, desiredName);
    ensureDir(targetDir);

    // Photos subfolder
    const photosDir = path.join(targetDir, 'photos');
    ensureDir(photosDir);

    // Copy photos (if any), keep original filenames, uniquify on collision
    for (const p of photos) {
      if (!p || typeof p !== 'string') continue;
      const ext = path.extname(p).toLowerCase();
      if (!IMAGE_EXTS.includes(ext)) continue; // ignore non-images
      try { await copyWithUniqueName(p, photosDir); } catch (e) { /* continue */ }
    }

    // Copy report as "Inspection Report.pdf" (if provided)
    if (report && typeof report === 'string') {
      const dest = path.join(targetDir, 'Inspection Report.pdf');
      try { await fsp.copyFile(report, dest); } catch (e) { /* ignore copy failure */ }
    }

    // Write comment.txt
    const body =
`Comment:
${comment || ''}

Inspector:
${inspector || ''}`;
    await fsp.writeFile(path.join(targetDir, 'comment.txt'), body, 'utf-8');

    return { success: true, folderName: path.basename(targetDir) };
  } catch (e) {
    console.error('[inspection_history:createInspectionFolder] failed:', e);
    return { success: false, message: String(e) };
  }
}

module.exports = {
  listInspections,
  deleteInspectionFolder,
  createInspectionFolder,
};
