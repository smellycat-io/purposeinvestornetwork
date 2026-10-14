(function () {
  'use strict';

  const state = {
    roundtables: [],
    initiatives: [],
    posts: [],
    press: [],
    investments: [],
    events: [],
    users: [],
    campaigns: [],
    campaignEntries: [],
    me: null,
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

  // Every route this dashboard calls returns a JSON { error } body on
  // failure — but not every *status code* the browser can see necessarily
  // comes from one of those routes (a CloudFront/API Gateway-level
  // rejection, a proxy error page, a body too large for body-parser to
  // even construct a response for). This is the fallback for exactly that
  // case: no JSON body to read an `error` out of, so map the bare status
  // to something more useful than "Request failed (502)".
  const STATUS_FALLBACK_MESSAGES = {
    401: 'Your session expired. Log in again.',
    403: "You don't have permission to do that.",
    413: 'That file is too large to upload.',
    502: 'The server is temporarily unavailable. Try again in a minute.',
    503: 'The server is temporarily unavailable. Try again in a minute.',
    504: 'The server is temporarily unavailable. Try again in a minute.',
  };

  async function api(path, options) {
    const response = await fetch(path, Object.assign({
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    }, options));
    if (!response.ok) {
      let message = STATUS_FALLBACK_MESSAGES[response.status] || ('Request failed (' + response.status + ')');
      try {
        const body = await response.json();
        if (body && body.error) message = body.error;
        // Only present on routes that opt into it server-side
        // (asyncRoute's `verbose` option) — the raw exception message
        // behind an unexpected 500, folded into the toast so "unable to
        // X" isn't the whole story.
        if (body && body.detail) message += ': ' + body.detail;
      } catch (_) { /* no JSON body — keep the status-mapped fallback above */ }
      throw new Error(message);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  // Fetched once (cached as a promise, not just state.me) so the dashboard
  // can adapt its own UI to the logged-in user's role — e.g. hiding invite/
  // edit controls a Chair's submission would just have been overridden or
  // rejected anyway — not just enforce permissions server-side. A bootstrap
  // ADMIN_USER/ADMIN_PASS session comes back as { role: 'admin', bootstrap:
  // true }, with no id/roundtableId — every call site below checks
  // state.me.role, which is always present either way. Callers that need
  // state.me before the page-load fetch resolves await this same in-flight
  // request instead of firing a second one.
  let currentUserPromise = null;
  function loadCurrentUser() {
    if (!currentUserPromise) {
      currentUserPromise = api('/api/users/me')
        .then((me) => { state.me = me; return me; })
        .catch((err) => { showToast('Unable to load your profile: ' + err.message, true); return null; });
    }
    return currentUserPromise;
  }

  // "Signed in as <name or email> (<Level>, <roundtable name>)" — the
  // bootstrap ADMIN_USER/ADMIN_PASS session has no profile or roundtable to
  // show at all, so it gets the one-line fallback instead.
  function renderSessionInfo() {
    const el = document.getElementById('session-info');
    const me = state.me;
    if (!el || !me) return;
    if (me.bootstrap) {
      el.textContent = 'Signed in as admin';
      return;
    }
    const name = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.email || '';
    const levelLabel = isChairSession() ? 'Chair' : 'Admin';
    if (isChairSession()) {
      const roundtable = state.roundtables.find((rt) => rt.id === me.roundtableId);
      el.textContent = `Signed in as ${name} (${levelLabel}, ${roundtable ? roundtable.name : 'no roundtable'})`;
    } else {
      el.textContent = `Signed in as ${name} (${levelLabel})`;
    }
  }

  // admin.css's `body:not([data-role="admin"]) .admin-only` rule hides
  // Admin-only static markup from first paint, before this runs — setting
  // data-role here only ever *reveals* it for an Admin/bootstrap session,
  // never the reverse, so there's nothing to flash for a Chair session
  // either way.
  async function applySessionRole() {
    const me = state.me;
    // Only an Admin or Chair session ever runs this file at all (GET /admin
    // itself is requireRole('admin', 'chair')), so the two helpers already
    // cover every case here.
    if (me) document.body.dataset.role = isAdminSession() ? 'admin' : 'chair';
    if (isChairSession() && !state.roundtables.length) {
      try {
        state.roundtables = await api('/api/roundtables');
      } catch (_) {
        // Header still shows Level without a roundtable name — not worth a
        // toast on its own, the rest of the dashboard surfaces the same
        // failure once a tab that actually needs roundtables loads.
      }
    }
    renderSessionInfo();
    applyDefaultTab();
  }

  // The default active tab is always the first one this role can see, so a
  // hidden tab (Press, for a Chair) never ends up the one left selected.
  function applyDefaultTab() {
    const role = currentRole();
    const tab = DashboardVisibility.defaultTab(role);
    document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === 'tab-' + tab));
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
    if (!file.type || !file.type.startsWith('image/')) {
      throw new Error('Only image files can be uploaded.');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      throw new Error(`${file.name} is ${sizeMb} MB; the limit is 3.5 MB.`);
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
        if (btn.dataset.tab === 'campaigns') loadCampaignsTab();
        if (btn.dataset.tab === 'posts') loadPostsTab();
        if (btn.dataset.tab === 'content') loadContentTab();
        if (btn.dataset.tab === 'press') loadPressTab();
        if (btn.dataset.tab === 'investments-events') loadInvestmentsEventsTab();
        if (btn.dataset.tab === 'users') loadUsersTab();
      });
    });
  }

  // --- Campaigns ---
  //
  // One tab covers five campaign types: the three site-wide ones (survey,
  // waitlist, newsletter) and one per Roundtable/Initiative. A single
  // dropdown (grouped by campaignGroupLabel) switches between them rather
  // than separate per-type panels, since the controls around a campaign
  // (results emails, consent filter, entries table) are the same shape
  // regardless of which kind it is — only the entries table's extra
  // columns and the consent filter's default actually vary by type.

  const CAMPAIGN_TYPE_LABELS = {
    survey: 'Survey',
    waitlist: 'Membership Waitlist',
    newsletter: 'Newsletter',
    'roundtable-interest': 'Roundtable Interest',
    'initiative-interest': 'Initiative Interest',
  };

  const INTEREST_TYPES = ['roundtable-interest', 'initiative-interest'];

  function campaignGroupLabel(campaign) {
    if (campaign.type === 'roundtable-interest') return 'Roundtables';
    if (campaign.type === 'initiative-interest') return 'Initiatives';
    return 'Site-wide';
  }

  function populateCampaignSelect() {
    const select = document.getElementById('campaign-select');
    const previousValue = select.value;
    const groups = { 'Site-wide': [], Roundtables: [], Initiatives: [] };
    state.campaigns.forEach((c) => { groups[campaignGroupLabel(c)].push(c); });

    select.innerHTML = Object.entries(groups)
      .filter(([, items]) => items.length)
      .map(([label, items]) => `
        <optgroup label="${escapeHtml(label)}">
          ${items.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}${c.archived ? ' (archived)' : ''}</option>`).join('')}
        </optgroup>
      `).join('');

    const stillExists = state.campaigns.some((c) => c.id === previousValue);
    select.value = stillExists ? previousValue : (state.campaigns[0] ? state.campaigns[0].id : '');
  }

  function selectedCampaign() {
    const id = document.getElementById('campaign-select').value;
    return state.campaigns.find((c) => c.id === id) || null;
  }

  // Everything that doesn't depend on the entries fetch — the entries
  // themselves (and the entry count in the meta line) are rendered
  // separately by renderCampaignEntriesTable, once loadCampaignEntries
  // resolves.
  function renderCampaignControls(campaign) {
    const chairSession = isChairSession();
    document.getElementById('campaign-detail-name').textContent = campaign ? campaign.name : '—';

    const resultsEmailsField = document.getElementById('campaign-results-emails');
    resultsEmailsField.value = campaign && Array.isArray(campaign.resultsEmails) ? campaign.resultsEmails.join(', ') : '';
    resultsEmailsField.readOnly = chairSession;

    document.getElementById('campaign-effective-emails').textContent = campaign
      ? `Currently emails: ${(campaign.effectiveResultsEmails || []).join(', ') || '(no recipients configured)'}`
      : '';

    document.getElementById('campaign-results-emails-actions').style.display = chairSession ? 'none' : '';
    document.getElementById('campaign-notify-on-entry').checked = !!(campaign && campaign.notifyOnEntry);
    document.getElementById('campaign-archived-toggle').checked = !!(campaign && campaign.archived);

    // "Opted in only" by default for interest campaigns, where the
    // checkbox is a real choice the visitor made; "Everyone" for the
    // site-wide ones, where consent is either not recorded at all
    // (survey) or always true by construction (waitlist/newsletter — see
    // routes/subscribers.js), so filtering on it wouldn't narrow anything.
    document.getElementById('campaign-consent-filter').value =
      campaign && INTEREST_TYPES.includes(campaign.type) ? 'yes' : 'all';
  }

  function filteredCampaignEntries(campaign) {
    const wantsOptedInOnly = document.getElementById('campaign-consent-filter').value === 'yes';
    if (!wantsOptedInOnly || campaign.id === 'survey') return state.campaignEntries;
    return state.campaignEntries.filter((e) => e.consent);
  }

  function renderCampaignEntriesTable(campaign) {
    const thead = document.getElementById('campaign-entries-head');
    const tbody = document.getElementById('campaign-entries-rows');
    document.getElementById('campaign-detail-meta').textContent = campaign
      ? `${CAMPAIGN_TYPE_LABELS[campaign.type] || campaign.type} • ${state.campaignEntries.length} entries`
      : '';

    if (!campaign) {
      thead.innerHTML = '';
      tbody.innerHTML = '<tr><td class="muted">No campaign selected.</td></tr>';
      return;
    }

    const isSurvey = campaign.id === 'survey';
    const isWaitlist = campaign.id === 'waitlist';
    const isInterest = INTEREST_TYPES.includes(campaign.type);

    const columns = ['Email', 'Name', 'Consent'];
    if (isInterest) columns.push('Message');
    if (isWaitlist) columns.push('Phone', 'Address');
    if (isSurvey) columns.push('Answers');
    columns.push('Created');
    thead.innerHTML = `<tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`;

    const entries = filteredCampaignEntries(campaign);
    if (!entries.length) {
      tbody.innerHTML = `<tr><td colspan="${columns.length}" class="muted">No entries match these filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = entries.map((e) => {
      const cells = [
        escapeHtml(e.email || '—'),
        escapeHtml(e.name || '—'),
        isSurvey ? '—' : (e.consent ? 'Yes' : 'No'),
      ];
      if (isInterest) cells.push(escapeHtml(e.message || '—'));
      if (isWaitlist) cells.push(escapeHtml(e.phone || '—'), escapeHtml(e.address || '—'));
      if (isSurvey) cells.push(`<pre>${escapeHtml(JSON.stringify(e.answers, null, 2))}</pre>`);
      cells.push(escapeHtml(e.createdAt || '—'));
      return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
    }).join('');
  }

  async function loadCampaignEntries(campaign) {
    if (!campaign) {
      state.campaignEntries = [];
      renderCampaignEntriesTable(null);
      return;
    }
    document.getElementById('campaign-entries-rows').innerHTML = '<tr><td class="muted">Loading…</td></tr>';
    try {
      const { entries } = await api('/api/admin/campaigns/' + encodeURIComponent(campaign.id) + '/entries');
      state.campaignEntries = entries;
      renderCampaignEntriesTable(campaign);
    } catch (err) {
      document.getElementById('campaign-entries-rows').innerHTML = '<tr><td class="muted">Failed to load entries.</td></tr>';
      showToast(err.message, true);
    }
  }

  async function onCampaignSelected() {
    const campaign = selectedCampaign();
    renderCampaignControls(campaign);
    await loadCampaignEntries(campaign);
  }

  async function loadCampaignsTab() {
    await loadCurrentUser();
    const chairSession = isChairSession();
    document.getElementById('campaign-archived-field').style.display = chairSession ? 'none' : '';

    const showArchived = !chairSession && document.getElementById('campaign-show-archived').checked;
    try {
      state.campaigns = await api('/api/admin/campaigns' + (showArchived ? '?archived=1' : ''));
      populateCampaignSelect();
      await onCampaignSelected();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function saveCampaignResultsEmails() {
    const campaign = selectedCampaign();
    if (!campaign) return;
    const emails = document.getElementById('campaign-results-emails').value.split(',').map((e) => e.trim()).filter(Boolean);
    try {
      const updated = await api('/api/admin/campaigns/' + encodeURIComponent(campaign.id), {
        method: 'PATCH',
        body: JSON.stringify({ resultsEmails: emails.length ? emails : null }),
      });
      Object.assign(campaign, updated);
      renderCampaignControls(campaign);
      showToast('Results emails updated.');
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function toggleCampaignField(field, checkboxId) {
    const campaign = selectedCampaign();
    if (!campaign) return;
    const value = document.getElementById(checkboxId).checked;
    try {
      const updated = await api('/api/admin/campaigns/' + encodeURIComponent(campaign.id), {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
      });
      // Archiving the currently-selected campaign while "Show archived" is
      // off would otherwise leave it selected but no longer in the list it
      // came from — reload the whole tab so the dropdown and selection
      // land somewhere consistent.
      if (field === 'archived' && value && !document.getElementById('campaign-show-archived').checked) {
        await loadCampaignsTab();
      } else {
        Object.assign(campaign, updated);
        renderCampaignControls(campaign);
      }
      showToast('Campaign updated.');
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function copyFilteredEmails() {
    const campaign = selectedCampaign();
    if (!campaign) return;
    const emails = [...new Set(
      filteredCampaignEntries(campaign).map((e) => (e.email || '').trim().toLowerCase()).filter(Boolean)
    )];
    const text = emails.join(', ');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      showToast(`Copied ${emails.length} email${emails.length === 1 ? '' : 's'}.`);
    } catch (err) {
      showToast('Unable to copy emails.', true);
    }
  }

  function initCampaignsTab() {
    document.getElementById('campaign-select').addEventListener('change', onCampaignSelected);
    document.getElementById('campaign-show-archived').addEventListener('change', loadCampaignsTab);
    document.getElementById('campaign-consent-filter').addEventListener('change', () => renderCampaignEntriesTable(selectedCampaign()));
    document.getElementById('campaign-save-results-emails-btn').addEventListener('click', saveCampaignResultsEmails);
    document.getElementById('campaign-notify-on-entry').addEventListener('change', () => toggleCampaignField('notifyOnEntry', 'campaign-notify-on-entry'));
    document.getElementById('campaign-archived-toggle').addEventListener('change', () => toggleCampaignField('archived', 'campaign-archived-toggle'));
    document.getElementById('campaign-copy-emails-btn').addEventListener('click', copyFilteredEmails);
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
      // A Chair's Post type locks to 'update' — the only type tied to an
      // Initiative they can reach (routes/posts.js's isPostInChairScope) —
      // on both a new Post and an edit, since every Post a Chair can open
      // is already type:'update' per the backend's own scoping.
      const lockedType = DashboardVisibility.lockedPostType(currentRole());
      const typeSelect = document.getElementById('post-type');
      typeSelect.value = lockedType || (post ? post.type : 'blog');
      typeSelect.disabled = !!lockedType;
      document.getElementById('post-initiative').required = !!lockedType;
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
    await loadCurrentUser();
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

  // lockToId (a Chair's own roundtableId — see DashboardVisibility's
  // lockedRoundtableId) renders a single checkbox, pre-checked and
  // disabled, instead of the full list: a Chair has no authority over any
  // Roundtable but their own (routes/initiatives.js, routes/investments.js),
  // so that's the only choice their form ever actually offers. A disabled
  // checkbox still matches `:checked` in a querySelectorAll — only a native
  // form submit excludes disabled fields, and buildPayload reads `.value`
  // directly, not via FormData.
  function renderRoundtableChecks(containerId, selectedIds, lockToId) {
    const container = document.getElementById(containerId);
    if (lockToId) {
      const rt = state.roundtables.find((r) => r.id === lockToId);
      container.innerHTML = rt
        ? `<label><input type="checkbox" value="${escapeHtml(rt.id)}" checked disabled> ${escapeHtml(rt.name)}</label>`
        : '<span class="muted">Your roundtable could not be found.</span>';
      return;
    }
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
    getItems: () => DashboardVisibility.visibleRoundtables(currentRole(), state.roundtables, currentRoundtableId()),
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
          ${DashboardVisibility.canDeleteRoundtable(currentRole())
            ? '<button class="btn-small danger" data-action="delete-roundtable" type="button">Delete</button>'
            : ''}
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
      renderRoundtableChecks(
        'initiative-roundtable-checks',
        initiative ? initiative.roundtableIds : [],
        DashboardVisibility.lockedRoundtableId(currentRole(), currentRoundtableId())
      );
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
    await loadCurrentUser();
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
      renderRoundtableChecks(
        'investment-roundtable-checks',
        investment ? investment.roundtableIds : [],
        DashboardVisibility.lockedRoundtableId(currentRole(), currentRoundtableId())
      );
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
    await loadCurrentUser();
    try {
      // GET /api/admin/events is requireRole('admin') only, no Chair path
      // (see routes/events.js) — fetching it for a Chair session would 403
      // and surface as a failed-to-load toast for a section they can't see
      // anyway (admin-only in admin.html), so it's skipped outright instead.
      const canSeeEvents = DashboardVisibility.canSeeEvents(currentRole());
      const [investments, events, roundtables, initiatives] = await Promise.all([
        api('/api/admin/investments'),
        canSeeEvents ? api('/api/admin/events') : Promise.resolve([]),
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
  //
  // Notification email used to live here, but it's per-campaign now (see
  // the Campaigns tab's "Results emails" field) — this tab is just Change
  // Password.

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
    document.getElementById('password-form').addEventListener('submit', savePassword);
  }

  // --- Users ---
  //
  // Not a createCrudPanel: invite-by-email and edit-by-PATCH are different
  // shapes, status/level filtering sits above the table, and this is a
  // table layout rather than .list-item rows.

  function isChairSession() {
    return !!(state.me && state.me.role === 'chair');
  }

  function isAdminSession() {
    return !!(state.me && state.me.role === 'admin');
  }

  // state.me resolves before anything that reads it ever runs (every load*Tab
  // function awaits loadCurrentUser, and DOMContentLoaded awaits it before
  // the first render) — the 'admin' fallback here only guards a call made
  // before that, which defaults open the same way admin.css's admin-only
  // class defaults *closed*: neither should ever matter in practice.
  function currentRole() {
    return state.me ? state.me.role : 'admin';
  }

  function currentRoundtableId() {
    return state.me ? state.me.roundtableId : null;
  }

  // Pending + inviteExpiresAt in the past reads as "Expired," not
  // "Pending" — same status value server-side (only Admin/Chair action
  // availability differs: both are still resendable), but the dashboard
  // should make a stale invite visually obvious rather than leaving it
  // looking identical to a fresh one.
  function userStatusKey(u) {
    if (u.status === 'active') return 'active';
    if (u.status === 'pending') {
      return u.inviteExpiresAt && new Date(u.inviteExpiresAt).getTime() < Date.now() ? 'expired' : 'pending';
    }
    return u.status;
  }

  const USER_STATUS_LABELS = { active: 'Active', pending: 'Pending', expired: 'Expired' };

  function roundtableLabel(u) {
    if (u.role === 'chair') {
      const rt = state.roundtables.find((r) => r.id === u.roundtableId);
      return rt ? rt.name : '—';
    }
    if (u.role === 'member') {
      const names = (u.roundtableIds || [])
        .map((id) => (state.roundtables.find((r) => r.id === id) || {}).name)
        .filter(Boolean);
      return names.length ? names.join(', ') : 'None';
    }
    return '—';
  }

  function renderUsersTable() {
    const tbody = document.getElementById('users-rows');
    const statusFilter = document.getElementById('users-filter-status').value;
    const levelFilter = document.getElementById('users-filter-level').value;
    const chairSession = isChairSession();

    const filtered = state.users.filter((u) => {
      if (statusFilter !== 'all' && userStatusKey(u) !== statusFilter) return false;
      if (levelFilter !== 'all' && u.role !== levelFilter) return false;
      return true;
    });

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="muted">No users match these filters.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map((u) => {
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || '—';
      const statusKey = userStatusKey(u);
      const canResend = statusKey === 'pending' || statusKey === 'expired';
      const removeLabel = chairSession ? 'Remove from roundtable' : 'Remove';
      return `
        <tr data-id="${escapeHtml(u.id)}">
          <td>${escapeHtml(name)}</td>
          <td>${escapeHtml(u.email)}</td>
          <td>${escapeHtml(u.role || '—')}</td>
          <td>${escapeHtml(roundtableLabel(u))}</td>
          <td>${escapeHtml(USER_STATUS_LABELS[statusKey] || statusKey)}</td>
          <td>${escapeHtml(u.createdAt || '—')}</td>
          <td>${u.status === 'pending' && u.inviteExpiresAt ? escapeHtml(u.inviteExpiresAt) : '—'}</td>
          <td class="list-item-actions">
            ${!chairSession ? '<button class="btn-small" data-action="edit-user" type="button">Edit</button>' : ''}
            ${canResend ? '<button class="btn-small" data-action="resend-invite" type="button">Resend invite</button>' : ''}
            ${!chairSession && statusKey === 'active' ? '<button class="btn-small" data-action="send-reset" type="button">Send reset email</button>' : ''}
            <button class="btn-small danger" data-action="delete-user" type="button">${removeLabel}</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function loadUsersTab() {
    try {
      await loadCurrentUser();
      const [users, roundtables] = await Promise.all([
        api('/api/admin/users'),
        state.roundtables.length ? Promise.resolve(state.roundtables) : api('/api/roundtables'),
      ]);
      state.users = users;
      state.roundtables = roundtables;
      populateInviteRoundtableFields();
      updateInviteFieldVisibility();
      renderUsersTable();
    } catch (err) {
      document.getElementById('users-rows').innerHTML = '<tr><td colspan="8" class="muted">Failed to load users.</td></tr>';
      showToast(err.message, true);
    }
  }

  // --- Invite form ---

  // A Chair-issued invite always becomes role: 'member' onto the Chair's
  // own Roundtable regardless of what's submitted (routes/users.js ignores
  // Level/Roundtable entirely once the requester is a Chair), so a Chair
  // session hides both and shows a one-line explanation instead. An Admin
  // session shows Level and swaps between the Chair (single roundtable)
  // and Member (multi roundtable, optional) fields based on the currently
  // selected Level.
  function updateInviteFieldVisibility() {
    const chairSession = isChairSession();
    document.getElementById('invite-chair-note').style.display = chairSession ? 'block' : 'none';
    document.getElementById('invite-level-row').style.display = chairSession ? 'none' : 'flex';
    if (chairSession) {
      document.getElementById('invite-roundtable-chair-field').style.display = 'none';
      document.getElementById('invite-roundtable-member-field').style.display = 'none';
      return;
    }
    const level = document.getElementById('invite-level').value;
    document.getElementById('invite-roundtable-chair-field').style.display = level === 'chair' ? 'flex' : 'none';
    document.getElementById('invite-roundtable-member-field').style.display = level === 'member' ? 'block' : 'none';
  }

  function populateInviteRoundtableFields() {
    const select = document.getElementById('invite-roundtable-id');
    select.innerHTML = state.roundtables.length
      ? state.roundtables.map((rt) => `<option value="${escapeHtml(rt.id)}">${escapeHtml(rt.name)}</option>`).join('')
      : '<option value="">No roundtables yet — create one first.</option>';
    renderRoundtableChecks('invite-roundtable-checks', []);
  }

  async function sendInvite(event) {
    event.preventDefault();
    const email = document.getElementById('invite-email').value.trim();
    const note = document.getElementById('invite-note').value.trim();
    const payload = { email };
    if (note) payload.note = note;

    // A Chair session never submits Level/Roundtable — those controls are
    // hidden (updateInviteFieldVisibility), and routes/users.js ignores
    // them anyway once the requester is a Chair.
    if (!isChairSession()) {
      const level = document.getElementById('invite-level').value;
      payload.role = level;
      if (level === 'chair') {
        payload.roundtableId = document.getElementById('invite-roundtable-id').value || null;
      } else if (level === 'member') {
        payload.roundtableIds = Array.from(document.querySelectorAll('#invite-roundtable-checks input:checked')).map((el) => el.value);
      }
      // level === 'admin': no roundtable field applies — routes/users.js
      // forces roundtableId/roundtableIds to null/[] for any role but
      // chair/member regardless, but there's nothing meaningful to read
      // from the (hidden) roundtable controls here either way.
    }

    try {
      const result = await api('/api/admin/users/invite', { method: 'POST', body: JSON.stringify(payload) });
      if (result.emailed) {
        showToast('Invite sent.');
      } else {
        showToast('Invite created, but the email failed to send. Use Resend invite once that’s fixed.', true);
      }
      document.getElementById('invite-form').reset();
      updateInviteFieldVisibility();
      await loadUsersTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // --- Edit form (Admin only) ---

  function updateEditRoundtableVisibility() {
    const level = document.getElementById('user-edit-level').value;
    document.getElementById('user-edit-roundtable-chair-field').style.display = level === 'chair' ? 'flex' : 'none';
    document.getElementById('user-edit-roundtable-member-field').style.display = level === 'member' ? 'block' : 'none';
  }

  function populateEditRoundtableSelect() {
    const select = document.getElementById('user-edit-roundtable-id');
    select.innerHTML = state.roundtables.length
      ? state.roundtables.map((rt) => `<option value="${escapeHtml(rt.id)}">${escapeHtml(rt.name)}</option>`).join('')
      : '<option value="">No roundtables yet — create one first.</option>';
  }

  function openEditUser(user) {
    populateEditRoundtableSelect();
    document.getElementById('user-edit-id').value = user.id;
    document.getElementById('user-edit-first-name').value = user.firstName || '';
    document.getElementById('user-edit-last-name').value = user.lastName || '';
    document.getElementById('user-edit-phone').value = user.phone || '';
    document.getElementById('user-edit-address').value = user.address || '';
    document.getElementById('user-edit-level').value = user.role || 'member';
    document.getElementById('user-edit-roundtable-id').value = user.roundtableId || '';
    renderRoundtableChecks('user-edit-roundtable-checks', user.roundtableIds || []);
    updateEditRoundtableVisibility();
    document.getElementById('user-edit-form').classList.remove('hidden');
  }

  function closeEditUser() {
    document.getElementById('user-edit-form').classList.add('hidden');
    document.getElementById('user-edit-form').reset();
  }

  async function saveEditUser(event) {
    event.preventDefault();
    const id = document.getElementById('user-edit-id').value;
    const level = document.getElementById('user-edit-level').value;
    const payload = {
      firstName: document.getElementById('user-edit-first-name').value.trim(),
      lastName: document.getElementById('user-edit-last-name').value.trim(),
      phone: document.getElementById('user-edit-phone').value.trim() || null,
      address: document.getElementById('user-edit-address').value.trim() || null,
      role: level,
    };
    if (level === 'chair') {
      payload.roundtableId = document.getElementById('user-edit-roundtable-id').value || null;
    } else if (level === 'member') {
      payload.roundtableIds = Array.from(document.querySelectorAll('#user-edit-roundtable-checks input:checked')).map((el) => el.value);
    }

    try {
      await api('/api/admin/users/' + id, { method: 'PATCH', body: JSON.stringify(payload) });
      showToast('User updated.');
      closeEditUser();
      await loadUsersTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // --- Row actions ---

  async function resendInvite(id) {
    try {
      const result = await api('/api/admin/users/' + id + '/resend-invite', { method: 'POST' });
      showToast(result.emailed ? 'Invite resent.' : 'Invite reissued, but the email failed to send.', !result.emailed);
      await loadUsersTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function sendResetEmailToUser(id) {
    if (!confirm('Send a password reset email to this user?')) return;
    try {
      const result = await api('/api/admin/users/' + id + '/send-reset', { method: 'POST' });
      showToast(result.emailed ? 'Reset email sent.' : 'Reset created, but the email failed to send.', !result.emailed);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function deleteUser(id) {
    const chairSession = isChairSession();
    const confirmMessage = chairSession
      ? 'Remove this user from your Roundtable? They keep access to any other Roundtables they belong to.'
      : 'Remove this user? They will no longer be able to log in.';
    if (!confirm(confirmMessage)) return;
    try {
      await api('/api/admin/users/' + id, { method: 'DELETE' });
      showToast(chairSession ? 'User removed from your Roundtable.' : 'User removed.');
      await loadUsersTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function initUsersTab() {
    document.getElementById('invite-form').addEventListener('submit', sendInvite);
    document.getElementById('invite-level').addEventListener('change', updateInviteFieldVisibility);
    document.getElementById('user-edit-form').addEventListener('submit', saveEditUser);
    document.getElementById('user-edit-cancel-btn').addEventListener('click', closeEditUser);
    document.getElementById('user-edit-level').addEventListener('change', updateEditRoundtableVisibility);
    document.getElementById('users-filter-status').addEventListener('change', renderUsersTable);
    document.getElementById('users-filter-level').addEventListener('change', renderUsersTable);
    document.getElementById('users-rows').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.closest('tr').dataset.id;
      if (btn.dataset.action === 'edit-user') {
        const user = state.users.find((u) => u.id === id);
        if (user) openEditUser(user);
      } else if (btn.dataset.action === 'resend-invite') {
        resendInvite(id);
      } else if (btn.dataset.action === 'send-reset') {
        sendResetEmailToUser(id);
      } else if (btn.dataset.action === 'delete-user') {
        deleteUser(id);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    initTabs();
    initCampaignsTab();
    initPostsTab();
    initContentTab();
    initPressTab();
    initInvestmentsEventsTab();
    initSettingsTab();
    initUsersTab();
    // Awaited before the first render (Campaigns, below) so admin.css's
    // data-role selector and every isAdminSession()/isChairSession() call a
    // render function makes are already correct the first time anything
    // paints — never a flash of the wrong role's controls followed by a
    // second, corrected render.
    await loadCurrentUser();
    await applySessionRole();
    loadCampaignsTab();
  });
})();
