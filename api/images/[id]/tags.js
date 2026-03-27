const supabase = require('../../../lib/supabase');

// POST /api/images/:id/tags   — add tags
// DELETE /api/images/:id/tags?tag=xxx  — remove a tag
module.exports = async function handler(req, res) {
  const { id, tag } = req.query;

  try {
    if (req.method === 'POST') {
      const { tags, auto = false } = req.body;
      if (!Array.isArray(tags) || tags.length === 0) {
        return res.status(400).json({ error: 'tags must be a non-empty array' });
      }

      for (const name of tags) {
        const clean = name.trim().toLowerCase();
        if (!clean) continue;

        // Upsert tag
        const { data: tagRow } = await supabase
          .from('tags')
          .upsert({ name: clean }, { onConflict: 'name' })
          .select('id')
          .single();

        const tagId = tagRow?.id;
        if (!tagId) {
          const { data: existing } = await supabase.from('tags').select('id').eq('name', clean).single();
          if (!existing) continue;
          await supabase.from('image_tags').upsert({ image_id: parseInt(id), tag_id: existing.id, auto }, { onConflict: 'image_id,tag_id', ignoreDuplicates: true });
        } else {
          await supabase.from('image_tags').upsert({ image_id: parseInt(id), tag_id: tagId, auto }, { onConflict: 'image_id,tag_id', ignoreDuplicates: true });
        }
      }

      const { data: tagRows } = await supabase
        .from('image_tags')
        .select('auto, tags(name)')
        .eq('image_id', id);

      return res.json({
        tags: (tagRows || []).map(r => ({ name: r.tags.name, auto: r.auto })).sort((a, b) => a.name.localeCompare(b.name))
      });
    }

    if (req.method === 'DELETE') {
      if (!tag) return res.status(400).json({ error: 'tag query param required' });

      const { data: tagRow } = await supabase.from('tags').select('id').eq('name', tag).single();
      if (!tagRow) return res.status(404).json({ error: 'Tag not found' });

      await supabase.from('image_tags').delete().eq('image_id', parseInt(id)).eq('tag_id', tagRow.id);

      // Clean up orphan tag
      const { count } = await supabase.from('image_tags').select('*', { count: 'exact', head: true }).eq('tag_id', tagRow.id);
      if (count === 0) await supabase.from('tags').delete().eq('id', tagRow.id);

      return res.json({ ok: true });
    }

    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
