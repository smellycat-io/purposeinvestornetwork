// Card renderers shared by the roundtables/roundtable/initiative pages.
// Depends on escapeHtml/formatDate from dom-utils.js, which must be loaded first.

function cardImageHtml(url) {
  return url ? `<img class="card-link__image" src="${escapeHtml(url)}" alt="" />` : '';
}

function linkCardHtml({ href, imageUrl, title, description, headingLevel = 3 }) {
  return `
    <a class="card-link" href="${href}">
      ${cardImageHtml(imageUrl)}
      <div class="card-link__body">
        <h${headingLevel}>${escapeHtml(title)}</h${headingLevel}>
        <p>${escapeHtml(description)}</p>
      </div>
    </a>
  `;
}

function updateCardHtml(update, { initiativeLink } = {}) {
  const initiativePrefix = initiativeLink
    ? `<a href="${initiativeLink.href}">${escapeHtml(initiativeLink.label)}</a> &bull; `
    : '';

  return `
    <article class="update-card">
      <div class="update-meta">
        ${initiativePrefix}<span>${escapeHtml(formatDate(update.publishedAt))}</span>
        ${update.author ? `<span>&bull; ${escapeHtml(update.author)}</span>` : ''}
      </div>
      <h4>${escapeHtml(update.title)}</h4>
      <div class="update-body">${update.body}</div>
    </article>
  `;
}
