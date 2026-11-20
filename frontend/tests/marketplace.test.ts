import { expect,it } from 'vitest';
import { competingOffers,offerPreview,periodLength,rewardSatoshis,routeFromHash,vaultStatus } from '../src/marketplace';
import { fixture } from './fixture';
it('classifies overdue/expired states from UTC and confirmed period without claiming completion',()=>{
 const data=fixture(),v=data.vaults[0],at=(time:number)=>time*1000;
 expect(vaultStatus(v,data.tip,at(v.config.epoch+90))).toBe('Overdue — awaiting activation');v.period=0;
 expect(vaultStatus(v,{...data.tip!,mtp:v.config.epoch-1},at(v.config.epoch-1))).toBe('Scheduled — awaiting start');
 expect(vaultStatus(v,{...data.tip!,mtp:v.config.epoch+100000},at(v.config.epoch-1))).toBe('Expired — awaiting on-chain processing');
 expect(vaultStatus(v,null)).toBe('Status unavailable');v.period=3;expect(vaultStatus(v,data.tip)).toBe('Completed — all periods processed on-chain');
});
it('parses hash routes without server path rewrites',()=>{
 const id='a'.repeat(64);expect(routeFromHash('#/vault/'+id)).toEqual({page:'vault',id});
 expect(routeFromHash('#/vault/'+id+'/offer')).toEqual({page:'offer',id});
 expect(routeFromHash('#/v3/offers')).toEqual({page:'v3'});expect(routeFromHash('#/v3/vault/'+id)).toEqual({page:'v3'});expect(routeFromHash('#/v3')).toEqual({page:'v3'});expect(routeFromHash('#/create')).toEqual({page:'create'});expect(routeFromHash('')).toEqual({page:'home'});expect(routeFromHash('#/vault/bad')).toEqual({page:'missing'});
});
it('uses raw satoshis for exact priority and rejects invalid or unsupported preview terms',()=>{
 const v=fixture().vaults[0];expect(offerPreview('3000','2','0.00001000','3',v,{decimals:0})).toMatchObject({commitment:9000n,terms:{stake:3000,reward:1000}});
 for(const values of [['1','2','0.00001000','2'],['3000','4','0.00001000','2'],['3000','2','0.00002000','2'],['3000','2','0','2'],['3000','2','0.00001000','0'],['1e4','2','0.00001000','2']])expect(offerPreview(...values as [string,string,string,string],v,{decimals:0}).error).toBeTruthy();
 expect(rewardSatoshis('0.00000001')).toBe(1n);expect(rewardSatoshis('0.000000001')).toBeNull();expect(rewardSatoshis('NaN')).toBeNull();expect(rewardSatoshis('1e-5')).toBeNull();
});
it('breaks equal priorities by canonical slot rather than API array order',()=>{
 const v=fixture().vaults[0];v.offers=[{...v.offers[0],slot:5},{...v.offers[0],slot:1}];expect(competingOffers(v).map(o=>o.slot)).toEqual([1,5]);
 expect(periodLength(86400)).toBe('Daily');expect(periodLength(604800)).toBe('Weekly');
});
