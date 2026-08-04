function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const error = new Error(`Request to ${url} failed with ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

function lastPathSegment() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return decodeURIComponent(parts[parts.length - 1] || '');
}

function cardImageHtml(url) {
  return url ? `<img class="card-link__image" src="${escapeHtml(url)}" alt="" />` : '';
}
