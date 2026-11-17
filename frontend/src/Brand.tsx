import {brandArtworkMarkup} from './brandArtwork';

/** Both images embed the user's original JPEG bytes, with display-only masks. */
export default function Brand() {
  return <div className="brand-artwork" dangerouslySetInnerHTML={{__html:brandArtworkMarkup}}/>;
}
