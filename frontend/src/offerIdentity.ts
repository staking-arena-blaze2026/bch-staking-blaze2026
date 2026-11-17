import {v3Chain} from './v3Config';
const key=(network:string)=>`arena-my-offers-owner-${network}`;
export function lastOfferOwner(network=v3Chain):string {try{const value=localStorage.getItem(key(network))??'';return /^(02|03)[a-f0-9]{64}$/.test(value)?value:'';}catch{return '';}}
export function rememberOfferOwner(owner:string,network=v3Chain){if(!/^(02|03)[a-f0-9]{64}$/.test(owner))return;try{localStorage.setItem(key(network),owner);}catch{/* Identity is a read-only hint, never authorization. */}}
