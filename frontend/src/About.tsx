import Brand from './Brand';
import Markdown from 'react-markdown';
import document from '../../ABOUT.md?raw';

export default function About() {
  return <div className="app about-page">
    <a className="skip-link" href="#content" onClick={event=>{event.preventDefault();globalThis.document.getElementById('content')?.focus();}}>Skip to content</a>
    <header className="header">
      <Brand/>
      <nav aria-label="Main navigation"><a href="#/v3/offers">Marketplace</a><a className="about-nav" href="#/about" aria-current="page">About</a></nav>
    </header>
    <main id="content" tabIndex={-1}>
      <a className="button" href="#/v3/offers">← Back to marketplace</a>
      <article className="about-document"><Markdown>{document}</Markdown></article>
    </main>
  </div>;
}
