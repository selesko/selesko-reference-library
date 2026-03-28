require('dotenv').config({ path: '.env.local' });
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const IMAGE_ROOT = "/Users/jeffgoldblatt/Library/CloudStorage/GoogleDrive-jsgoldblatt@gmail.com/My Drive/03 REFERENCE LIBRARY";
const testPath = "/Users/jeffgoldblatt/Library/CloudStorage/GoogleDrive-jsgoldblatt@gmail.com/My Drive/03 REFERENCE LIBRARY/01 Exteriors/576555710_1194558455878021_8373577059440195870_n.jpg";

async function main() {
  const relativePath = path.relative(IMAGE_ROOT, testPath).replace(/\\/g, '/');
  console.log("Calculated relativePath:", relativePath);

  const { data, error } = await supabase.from('images').select('id, filepath, filename').eq('filepath', relativePath).single();
  console.log("DB lookup error:", error);
  console.log("DB image found:", data);
}
main();
