import './style.css';
import {startPublicPreview} from './publicIndexPreview';

async function copyAddress(address: HTMLElement) {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(address.textContent ?? '');
      return true;
    } catch { /* Try copying the visible text if the browser denies clipboard access. */ }
  }
  // The site's HTTP entry point cannot use the Clipboard API.
  const selection = window.getSelection();
  if (!selection) return false;
  const range = document.createRange();
  range.selectNodeContents(address);
  selection.removeAllRanges();
  selection.addRange(range);
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    selection.removeAllRanges();
  }
}

const blazeAddress = document.getElementById('blaze-address');
const copyButton = document.querySelector<HTMLButtonElement>('#blaze-copy-address');
const copyStatus = document.getElementById('blaze-copy-status');
if (blazeAddress && copyButton && copyStatus) {
  let clearStatus: number | undefined;
  copyButton.addEventListener('click', async () => {
    const copied = await copyAddress(blazeAddress);
    window.clearTimeout(clearStatus);
    copyStatus.textContent = copied ? 'Address copied' : 'Select the address to copy it';
    clearStatus = window.setTimeout(() => { copyStatus.textContent = ''; }, 3000);
  });
  copyButton.hidden = false;
}

if(!location.hash || location.hash==='#/' || location.hash==='#')history.replaceState(null,'',location.pathname+location.search+'#/v3/offers');
const welcome=document.querySelector<HTMLDialogElement>('#arena-welcome');
if(welcome){
  const key='stake-arena-welcome-dismissed';
  let dismissed=false;
  try{dismissed=localStorage.getItem(key)==='1';}catch{/* Storage can be unavailable. */}
  if(!dismissed){
    welcome.addEventListener('close',()=>{
      try{localStorage.setItem(key,'1');}catch{/* The dialog still closes without storage. */}
    },{once:true});
    for(const link of welcome.querySelectorAll('a[href^="#/about"]')){
      link.addEventListener('click',()=>welcome.close());
    }
    welcome.showModal();
  }
}
startPublicPreview();
// Load the UI explicitly so a failed module request cannot leave an empty page.
function showStartupError(error: unknown) {
  document.getElementById('arena-public-preview')?.remove();
  const status = document.getElementById('arena-startup');
  if (!status) return; // React has already replaced the startup message.
  status.setAttribute('role', 'alert');
  status.textContent = 'Stake Arena could not start. Reload this page to try again.';
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
