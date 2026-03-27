const supabase = require('../../lib/supabase');

// GET /api/tags — all tags with usage counts
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const { data: tags, error } = await supabase
      .from('tags')
      .select('name, image_tags(count)');

    if (error) throw error;

    const result = (tags || [])
      .map(t => ({ name: t.name, count: t.image_tags?.[0]?.count ?? 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    res.json(result);
  } catch (e) {
    // Fallback: simpler query if the join count doesn't work
    try {
      const { data: allTags } = await supabase.from('tags').select('id, name').order('name');
      const { data: itRows } = await supabase.from('image_tags').select('tag_id');

      const counts = {};
      for (const r of (itRows || [])) counts[r.tag_id] = (counts[r.tag_id] || 0) + 1;

      const result = (allTags || [])
        .map(t => ({ name: t.name, count: counts[t.id] || 0 }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

      res.json(result);
    } catch (e2) {
      res.status(500).json({ error: e2.message });
    }
  }
};
