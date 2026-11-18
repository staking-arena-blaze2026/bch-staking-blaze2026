import {brandArtworkMarkup} from './brandArtwork';

/** Shared original logo and arched parchment ribbon for every page. */
export default function Brand() {
  return <div className="brand-artwork" dangerouslySetInnerHTML={{__html:brandArtworkMarkup}}/>;
}
