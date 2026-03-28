require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const IMAGE_ROOT = process.env.IMAGE_ROOT || 'C:\\Users\\jsgol\\My Drive\\03 REFERENCE LIBRARY';
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']);

if (!process.env.SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY not set in .env');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function sanitizeKey(key) {
  return key
    .replace(/\u202f/g, ' ')
    .replace(/—/g, '-')
    .replace(/[^\x20-\x7E]/g, '-')
    .replace(/[\*\?\":<>|]/g, '-');
}

function getSafeRenamePath(dir, baseDate, ext) {
  const pad = n => String(n).padStart(2, '0');
  const baseName = `${baseDate.getFullYear()}-${pad(baseDate.getMonth()+1)}-${pad(baseDate.getDate())}_${pad(baseDate.getHours())}-${pad(baseDate.getMinutes())}-${pad(baseDate.getSeconds())}`;
  
  let resultPath = path.join(dir, `${baseName}${ext}`);
  let counter = 1;
  while (fs.existsSync(resultPath)) {
    resultPath = path.join(dir, `${baseName}_${counter}${ext}`);
    counter++;
  }
  return resultPath;
}

function isImage(filename) {
  return IMAGE_EXTS.has(path.extname(filename).toLowerCase());
}

async function getAllLocalFiles(dir) {
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      if (file.startsWith('.')) continue; // skip hidden folders
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat && stat.isDirectory()) {
        results = results.concat(await getAllLocalFiles(filePath));
      } else if (isImage(file)) {
        results.push(filePath);
      }
    }
  } catch (e) {
    console.error(`Error reading ${dir}: ${e.message}`);
  }
  return results;
}

async function main() {
  console.log('--- Selesko Studio Retroactive Cleaner ---');
  console.log(`Scanning local Google Drive library: ${IMAGE_ROOT}`);
  
  const allFiles = await getAllLocalFiles(IMAGE_ROOT);
  console.log(`Found ${allFiles.length} images total.\n`);

  let renamedCount = 0;
  let skippedClean = 0;

  for (const fullPath of allFiles) {
    const filename = path.basename(fullPath);
    const relativePath = path.relative(IMAGE_ROOT, fullPath).replace(/\\/g, '/');
    const folder = path.relative(IMAGE_ROOT, path.dirname(fullPath)).replace(/\\/g, '/');
    const ext = path.extname(filename).toLowerCase();

    // Check if filename is already clean
    const isClean = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_\d+)?\.[a-zA-Z0-9]+$/.test(filename);
    if (isClean) {
      skippedClean++;
      continue;
    }

    console.log(`\nProcessing messy file: ${filename}`);

    // We must query the database to see if this particular file exists there by filepath
    const { data: dbImage, error: dbErr } = await supabase
      .from('images')
      .select('*')
      .eq('filepath', relativePath)
      .single();

    // Determine the base date to use (prefer database created_at, fallback to file stat created time)
    let baseDate = fs.statSync(fullPath).birthtime || fs.statSync(fullPath).mtime;
    if (dbImage && dbImage.created_at) {
      baseDate = new Date(dbImage.created_at);
    }

    const newPath = getSafeRenamePath(path.dirname(fullPath), baseDate, ext);
    const newFilename = path.basename(newPath);
    const newRelativePath = path.relative(IMAGE_ROOT, newPath).replace(/\\/g, '/');

    // If it exists in DB, move in Supabase Storage and update DB
    if (dbImage) {
      console.log(`  🔗 Found in Database. Migrating storage links...`);
      const oldStoragePath = sanitizeKey(relativePath);
      const oldThumbPath = sanitizeKey(relativePath.replace(/\.[^.]+$/, '.jpg'));

      const newStoragePath = sanitizeKey(newRelativePath);
      const newThumbPath = sanitizeKey(newRelativePath.replace(/\.[^.]+$/, '.jpg'));

      // 1. Copy Storage File (Move inherently deletes old bucket key, but moving is not atomic, so we just .move())
      const { error: moveImgErr } = await supabase.storage.from('images').move(oldStoragePath, newStoragePath);
      if (moveImgErr && moveImgErr.message.indexOf('not found') === -1) {
         console.warn(`    ⚠ Move Image Error: ${moveImgErr.message}`);
      }
      
      // 2. Move Thumbnail
      const { error: moveThumbErr } = await supabase.storage.from('thumbnails').move(oldThumbPath, newThumbPath);
      if (moveThumbErr && moveThumbErr.message.indexOf('not found') === -1) {
         console.warn(`    ⚠ Move Thumb Error: ${moveThumbErr.message}`);
      }

      // 3. Update paths in Database
      const { data: imgUrl }   = supabase.storage.from('images').getPublicUrl(newStoragePath);
      const { data: thumbUrl } = supabase.storage.from('thumbnails').getPublicUrl(newThumbPath);

      const { error: updateErr } = await supabase.from('images').update({
        filename: newFilename,
        filepath: newRelativePath,
        storage_path: imgUrl.publicUrl,
        thumbnail_path: thumbUrl.publicUrl
      }).eq('id', dbImage.id);

      if (updateErr) {
        console.error(`    ❌ DB Update Error: ${updateErr.message}`);
        continue; // abort before local rename if DB fails
      }
      console.log('  ✓ Supabase paths updated.');
    } else {
      console.log(`  (File not yet uploaded to Supabase — formatting natively)`);
    }

    // Finally, safely rename the file in Google Drive locally
    try {
      fs.renameSync(fullPath, newPath);
      console.log(`  ✓ Renamed Locally: -> ${newFilename}`);
      renamedCount++;
    } catch (e) {
      console.error(`  ❌ Local Rename Error: ${e.message}`);
    }
  }

  console.log(`\n===========================================`);
  console.log(`Cleanup Complete!`);
  console.log(`- Files correctly formatted previously: ${skippedClean}`);
  console.log(`- Files safely modernized: ${renamedCount}`);
}

main().catch(console.error);
