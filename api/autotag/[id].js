const Anthropic = require('@anthropic-ai/sdk');
const genAI = require('../../lib/gemini');
const supabase = require('../../lib/supabase');

const SYSTEM_PROMPT = `You are an expert architectural image tagger for Selesko Studio, a design firm.
Analyze the image and return a JSON array of 4-8 tags chosen ONLY from the approved taxonomy below.

APPROVED TAGS BY CATEGORY:

Space: kitchen, bathroom, bedroom, living-room, dining, entry-foyer, office-study, staircase, hallway, exterior-facade, courtyard, rooftop, landscape-garden, lobby, common-area

Building Type: single-family, multi-family, cabin

Material: wood, concrete, brick, steel-metal, glass, stone, tile, brass-bronze, plaster, rammed-earth, terrazzo, textile-fabric, leather

Style: mid-century, rustic, scandinavian, industrial, minimalist, brutalist, contemporary, traditional, organic-biophilic, eco-sustainable, japandi, craftsman

Mood: warm, cool-calm, moody-dark, bright-airy, cozy, bold-dramatic, serene, raw-unfinished

Element / Detail: millwork, cabinetry, joinery, hardware, fireplace, ceiling, flooring, aperture-window, door, railing, overhang, facade-screen, roofline

Lighting: clerestory, skylight, dappled-light, indirect-light, shadow-play, task-lighting, statement-fixture

Context / Site: urban, suburban, rural, alpine, high-desert, coastal, forest, steep-slope

RULES:
- Only use tags from the list above — no invented tags
- Choose 4-8 tags that are clearly visible in the image
- Always include at least one Space or Building Type tag if determinable
- Always include a Mood tag
- Return ONLY a JSON array of strings, nothing else

Example: ["living-room", "single-family", "wood", "concrete", "minimalist", "warm", "dappled-light", "aperture-window"]`;

async function callClaude(base64, mediaType) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: 'Tag this image.' },
      ],
    }],
  });
  return response.content[0].text.trim();
}

async function callGemini(base64, mediaType) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const result = await model.generateContent([
    SYSTEM_PROMPT,
    {
      inlineData: {
        data: base64,
        mimeType: mediaType
      }
    },
    "Tag this image."
  ]);
  return result.response.text().trim();
}

// GET  /api/autotag/:id  — return untagged image count (when id = "untagged")
// POST /api/autotag/:id?provider=claude|gemini  — tag a single image by ID
module.exports = async function handler(req, res) {
  const { id, provider = 'claude' } = req.query;

  // Special route: GET /api/autotag/untagged — returns IDs of untagged images
  if (req.method === 'GET' && id === 'untagged') {
    try {
      const { data, error } = await supabase
        .from('images')
        .select('id')
        .is('autotagged_at', null)
        .not('storage_path', 'is', null);

      if (error) throw error;
      return res.json({ ids: (data || []).map(r => r.id) });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  try {
    // Fetch image record
    const { data: img, error: imgErr } = await supabase
      .from('images')
      .select('id, filename, filepath, storage_path')
      .eq('id', id)
      .single();

    if (imgErr || !img) return res.status(404).json({ error: 'Image not found' });
    if (!img.storage_path) return res.status(400).json({ error: 'Image not yet uploaded to storage' });

    // Download image from Supabase Storage
    // Use filepath as the storage key — storage_path is a full public URL, not a bucket key
    const storageKey = img.filepath
      .replace(/\u202f/g, ' ').replace(/—/g, '-').replace(/[^\x20-\x7E]/g, '-').replace(/[\*\?\":<>|]/g, '-');
    const { data: fileData, error: dlErr } = await supabase.storage
      .from('images')
      .download(storageKey);

    if (dlErr) throw dlErr;

    const arrayBuffer = await fileData.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    const ext = img.filename.split('.').pop().toLowerCase();
    const mediaTypeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };
    const mediaType = mediaTypeMap[ext] || 'image/jpeg';

    // Call chosen provider
    let raw;
    if (provider === 'gemini') {
      raw = await callGemini(base64, mediaType);
    } else {
      raw = await callClaude(base64, mediaType);
    }

    let tags;
    try {
      const match = raw.match(/\[.*\]/s);
      tags = JSON.parse(match ? match[0] : raw);
    } catch {
      throw new Error('Failed to parse tags: ' + raw);
    }

    if (!Array.isArray(tags)) throw new Error('Expected array of tags');

    // Remove previous auto-tags, insert new ones
    const { data: existingAutoTags } = await supabase
      .from('image_tags')
      .select('tag_id')
      .eq('image_id', id)
      .eq('auto', true);

    if (existingAutoTags?.length > 0) {
      await supabase.from('image_tags').delete().eq('image_id', id).eq('auto', true);
    }

    for (const name of tags) {
      const clean = name.trim().toLowerCase();
      if (!clean) continue;

      // Find or create tag (only from taxonomy)
      let { data: tagRow } = await supabase.from('tags').select('id').eq('name', clean).single();
      if (!tagRow) {
        const { data: newTag } = await supabase.from('tags').insert({ name: clean }).select('id').single();
        tagRow = newTag;
      }
      if (tagRow) {
        await supabase.from('image_tags').upsert(
          { image_id: parseInt(id), tag_id: tagRow.id, auto: true },
          { onConflict: 'image_id,tag_id', ignoreDuplicates: true }
        );
      }
    }

    // Mark as autotagged
    await supabase.from('images').update({ autotagged_at: new Date().toISOString() }).eq('id', id);

    res.json({ tags, provider });
  } catch (e) {
    console.error('Autotag error:', e);
    res.status(500).json({ error: e.message });
  }
};

