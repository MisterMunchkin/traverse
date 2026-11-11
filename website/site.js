// Preserve readable manual commands without JavaScript; use this build's base URL when enabled.
const installCommands = document.getElementById('install-code');
if (installCommands) installCommands.textContent = installCommands.textContent.replaceAll('PREVIEW_ORIGIN', new URL('.', location.href).href.replace(/\/$/, ''));

const routes = {
  home: ['HOME', 'app/index.tsx', 'The source declares a starting route. Its presence in the graph does not identify the current screen.'],
  notes: ['NOTES', 'app/notes/index.tsx', 'Declared navigation links carry source context. Visibility still needs a fresh UI observation.'],
  detail: ['DETAIL', 'app/notes/first.tsx', 'A source route is not a live control target. The runner must observe what is available now.'],
  edit: ['EDIT NOTE', 'app/notes/edit.tsx', 'A declared Save path is a navigation fact. It is not proof that the note was saved.'],
};

for (const button of document.querySelectorAll('[data-route]')) {
  button.addEventListener('click', () => {
    for (const node of document.querySelectorAll('[data-route]')) node.setAttribute('aria-pressed', String(node === button));
    const [kind, source, fact] = routes[button.dataset.route];
    document.querySelector('#route-kind').textContent = '/ ' + kind;
    document.querySelector('#route-source').textContent = source;
    document.querySelector('#route-fact').textContent = fact;
  });
}

if (navigator.clipboard?.writeText) {
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.hidden = false;
    button.addEventListener('click', async () => {
      const status = document.querySelector('#copy-status');
      try {
        await navigator.clipboard.writeText(document.getElementById(button.dataset.copy).textContent);
        status.textContent = button.dataset.copy === 'install-code' ? 'Installation commands copied.' : 'Project graph commands copied.';
        button.textContent = 'Copied';
        clearTimeout(button.copyTimer);
        button.copyTimer = setTimeout(() => { button.textContent = 'Copy'; }, 2000);
      } catch {
        status.textContent = 'Clipboard unavailable. Select and copy the commands directly.';
      }
    });
  }
}

// A deep link to model setup should expose its instructions without extra steps.
function revealDetail() {
  const target = document.getElementById(location.hash.slice(1));
  if (target?.tagName === 'DETAILS') target.open = true;
}
window.addEventListener('hashchange', revealDetail);
revealDetail();
