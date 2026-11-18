/** Static local artwork shared by startup and React; no network content is interpolated. */
export const brandArtworkMarkup = `<a class="brand" href="#/v3/offers" aria-label="Stake Arena home">
<svg class="brand-logo" viewBox="570 140 1640 1280" role="img" aria-label="Stake Arena"><defs><clipPath id="stake-arena-logo-outline" clipPathUnits="userSpaceOnUse"><path clip-rule="evenodd" fill-rule="evenodd" d="M 1388 189 C 1580 184 1740 296 1820 463 L 2142 166 Q 2183 130 2180 180 C 2166 351 2045 480 1859 584 C 1880 699 1860 803 1818 891 L 1947 965 Q 1991 958 2032 945 L 2140 930 Q 2189 911 2178 951 L 2153 1054 L 2177 1187 Q 2189 1215 2150 1225 L 2022 1245 C 1980 1331 1880 1358 1730 1378 C 1520 1410 1230 1400 1060 1382 C 902 1370 768 1345 738 1250 L 609 1224 Q 586 1220 594 1188 L 621 1054 L 595 960 Q 581 915 620 932 L 739 956 L 807 966 L 946 872 C 885 740 886 600 945 475 L 851 437 Q 820 457 774 444 L 606 273 Q 578 237 608 227 Q 621 225 643 243 L 804 368 Q 829 381 841 369 Q 856 355 838 336 L 660 196 Q 638 176 657 165 Q 666 159 684 173 L 1004 425 C 1088 273 1225 193 1388 189 Z M 865 1048 Q 949 1080 980 1045 L 1008 1003 C 1058 1054 1114 1090 1170 1115 Q 1012 1092 865 1062 Z M 1766 1006 Q 1815 1066 1880 1054 L 1917 1048 L 1917 1065 Q 1773 1096 1609 1113 C 1673 1084 1723 1046 1766 1006 Z"/></clipPath></defs><image href="./assets/brand/stake-arena-logo-original.jpeg" width="2752" height="1536" clip-path="url(#stake-arena-logo-outline)"/></svg></a>
<img class="brand-slogan" src="./assets/brand/stake-arena-slogan-arched-v1.webp" alt="Make the best stake to get a piece of the cake" width="2153" height="459"/>`;

export function createBrandArtwork() {
 const artwork=document.createElement('div');artwork.className='brand-artwork';
 artwork.innerHTML=brandArtworkMarkup;
 return artwork;
}
