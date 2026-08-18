// Shared site navigation, used by both the static front-end pages and the
// backend-rendered pages (roundtables, roundtable, initiative). Served at
// /nav.js in both local dev and production so there is exactly one copy of
// the topbar markup.
(function () {
  const NAV_LINKS = [
    { href: '/about.html', label: 'About' },
    {
      href: '/roundtables',
      label: 'Roundtables',
      children: [
        { href: '/investments', label: 'Investments' },
        { href: '/events', label: 'Events' },
      ],
    },
    { href: '/education', label: 'Education' },
    {
      href: '/updates',
      label: 'Updates',
      children: [{ href: '/press', label: 'Press' }],
    },
    { href: '/pin-member-questionnaire.html', label: 'Take Our Survey' },
    { href: '/become-a-member.html', label: 'Join', cta: true },
  ];

  // Prefix-matched sections (their own detail/sub-pages share the parent link's active state).
  const PREFIX_MATCHED = ['/roundtables', '/investments', '/events', '/education', '/updates'];

  function isActive(href) {
    const path = window.location.pathname;
    if (href === '/events' && path === '/conference') return true;
    return PREFIX_MATCHED.includes(href) ? path.startsWith(href) : path === href;
  }

  function linkHtml(link, forceActive) {
    const active = forceActive || isActive(link.href);
    const classes = [link.cta ? 'site-topbar__nav-cta' : null, active ? 'active' : null].filter(Boolean);
    const classAttr = classes.length ? ` class="${classes.join(' ')}"` : '';
    return `<a href="${link.href}"${classAttr}>${link.label}</a>`;
  }

  function navItemHtml(link) {
    if (!link.children || !link.children.length) return linkHtml(link);

    const hasActiveChild = link.children.some((child) => isActive(child.href));
    return `
        <div class="site-topbar__nav-item${hasActiveChild ? ' active' : ''}">
          ${linkHtml(link, hasActiveChild)}
          <div class="site-topbar__dropdown">
            ${link.children.map((child) => linkHtml(child)).join('\n            ')}
          </div>
        </div>`;
  }

  function siteTopbarHtml() {
    const links = NAV_LINKS.map(navItemHtml).join('\n        ');

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
