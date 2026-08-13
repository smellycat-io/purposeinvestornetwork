// Shared site navigation, used by both the static front-end pages and the
// backend-rendered pages (roundtables, roundtable, initiative). Served at
// /nav.js in both local dev and production so there is exactly one copy of
// the topbar markup.
(function () {
  const NAV_LINKS = [
    { href: '/about.html', label: 'About' },
    { href: '/roundtables', label: 'Roundtables' },
    { href: '/pin-member-questionnaire.html', label: 'Take Our Survey' },
  ];

  function isActive(href) {
    const path = window.location.pathname;
    return href === '/roundtables' ? path.startsWith('/roundtables') : path === href;
  }

  function siteTopbarHtml() {
    const links = NAV_LINKS.map(
      (link) => `<a href="${link.href}"${isActive(link.href) ? ' class="active"' : ''}>${link.label}</a>`
    ).join('\n        ');

    return `
    <div class="site-topbar__inner">
      <a class="site-topbar__logo" href="/">
        <img src="/imgs/logos/pin_logo.png" alt="Purpose Investor Network logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex';" />
        <span class="site-topbar__logo-fallback">Purpose Investor Network</span>
      </a>
      <nav class="site-topbar__nav">
        ${links}
      </nav>
    </div>`;
  }

  function renderNav() {
    const root = document.getElementById('site-topbar');
    if (root) root.innerHTML = siteTopbarHtml();
  }

  // Separate entry points for the front-end and backend pages so each side
  // can diverge later without the other having to change.
  window.renderFrontendNav = renderNav;
  window.renderBackendNav = renderNav;
})();
