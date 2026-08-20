// "Where We Started" — a hardcoded, static archive/history section. Not
// database-driven: the calling page passes its own entries array in, so
// this file holds zero data of its own and stays reusable across pages
// (Updates page, /events/conference, wherever else it's dropped in later).
//
// Depends on escapeHtml from dom-utils.js, and on video-facade.js for the
// click-to-play behavior on video entries — both must be loaded first.
//
// Entry shape: { title, date, description, imageUrl? , videoUrl? }
// Exactly one of imageUrl/videoUrl is expected (videoUrl wins if both are
// given). videoUrl accepts a normal youtube.com/watch or youtu.be link —
// it's parsed down to a bare video id for the facade.

function extractYouTubeId(url) {
  const trimmed = String(url || '').trim();
  const match = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|watch\?v=))([^&?/]+)/);
  return match ? match[1] : trimmed;
}

function archiveEntryMediaHtml(entry) {
  if (entry.videoUrl) {
    return `
      <div class="archive-entry__media">
        <div class="video-facade" data-video-id="${escapeHtml(extractYouTubeId(entry.videoUrl))}" data-title="${escapeHtml(entry.title)}"></div>
      </div>
    `;
  }
  if (entry.imageUrl) {
    return `
      <div class="archive-entry__media">
        <img src="${escapeHtml(entry.imageUrl)}" alt="${escapeHtml(entry.title)}" loading="lazy" />
      </div>
    `;
  }
  return '';
}

function archiveEntryHtml(entry) {
  return `
    <div class="archive-entry">
      ${archiveEntryMediaHtml(entry)}
      <div class="archive-entry__body">
        <p class="archive-entry__era">${escapeHtml(entry.date)}</p>
        <h4>${escapeHtml(entry.title)}</h4>
        <p>${escapeHtml(entry.description)}</p>
      </div>
    </div>
  `;
}

function whereWeStartedHtml(entries, options) {
  const opts = options || {};
  const heading = opts.heading || 'Where We Started';
  const intro = opts.intro || '';

  return `
    <div class="archive-divider" aria-hidden="true"></div>
    <section class="archive-section">
      <div class="archive-section__inner">
        <p class="archive-section__eyebrow">Archive</p>
        <h3 class="archive-section__heading">${escapeHtml(heading)}</h3>
        ${intro ? `<p class="archive-section__intro">${escapeHtml(intro)}</p>` : ''}
        <div class="archive-timeline">
          ${(entries || []).map(archiveEntryHtml).join('')}
        </div>
      </div>
    </section>
  `;
}
