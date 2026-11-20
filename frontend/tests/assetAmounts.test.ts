import {expect,it,vi} from 'vitest';
import {assetAmount,assetInputUnits,bchAsset,tokenAsset,wholeTokenRange} from '../src/assetAmounts';
import {fetchTokenMetadata} from '../src/tokenMetadata';
import {creationValidation,offerValidation} from '../src/queueFormValidation';
import {compare,parameters,score,ZERO} from '../../src/queue/model';
import {loadWalletAmountReview} from '../src/walletAmountReview';
import {hexToBin} from '@bitauth/libauth';

const category='ae'.repeat(32),asset=tokenAsset(category);
it.each([0,2,6,8,18])('uses exact raw units and displays legacy amounts with %i decimals',decimals=>{
 const metadata={decimals,symbol:'TOK'},scale=10n**BigInt(decimals),whole=90071992547409931234n;
 expect(assetInputUnits(asset,String(whole),metadata)).toBe(whole*scale);
 expect(assetAmount(asset,whole*scale,metadata)).toBe(`${whole} TOK`);
 expect(assetAmount(asset,whole*scale+1n,metadata)).toBe(decimals?`${whole}.${'0'.repeat(decimals-1)}1 TOK`:`${whole+1n} TOK`);
 expect(assetAmount(asset,-1n,metadata)).toBe(decimals?`-0.${'0'.repeat(decimals-1)}1 TOK`:'-1 TOK');
 for(const input of ['','0','0.01','1.0','1e3','-1','+1','1,000'])expect(assetInputUnits(asset,input,metadata)).toBeNull();
});

it('keeps the existing BCH precision',()=>{
 expect(assetInputUnits(bchAsset,'0.00000001')).toBe(1n);
 expect(assetInputUnits(bchAsset,'0.000000001')).toBeNull();
 expect(assetAmount(bchAsset,1n)).toBe('0.00000001 BCH');
});

it('uses the BCMR default for a matching token record and isolates cached lookups by network',async()=>{
 const fetch=vi.fn(async (url:string)=>new Response(JSON.stringify({
  name:'Token',token:{category,symbol:'TOK',...(url.includes('chipnet')?{decimals:6}:{})},
 })));
 vi.stubGlobal('fetch',fetch);
 const main=fetchTokenMetadata('mainnet',category);
 expect(fetchTokenMetadata('mainnet',category.toUpperCase())).toBe(main);
 expect(await main).toMatchObject({decimals:0,symbol:'TOK'});
 expect(await fetchTokenMetadata('chipnet',category)).toMatchObject({decimals:6});
 expect(fetch).toHaveBeenCalledTimes(2);
});

it('labels unresolved amounts and prevents input when metadata is unavailable or malformed',async()=>{
 const missing='af'.repeat(32),invalid='ad'.repeat(32),mismatched='ac'.repeat(32);
 vi.stubGlobal('fetch',vi.fn(async (url:string)=>{
  if(url.includes(missing))throw Error('Network unavailable');
  return new Response(JSON.stringify({token:{category:invalid,symbol:'BAD',decimals:19}}));
 }));
 expect(await fetchTokenMetadata('mainnet',missing)).toBeUndefined();
 expect(await fetchTokenMetadata('mainnet',mismatched)).toBeUndefined();
 const metadata=await fetchTokenMetadata('mainnet',invalid);
 expect(metadata?.decimals).toBeUndefined();
 expect(assetAmount(tokenAsset(invalid),1000000n,metadata)).toBe('1000000 raw units of BAD');
 expect(assetInputUnits(tokenAsset(invalid),'1',metadata)).toBeNull();
 expect(assetInputUnits(asset,'1')).toBeNull();
 expect(await fetchTokenMetadata('regtest',category)).toBeUndefined();
});

it('serializes form entries once and validates raw limits and reserve balances exactly',()=>{
 const rewardMetadata={decimals:6,symbol:'REWARD'},stakingMetadata={decimals:2,symbol:'STAKE'};
 const fields={stakingCategory:'ab'.repeat(32),rewardCategory:category,cap:'1',interval:'10',releases:'3',epoch:'2027-01-01T12:00:00'};
 const p=creationValidation(fields,'mainnet',rewardMetadata).parameters!;
 expect(p.cap).toBe(1000000n);
 expect(parameters(p).schedule.readUInt32LE(12)).toBe(1000000);
 expect(p.cap*BigInt(p.releases)).toBe(3000000n);
 expect(creationValidation({...fields,cap:'2'},'mainnet',rewardMetadata).errors.cap).toBe('Enter 1 REWARD.');
 for(const decimals of [8,18]){
  const metadata={decimals,symbol:'REWARD'};
  expect(creationValidation(fields,'mainnet',metadata).errors.cap).toContain('No whole REWARD amount fits');
  expect(wholeTokenRange(asset,1n,1000000n,metadata)).toContain(assetAmount(asset,1000000n,metadata));
 }
 const offer={stake:'12',reward:'1',duration:'2'};
 const terms=offerValidation(p,offer,1000000n,stakingMetadata,rewardMetadata).terms!;
 expect(terms).toEqual({stake:1200n,reward:1000000n,duration:1024});
 const serialized=score(terms);
 expect([serialized.readUInt32LE(0),serialized.readUInt32LE(4),serialized.readUInt32LE(8)]).toEqual([1200,1024,1000000]);
 expect(compare(terms,{...terms,stake:1201n})).toBe(-1);
 const insufficient=offerValidation(p,offer,999999n,stakingMetadata,rewardMetadata);
 expect(insufficient.terms).toBeUndefined();
 expect(insufficient.errors.reward).toContain('0.999999 REWARD');
 expect(offerValidation({...p,stakingCategory:ZERO},{...offer,stake:'0.00001200'},1000000n,undefined,rewardMetadata).terms).toEqual(terms);
});

it('uses the exact fractional transaction output in a review while preserving signing data',async()=>{
 const category='ba'.repeat(32),token={category:hexToBin(category),amount:1000000000000000001n};
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({token:{category,symbol:'TOK',decimals:18}}))));
 const transaction={version:2,locktime:0,inputs:[],outputs:[{valueSatoshis:1200n,lockingBytecode:new Uint8Array(),token}]};
 const original={transaction,sourceOutputs:[],broadcast:false,userPrompt:'Original'};
 const describe=await loadWalletAmountReview('mainnet',original);
 const review=describe(original,'Review payment');
 expect(review.label).toContain('1.000000000000000001 TOK');
 expect(review.request.transaction).toBe(transaction);
 expect(review.request.broadcast).toBe(false);
 expect(original.userPrompt).toBe('Original');
});
