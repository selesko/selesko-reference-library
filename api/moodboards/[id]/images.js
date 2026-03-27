const supabase = require('../../../lib/supabase');

// POST   /api/moodboards/:id/images        — add images { imageIds: [] }
// DELETE /api/moodboards/:id/images?imageId=  — remove one image
module.exports = async function handler(req, res) {
  const { id, imageId } = req.query;

  try {
    if (req.method === 'POST') {
      const { imageIds } = req.body;
      if (!Array.isArray(imageIds)) return res.status(400).json({ error: 'imageIds must be an array' });

      // Get current max sort_order
      const { data: maxRow } = await supabase
        .from('moodboard_images')
        .select('sort_order')
        .eq('moodboard_id', id)
        .order('sort_order', { ascending: false })
        .limit(1);

      const maxOrder = maxRow?.[0]?.sort_order ?? -1;

      const rows = imageIds.map((imgId, i) => ({
        moodboard_id: parseInt(id),
        image_id: parseInt(imgId),
        sort_order: maxOrder + 1 + i,
      }));

      await supabase.from('moodboard_images').upsert(rows, { onConflict: 'moodboard_id,image_id', ignoreDuplicates: true });
      return res.json({ ok: true });
    }

    if (req.method === 'DELETE') {
      if (!imageId) return res.status(400).json({ error: 'imageId required' });
      await supabase.from('moodboard_images').delete().eq('moodboard_id', id).eq('image_id', imageId);
      return res.json({ ok: true });
    }

    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
