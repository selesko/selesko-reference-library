/**
 * upload.js — One-time bulk upload of your Google Drive reference library to Supabase Storage.
 *
 * Run from the project root:
 *   node scripts/upload.js
 *
 * Skips images already in the database. Safe to re-run after interruptions.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');

const IMAGE_ROOT = process.env.IMAGE_ROOT || 'C:\\Users\\jsgol\\My Drive\\03 REFERENCE LIBRARY';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function isImage(filename) {
  return IMAGE_EXTS.has(path.extname(filename).toLowerCase());
}

function scanDirectory(dir, rootDir) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...scanDirectory(fullPath, rootDir));
    } else if (entry.isFile() && isImage(entry.name)) {
      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      const folder = path.relative(rootDir, dir).replace(/\\/g, '/');
      results.push({ relativePath, folder, filename: entry.name, fullPath });
    }
  }
  return results;
}

async function generateThumbnail(srcPath) {
  return sharp(srcPath)
    .resize(600, 600, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: 82 })
    .toBuffer();
}

async function uploadImage(file, existingPaths) {
  if (existingPaths.has(file.relativePath)) {
    return 'skipped';
  }

  const fileBuffer = fs.readFileSync(file.fullPath);
  const storagePath = file.relativePath; // e.g. "01 Exteriors/my-image.jpg"

  // Upload original
  const { error: uploadErr } = await supabase.storage
    .from('images')
    .upload(storagePath, fileBuffer, {
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (uploadErr && uploadErr.message !== 'The resource already exists') {
    throw new Error(`Storage upload failed: ${uploadErr.message}`);
  }

  // Generate + upload thumbnail
  let thumbBuffer;
  try {
    thumbBuffer = await generateThumbnail(file.fullPath);
  } catch (e) {
    console.warn(`  ⚠ Thumbnail failed for ${file.filename}: ${e.message}`);
  }

  const thumbPath = storagePath.replace(/\.[^.]+$/, '.jpg');
  if (thumbBuffer) {
    await supabase.storage
      .from('thumbnails')
      .upload(thumbPath, thumbBuffer, { contentType: 'image/jpeg', upsert: true });
  }

  // Get public URLs
  const { data: imgUrl }   = supabase.storage.from('images').getPublicUrl(storagePath);
  const { data: thumbUrl } = supabase.storage.from('thumbnails').getPublicUrl(thumbPath);

  // Get image dimensions
  let width = null, height = null, filesize = null;
  try {
    const meta = await sharp(file.fullPath).metadata();
    width = meta.width; height = meta.height;
    filesize = fs.statSync(file.fullPath).size;
  } catch {}

  // Insert into database
  const { error: dbErr } = await supabase.from('images').insert({
    filepath:       file.relativePath,
    folder:         file.folder,
    filename:       file.filename,
    filesize,
    width,
    height,
    storage_path:   imgUrl.publicUrl,
    thumbnail_path: thumbUrl.publicUrl,
  });

  if (dbErr && !dbErr.message.includes('duplicate')) {
    throw new Error(`DB insert failed: ${dbErr.message}`);
  }

  return 'uploaded';
}

async function main() {
  console.log('\nSelesko Studio — Reference Library Upload\n');
  console.log(`Source: ${IMAGE_ROOT}`);
  console.log(`Target: ${process.env.SUPABASE_URL}\n`);

  if (!process.env.SUPABASE_SERVICE_KEY) {
    console.error('❌  SUPABASE_SERVICE_KEY not set in .env');
    process.exit(1);
  }

  // Get already-uploaded filepaths
  const { data: existing } = await supabase.from('images').select('filepath');
  const existingPaths = new Set((existing || []).map(r => r.filepath));
  console.log(`Already in database: ${existingPaths.size} images\n`);

  const files = scanDirectory(IMAGE_ROOT, IMAGE_ROOT);
  const toUpload = files.filter(f => !existingPaths.has(f.relativePath));
  console.log(`Found ${files.length} images total, ${toUpload.length} to upload\n`);

  if (toUpload.length === 0) {
    console.log('✓ Nothing to do — all images already uploaded.');
    return;
  }

  let uploaded = 0, skipped = 0, errors = 0;

  for (let i = 0; i < toUpload.length; i++) {
    const file = toUpload[i];
    const pct  = Math.round(((i + 1) / toUpload.length) * 100);
    process.stdout.write(`\r  [${pct}%] ${i + 1}/${toUpload.length} — ${file.filename.slice(0, 50)}`);

    try {
      const result = await uploadImage(file, existingPaths);
      if (result === 'skipped') skipped++;
      else uploaded++;
    } catch (e) {
      errors++;
      console.error(`\n  ❌ ${file.filename}: ${e.message}`);
    }
  }

  console.log(`\n\n✓ Upload complete!`);
  console.log(`  Uploaded: ${uploaded}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Errors:   ${errors}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
