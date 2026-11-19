/** Static local artwork shared by startup and React; no network content is interpolated. */
export const brandArtworkMarkup = `<a class="brand" href="#/v3/offers" aria-label="Stake Arena home">
<img class="brand-logo" src="./assets/brand/stake-arena-grill-emblem.webp" alt="Stake Arena" width="736" height="582"/></a>
<img class="brand-slogan" src="./assets/brand/stake-arena-slogan-arched-v1.webp" alt="Make the best stake to get a piece of the cake" width="2153" height="459"/>`;

export function createBrandArtwork() {
 const artwork=document.createElement('div');artwork.className='brand-artwork';
 artwork.innerHTML=brandArtworkMarkup;
 return artwork;
}
