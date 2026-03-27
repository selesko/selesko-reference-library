const supabase = require('../../lib/supabase');

// GET    /api/moodboards/:id          — get board + images
// PATCH  /api/moodboards/:id          — update name/description
// DELETE /api/moodboards/:id          — delete board
module.exports = async function handler(req, res) {
  const { id } = req.query;

  try {
    if (req.method === 'GET') {
      const { data: board, error } = await supabase
        .from('moodboards')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !board) return res.status(404).json({ error: 'Not found' });

      const { data: mbImages } = await supabase
        .from('moodboard_images')
        .select('sort_order, images(id, filepath, folder, filename, thumbnail_path, storage_path)')
        .eq('moodboard_id', id)
        .order('sort_order');

      board.images = (mbImages || []).map(r => ({ ...r.images, sort_order: r.sort_order }));
      return res.json(board);
    }

    if (req.method === 'PATCH') {
      const { name, description } = req.body;
      const { data, error } = await supabase
        .from('moodboards')
        .update({ ...(name && { name: name.trim() }), ...(description !== undefined && { description }) })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return res.json(data);
    }

    if (req.method === 'DELETE') {
      await supabase.from('moodboards').delete().eq('id', id);
      return res.json({ ok: true });
    }

    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
