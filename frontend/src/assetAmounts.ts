import type {Asset} from '../../src/v2/model';
import {tokenTicker,type TokenMetadata} from './tokenMetadata';

export function bch(sats: string | bigint | number) {
  const value = BigInt(sats), sign = value < 0n ? '-' : '', absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100000000n}.${(absolute % 100000000n).toString().padStart(8,'0')}`;
}

export const bchAsset={kind:'bch'} as const;
export const tokenAsset=(category:string)=>({kind:'token',category} as const);
export const categoryAsset=(category:string):Asset=>category==='0'.repeat(64)?bchAsset:tokenAsset(category);

export function assetLabel(asset:Asset,metadata?:TokenMetadata):string {
 return asset.kind==='bch'?'BCH':tokenTicker(asset.category,metadata);
}

export function assetQuantity(asset:Asset,raw:bigint,metadata?:TokenMetadata):string {
 if(asset.kind==='bch')return bch(raw);
 const decimals=metadata?.decimals;
 if(!decimals)return raw.toString();
 const digits=(raw<0n?-raw:raw).toString().padStart(decimals+1,'0');
 const whole=digits.slice(0,-decimals),fraction=digits.slice(-decimals).replace(/0+$/,'');
 return (raw<0n?'-':'')+whole+(fraction?'.'+fraction:'');
}

export function assetAmount(asset:Asset,raw:bigint,metadata?:TokenMetadata):string {
 const label=assetLabel(asset,metadata);
 if(asset.kind==='bch')return assetQuantity(asset,raw)+' BCH';
 if(metadata?.decimals===undefined)return `${raw} raw units of ${label}`;
 return assetQuantity(asset,raw,metadata)+' '+label;
}

export function assetInputUnits(asset:Asset,text:string,metadata?:TokenMetadata):bigint|null {
 if(asset.kind==='bch'){
  if(!/^\d{1,16}(?:\.\d{1,8})?$/.test(text))return null;
  const [whole,fraction='']=text.split('.');
  return BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,'0'));
 }
 if(metadata?.decimals===undefined||!/^\d{1,30}$/.test(text))return null;
 const whole=BigInt(text);
 return whole>0n?whole*10n**BigInt(metadata.decimals):null;
}

export function amountInputError(asset:Asset,metadata?:TokenMetadata):string {
 if(asset.kind==='bch')return 'Enter a BCH amount with up to 8 decimal places.';
 return metadata?.decimals===undefined?'Token precision unavailable from BCMR. A token amount cannot be entered yet.':`Enter a positive whole number of ${assetLabel(asset,metadata)}.`;
}

export function tokenBounds(min:bigint,max:bigint,metadata?:TokenMetadata) {
 if(metadata?.decimals===undefined)return;
 const scale=10n**BigInt(metadata.decimals);
 return {first:(min+scale-1n)/scale,last:max/scale};
}

export function wholeTokenRange(asset:Asset,min:bigint,max:bigint,metadata?:TokenMetadata):string {
 const bounds=tokenBounds(min,max,metadata);
 if(asset.kind==='bch'||!bounds)return '';
 const {first,last}=bounds;
 const label=assetLabel(asset,metadata);
 if(last<first)return `No whole ${label} amount fits the vault limits (${assetAmount(asset,min,metadata)} to ${assetAmount(asset,max,metadata)}).`;
 return first===last?`Enter ${first} ${label}.`:`Enter ${first} to ${last} whole ${label}.`;
}

export function priorityRatio(staking:Asset,numerator:bigint,reward:Asset,denominator:bigint,metadataFor:(asset:Asset)=>TokenMetadata|undefined):string {
 // Within a vault, changing the displayed denominations multiplies every score by the same constant.
 return `${assetAmount(staking,numerator,metadataFor(staking))} / ${assetAmount(reward,denominator,metadataFor(reward))}`;
}
