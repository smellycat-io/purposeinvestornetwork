// Click-to-play YouTube facade: shows a thumbnail + play button and only
// loads the actual YouTube iframe (and its third-party requests) once the
// visitor clicks — no autoplay, no YouTube traffic on page load.
// Usage: <div class="video-facade" data-video-id="..." data-title="..."></div>
(function () {
  function buildFacade(el) {
    const videoId = el.dataset.videoId;
    const title = el.dataset.title || 'Play video';

    el.innerHTML = `
      <img class="video-facade__thumb" src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg" alt="" loading="lazy" />
      <button type="button" class="video-facade__play" aria-label="${title}">
        <svg viewBox="0 0 68 48" width="68" height="48" aria-hidden="true">
          <path d="M66.5 7.7c-.8-2.9-2.5-5.2-5.4-6C55.8.3 34 .3 34 .3S12.2.3 6.9 1.7C4 2.5 2.3 4.8 1.5 7.7 0 13 0 24 0 24s0 11 1.5 16.3c.8 2.9 2.5 5.2 5.4 6C12.2 47.7 34 47.7 34 47.7s21.8 0 27.1-1.4c2.9-.8 4.6-3.1 5.4-6C68 35 68 24 68 24s0-11-1.5-16.3z" fill="#212121" fill-opacity="0.8"/>
          <path d="M45 24 27 14v20" fill="#fff"/>
        </svg>
      </button>
    `;

    el.querySelector('.video-facade__play').addEventListener('click', () => {
      el.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1" title="${title}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
    }, { once: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.video-facade[data-video-id]').forEach(buildFacade);
  });
})();
