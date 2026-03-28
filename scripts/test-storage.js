require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function test() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const testBuffer = Buffer.from('test');

  // Test cases for "Invalid key"
  const cases = [
    { name: 'Simple space', key: 'test folder/test image.txt' },
    { name: 'Em Dash', key: 'test — dash.txt' },
    { name: 'Narrow No-Break Space', key: 'test\u202fat.txt' },
    { name: 'Unicode Emoji', key: 'test ✦.txt' }
  ];

  for (const c of cases) {
    console.log(`Testing: ${c.name} (${c.key})`);
    const { error } = await supabase.storage.from('images').upload(c.key, testBuffer, { upsert: true });
    if (error) {
      console.log(`  ❌ Failed: ${error.message}`);
    } else {
      console.log(`  ✅ Success`);
      await supabase.storage.from('images').remove([c.key]);
    }
  }
}

test().catch(console.error);
