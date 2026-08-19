(function () {
  'use strict';

  const state = {
    roundtables: [],
    initiatives: [],
    posts: [],
    press: [],
    investments: [],
    events: [],
    editingPostId: null,
    editingRoundtableId: null,
    editingInitiativeId: null,
    editingPressId: null,
    editingInvestmentId: null,
    editingEventId: null,
  };

  const POST_TYPES_WITH_MEMBER_ONLY = ['education'];
  const POST_TYPES_WITH_EXCERPT = ['education', 'book'];
  const POST_TYPES_WITH_IMAGE = ['education', 'book', 'blog'];
  const POST_TYPES_WITH_BOOK_FIELDS = ['book'];

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
        if (btn.dataset.tab === 'press') loadPressTab();
        if (btn.dataset.tab === 'investments-events') loadInvestmentsEventsTab();
        if (btn.dataset.tab === 'settings') loadSettingsTab();
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

  function updatePostFieldVisibility() {
    const type = document.getElementById('post-type').value;
    document.getElementById('post-initiative-field').style.display = type === 'update' ? 'flex' : 'none';
    document.getElementById('post-member-only-field').style.display =
      POST_TYPES_WITH_MEMBER_ONLY.includes(type) ? 'block' : 'none';
    document.getElementById('post-excerpt-field').style.display =
      POST_TYPES_WITH_EXCERPT.includes(type) ? 'flex' : 'none';
    document.getElementById('post-image-field').style.display =
      POST_TYPES_WITH_IMAGE.includes(type) ? 'block' : 'none';
    document.getElementById('post-book-fields').style.display =
      POST_TYPES_WITH_BOOK_FIELDS.includes(type) ? 'flex' : 'none';
  }

  function resetPostForm() {
    state.editingPostId = null;
    document.getElementById('post-id').value = '';
    document.getElementById('post-title').value = '';
    document.getElementById('post-author').value = '';
    document.getElementById('post-type').value = 'blog';
    document.getElementById('post-member-only').checked = false;
    document.getElementById('post-excerpt').value = '';
    document.getElementById('post-purchase-url').value = '';
    document.getElementById('post-price').value = '';
    setImagePreview('post', null);
    updatePostFieldVisibility();
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
      document.getElementById('post-member-only').checked = !!post.memberOnly;
      document.getElementById('post-excerpt').value = post.excerpt || '';
      document.getElementById('post-purchase-url').value = post.purchaseUrl || '';
      document.getElementById('post-price').value = post.price || '';
      setImagePreview('post', post.imageUrl || null);
      updatePostFieldVisibility();
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
      document.getElementById('post-member-only').checked = false;
      document.getElementById('post-excerpt').value = '';
      document.getElementById('post-purchase-url').value = '';
      document.getElementById('post-price').value = '';
      setImagePreview('post', null);
      updatePostFieldVisibility();
      quill.setContents([]);
    }
  }

  const POST_TYPE_LABELS = {
    blog: 'Blog',
    update: 'Update',
    education: 'Education',
    announcement: 'PIN Update',
    book: 'Book',
  };

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
            <span class="badge">${escapeHtml(POST_TYPE_LABELS[post.type] || post.type)}</span>
            ${post.memberOnly ? '<span class="badge">Members only</span>' : ''}
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
      memberOnly: document.getElementById('post-member-only').checked,
      excerpt: document.getElementById('post-excerpt').value.trim() || null,
      imageUrl: document.getElementById('post-image-url').value || null,
      purchaseUrl: document.getElementById('post-purchase-url').value.trim() || null,
      price: document.getElementById('post-price').value.trim() || null,
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
    document.getElementById('post-type').addEventListener('change', updatePostFieldVisibility);
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

  // --- Press ---

  function resetPressForm() {
    state.editingPressId = null;
    document.getElementById('press-id').value = '';
    document.getElementById('press-title').value = '';
    document.getElementById('press-source').value = '';
    document.getElementById('press-date').value = '';
    document.getElementById('press-url').value = '';
    document.getElementById('press-excerpt').value = '';
    document.getElementById('press-form').classList.add('hidden');
  }

  function openPressForm(press) {
    document.getElementById('press-form').classList.remove('hidden');
    state.editingPressId = press ? press.id : null;
    document.getElementById('press-id').value = press ? press.id : '';
    document.getElementById('press-title').value = press ? press.title : '';
    document.getElementById('press-source').value = press ? press.source : '';
    document.getElementById('press-date').value = press && press.publishedDate ? press.publishedDate.slice(0, 10) : '';
    document.getElementById('press-url').value = press ? press.externalUrl : '';
    document.getElementById('press-excerpt').value = press ? press.excerpt || '' : '';
  }

  function renderPress() {
    const list = document.getElementById('press-list');
    if (!state.press.length) {
      list.innerHTML = '<p class="muted">No press mentions yet.</p>';
      return;
    }
    list.innerHTML = state.press.map((p) => `
      <div class="list-item" data-id="${escapeHtml(p.id)}">
        <div class="list-item-body">
          <h3>${escapeHtml(p.title)}</h3>
          <p>${escapeHtml(p.source)} &middot; ${escapeHtml((p.publishedDate || '').slice(0, 10))}</p>
          <p><a href="${escapeHtml(p.externalUrl)}" target="_blank" rel="noopener">${escapeHtml(p.externalUrl)}</a></p>
        </div>
        <div class="list-item-actions">
          <button class="btn-small" data-action="edit-press" type="button">Edit</button>
          <button class="btn-small danger" data-action="delete-press" type="button">Delete</button>
        </div>
      </div>
    `).join('');
  }

  async function loadPressTab() {
    try {
      state.press = await api('/api/admin/press');
      renderPress();
    } catch (err) {
      document.getElementById('press-list').innerHTML = '<p class="muted">Failed to load press mentions.</p>';
      showToast(err.message, true);
    }
  }

  async function savePress(event) {
    event.preventDefault();
    const dateValue = document.getElementById('press-date').value;
    const payload = {
      title: document.getElementById('press-title').value.trim(),
      source: document.getElementById('press-source').value.trim(),
      publishedDate: dateValue ? new Date(dateValue).toISOString() : new Date().toISOString(),
      externalUrl: document.getElementById('press-url').value.trim(),
      excerpt: document.getElementById('press-excerpt').value.trim() || null,
    };
    try {
      if (state.editingPressId) {
        await api('/api/admin/press/' + state.editingPressId, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Press mention updated.');
      } else {
        await api('/api/admin/press', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Press mention created.');
      }
      resetPressForm();
      await loadPressTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function deletePress(id) {
    if (!confirm('Delete this press mention?')) return;
    try {
      await api('/api/admin/press/' + id, { method: 'DELETE' });
      showToast('Press mention deleted.');
      await loadPressTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function initPressTab() {
    document.getElementById('press-new-btn').addEventListener('click', () => openPressForm(null));
    document.getElementById('press-cancel-btn').addEventListener('click', resetPressForm);
    document.getElementById('press-form').addEventListener('submit', savePress);
    document.getElementById('press-list').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.closest('.list-item').dataset.id;
      if (btn.dataset.action === 'edit-press') {
        openPressForm(state.press.find((p) => p.id === id));
      } else if (btn.dataset.action === 'delete-press') {
        deletePress(id);
      }
    });
  }

  // --- Investments & Events ---

  function toDatetimeLocalValue(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function fromDatetimeLocalValue(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function populateInvestmentInitiativeSelect() {
    const select = document.getElementById('investment-initiative');
    select.innerHTML = '<option value="">None</option>' + state.initiatives.map((i) =>
      `<option value="${escapeHtml(i.id)}">${escapeHtml(i.title)}</option>`
    ).join('');
  }

  function renderInvestmentRoundtableChecks(selectedIds) {
    const container = document.getElementById('investment-roundtable-checks');
    const selected = new Set(selectedIds || []);
    if (!state.roundtables.length) {
      container.innerHTML = '<span class="muted">No roundtables yet.</span>';
      return;
    }
    container.innerHTML = state.roundtables.map((rt) => `
      <label>
        <input type="checkbox" value="${escapeHtml(rt.id)}" ${selected.has(rt.id) ? 'checked' : ''}>
        ${escapeHtml(rt.name)}
      </label>
    `).join('');
  }

  function resetInvestmentForm() {
    state.editingInvestmentId = null;
    document.getElementById('investment-id').value = '';
    document.getElementById('investment-title').value = '';
    document.getElementById('investment-status').value = 'open';
    document.getElementById('investment-initiative').value = '';
    renderInvestmentRoundtableChecks([]);
    document.getElementById('investment-description').value = '';
    document.getElementById('investment-outcome').value = '';
    document.getElementById('investment-member-only').checked = false;
    setImagePreview('investment', null);
    document.getElementById('investment-form').classList.add('hidden');
  }

  function openInvestmentForm(investment) {
    document.getElementById('investment-form').classList.remove('hidden');
    state.editingInvestmentId = investment ? investment.id : null;
    document.getElementById('investment-id').value = investment ? investment.id : '';
    document.getElementById('investment-title').value = investment ? investment.title : '';
    document.getElementById('investment-status').value = investment ? investment.status : 'open';
    document.getElementById('investment-initiative').value = investment ? investment.initiativeId || '' : '';
    renderInvestmentRoundtableChecks(investment ? investment.roundtableIds : []);
    document.getElementById('investment-description').value = investment ? stripHtml(investment.description || '') : '';
    document.getElementById('investment-outcome').value = investment ? stripHtml(investment.outcomeSummary || '') : '';
    document.getElementById('investment-member-only').checked = investment ? !!investment.memberOnly : false;
    setImagePreview('investment', investment ? investment.imageUrl : null);
  }

  function renderInvestments() {
    const list = document.getElementById('investments-list');
    if (!state.investments.length) {
      list.innerHTML = '<p class="muted">No investments yet.</p>';
      return;
    }
    list.innerHTML = state.investments.map((inv) => `
      <div class="list-item" data-id="${escapeHtml(inv.id)}">
        ${inv.imageUrl ? `<img class="image-preview visible" src="${escapeHtml(inv.imageUrl)}" alt="">` : ''}
        <div class="list-item-body">
          <h3>
            <span class="badge">${inv.status === 'completed' ? 'Completed' : 'Open'}</span>
            ${inv.memberOnly ? '<span class="badge">Members only</span>' : ''}
            ${escapeHtml(inv.title)}
          </h3>
          <p>${escapeHtml(inv.description || '')}</p>
        </div>
        <div class="list-item-actions">
          <button class="btn-small" data-action="edit-investment" type="button">Edit</button>
          <button class="btn-small danger" data-action="delete-investment" type="button">Delete</button>
        </div>
      </div>
    `).join('');
  }

  async function saveInvestment(event) {
    event.preventDefault();
    const roundtableIds = Array.from(document.querySelectorAll('#investment-roundtable-checks input:checked')).map((el) => el.value);
    const payload = {
      title: document.getElementById('investment-title').value.trim(),
      status: document.getElementById('investment-status').value,
      initiativeId: document.getElementById('investment-initiative').value || null,
      roundtableIds,
      description: document.getElementById('investment-description').value.trim(),
      outcomeSummary: document.getElementById('investment-outcome').value.trim() || null,
      memberOnly: document.getElementById('investment-member-only').checked,
      imageUrl: document.getElementById('investment-image-url').value || null,
    };
    try {
      if (state.editingInvestmentId) {
        await api('/api/admin/investments/' + state.editingInvestmentId, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Investment updated.');
      } else {
        await api('/api/admin/investments', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Investment created.');
      }
      resetInvestmentForm();
      await loadInvestmentsEventsTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function deleteInvestment(id) {
    if (!confirm('Delete this investment?')) return;
    try {
      await api('/api/admin/investments/' + id, { method: 'DELETE' });
      showToast('Investment deleted.');
      await loadInvestmentsEventsTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function resetEventForm() {
    state.editingEventId = null;
    document.getElementById('event-id').value = '';
    document.getElementById('event-title').value = '';
    document.getElementById('event-starts-at').value = '';
    document.getElementById('event-ends-at').value = '';
    document.getElementById('event-location').value = '';
    document.getElementById('event-virtual-link').value = '';
    document.getElementById('event-description').value = '';
    document.getElementById('event-member-only').checked = false;
    document.getElementById('event-is-conference').checked = false;
    setImagePreview('event', null);
    document.getElementById('event-form').classList.add('hidden');
  }

  function openEventForm(evt) {
    document.getElementById('event-form').classList.remove('hidden');
    state.editingEventId = evt ? evt.id : null;
    document.getElementById('event-id').value = evt ? evt.id : '';
    document.getElementById('event-title').value = evt ? evt.title : '';
    document.getElementById('event-starts-at').value = evt ? toDatetimeLocalValue(evt.startsAt) : '';
    document.getElementById('event-ends-at').value = evt ? toDatetimeLocalValue(evt.endsAt) : '';
    document.getElementById('event-location').value = evt ? evt.location || '' : '';
    document.getElementById('event-virtual-link').value = evt ? evt.virtualLink || '' : '';
    document.getElementById('event-description').value = evt ? stripHtml(evt.description || '') : '';
    document.getElementById('event-member-only').checked = evt ? !!evt.memberOnly : false;
    document.getElementById('event-is-conference').checked = evt ? !!evt.isConference : false;
    setImagePreview('event', evt ? evt.imageUrl : null);
  }

  function renderEvents() {
    const list = document.getElementById('events-list');
    if (!state.events.length) {
      list.innerHTML = '<p class="muted">No events yet.</p>';
      return;
    }
    list.innerHTML = state.events.map((evt) => `
      <div class="list-item" data-id="${escapeHtml(evt.id)}">
        ${evt.imageUrl ? `<img class="image-preview visible" src="${escapeHtml(evt.imageUrl)}" alt="">` : ''}
        <div class="list-item-body">
          <h3>
            ${evt.isConference ? '<span class="badge">Conference</span>' : ''}
            ${evt.memberOnly ? '<span class="badge">Members only</span>' : ''}
            ${escapeHtml(evt.title)}
          </h3>
          <p>${escapeHtml(new Date(evt.startsAt).toLocaleString())}${evt.location ? ' &middot; ' + escapeHtml(evt.location) : ''}</p>
          <p>${escapeHtml(stripHtml(evt.description || '').slice(0, 140))}</p>
        </div>
        <div class="list-item-actions">
          <button class="btn-small" data-action="edit-event" type="button">Edit</button>
          <button class="btn-small danger" data-action="delete-event" type="button">Delete</button>
        </div>
      </div>
    `).join('');
  }

  async function saveEvent(event) {
    event.preventDefault();
    const payload = {
      title: document.getElementById('event-title').value.trim(),
      startsAt: fromDatetimeLocalValue(document.getElementById('event-starts-at').value),
      endsAt: fromDatetimeLocalValue(document.getElementById('event-ends-at').value),
      location: document.getElementById('event-location').value.trim() || null,
      virtualLink: document.getElementById('event-virtual-link').value.trim() || null,
      description: document.getElementById('event-description').value.trim(),
      memberOnly: document.getElementById('event-member-only').checked,
      isConference: document.getElementById('event-is-conference').checked,
      imageUrl: document.getElementById('event-image-url').value || null,
    };
    try {
      if (state.editingEventId) {
        await api('/api/admin/events/' + state.editingEventId, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Event updated.');
      } else {
        await api('/api/admin/events', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Event created.');
      }
      resetEventForm();
      await loadInvestmentsEventsTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function deleteEvent(id) {
    if (!confirm('Delete this event?')) return;
    try {
      await api('/api/admin/events/' + id, { method: 'DELETE' });
      showToast('Event deleted.');
      await loadInvestmentsEventsTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function loadInvestmentsEventsTab() {
    try {
      const [investments, events, roundtables, initiatives] = await Promise.all([
        api('/api/admin/investments'),
        api('/api/admin/events'),
        state.roundtables.length ? Promise.resolve(state.roundtables) : api('/api/roundtables'),
        state.initiatives.length ? Promise.resolve(state.initiatives) : api('/api/admin/initiatives'),
      ]);
      state.investments = investments;
      state.events = events;
      state.roundtables = roundtables;
      state.initiatives = initiatives;
      populateInvestmentInitiativeSelect();
      renderInvestments();
      renderEvents();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function initInvestmentsEventsTab() {
    document.getElementById('investment-new-btn').addEventListener('click', () => openInvestmentForm(null));
    document.getElementById('investment-cancel-btn').addEventListener('click', resetInvestmentForm);
    document.getElementById('investment-form').addEventListener('submit', saveInvestment);
    document.getElementById('investments-list').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.closest('.list-item').dataset.id;
      if (btn.dataset.action === 'edit-investment') {
        openInvestmentForm(state.investments.find((i) => i.id === id));
      } else if (btn.dataset.action === 'delete-investment') {
        deleteInvestment(id);
      }
    });

    document.getElementById('event-new-btn').addEventListener('click', () => openEventForm(null));
    document.getElementById('event-cancel-btn').addEventListener('click', resetEventForm);
    document.getElementById('event-form').addEventListener('submit', saveEvent);
    document.getElementById('events-list').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.closest('.list-item').dataset.id;
      if (btn.dataset.action === 'edit-event') {
        openEventForm(state.events.find((e) => e.id === id));
      } else if (btn.dataset.action === 'delete-event') {
        deleteEvent(id);
      }
    });
  }

  // --- Settings ---

  async function loadSettingsTab() {
    try {
      const settings = await api('/api/admin/settings');
      document.getElementById('settings-notify-email').value = settings.notifyEmail || '';
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function saveNotifyEmail(event) {
    event.preventDefault();
    const email = document.getElementById('settings-notify-email').value.trim();
    try {
      await api('/api/admin/settings/notify-email', { method: 'PUT', body: JSON.stringify({ email }) });
      showToast('Notification email updated.');
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    const currentPassword = document.getElementById('settings-current-password').value;
    const newPassword = document.getElementById('settings-new-password').value;
    const confirmPassword = document.getElementById('settings-confirm-password').value;
    if (newPassword !== confirmPassword) {
      showToast('New password and confirmation do not match.', true);
      return;
    }
    try {
      await api('/api/admin/settings/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      showToast('Password updated.');
      document.getElementById('password-form').reset();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function initSettingsTab() {
    document.getElementById('notify-email-form').addEventListener('submit', saveNotifyEmail);
    document.getElementById('password-form').addEventListener('submit', savePassword);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initPostsTab();
    initContentTab();
    initPressTab();
    initInvestmentsEventsTab();
    initSettingsTab();
    loadSurvey();
  });
})();
