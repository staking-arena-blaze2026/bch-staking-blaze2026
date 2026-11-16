import {startPublicPreview} from './publicIndexPreview';
if(!location.hash || location.hash==='#/' || location.hash==='#')history.replaceState(null,'',location.pathname+location.search+'#/v3/offers');
startPublicPreview();
// Load the UI explicitly so a failed module request cannot leave an empty page.
function showStartupError(error: unknown) {
  document.getElementById('arena-public-preview')?.remove();
  const status = document.getElementById('arena-startup');
  if (!status) return; // React has already replaced the startup message.
  status.setAttribute('role', 'alert');
  status.textContent = 'Staking Arena could not start. Reload this page to try again.';
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Show startup error';
  const message = document.createElement('pre');
  message.style.whiteSpace = 'pre-wrap';
  message.textContent = error instanceof Error ? error.message : String(error);
  details.append(summary, message);
  status.append(details);
}

window.addEventListener('error', event => {
  const resource = event.target;
  showStartupError(event.error ?? event.message ?? (
    resource instanceof HTMLScriptElement ? `Could not load ${resource.src}` : 'A frontend resource failed to load.'
  ));
}, true);
window.addEventListener('unhandledrejection', event => showStartupError(event.reason));

// The queried entry URL works through the Windows access path where the bare .tsx URL fails.
void import('./app-entry.tsx?arena-start').catch(showStartupError);
