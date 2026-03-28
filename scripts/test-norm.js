require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const { data: dbImages } = await supabase.from('images').select('filepath, filename').limit(15);
  console.log("Sample DB Filepaths:");
  dbImages.forEach(i => console.log(i.filepath));

  const IMAGE_ROOT = "/Users/jeffgoldblatt/Library/CloudStorage/GoogleDrive-jsgoldblatt@gmail.com/My Drive/03 REFERENCE LIBRARY";
  const folders = fs.readdirSync(IMAGE_ROOT);
  console.log("\nSample Local Folders:");
  folders.forEach(f => console.log(f));
}
main();
