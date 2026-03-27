const supabase = require('../../lib/supabase');

// GET  /api/moodboards        — list all
// POST /api/moodboards        — create new
module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { data: boards, error } = await supabase
        .from('moodboards')
        .select('*, moodboard_images(count)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const result = (boards || []).map(b => ({
        ...b,
        image_count: b.moodboard_images?.[0]?.count ?? 0,
        moodboard_images: undefined,
      }));

      return res.json(result);
    }

    if (req.method === 'POST') {
      const { name, description } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

      const { data, error } = await supabase
        .from('moodboards')
        .insert({ name: name.trim(), description: description || null })
        .select()
        .single();

      if (error) throw error;
      return res.json(data);
    }

    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
