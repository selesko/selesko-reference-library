require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function main() {
  const { data, error } = await supabase.from('images').select('id, filename');
  if (error) { console.error(error); return; }
  
  let clean = 0;
  let messy = 0;
  const isClean = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(_\d+)?\.[a-zA-Z0-9]+$/;
  data.forEach(row => {
    if (isClean.test(row.filename)) clean++;
    else messy++;
  });
  console.log(`DB Stats:\nClean names: ${clean}\nMessy names: ${messy}\nTotal: ${data.length}`);
}
main();
