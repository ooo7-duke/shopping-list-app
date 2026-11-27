// Sends the contact and deletion forms to the app's private inbox, so no email address is published.
// The "website" box is hidden from people; bots that fill it are quietly ignored.
(function () {
  document.querySelectorAll('form[data-kind]').forEach(function (form) {
    var started = Date.now();
    var status = form.querySelector('.form-status');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type=submit]');
      var data = {
        kind: form.getAttribute('data-kind'),
        name: (form.elements.name && form.elements.name.value) || '',
        email: form.elements.email.value,
        message: (form.elements.message && form.elements.message.value) || '',
        website: form.elements.website.value,
        startedAt: started,
        page: location.pathname.replace(/\//g, '') || 'home',
      };
      btn.disabled = true;
      status.className = 'form-status';
      status.textContent = 'Sending…';
      fetch('/.netlify/functions/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok && !d.error, d: d }; }); })
        .then(function (res) {
          if (res.ok) {
            form.reset();
            status.className = 'form-status ok';
            status.textContent = form.getAttribute('data-done');
          } else {
            status.className = 'form-status err';
            status.textContent = res.d.error || 'It didn’t send. Please try again.';
            btn.disabled = false;
          }
        })
        .catch(function () {
          status.className = 'form-status err';
          status.textContent = 'It didn’t send. Check your connection and try again.';
          btn.disabled = false;
        });
    });
  });
})();
