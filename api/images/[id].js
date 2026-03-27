const supabase = require('../../lib/supabase');

// GET /api/images/:id
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { id } = req.query;

  try {
    const { data: img, error } = await supabase
      .from('images')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !img) return res.status(404).json({ error: 'Not found' });

    const { data: tagRows } = await supabase
      .from('image_tags')
      .select('auto, tags(name)')
      .eq('image_id', id);

    img.tags = (tagRows || [])
      .map(r => ({ name: r.tags.name, auto: r.auto }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json(img);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
