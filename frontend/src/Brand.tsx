import {brandArtworkMarkup} from './brandArtwork';

/** Shared original logo and single-line vector ribbon for every page. */
export default function Brand() {
  return <div className="brand-artwork" dangerouslySetInnerHTML={{__html:brandArtworkMarkup}}/>;
}
