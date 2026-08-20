// Generic "fetch a collection -> render item cards" driver for list/index
// pages (Roundtables, Investments, Events, Press, Education, Updates).
// Depends on fetchJson from dom-utils.js, which must be loaded first.
//
// A page can render more than one list from the same fetch (e.g. Events
// splits one /api/events response into "Upcoming" and "Past" containers) by
// passing multiple entries in `lists`, each with its own transform.

async function renderListPage({ endpoint, lists }) {
  let items;
  try {
    items = await fetchJson(endpoint);
  } catch (err) {
    lists.forEach((list) => {
      const el = document.getElementById(list.containerId);
      if (!el) return;
      const text = list.errorText != null ? list.errorText : 'Unable to load right now. Please try again later.';
      el.innerHTML = text ? `<p class="muted">${text}</p>` : '';
    });
    return;
  }

  lists.forEach((list) => {
    const el = document.getElementById(list.containerId);
    if (!el) return;
    const rendered = list.transform ? list.transform(items) : items;
    if (!rendered.length) {
      el.innerHTML = `<p class="muted">${list.emptyText || 'Nothing here yet.'}</p>`;
      return;
    }
    el.innerHTML = rendered.map(list.itemHtml).join('');
  });
}
