(function () {
  'use strict';

  const state = {
    roundtables: [],
    initiatives: [],
    posts: [],
    editingPostId: null,
    editingRoundtableId: null,
    editingInitiativeId: null,
  };

  let quill = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function stripHtml(html) {
    const div = document.createElement('div');
    div.innerHTML = html || '';
    return (div.textContent || '').trim();
  }

  function showToast(message, isError) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast' + (isError ? ' error' : '');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toast.className = 'toast hidden'; }, 3500);
  }

  async function api(path, options) {
    const response = await fetch(path, Object.assign({
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    }, options));
    if (!response.ok) {
      let message = 'Request failed (' + response.status + ')';
      try {
        const body = await response.json();
        if (body && body.error) message = body.error;
      } catch (_) { /* ignore */ }
      throw new Error(message);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  // --- Image uploads ---

  const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('Unable to read file.'));
      reader.readAsDataURL(file);
    });
  }

  async function uploadImage(file) {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error('Image is too large. Please use a file under 3.5MB.');
    }
    const dataBase64 = await readFileAsBase64(file);
    const result = await api('/api/admin/uploads', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, contentType: file.type, dataBase64 }),
    });
    return result.url;
  }

  function setImagePreview(prefix, url) {
    const urlField = document.getElementById(prefix + '-image-url');
    const preview = document.getElementById(prefix + '-image-preview');
    urlField.value = url || '';
    if (url) {
      preview.src = url;
      preview.classList.add('visible');
    } else {
      preview.removeAttribute('src');
      preview.classList.remove('visible');
    }
  }

  // --- Shared image picker (upload, or browse past uploads / stock photos) ---

  let imagePickerField = null;

  function renderImageGrid(containerId, images, emptyMessage) {
    const container = document.getElementById(containerId);
    if (!images.length) {
      container.innerHTML = `<p class="muted">${escapeHtml(emptyMessage)}</p>`;
      return;
    }
    container.innerHTML = images.map((img) => `
      <img class="image-picker__thumb" src="${escapeHtml(img.url)}" alt="${escapeHtml(img.filename || '')}" data-url="${escapeHtml(img.url)}">
    `).join('');
  }

  async function loadImagePickerGrids() {
    const uploadsContainer = document.getElementById('image-picker-uploads');
    const stockContainer = document.getElementById('image-picker-stock');
    uploadsContainer.innerHTML = '<p class="muted">Loading…</p>';
    stockContainer.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const images = await api('/api/admin/images');
      renderImageGrid('image-picker-uploads', images, 'No uploads yet.');
    } catch (err) {
      uploadsContainer.innerHTML = '<p class="muted">Failed to load uploads.</p>';
    }
    try {
      const stock = await api('/api/admin/stock-images');
      renderImageGrid('image-picker-stock', stock, 'No stock photos found.');
    } catch (err) {
      stockContainer.innerHTML = '<p class="muted">Failed to load stock photos.</p>';
    }
  }

  function openImagePicker(prefix) {
    imagePickerField = prefix;
    document.getElementById('image-picker').classList.remove('hidden');
    loadImagePickerGrids();
  }

  function closeImagePicker() {
    imagePickerField = null;
    document.getElementById('image-picker').classList.add('hidden');
  }

  function initImagePicker() {
    document.querySelectorAll('[data-action="choose-image"]').forEach((btn) => {
      btn.addEventListener('click', () => openImagePicker(btn.dataset.field));
    });

    document.getElementById('image-picker-close-btn').addEventListener('click', closeImagePicker);
    document.getElementById('image-picker').addEventListener('click', (event) => {
      if (event.target.id === 'image-picker') closeImagePicker();
    });

    document.querySelectorAll('#image-picker-uploads, #image-picker-stock').forEach((grid) => {
      grid.addEventListener('click', (event) => {
        const thumb = event.target.closest('.image-picker__thumb');
        if (!thumb || !imagePickerField) return;
        setImagePreview(imagePickerField, thumb.dataset.url);
        closeImagePicker();
      });
    });

    const uploadInput = document.getElementById('image-picker-upload-input');
    uploadInput.addEventListener('change', async () => {
      const file = uploadInput.files[0];
      if (!file || !imagePickerField) return;
      const status = document.getElementById('image-picker-status');
      status.textContent = 'Uploading…';
      try {
        const url = await uploadImage(file);
        setImagePreview(imagePickerField, url);
        status.textContent = '';
        closeImagePicker();
      } catch (err) {
        status.textContent = '';
        showToast(err.message, true);
      } finally {
        uploadInput.value = '';
      }
    });
  }

  // --- Tabs ---

  function initTabs() {
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'posts') loadPostsTab();
        if (btn.dataset.tab === 'content') loadContentTab();
      });
    });
  }

  // --- Survey Responses ---

  async function loadSurvey() {
    const tbody = document.getElementById('survey-rows');
    try {
      const responses = await api('/api/admin/survey-responses');
      if (!responses.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="muted">No responses yet.</td></tr>';
        return;
      }
      tbody.innerHTML = responses.map((r) => `
        <tr>
          <td>${escapeHtml(r.id)}</td>
          <td>${escapeHtml(r.createdAt)}</td>
          <td>${escapeHtml(r.email || '—')}</td>
          <td><pre>${escapeHtml(JSON.stringify(r.answers, null, 2))}</pre></td>
        </tr>
      `).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="4" class="muted">Failed to load responses.</td></tr>';
      showToast(err.message, true);
    }
  }

  // --- Blog Posts ---

  function getQuill() {
    if (!quill) {
      quill = new Quill('#post-editor', {
        theme: 'snow',
        modules: {
          toolbar: [
            [{ header: [2, 3, false] }],
            ['bold', 'italic', 'underline'],
            [{ list: 'ordered' }, { list: 'bullet' }],
            ['blockquote', 'link'],
            ['clean'],
          ],
        },
      });
    }
    return quill;
  }

  function populateInitiativeSelect() {
    const select = document.getElementById('post-initiative');
    select.innerHTML = state.initiatives.map((i) =>
      `<option value="${escapeHtml(i.id)}">${escapeHtml(i.title)}</option>`
    ).join('');
  }

  function togglePostInitiativeField() {
    const type = document.getElementById('post-type').value;
    document.getElementById('post-initiative-field').style.display = type === 'update' ? 'flex' : 'none';
  }

  function resetPostForm() {
    state.editingPostId = null;
    document.getElementById('post-id').value = '';
    document.getElementById('post-title').value = '';
    document.getElementById('post-author').value = '';
    document.getElementById('post-type').value = 'blog';
    togglePostInitiativeField();
    getQuill().setContents([]);
    document.getElementById('post-form').classList.add('hidden');
  }

  function openPostForm(post) {
    getQuill();
    document.getElementById('post-form').classList.remove('hidden');
    if (post) {
      state.editingPostId = post.id;
      document.getElementById('post-id').value = post.id;
      document.getElementById('post-title').value = post.title;
      document.getElementById('post-author').value = post.author || '';
      document.getElementById('post-type').value = post.type;
      togglePostInitiativeField();
      if (post.type === 'update' && post.initiativeId) {
        document.getElementById('post-initiative').value = post.initiativeId;
      }
      quill.root.innerHTML = post.body || '';
    } else {
      state.editingPostId = null;
      document.getElementById('post-id').value = '';
      document.getElementById('post-title').value = '';
      document.getElementById('post-author').value = '';
      document.getElementById('post-type').value = 'blog';
      togglePostInitiativeField();
      quill.setContents([]);
    }
  }

  function renderPosts() {
    const list = document.getElementById('posts-list');
    if (!state.posts.length) {
      list.innerHTML = '<p class="muted">No posts yet.</p>';
      return;
    }
    const initiativeName = (id) => {
      const found = state.initiatives.find((i) => i.id === id);
      return found ? found.title : 'Unknown initiative';
    };
    list.innerHTML = state.posts.map((post) => `
      <div class="list-item" data-id="${escapeHtml(post.id)}">
        <div class="list-item-body">
          <h3>
            <span class="badge">${post.type === 'update' ? 'Update' : 'Blog'}</span>
            ${escapeHtml(post.title)}
          </h3>
          <p>${post.type === 'update' ? escapeHtml(initiativeName(post.initiativeId)) + ' · ' : ''}${escapeHtml(post.author || 'Unknown author')} · ${escapeHtml(post.publishedAt)}</p>
          <p>${escapeHtml(stripHtml(post.body).slice(0, 140))}${stripHtml(post.body).length > 140 ? '…' : ''}</p>
        </div>
        <div class="list-item-actions">
          <button class="btn-small" data-action="edit-post" type="button">Edit</button>
          <button class="btn-small danger" data-action="delete-post" type="button">Delete</button>
        </div>
      </div>
    `).join('');
  }

  async function loadPostsTab() {
    try {
      const [posts, initiatives] = await Promise.all([
        api('/api/admin/posts'),
        state.initiatives.length ? Promise.resolve(state.initiatives) : api('/api/admin/initiatives'),
      ]);
      state.posts = posts;
      state.initiatives = initiatives;
      populateInitiativeSelect();
      renderPosts();
    } catch (err) {
      document.getElementById('posts-list').innerHTML = '<p class="muted">Failed to load posts.</p>';
      showToast(err.message, true);
    }
  }

  async function savePost(event) {
    event.preventDefault();
    const type = document.getElementById('post-type').value;
    const payload = {
      title: document.getElementById('post-title').value.trim(),
      author: document.getElementById('post-author').value.trim(),
      type,
      initiativeId: type === 'update' ? document.getElementById('post-initiative').value : null,
      body: getQuill().root.innerHTML,
    };
    try {
      if (state.editingPostId) {
        await api('/api/admin/posts/' + state.editingPostId, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Post updated.');
      } else {
        await api('/api/admin/posts', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Post created.');
      }
      resetPostForm();
      await loadPostsTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function deletePost(id) {
    if (!confirm('Delete this post? This cannot be undone.')) return;
    try {
      await api('/api/admin/posts/' + id, { method: 'DELETE' });
      showToast('Post deleted.');
      await loadPostsTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function initPostsTab() {
    document.getElementById('post-new-btn').addEventListener('click', () => openPostForm(null));
    document.getElementById('post-cancel-btn').addEventListener('click', resetPostForm);
    document.getElementById('post-type').addEventListener('change', togglePostInitiativeField);
    document.getElementById('post-form').addEventListener('submit', savePost);
    document.getElementById('posts-list').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.closest('.list-item').dataset.id;
      if (btn.dataset.action === 'edit-post') {
        openPostForm(state.posts.find((p) => p.id === id));
      } else if (btn.dataset.action === 'delete-post') {
        deletePost(id);
      }
    });
  }

  // --- Roundtables & Initiatives ---

  function resetRoundtableForm() {
    state.editingRoundtableId = null;
    document.getElementById('roundtable-id').value = '';
    document.getElementById('roundtable-name').value = '';
    document.getElementById('roundtable-description').value = '';
    setImagePreview('roundtable', null);
    document.getElementById('roundtable-form').classList.add('hidden');
  }

  function openRoundtableForm(roundtable) {
    document.getElementById('roundtable-form').classList.remove('hidden');
    state.editingRoundtableId = roundtable ? roundtable.id : null;
    document.getElementById('roundtable-id').value = roundtable ? roundtable.id : '';
    document.getElementById('roundtable-name').value = roundtable ? roundtable.name : '';
    document.getElementById('roundtable-description').value = roundtable ? roundtable.description || '' : '';
    setImagePreview('roundtable', roundtable ? roundtable.imageUrl : null);
  }

  function renderRoundtables() {
    const list = document.getElementById('roundtables-list');
    if (!state.roundtables.length) {
      list.innerHTML = '<p class="muted">No roundtables yet.</p>';
      return;
    }
    list.innerHTML = state.roundtables.map((rt) => `
      <div class="list-item" data-id="${escapeHtml(rt.id)}">
        ${rt.imageUrl ? `<img class="image-preview visible" src="${escapeHtml(rt.imageUrl)}" alt="">` : ''}
        <div class="list-item-body">
          <h3>${escapeHtml(rt.name)}</h3>
          <p>${escapeHtml(rt.description || '')}</p>
        </div>
        <div class="list-item-actions">
          <button class="btn-small" data-action="edit-roundtable" type="button">Edit</button>
          <button class="btn-small danger" data-action="delete-roundtable" type="button">Delete</button>
        </div>
      </div>
    `).join('');
  }

  async function saveRoundtable(event) {
    event.preventDefault();
    const payload = {
      name: document.getElementById('roundtable-name').value.trim(),
      description: document.getElementById('roundtable-description').value.trim(),
      imageUrl: document.getElementById('roundtable-image-url').value || null,
    };
    try {
      if (state.editingRoundtableId) {
        await api('/api/admin/roundtables/' + state.editingRoundtableId, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Roundtable updated.');
      } else {
        await api('/api/admin/roundtables', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Roundtable created.');
      }
      resetRoundtableForm();
      await loadContentTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function deleteRoundtable(id) {
    if (!confirm('Delete this roundtable? Initiatives linked to it will keep their link until edited.')) return;
    try {
      await api('/api/admin/roundtables/' + id, { method: 'DELETE' });
      showToast('Roundtable deleted.');
      await loadContentTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function renderRoundtableChecks(selectedIds) {
    const container = document.getElementById('initiative-roundtable-checks');
    const selected = new Set(selectedIds || []);
    if (!state.roundtables.length) {
      container.innerHTML = '<span class="muted">No roundtables yet — create one first.</span>';
      return;
    }
    container.innerHTML = state.roundtables.map((rt) => `
      <label>
        <input type="checkbox" value="${escapeHtml(rt.id)}" ${selected.has(rt.id) ? 'checked' : ''}>
        ${escapeHtml(rt.name)}
      </label>
    `).join('');
  }

  function resetInitiativeForm() {
    state.editingInitiativeId = null;
    document.getElementById('initiative-id').value = '';
    document.getElementById('initiative-title').value = '';
    document.getElementById('initiative-description').value = '';
    renderRoundtableChecks([]);
    setImagePreview('initiative', null);
    document.getElementById('initiative-form').classList.add('hidden');
  }

  function openInitiativeForm(initiative) {
    document.getElementById('initiative-form').classList.remove('hidden');
    state.editingInitiativeId = initiative ? initiative.id : null;
    document.getElementById('initiative-id').value = initiative ? initiative.id : '';
    document.getElementById('initiative-title').value = initiative ? initiative.title : '';
    document.getElementById('initiative-description').value = initiative ? initiative.description || '' : '';
    renderRoundtableChecks(initiative ? initiative.roundtableIds : []);
    setImagePreview('initiative', initiative ? initiative.imageUrl : null);
  }

  function renderInitiatives() {
    const list = document.getElementById('initiatives-list');
    if (!state.initiatives.length) {
      list.innerHTML = '<p class="muted">No initiatives yet.</p>';
      return;
    }
    const roundtableNames = (ids) => (ids || [])
      .map((id) => (state.roundtables.find((rt) => rt.id === id) || {}).name)
      .filter(Boolean)
      .join(', ') || 'No roundtables linked';
    list.innerHTML = state.initiatives.map((initiative) => `
      <div class="list-item" data-id="${escapeHtml(initiative.id)}">
        ${initiative.imageUrl ? `<img class="image-preview visible" src="${escapeHtml(initiative.imageUrl)}" alt="">` : ''}
        <div class="list-item-body">
          <h3>${escapeHtml(initiative.title)}</h3>
          <p>${escapeHtml(initiative.description || '')}</p>
          <p>${escapeHtml(roundtableNames(initiative.roundtableIds))}</p>
        </div>
        <div class="list-item-actions">
          <button class="btn-small" data-action="edit-initiative" type="button">Edit</button>
          <button class="btn-small danger" data-action="delete-initiative" type="button">Delete</button>
        </div>
      </div>
    `).join('');
  }

  async function saveInitiative(event) {
    event.preventDefault();
    const roundtableIds = Array.from(document.querySelectorAll('#initiative-roundtable-checks input:checked')).map((el) => el.value);
    const payload = {
      title: document.getElementById('initiative-title').value.trim(),
      description: document.getElementById('initiative-description').value.trim(),
      roundtableIds,
      imageUrl: document.getElementById('initiative-image-url').value || null,
    };
    try {
      if (state.editingInitiativeId) {
        await api('/api/admin/initiatives/' + state.editingInitiativeId, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Initiative updated.');
      } else {
        await api('/api/admin/initiatives', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Initiative created.');
      }
      resetInitiativeForm();
      await loadContentTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function deleteInitiative(id) {
    if (!confirm('Delete this initiative? Its updates will remain but lose their initiative link.')) return;
    try {
      await api('/api/admin/initiatives/' + id, { method: 'DELETE' });
      showToast('Initiative deleted.');
      await loadContentTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function loadContentTab() {
    try {
      const [roundtables, initiatives] = await Promise.all([
        api('/api/roundtables'),
        api('/api/admin/initiatives'),
      ]);
      state.roundtables = roundtables;
      state.initiatives = initiatives;
      renderRoundtables();
      renderInitiatives();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function initContentTab() {
    initImagePicker();

    document.getElementById('roundtable-new-btn').addEventListener('click', () => openRoundtableForm(null));
    document.getElementById('roundtable-cancel-btn').addEventListener('click', resetRoundtableForm);
    document.getElementById('roundtable-form').addEventListener('submit', saveRoundtable);
    document.getElementById('roundtables-list').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.closest('.list-item').dataset.id;
      if (btn.dataset.action === 'edit-roundtable') {
        openRoundtableForm(state.roundtables.find((r) => r.id === id));
      } else if (btn.dataset.action === 'delete-roundtable') {
        deleteRoundtable(id);
      }
    });

    document.getElementById('initiative-new-btn').addEventListener('click', () => openInitiativeForm(null));
    document.getElementById('initiative-cancel-btn').addEventListener('click', resetInitiativeForm);
    document.getElementById('initiative-form').addEventListener('submit', saveInitiative);
    document.getElementById('initiatives-list').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.closest('.list-item').dataset.id;
      if (btn.dataset.action === 'edit-initiative') {
        openInitiativeForm(state.initiatives.find((i) => i.id === id));
      } else if (btn.dataset.action === 'delete-initiative') {
        deleteInitiative(id);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initPostsTab();
    initContentTab();
    loadSurvey();
  });
})();
