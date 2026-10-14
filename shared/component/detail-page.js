// Generic "fetch by slug -> render banner + body" driver for detail pages
// (Investment, Event, Roundtable, Initiative, Update, Education Article).
// Depends on fetchJson/lastPathSegment from dom-utils.js, and pageBannerHtml
// from banner.js when useBanner is true — both must be loaded first.
//
// `load` receives the slug and returns (a promise of) whatever shape the
// page needs — a single fetch, or several combined, since that varies per
// page (e.g. Roundtable returns {roundtable, initiatives, updates}).

async function renderDetailPage({
  contentElId,
  bannerSlotId,
  load,
  pageTitle,
  useBanner = true,
  mapBanner,
  renderBody,
  afterRender,
  notFoundText,
  errorText,
}) {
  const contentEl = document.getElementById(contentElId);
  const slug = lastPathSegment();

  try {
    const data = await load(slug);
    document.title = pageTitle(data);

    let headingHtml = '';
    if (useBanner) {
      const { bannerHtml, headingHtml: h } = pageBannerHtml(mapBanner(data));
      if (bannerSlotId) document.getElementById(bannerSlotId).innerHTML = bannerHtml;
      headingHtml = h;
    }

    contentEl.innerHTML = `${headingHtml}${renderBody(data)}`;
    // Anything renderBody's returned HTML needs live behavior wired up for
    // (e.g. the interest form's submit handler) has to happen after this
    // innerHTML assignment — injected markup has no behavior of its own
    // until something explicitly attaches it.
    if (afterRender) afterRender(data);
  } catch (err) {
    if (err.status === 404) {
      contentEl.innerHTML = `<p class="muted">${notFoundText || 'We couldn’t find that. It may have been renamed or removed.'}</p>`;
    } else {
      contentEl.innerHTML = `<p class="muted">${errorText || 'Unable to load this right now. Please try again later.'}</p>`;
    }
  }
}
