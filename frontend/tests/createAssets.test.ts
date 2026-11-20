import {expect,it} from 'vitest';
import {createQuote} from '../src/createAssets';
const token={kind:'token' as const,category:'ab'.repeat(32)},bch={kind:'bch' as const};
for(const stake of [bch,token])for(const reward of [bch,token])it(`selects the covenant and exact reserve for ${stake.kind} → ${reward.kind}`,()=>{
 const quote=createQuote(stake,reward,reward.kind==='bch'?'0.00001001':'1001','16','60','2027-01-01T00:00',undefined,{decimals:0});
 expect(quote.version).toBe(stake.kind==='token'&&reward.kind==='bch'?1:2);
 expect(quote.parameters.cap).toBe(quote.version===1?1001:1001n);
 expect(quote.reserve).toBe(16016n);expect(quote.requiredTokens).toBe(reward.kind==='token'?16016n:0n);
 if(quote.version===2)expect(quote.requiredBch).toBe(reward.kind==='bch'?40016n:25000n);
});
it('rejects fractional tokens, sub-satoshi amounts, zero/reserved categories, invalid periods and timestamps',()=>{
 for(const [stake,reward,amount,periods,date] of [[token,token,'1.1','2','2027-01-01T00:00'],[bch,bch,'0.000010001','2','2027-01-01T00:00'],[{kind:'token',category:'00'.repeat(32)},bch,'0.00002','2','2027-01-01T00:00'],[token,{kind:'token',category:'bad'},'1','2','2027-01-01T00:00'],[bch,bch,'0.00002','17','2027-01-01T00:00'],[bch,bch,'0.00002','2','invalid']] as const){
  expect(()=>createQuote(stake,reward,amount,periods,'60',date,undefined,{decimals:0})).toThrow();
 }
});
