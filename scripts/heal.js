require('dotenv').config({ path: '.env.local' });
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const IMAGE_ROOT = process.env.IMAGE_ROOT || "/Users/jeffgoldblatt/Library/CloudStorage/GoogleDrive-jsgoldblatt@gmail.com/My Drive/03 REFERENCE LIBRARY";
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']);

if (!process.env.SUPABASE_SERVICE_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY not set in .env.local');
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

function isImage(filename) {
  return IMAGE_EXTS.has(path.extname(filename).toLowerCase());
}

async function getAllLocalFiles(dir) {
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    for (const file of list) {
      if (file.startsWith('.')) continue; 
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

const isClean = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_\d+)?\.[a-zA-Z0-9]+$/;

async function main() {
  console.log('--- Selesko Studio Database Healer ---');
  console.log(`Scanning local library for cleanly named files...`);

  const allFiles = await getAllLocalFiles(IMAGE_ROOT);
  const cleanLocalFiles = [];

  for (const fullPath of allFiles) {
    const filename = path.basename(fullPath);
    if (isClean.test(filename)) {
      const stats = fs.statSync(fullPath);
      cleanLocalFiles.push({
        fullPath,
        filename,
        filesize: stats.size,
        relativePath: path.relative(IMAGE_ROOT, fullPath).replace(/\\/g, '/')
      });
    }
  }
  console.log(`Found ${cleanLocalFiles.length} cleanly formatted local files.`);

  console.log(`\nFetching all messy rows from Database...`);
  const { data: allDbImages, error: dbErr } = await supabase
    .from('images')
    .select('id, filename, filepath, filesize');
  
  if (dbErr) {
    console.error("DB Error:", dbErr);
    return;
  }

  const messyDbRows = allDbImages.filter(row => !isClean.test(row.filename));
  console.log(`Found ${messyDbRows.length} orphaned messy rows needing links.`);

  let resolvedCount = 0;
  let missingCount = 0;

  for (const dbRow of messyDbRows) {
    // Math matching
    const matches = cleanLocalFiles.filter(f => f.filesize === dbRow.filesize);

    if (matches.length === 0) {
      console.warn(`\n  ⚠ Failed to heal: ${dbRow.filename}. No local file with size ${dbRow.filesize} bytes!`);
      missingCount++;
      continue;
    }

    let match = matches[0];
    if (matches.length > 1) {
      const oldFolder = path.dirname(dbRow.filepath).toLowerCase().trim();
      match = matches.find(f => path.dirname(f.relativePath).toLowerCase().trim() === oldFolder) || matches[0];
    }

    console.log(`\nHealing: ${dbRow.filename}`);
    console.log(`  ✓ Matched locally to: ${match.filename}`);

    const oldStoragePath = sanitizeKey(dbRow.filepath);
    const oldThumbPath = sanitizeKey(dbRow.filepath.replace(/\.[^.]+$/, '.jpg'));

    const newStoragePath = sanitizeKey(match.relativePath);
    const newThumbPath = sanitizeKey(match.relativePath.replace(/\.[^.]+$/, '.jpg'));

    const { error: moveImgErr } = await supabase.storage.from('images').move(oldStoragePath, newStoragePath);
    if (moveImgErr && moveImgErr.message.indexOf('not found') === -1) {
       console.warn(`    ⚠ Move Image Error: ${moveImgErr.message}`);
    }
    
    const { error: moveThumbErr } = await supabase.storage.from('thumbnails').move(oldThumbPath, newThumbPath);
    if (moveThumbErr && moveThumbErr.message.indexOf('not found') === -1) {
       console.warn(`    ⚠ Move Thumb Error: ${moveThumbErr.message}`);
    }

    const { data: imgUrl }   = supabase.storage.from('images').getPublicUrl(newStoragePath);
    const { data: thumbUrl } = supabase.storage.from('thumbnails').getPublicUrl(newThumbPath);

    const { error: updateErr } = await supabase.from('images').update({
      filename: match.filename,
      filepath: match.relativePath,
      storage_path: imgUrl.publicUrl,
      thumbnail_path: thumbUrl.publicUrl
    }).eq('id', dbRow.id);

    if (updateErr) {
      console.error(`    ❌ DB Update Error: ${updateErr.message}`);
      missingCount++;
    } else {
      console.log('  ✓ Supabase fully healed and permanently relinked.');
      resolvedCount++;
    }
  }

  console.log(`\n===========================================`);
  console.log(`Healer Complete!`);
  console.log(`- Successfully matched & healed: ${resolvedCount} out of ${messyDbRows.length}`);
  if (missingCount > 0) {
    console.log(`- Missing/Failed: ${missingCount}`);
  }
}

main().catch(console.error);
