// Shared "hero" renderer for the roundtable/initiative pages: a full-width
// image banner when the item has an imageUrl, otherwise a plain heading.
// Depends on escapeHtml from dom-utils.js, which must be loaded first.

function pageBannerHtml({ imageUrl, title, description, extraHtml = '' }) {
  if (imageUrl) {
    return {
      bannerHtml: `
        <div class="page-banner" style="background-image: url('${escapeHtml(imageUrl)}');">
          <div class="page-banner__inner">
            <div class="page-banner-text">
              <h2>${escapeHtml(title)}</h2>
              <p>${escapeHtml(description)}</p>
              ${extraHtml}
            </div>
          </div>
        </div>
      `,
      headingHtml: '',
    };
  }

  return {
    bannerHtml: '',
    headingHtml: `
      <div class="page-heading">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
        ${extraHtml}
      </div>
    `,
  };
}
