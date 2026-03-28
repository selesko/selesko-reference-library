/**
 * watch.js — Watches your Google Drive reference library folder and automatically
 * uploads new images to Supabase Storage as you add them.
 *
 * Run from the project root:
 *   node scripts/watch.js
 *
 * Keep this running in the background whenever you're adding images.
 * New images are uploaded within a few seconds of being saved.
 */

require('dotenv').config();
const fs      = require('fs');
const path    = require('path');
const chokidar = require('chokidar');
const { createClient } = require('@supabase/supabase-js');
const sharp   = require('sharp');

const IMAGE_ROOT = process.env.IMAGE_ROOT || 'C:\\Users\\jsgol\\My Drive\\03 REFERENCE LIBRARY';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function isImage(filename) {
  return IMAGE_EXTS.has(path.extname(filename).toLowerCase());
}

function sanitizeKey(key) {
  return key
    .replace(/\u202f/g, ' ') // Mac narrow no-break space
    .replace(/—/g, '-')      // Em-dash
    .replace(/[^\x20-\x7E]/g, '-') // Any non-ASCII
    .replace(/[\*\?\":<>|]/g, '-'); // System reserved
}

// Wait for a file to stabilise before reading it (Google Drive can write slowly)
function waitForFile(filePath, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    let lastSize = -1;

    const check = () => {
      try {
        const { size } = fs.statSync(filePath);
        if (size === lastSize && size > 0) return resolve();
        lastSize = size;
        if (Date.now() - start > timeout) return reject(new Error('File stabilisation timeout'));
        setTimeout(check, 500);
      } catch {
        if (Date.now() - start > timeout) return reject(new Error('File not accessible'));
        setTimeout(check, 500);
      }
    };
    setTimeout(check, 1000); // initial delay
  });
}

async function handleNewImage(fullPath) {
  const filename     = path.basename(fullPath);
  const relativePath = path.relative(IMAGE_ROOT, fullPath).replace(/\\/g, '/');
  const folder       = path.relative(IMAGE_ROOT, path.dirname(fullPath)).replace(/\\/g, '/');

  // Check if already in DB
  const { data: existing } = await supabase
    .from('images')
    .select('id')
    .eq('filepath', relativePath)
    .single();

  if (existing) {
    console.log(`  ↩ Already in library: ${filename}`);
    return;
  }

  console.log(`  ↑ Uploading: ${filename}`);

  await waitForFile(fullPath);

  const fileBuffer = fs.readFileSync(fullPath);
  const storagePath = sanitizeKey(relativePath);

  // Upload original
  const { error: uploadErr } = await supabase.storage
    .from('images')
    .upload(storagePath, fileBuffer, { contentType: 'image/jpeg', upsert: false });

  if (uploadErr && uploadErr.message !== 'The resource already exists') {
    throw new Error(`Storage upload failed: ${uploadErr.message}`);
  }

  // Generate + upload thumbnail
  const thumbPath = sanitizeKey(relativePath.replace(/\.[^.]+$/, '.jpg'));
  try {
    const thumbBuffer = await sharp(fullPath)
      .resize(600, 600, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 82 })
      .toBuffer();

    await supabase.storage
      .from('thumbnails')
      .upload(thumbPath, thumbBuffer, { contentType: 'image/jpeg', upsert: true });
  } catch (e) {
    console.warn(`  ⚠ Thumbnail failed: ${e.message}`);
  }

  // Get public URLs
  const { data: imgUrl }   = supabase.storage.from('images').getPublicUrl(storagePath);
  const { data: thumbUrl } = supabase.storage.from('thumbnails').getPublicUrl(thumbPath);

  // Dimensions + filesize
  let width = null, height = null, filesize = null;
  try {
    const meta = await sharp(fullPath).metadata();
    width = meta.width; height = meta.height;
    filesize = fs.statSync(fullPath).size;
  } catch {}

  // Insert into DB
  await supabase.from('images').insert({
    filepath:       relativePath,
    folder,
    filename,
    filesize,
    width,
    height,
    storage_path:   imgUrl.publicUrl,
    thumbnail_path: thumbUrl.publicUrl,
  });

  console.log(`  ✓ Added to library: ${filename}`);
}

async function main() {
  console.log('\nSelesko Studio — Reference Library Watcher\n');
  console.log(`Watching: ${IMAGE_ROOT}`);
  console.log('Drop images into any folder in your Drive library and they\'ll appear automatically.\n');

  if (!process.env.SUPABASE_SERVICE_KEY) {
    console.error('❌  SUPABASE_SERVICE_KEY not set in .env');
    process.exit(1);
  }

  const watcher = chokidar.watch(IMAGE_ROOT, {
    ignored:    /(^|[/\\])\../,   // ignore dotfiles
    persistent: true,
    ignoreInitial: true,          // don't re-process existing files
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 500,
    },
  });

  watcher.on('add', async (filePath) => {
    if (!isImage(path.basename(filePath))) return;
    try {
      await handleNewImage(filePath);
    } catch (e) {
      console.error(`  ❌ Error processing ${path.basename(filePath)}: ${e.message}`);
    }
  });

  watcher.on('error', e => console.error('Watcher error:', e));

  console.log('Watching for new images… (Ctrl+C to stop)\n');
}

main().catch(e => { console.error(e); process.exit(1); });
