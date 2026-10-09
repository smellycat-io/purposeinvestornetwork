(function () {
  'use strict';

  const state = {
    roundtables: [],
    initiatives: [],
    posts: [],
    press: [],
    investments: [],
    events: [],
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

  // --- Generic CRUD panel ---
  //
  // Every content panel (Posts, Roundtables, Initiatives, Press,
  // Investments, Events) is the same skeleton: a toggle-hidden `<prefix>-form`
  // with `<prefix>-new-btn`/`<prefix>-cancel-btn`, a `<listId>` of
  // `.list-item[data-id]` rows with edit/delete buttons, and
  // create-or-update-on-submit. The only genuine per-panel logic is
  // buildPayload (form → API body), populateForm (item → form, or clear when
  // null), and renderItem (item → one row's HTML). Panel-specific extras
  // (Quill, roundtable checkboxes, datetime conversion) live in those
  // closures, not here.
  function createCrudPanel(config) {
    const { idPrefix, endpoint, listId, entityLabel, emptyMessage, deleteConfirm,
      getItems, buildPayload, populateForm, renderItem, reload } = config;

    let editingId = null;
    const formEl = () => document.getElementById(idPrefix + '-form');

    function open(item) {
      const f = formEl();
      if (f) f.classList.remove('hidden');
      editingId = item ? item.id : null;
      populateForm(item || null);
    }

    function reset() {
      editingId = null;
      populateForm(null);
      const f = formEl();
      if (f) f.classList.add('hidden');
    }

    async function save(event) {
      event.preventDefault();
      const payload = buildPayload();
      try {
        if (editingId) {
          await api(endpoint + '/' + editingId, { method: 'PUT', body: JSON.stringify(payload) });
          showToast(entityLabel + ' updated.');
        } else {
          await api(endpoint, { method: 'POST', body: JSON.stringify(payload) });
          showToast(entityLabel + ' created.');
        }
        reset();
        await reload();
      } catch (err) {
        showToast(err.message, true);
      }
    }

    async function remove(id) {
      if (!confirm(deleteConfirm)) return;
      try {
        await api(endpoint + '/' + id, { method: 'DELETE' });
        showToast(entityLabel + ' deleted.');
        await reload();
      } catch (err) {
        showToast(err.message, true);
      }
    }

    function renderList() {
      const list = document.getElementById(listId);
      const items = getItems();
      list.innerHTML = items.length
        ? items.map(renderItem).join('')
        : `<p class="muted">${emptyMessage}</p>`;
    }

    function init() {
      document.getElementById(idPrefix + '-new-btn').addEventListener('click', () => open(null));
      const cancelBtn = document.getElementById(idPrefix + '-cancel-btn');
      if (cancelBtn) cancelBtn.addEventListener('click', reset);
      const f = formEl();
      if (f) f.addEventListener('submit', save);
      document.getElementById(listId).addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-action]');
        if (!btn) return;
        const id = btn.closest('.list-item').dataset.id;
        if (btn.dataset.action === 'edit-' + idPrefix) {
          open(getItems().find((x) => x.id === id));
        } else if (btn.dataset.action === 'delete-' + idPrefix) {
          remove(id);
        }
      });
    }

    return { init, renderList };
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
        if (btn.dataset.tab === 'users') loadUsersTab();
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

  const POST_TYPE_LABELS = {
    blog: 'Blog',
    update: 'Update',
    education: 'Education',
    announcement: 'PIN Update',
    book: 'Book',
  };

  const postsPanel = createCrudPanel({
    idPrefix: 'post',
    endpoint: '/api/admin/posts',
    listId: 'posts-list',
    entityLabel: 'Post',
    emptyMessage: 'No posts yet.',
    deleteConfirm: 'Delete this post? This cannot be undone.',
    reload: () => loadPostsTab(),
    getItems: () => state.posts,
    buildPayload: () => {
      const type = document.getElementById('post-type').value;
      return {
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
    },
    populateForm: (post) => {
      getQuill();
      document.getElementById('post-id').value = post ? post.id : '';
      document.getElementById('post-title').value = post ? post.title : '';
      document.getElementById('post-author').value = post ? post.author || '' : '';
      document.getElementById('post-type').value = post ? post.type : 'blog';
      document.getElementById('post-member-only').checked = post ? !!post.memberOnly : false;
      document.getElementById('post-excerpt').value = post ? post.excerpt || '' : '';
      document.getElementById('post-purchase-url').value = post ? post.purchaseUrl || '' : '';
      document.getElementById('post-price').value = post ? post.price || '' : '';
      setImagePreview('post', post ? post.imageUrl || null : null);
      updatePostFieldVisibility();
      if (post && post.type === 'update' && post.initiativeId) {
        document.getElementById('post-initiative').value = post.initiativeId;
      }
      if (post) {
        quill.root.innerHTML = post.body || '';
      } else {
        quill.setContents([]);
      }
    },
    renderItem: (post) => {
      const initiativeName = (id) => {
        const found = state.initiatives.find((i) => i.id === id);
        return found ? found.title : 'Unknown initiative';
      };
      return `
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
      `;
    },
  });

  async function loadPostsTab() {
    try {
      const [posts, initiatives] = await Promise.all([
        api('/api/admin/posts'),
        state.initiatives.length ? Promise.resolve(state.initiatives) : api('/api/admin/initiatives'),
      ]);
      state.posts = posts;
      state.initiatives = initiatives;
      populateInitiativeSelect();
      postsPanel.renderList();
    } catch (err) {
      document.getElementById('posts-list').innerHTML = '<p class="muted">Failed to load posts.</p>';
      showToast(err.message, true);
    }
  }

  function initPostsTab() {
    postsPanel.init();
    document.getElementById('post-type').addEventListener('change', updatePostFieldVisibility);
  }

  // --- Roundtables & Initiatives ---

  function renderRoundtableChecks(containerId, selectedIds) {
    const container = document.getElementById(containerId);
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

  const roundtablesPanel = createCrudPanel({
    idPrefix: 'roundtable',
    endpoint: '/api/admin/roundtables',
    listId: 'roundtables-list',
    entityLabel: 'Roundtable',
    emptyMessage: 'No roundtables yet.',
    deleteConfirm: 'Delete this roundtable? Initiatives linked to it will keep their link until edited.',
    reload: () => loadContentTab(),
    getItems: () => state.roundtables,
    buildPayload: () => ({
      name: document.getElementById('roundtable-name').value.trim(),
      description: document.getElementById('roundtable-description').value.trim(),
      imageUrl: document.getElementById('roundtable-image-url').value || null,
    }),
    populateForm: (rt) => {
      document.getElementById('roundtable-id').value = rt ? rt.id : '';
      document.getElementById('roundtable-name').value = rt ? rt.name : '';
      document.getElementById('roundtable-description').value = rt ? rt.description || '' : '';
      setImagePreview('roundtable', rt ? rt.imageUrl : null);
    },
    renderItem: (rt) => `
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
    `,
  });

  const initiativesPanel = createCrudPanel({
    idPrefix: 'initiative',
    endpoint: '/api/admin/initiatives',
    listId: 'initiatives-list',
    entityLabel: 'Initiative',
    emptyMessage: 'No initiatives yet.',
    deleteConfirm: 'Delete this initiative? Its updates will remain but lose their initiative link.',
    reload: () => loadContentTab(),
    getItems: () => state.initiatives,
    buildPayload: () => ({
      title: document.getElementById('initiative-title').value.trim(),
      description: document.getElementById('initiative-description').value.trim(),
      roundtableIds: Array.from(document.querySelectorAll('#initiative-roundtable-checks input:checked')).map((el) => el.value),
      imageUrl: document.getElementById('initiative-image-url').value || null,
    }),
    populateForm: (initiative) => {
      document.getElementById('initiative-id').value = initiative ? initiative.id : '';
      document.getElementById('initiative-title').value = initiative ? initiative.title : '';
      document.getElementById('initiative-description').value = initiative ? initiative.description || '' : '';
      renderRoundtableChecks('initiative-roundtable-checks', initiative ? initiative.roundtableIds : []);
      setImagePreview('initiative', initiative ? initiative.imageUrl : null);
    },
    renderItem: (initiative) => {
      const roundtableNames = (ids) => (ids || [])
        .map((id) => (state.roundtables.find((rt) => rt.id === id) || {}).name)
        .filter(Boolean)
        .join(', ') || 'No roundtables linked';
      return `
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
      `;
    },
  });

  async function loadContentTab() {
    try {
      const [roundtables, initiatives] = await Promise.all([
        api('/api/roundtables'),
        api('/api/admin/initiatives'),
      ]);
      state.roundtables = roundtables;
      state.initiatives = initiatives;
      roundtablesPanel.renderList();
      initiativesPanel.renderList();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function initContentTab() {
    initImagePicker();
    roundtablesPanel.init();
    initiativesPanel.init();
  }

  // --- Press ---

  const pressPanel = createCrudPanel({
    idPrefix: 'press',
    endpoint: '/api/admin/press',
    listId: 'press-list',
    entityLabel: 'Press mention',
    emptyMessage: 'No press mentions yet.',
    deleteConfirm: 'Delete this press mention?',
    reload: () => loadPressTab(),
    getItems: () => state.press,
    buildPayload: () => {
      const dateValue = document.getElementById('press-date').value;
      return {
        title: document.getElementById('press-title').value.trim(),
        source: document.getElementById('press-source').value.trim(),
        publishedDate: dateValue ? new Date(dateValue).toISOString() : new Date().toISOString(),
        externalUrl: document.getElementById('press-url').value.trim(),
        excerpt: document.getElementById('press-excerpt').value.trim() || null,
      };
    },
    populateForm: (press) => {
      document.getElementById('press-id').value = press ? press.id : '';
      document.getElementById('press-title').value = press ? press.title : '';
      document.getElementById('press-source').value = press ? press.source : '';
      document.getElementById('press-date').value = press && press.publishedDate ? press.publishedDate.slice(0, 10) : '';
      document.getElementById('press-url').value = press ? press.externalUrl : '';
      document.getElementById('press-excerpt').value = press ? press.excerpt || '' : '';
    },
    renderItem: (p) => `
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
    `,
  });

  async function loadPressTab() {
    try {
      state.press = await api('/api/admin/press');
      pressPanel.renderList();
    } catch (err) {
      document.getElementById('press-list').innerHTML = '<p class="muted">Failed to load press mentions.</p>';
      showToast(err.message, true);
    }
  }

  function initPressTab() {
    pressPanel.init();
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

  const investmentsPanel = createCrudPanel({
    idPrefix: 'investment',
    endpoint: '/api/admin/investments',
    listId: 'investments-list',
    entityLabel: 'Investment',
    emptyMessage: 'No investments yet.',
    deleteConfirm: 'Delete this investment?',
    reload: () => loadInvestmentsEventsTab(),
    getItems: () => state.investments,
    buildPayload: () => ({
      title: document.getElementById('investment-title').value.trim(),
      status: document.getElementById('investment-status').value,
      initiativeId: document.getElementById('investment-initiative').value || null,
      roundtableIds: Array.from(document.querySelectorAll('#investment-roundtable-checks input:checked')).map((el) => el.value),
      description: document.getElementById('investment-description').value.trim(),
      outcomeSummary: document.getElementById('investment-outcome').value.trim() || null,
      memberOnly: document.getElementById('investment-member-only').checked,
      imageUrl: document.getElementById('investment-image-url').value || null,
    }),
    populateForm: (investment) => {
      document.getElementById('investment-id').value = investment ? investment.id : '';
      document.getElementById('investment-title').value = investment ? investment.title : '';
      document.getElementById('investment-status').value = investment ? investment.status : 'open';
      document.getElementById('investment-initiative').value = investment ? investment.initiativeId || '' : '';
      renderRoundtableChecks('investment-roundtable-checks', investment ? investment.roundtableIds : []);
      document.getElementById('investment-description').value = investment ? stripHtml(investment.description || '') : '';
      document.getElementById('investment-outcome').value = investment ? stripHtml(investment.outcomeSummary || '') : '';
      document.getElementById('investment-member-only').checked = investment ? !!investment.memberOnly : false;
      setImagePreview('investment', investment ? investment.imageUrl : null);
    },
    renderItem: (inv) => `
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
    `,
  });

  const eventsPanel = createCrudPanel({
    idPrefix: 'event',
    endpoint: '/api/admin/events',
    listId: 'events-list',
    entityLabel: 'Event',
    emptyMessage: 'No events yet.',
    deleteConfirm: 'Delete this event?',
    reload: () => loadInvestmentsEventsTab(),
    getItems: () => state.events,
    buildPayload: () => ({
      title: document.getElementById('event-title').value.trim(),
      startsAt: fromDatetimeLocalValue(document.getElementById('event-starts-at').value),
      endsAt: fromDatetimeLocalValue(document.getElementById('event-ends-at').value),
      location: document.getElementById('event-location').value.trim() || null,
      virtualLink: document.getElementById('event-virtual-link').value.trim() || null,
      description: document.getElementById('event-description').value.trim(),
      memberOnly: document.getElementById('event-member-only').checked,
      isConference: document.getElementById('event-is-conference').checked,
      imageUrl: document.getElementById('event-image-url').value || null,
    }),
    populateForm: (evt) => {
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
    },
    renderItem: (evt) => `
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
    `,
  });

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
      investmentsPanel.renderList();
      eventsPanel.renderList();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function initInvestmentsEventsTab() {
    investmentsPanel.init();
    eventsPanel.init();
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

  // --- Users ---
  //
  // Not a createCrudPanel: invite-by-email (no title/body form), no edit
  // flow, and a table layout rather than .list-item rows.

  async function loadUsersTab() {
    const tbody = document.getElementById('users-rows');
    try {
      const users = await api('/api/admin/users');
      if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="muted">No users yet.</td></tr>';
        return;
      }
      tbody.innerHTML = users.map((u) => {
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ');
        return `
        <tr data-id="${escapeHtml(u.id)}">
          <td>${escapeHtml(name || '—')}</td>
          <td>${escapeHtml(u.email)}</td>
          <td>${escapeHtml(u.phone || '—')}</td>
          <td>${escapeHtml(u.status)}</td>
          <td>${escapeHtml(u.createdAt)}</td>
          <td><button class="btn-small danger" data-action="delete-user" type="button">Remove</button></td>
        </tr>
      `;
      }).join('');
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted">Failed to load users.</td></tr>';
      showToast(err.message, true);
    }
  }

  async function sendInvite(event) {
    event.preventDefault();
    const email = document.getElementById('invite-email').value.trim();
    try {
      const result = await api('/api/admin/users/invite', { method: 'POST', body: JSON.stringify({ email }) });
      showToast(result.emailed ? 'Invite sent.' : 'Invite created, but the email failed to send.', !result.emailed);
      document.getElementById('invite-form').reset();
      await loadUsersTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function deleteUser(id) {
    if (!confirm('Remove this user? They will no longer be able to log in.')) return;
    try {
      await api('/api/admin/users/' + id, { method: 'DELETE' });
      showToast('User removed.');
      await loadUsersTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function initUsersTab() {
    document.getElementById('invite-form').addEventListener('submit', sendInvite);
    document.getElementById('users-rows').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-action="delete-user"]');
      if (!btn) return;
      deleteUser(btn.closest('tr').dataset.id);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initPostsTab();
    initContentTab();
    initPressTab();
    initInvestmentsEventsTab();
    initSettingsTab();
    initUsersTab();
    loadSurvey();
  });
})();
