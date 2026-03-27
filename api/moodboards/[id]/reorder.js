const supabase = require('../../../lib/supabase');

// POST /api/moodboards/:id/reorder — { imageIds: [ordered array of image IDs] }
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { id } = req.query;
  const { imageIds } = req.body;

  if (!Array.isArray(imageIds)) return res.status(400).json({ error: 'imageIds must be an array' });

  try {
    const updates = imageIds.map((imgId, i) =>
      supabase
        .from('moodboard_images')
        .update({ sort_order: i })
        .eq('moodboard_id', id)
        .eq('image_id', imgId)
    );

    await Promise.all(updates);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
