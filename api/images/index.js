const supabase = require('../../lib/supabase');

// GET /api/images?folder=&search=&tags=&moodboard=&page=&limit=
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { folder, search, tags, moodboard, page = 1, limit = 60 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const lim = parseInt(limit);

  try {
    // Step 1: resolve image IDs from tag / moodboard filters
    let filteredIds = null; // null = no filter applied yet

    if (tags) {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      if (tagList.length > 0) {
        const { data: tagRows } = await supabase
          .from('tags')
          .select('id')
          .in('name', tagList);

        const tagIds = (tagRows || []).map(r => r.id);

        if (tagIds.length === 0) {
          return res.json({ images: [], total: 0, page: parseInt(page), limit: lim });
        }

        const { data: itRows } = await supabase
          .from('image_tags')
          .select('image_id')
          .in('tag_id', tagIds);

        filteredIds = [...new Set((itRows || []).map(r => r.image_id))];
        if (filteredIds.length === 0) {
          return res.json({ images: [], total: 0, page: parseInt(page), limit: lim });
        }
      }
    }

    if (moodboard) {
      const { data: mbRows } = await supabase
        .from('moodboard_images')
        .select('image_id')
        .eq('moodboard_id', parseInt(moodboard))
        .order('sort_order');

      const mbIds = (mbRows || []).map(r => r.image_id);
      filteredIds = filteredIds
        ? filteredIds.filter(id => mbIds.includes(id))
        : mbIds;
      if (filteredIds.length === 0) {
        return res.json({ images: [], total: 0, page: parseInt(page), limit: lim });
      }
    }

    // Step 2: build images query
    let query = supabase
      .from('images')
      .select('id, filepath, folder, filename, width, height, thumbnail_path, storage_path, autotagged_at', { count: 'exact' });

    if (filteredIds !== null) query = query.in('id', filteredIds);
    if (folder) query = query.eq('folder', folder);
    if (search) query = query.or(`filename.ilike.%${search}%`);

    query = query.order('folder').order('filename').range(offset, offset + lim - 1);

    const { data: images, count, error } = await query;
    if (error) throw error;

    // Step 3: attach tags to each image
    const imageIds = (images || []).map(i => i.id);
    let tagMap = {};

    if (imageIds.length > 0) {
      const { data: tagRows } = await supabase
        .from('image_tags')
        .select('image_id, auto, tags(name)')
        .in('image_id', imageIds);

      for (const row of (tagRows || [])) {
        if (!tagMap[row.image_id]) tagMap[row.image_id] = [];
        tagMap[row.image_id].push({ name: row.tags.name, auto: row.auto });
      }
    }

    const result = (images || []).map(img => ({
      ...img,
      tags: (tagMap[img.id] || []).sort((a, b) => a.name.localeCompare(b.name)),
    }));

    res.json({ images: result, total: count || 0, page: parseInt(page), limit: lim });
  } catch (e) {
    console.error('GET /api/images error:', e);
    res.status(500).json({ error: e.message });
  }
};
