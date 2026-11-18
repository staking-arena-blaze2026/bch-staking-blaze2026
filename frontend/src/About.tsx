import WalletConnect from './WalletConnect';
import {v3Chain} from './v3Config';
import {switchNetwork} from './activeNetwork';
import {MAINNET_NETWORK,CHIPNET_NETWORK,REGTEST_NETWORK} from './walletNetwork';
import Brand from './Brand';
import Markdown from 'react-markdown';
import document from '../../ABOUT.md?raw';

export default function About() {
  return <div className="app about-page">
    <a className="skip-link" href="#content" onClick={event=>{event.preventDefault();globalThis.document.getElementById('content')?.focus();}}>Skip to content</a>
    <header className="header">
      <Brand/>
      <nav aria-label="Main navigation"><a className="about-nav" href="#/about" aria-current="page">About</a><a href="#/v3/my-offers">My Offers</a><label>Network<select aria-label="Network" value={v3Chain} onChange={e=>switchNetwork(e.target.value as 'mainnet'|'chipnet')}><option value="mainnet">Mainnet</option><option value="chipnet">Chipnet</option>{v3Chain==='regtest'&&<option value="regtest">Regtest</option>}</select></label><WalletConnect browser getRequiredNetwork={()=>v3Chain==='mainnet'?MAINNET_NETWORK:v3Chain==='chipnet'?CHIPNET_NETWORK:REGTEST_NETWORK}/></nav>
    </header>
    <main id="content" tabIndex={-1}>
      <a className="button" href="#/v3/offers">← Back to marketplace</a>
      <article className="about-document"><Markdown>{document}</Markdown></article>
    </main>
  </div>;
}
