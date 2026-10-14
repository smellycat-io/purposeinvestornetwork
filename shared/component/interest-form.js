// Always-on interest-capture form for Roundtable and Initiative detail
// pages. Reuses become-a-member.html's .waitlist-form styling (front-end/
// styles.css) rather than introducing a second form skin for what's
// visually the same kind of form.
//
// Two pieces, used together by shared/component/detail-page.js:
//   - interestFormHtml(...) returns the markup, meant to be concatenated
//     into renderBody's returned string (so it's part of the same
//     innerHTML assignment as the rest of the page's content).
//   - initInterestForm(...) wires up the submit handler. Must be called
//     *after* that innerHTML assignment lands in the DOM — renderDetailPage
//     does this via its `afterRender` hook, since injected HTML has no
//     behavior of its own until something attaches it.
//
// Depends on escapeHtml from dom-utils.js, which must be loaded first.

function interestFormHtml({ formId, consentText }) {
  return `
    <section class="content-section interest-form-section">
      <h3>Stay in the loop</h3>
      <p>Share your email and we&rsquo;ll keep you posted.</p>
      <form id="${formId}" class="waitlist-form interest-form" novalidate>
        <div class="field-row">
          <label class="field">
            <span>Name</span>
            <input name="name" type="text" />
          </label>
          <label class="field">
            <span>Email</span>
            <input name="email" type="email" placeholder="you@example.com" required />
          </label>
        </div>
        <label class="field">
          <span>Message (optional)</span>
          <input name="message" type="text" maxlength="500" />
        </label>
        <label class="field field--consent">
          <input name="consent" type="checkbox" />
          <span>${escapeHtml(consentText)}</span>
        </label>
        <label class="visually-hidden" aria-hidden="true">
          Website
          <input name="website" type="text" tabindex="-1" autocomplete="off" />
        </label>
        <button type="submit" class="cta-button">Submit</button>
      </form>
      <p class="subscribe-message" id="${formId}-message" role="status" hidden></p>
    </section>
  `.trim();
}

function initInterestForm({ formId, submitUrl }) {
  const form = document.getElementById(formId);
  if (!form) return;
  const message = document.getElementById(`${formId}-message`);

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const payload = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      message: form.elements.message.value.trim(),
      consent: form.elements.consent.checked,
      website: form.elements.website.value,
    };
    message.hidden = false;
    message.classList.remove('subscribe-message--error');
    message.textContent = 'Submitting…';
    try {
      const res = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      message.textContent = 'Thanks — we’ll be in touch!';
      form.reset();
    } catch (err) {
      message.classList.add('subscribe-message--error');
      message.textContent = err.message || 'Unable to submit right now. Please try again later.';
    }
  });
}
