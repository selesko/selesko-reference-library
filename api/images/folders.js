const supabase = require('../../lib/supabase');

// GET /api/images/folders
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const { data, error } = await supabase
      .from('images')
      .select('folder');

    if (error) throw error;

    // Count per folder
    const counts = {};
    for (const row of (data || [])) {
      counts[row.folder] = (counts[row.folder] || 0) + 1;
    }

    const folders = Object.entries(counts)
      .map(([folder, count]) => ({ folder, count }))
      .sort((a, b) => a.folder.localeCompare(b.folder));

    res.json(folders);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
