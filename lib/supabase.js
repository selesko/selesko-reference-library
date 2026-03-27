const { createClient } = require('@supabase/supabase-js');

// Server-side client — uses service role key, bypasses RLS
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = supabase;
