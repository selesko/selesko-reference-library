/* ── State ── */
const state = {
  folder: '',
  search: '',
  tags: [],
  moodboard: null,
  page: 1,
  limit: 60,
  total: 0,
  images: [],
  loading: false,
  gridCols: 4,
  lightboxIndex: -1,
  selected: new Set(),
  folders: [],
  moodboards: [],
  allTags: [],
  // Autotag batch state
  autotagRunning: false,
  autotagDone: 0,
  autotagTotal: 0,
};

/* ── DOM refs ── */
const $ = id => document.getElementById(id);
const $grid = $('image-grid');
const $search = $('search-input');
const $viewTitle = $('view-title');
const $totalCount = $('total-count');
const $folderList = $('folder-list');
const $moodboardList = $('moodboard-list');
const $tagCloud = $('tag-cloud');
const $activeTagFilters = $('active-tag-filters');
const $selectionBar = $('selection-bar');
const $selectionCount = $('selection-count');
const $lightbox = $('lightbox');
const $lightboxImg = $('lightbox-img');
const $lightboxFilename = $('lightbox-filename');
const $lightboxFolder = $('lightbox-folder');
const $lightboxTagList = $('lightbox-tag-list');
const $lightboxMoodboardList = $('lightbox-moodboard-list');
const $autotagStatus = $('autotag-status');

/* ── API helpers ── */
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch('/api' + path, opts);
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
  return r.json();
}
const GET  = p       => api('GET',    p);
const POST = (p, b)  => api('POST',   p, b);
const DEL  = p       => api('DELETE', p);
const PATCH = (p, b) => api('PATCH',  p, b);

/* ── Image loading ── */
async function loadImages(append = false) {
  if (state.loading) return;
  state.loading = true;

  const params = new URLSearchParams({ page: state.page, limit: state.limit });
  if (state.folder)    params.set('folder',    state.folder);
  if (state.search)    params.set('search',    state.search);
  if (state.tags.length) params.set('tags',    state.tags.join(','));
  if (state.moodboard) params.set('moodboard', state.moodboard);

  try {
    const data = await GET(`/images?${params}`);
    state.total = data.total;
    $totalCount.textContent = state.total;

    if (!append) { state.images = data.images; $grid.innerHTML = ''; }
    else          { state.images.push(...data.images); }

    renderImages(data.images, append);
    $('empty-state').classList.toggle('hidden', state.images.length > 0);
  } catch (e) {
    console.error('Load images error:', e);
  } finally {
    state.loading = false;
  }
}

function thumbUrl(img) {
  // Use Supabase Storage thumbnail URL, fall back to full image
  return img.thumbnail_path || img.storage_path || '';
}

function fullUrl(img) {
  return img.storage_path || img.thumbnail_path || '';
}

function renderImages(images, append) {
  const frag = document.createDocumentFragment();
  images.forEach((img, i) => {
    const globalIdx = append ? state.images.length - images.length + i : i;
    const card = document.createElement('div');
    card.className = 'img-card' + (state.selected.has(img.id) ? ' selected' : '');
    card.dataset.id  = img.id;
    card.dataset.idx = globalIdx;

    const imgEl = document.createElement('img');
    imgEl.loading = 'lazy';
    imgEl.src = thumbUrl(img);
    imgEl.alt = img.filename;

    const overlay = document.createElement('div');
    overlay.className = 'img-overlay';
    if (img.tags?.length) {
      const tagWrap = document.createElement('div');
      tagWrap.className = 'img-overlay-tags';
      img.tags.slice(0, 4).forEach(t => {
        const span = document.createElement('span');
        span.className = 'img-overlay-tag';
        span.textContent = t.name;
        tagWrap.appendChild(span);
      });
      overlay.appendChild(tagWrap);
    }

    card.appendChild(imgEl);
    card.appendChild(overlay);
    card.addEventListener('click', e => {
      if (e.shiftKey || state.selected.size > 0) toggleSelect(img.id, card);
      else openLightbox(globalIdx);
    });
    frag.appendChild(card);
  });
  $grid.appendChild(frag);
}

/* ── Infinite scroll ── */
const observer = new IntersectionObserver(entries => {
  if (entries[0].isIntersecting && !state.loading && state.images.length < state.total) {
    state.page++;
    loadImages(true);
  }
}, { threshold: 0.1 });
observer.observe($('load-more-trigger'));

/* ── Selection ── */
function toggleSelect(id, card) {
  if (state.selected.has(id)) { state.selected.delete(id); card.classList.remove('selected'); }
  else                         { state.selected.add(id);    card.classList.add('selected'); }
  updateSelectionBar();
}
function clearSelection() {
  state.selected.clear();
  document.querySelectorAll('.img-card.selected').forEach(c => c.classList.remove('selected'));
  updateSelectionBar();
}
function updateSelectionBar() {
  if (state.selected.size > 0) {
    $selectionBar.classList.remove('hidden');
    $selectionCount.textContent = `${state.selected.size} selected`;
  } else {
    $selectionBar.classList.add('hidden');
  }
}
$('btn-clear-selection').addEventListener('click', clearSelection);
$('btn-add-to-moodboard').addEventListener('click', () => {
  if (state.selected.size === 0) return;
  showAddToMoodboardModal([...state.selected]);
});

/* ── Navigation ── */
function navigate(opts) {
  Object.assign(state, opts);
  state.page = 1;
  clearSelection();
  loadImages(false);
  updateNav();
  updateTagFilters();
}
function updateNav() {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  if (state.moodboard) {
    const mb = state.moodboards.find(m => m.id === state.moodboard);
    $viewTitle.textContent = mb?.name || 'Moodboard';
    document.querySelector(`.nav-item[data-moodboard="${state.moodboard}"]`)?.classList.add('active');
  } else {
    $viewTitle.textContent = state.folder || 'All Images';
    document.querySelector(`.nav-item[data-folder="${state.folder}"]`)?.classList.add('active');
  }
}

/* ── Search ── */
let searchTimeout;
$search.addEventListener('input', e => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    navigate({ search: e.target.value.trim(), folder: state.folder, tags: state.tags, moodboard: state.moodboard });
  }, 300);
});

/* ── Grid size ── */
document.querySelectorAll('.view-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-toggle').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.gridCols = parseInt(btn.dataset.grid);
    document.documentElement.style.setProperty('--grid-cols', state.gridCols);
  });
});
document.documentElement.style.setProperty('--grid-cols', state.gridCols);

/* ── Folders ── */
async function loadFolders() {
  state.folders = await GET('/images/folders');
  renderFolders();
}
function renderFolders() {
  $folderList.innerHTML = '';
  state.folders.forEach(f => {
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'nav-item' + (state.folder === f.folder ? ' active' : '');
    a.dataset.folder = f.folder;
    a.innerHTML = `<span class="nav-icon">▸</span>${folderLabel(f.folder)}<span class="nav-count">${f.count}</span>`;
    a.addEventListener('click', e => { e.preventDefault(); navigate({ folder: f.folder, search: state.search, tags: [], moodboard: null }); });
    $folderList.appendChild(a);
  });
}
function folderLabel(folder) { return folder.split(/[\\/]/).pop() || folder; }

/* ── Moodboards ── */
async function loadMoodboards() {
  state.moodboards = await GET('/moodboards');
  renderMoodboards();
}
function renderMoodboards() {
  $moodboardList.innerHTML = '';
  state.moodboards.forEach(m => {
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'nav-item' + (state.moodboard === m.id ? ' active' : '');
    a.dataset.moodboard = m.id;
    a.innerHTML = `<span class="nav-icon">◻</span>${m.name}<span class="nav-count">${m.image_count}</span>
      <button class="moodboard-delete" data-id="${m.id}" title="Delete">✕</button>`;
    a.addEventListener('click', e => {
      if (e.target.classList.contains('moodboard-delete')) { e.preventDefault(); deleteMoodboard(m.id); return; }
      e.preventDefault();
      navigate({ moodboard: m.id, folder: '', search: state.search, tags: [] });
    });
    $moodboardList.appendChild(a);
  });
}
async function deleteMoodboard(id) {
  if (!confirm('Delete this moodboard?')) return;
  await DEL(`/moodboards/${id}`);
  if (state.moodboard === id) navigate({ moodboard: null, folder: '', search: '', tags: [] });
  await loadMoodboards();
}

/* ── New Moodboard ── */
$('btn-new-moodboard').addEventListener('click', () => {
  $('modal-new-moodboard').classList.remove('hidden');
  $('moodboard-name-input').value = '';
  $('moodboard-desc-input').value = '';
  setTimeout(() => $('moodboard-name-input').focus(), 50);
});
$('btn-cancel-moodboard').addEventListener('click', () => $('modal-new-moodboard').classList.add('hidden'));
$('btn-create-moodboard').addEventListener('click', async () => {
  const name = $('moodboard-name-input').value.trim();
  if (!name) return;
  const mb = await POST('/moodboards', { name, description: $('moodboard-desc-input').value });
  $('modal-new-moodboard').classList.add('hidden');
  await loadMoodboards();
  navigate({ moodboard: mb.id, folder: '', search: '', tags: [] });
});
$('moodboard-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-create-moodboard').click(); });

/* ── Add to Moodboard Modal ── */
async function showAddToMoodboardModal(imageIds) {
  const modal = $('modal-add-to-moodboard');
  const list  = $('modal-moodboard-list');
  modal.classList.remove('hidden');
  list.innerHTML = '';
  if (state.moodboards.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:12px">No moodboards yet. Create one first.</p>';
  } else {
    state.moodboards.forEach(m => {
      const btn = document.createElement('button');
      btn.className = 'moodboard-add-btn';
      btn.textContent = `${m.name} (${m.image_count} images)`;
      btn.addEventListener('click', async () => {
        await POST(`/moodboards/${m.id}/images`, { imageIds });
        btn.classList.add('added');
        btn.textContent = `✓ Added to ${m.name}`;
        clearSelection();
        await loadMoodboards();
        setTimeout(() => modal.classList.add('hidden'), 800);
      });
      list.appendChild(btn);
    });
  }
}
$('btn-cancel-add-moodboard').addEventListener('click', () => $('modal-add-to-moodboard').classList.add('hidden'));

/* ── Tags ── */
async function loadTags() {
  state.allTags = await GET('/tags');
  renderTagCloud();
}
function renderTagCloud() {
  $tagCloud.innerHTML = '';
  state.allTags.slice(0, 60).forEach(t => {
    if (state.tags.includes(t.name)) return;
    const pill = document.createElement('span');
    pill.className = 'tag-pill';
    pill.innerHTML = `${t.name}${t.count > 0 ? `<span class="count">${t.count}</span>` : ''}`;
    pill.addEventListener('click', () => addTagFilter(t.name));
    $tagCloud.appendChild(pill);
  });
}
function addTagFilter(tag) {
  if (!state.tags.includes(tag)) navigate({ tags: [...state.tags, tag], folder: state.folder, search: state.search, moodboard: state.moodboard });
}
function removeTagFilter(tag) {
  navigate({ tags: state.tags.filter(t => t !== tag), folder: state.folder, search: state.search, moodboard: state.moodboard });
}
function updateTagFilters() {
  $activeTagFilters.innerHTML = '';
  state.tags.forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'tag-filter-chip';
    chip.innerHTML = `${tag}<span class="remove">✕</span>`;
    chip.addEventListener('click', () => removeTagFilter(tag));
    $activeTagFilters.appendChild(chip);
  });
  renderTagCloud();
}

/* ── Lightbox ── */
function openLightbox(idx) {
  state.lightboxIndex = idx;
  const img = state.images[idx];
  if (!img) return;
  $lightboxImg.src = fullUrl(img);
  $lightboxFilename.textContent = img.filename;
  $lightboxFolder.textContent = img.folder;
  renderLightboxTags(img);
  renderLightboxMoodboards(img.id);
  $lightbox.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  $lightbox.classList.add('hidden');
  document.body.style.overflow = '';
  $lightboxImg.src = '';
}
function lightboxNav(dir) {
  const newIdx = state.lightboxIndex + dir;
  if (newIdx < 0 || newIdx >= state.images.length) return;
  if (newIdx >= state.images.length - 5 && state.images.length < state.total) {
    state.page++;
    loadImages(true).then(() => openLightbox(newIdx));
    return;
  }
  openLightbox(newIdx);
}
function renderLightboxTags(img) {
  $lightboxTagList.innerHTML = '';
  (img.tags || []).forEach(t => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip' + (t.auto ? ' auto' : '');
    chip.innerHTML = `${t.name}<button class="tag-remove" data-tag="${t.name}">✕</button>`;
    chip.querySelector('.tag-remove').addEventListener('click', async () => {
      await api('DELETE', `/images/${img.id}/tags?tag=${encodeURIComponent(t.name)}`);
      const updated = await GET(`/images/${img.id}`);
      state.images[state.lightboxIndex] = updated;
      renderLightboxTags(updated);
      updateCardTags(img.id, updated.tags);
      loadTags();
    });
    $lightboxTagList.appendChild(chip);
  });
}
function renderLightboxMoodboards(imageId) {
  $lightboxMoodboardList.innerHTML = '';
  state.moodboards.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'moodboard-add-btn';
    btn.textContent = m.name;
    btn.addEventListener('click', async () => {
      await POST(`/moodboards/${m.id}/images`, { imageIds: [imageId] });
      btn.classList.add('added');
      btn.textContent = `✓ ${m.name}`;
      await loadMoodboards();
    });
    $lightboxMoodboardList.appendChild(btn);
  });
}
$('lightbox-tag-add').addEventListener('click', async () => {
  const input = $('lightbox-tag-input');
  const tags = input.value.split(',').map(t => t.trim()).filter(Boolean);
  if (!tags.length) return;
  const img = state.images[state.lightboxIndex];
  await POST(`/images/${img.id}/tags`, { tags });
  input.value = '';
  const updated = await GET(`/images/${img.id}`);
  state.images[state.lightboxIndex] = updated;
  renderLightboxTags(updated);
  updateCardTags(img.id, updated.tags);
  loadTags();
});
$('lightbox-tag-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('lightbox-tag-add').click(); });

$('btn-autotag-single').addEventListener('click', async () => {
  const btn = $('btn-autotag-single');
  const img = state.images[state.lightboxIndex];
  btn.disabled = true;
  btn.textContent = '✦ Tagging…';
  try {
    await POST(`/autotag/${img.id}`);
    const updated = await GET(`/images/${img.id}`);
    state.images[state.lightboxIndex] = updated;
    renderLightboxTags(updated);
    updateCardTags(img.id, updated.tags);
    loadTags();
    btn.textContent = '✓ Tagged!';
    setTimeout(() => { btn.textContent = '✦ Auto-tag this image'; btn.disabled = false; }, 2000);
  } catch (e) {
    btn.textContent = '✦ Error — try again';
    btn.disabled = false;
  }
});

function updateCardTags(imageId, tags) {
  const card = $grid.querySelector(`[data-id="${imageId}"]`);
  if (!card) return;
  const overlay = card.querySelector('.img-overlay');
  overlay.innerHTML = '';
  if (tags?.length) {
    const tagWrap = document.createElement('div');
    tagWrap.className = 'img-overlay-tags';
    tags.slice(0, 4).forEach(t => {
      const span = document.createElement('span');
      span.className = 'img-overlay-tag';
      span.textContent = t.name;
      tagWrap.appendChild(span);
    });
    overlay.appendChild(tagWrap);
  }
}

$('lightbox-close').addEventListener('click', closeLightbox);
$('lightbox-backdrop').addEventListener('click', closeLightbox);
$('lightbox-prev').addEventListener('click', () => lightboxNav(-1));
$('lightbox-next').addEventListener('click', () => lightboxNav(1));
document.addEventListener('keydown', e => {
  if ($lightbox.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') lightboxNav(-1);
  if (e.key === 'ArrowRight') lightboxNav(1);
});

/* ── Auto-Tag All (client-driven batch) ── */
$('btn-autotag').addEventListener('click', async () => {
  if (state.autotagRunning) return;
  const confirmed = confirm('This will use Claude AI to auto-tag all untagged images.\nImages must be uploaded to Supabase Storage first.\n\nContinue?');
  if (!confirmed) return;

  state.autotagRunning = true;
  $('btn-autotag').disabled = true;
  $autotagStatus.classList.remove('hidden');

  try {
    const { ids } = await GET('/autotag/untagged');
    state.autotagTotal = ids.length;
    state.autotagDone  = 0;

    if (ids.length === 0) {
      $autotagStatus.textContent = 'All images already tagged!';
      setTimeout(() => $autotagStatus.classList.add('hidden'), 3000);
      return;
    }

    for (const id of ids) {
      $autotagStatus.textContent = `Auto-tagging: ${state.autotagDone}/${state.autotagTotal}…`;
      try {
        await POST(`/autotag/${id}`);
      } catch (e) {
        console.warn(`Failed to tag image ${id}:`, e.message);
      }
      state.autotagDone++;
    }

    $autotagStatus.textContent = `✓ Done — tagged ${state.autotagDone} images.`;
    loadTags();
    navigate({ folder: state.folder, search: state.search, tags: state.tags, moodboard: state.moodboard });
    setTimeout(() => { $autotagStatus.classList.add('hidden'); }, 5000);
  } finally {
    state.autotagRunning = false;
    $('btn-autotag').disabled = false;
  }
});

/* ── Init ── */
async function init() {
  await Promise.all([loadFolders(), loadMoodboards(), loadTags()]);
  document.querySelector('.nav-item[data-folder=""]').addEventListener('click', e => {
    e.preventDefault();
    navigate({ folder: '', search: '', tags: [], moodboard: null });
  });
  await loadImages(false);
}

init().catch(console.error);
