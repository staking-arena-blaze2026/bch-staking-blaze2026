import {expect,it} from 'vitest';
import {minutesToSeconds,validateNewTime,stakingUnitsToSeconds,stakingSecondsToUnits,formatDuration} from '../../src/v3/time-policy';
import {allocationSequence,initialState,advance,decision,type Parameters} from '../../src/v3/model';
import {releaseDisplay} from '../../src/v3/release-display';
import {rankings} from '../../src/arena-core';
import {offer} from '../../src/registry';
import {Buffer} from '../../src/bytes';
import {localTimestamp,parseLocalDateTime,localDateTimeInput} from '../src/localTime';
it.each([['chipnet',1,60],['mainnet',10,600]] as const)('enforces %s release interval minimum and increment',(network,step,seconds)=>{
 expect(minutesToSeconds(String(step),network)).toBe(seconds);
 expect(minutesToSeconds(String(step*2),network)).toBe(seconds*2);
 for(const value of ['',String(step-1),'1.5','Infinity'])expect(()=>minutesToSeconds(value,network)).toThrow();
 expect(()=>validateNewTime(seconds-1,network)).toThrow();
 if(network==='mainnet')expect(()=>minutesToSeconds('11',network)).toThrow();
});
it('uses exact 512-second units from 1 through the BIP68 maximum',()=>{
 for(const u of [1,2,12,65535]){
  expect(stakingUnitsToSeconds(u)).toBe(u*512);
  expect(stakingSecondsToUnits(u*512)).toBe(u);
  expect(allocationSequence(stakingUnitsToSeconds(u))).toBe(0x400000+u);
 }
 for(const u of ['',0,-1,1.5,65536,NaN,Infinity])expect(()=>stakingUnitsToSeconds(u)).toThrow();
 expect(()=>stakingSecondsToUnits(513)).toThrow();
});
it('formats every nonzero conventional time component without rounding',()=>{
 expect(formatDuration(12*512)).toBe('1 hour, 42 minutes, 24 seconds');
 expect(formatDuration(604800+86400+3600+60+1)).toBe('1 week, 1 day, 1 hour, 1 minute, 1 second');
 expect(formatDuration(2*604800+2*86400+2*3600+2*60+2)).toBe('2 weeks, 2 days, 2 hours, 2 minutes, 2 seconds');
 expect(formatDuration(3600)).toBe('1 hour');expect(formatDuration(0)).toBe('0 seconds');
});
const p:Parameters={version:3,registryVersion:4,stakingAsset:{kind:'bch'},rewardAsset:{kind:'bch'},epoch:1800000000,periodSeconds:600,periods:4,cap:2000n};
const key=Buffer.from('02'+'11'.repeat(32),'hex'),boundary=p.epoch+600,now=(boundary+1)*1000;
it('ranks effective unit commitments exactly and retains earliest-registration ties',()=>{
 let s=initialState(p);
 for(const [slot,stake,u,reward] of [[0,3000,12,1000],[1,6000,12,2000],[2,3000,13,1000]])s=advance(s,0,slot,offer(key,stake,stakingUnitsToSeconds(u),reward,1));
 expect(rankings(s,false).map(r=>r.slot)).toEqual([2,0,1]);
});
it('classifies BIP113 equality as awaiting blockchain time and accumulates releases independently of queue readiness',()=>{
 const s=initialState(p);
 const display=(mtp:number,local=now)=>releaseDisplay(p,s,mtp,local,local,true);
 expect(display(boundary-1,(boundary-1)*1000).status(boundary)).toBe('Scheduled');
 expect(display(boundary).status(boundary)).toBe('Awaiting blockchain time');
 expect(display(boundary).unlocked).toBe(0);
 expect(display(boundary+1).status(boundary)).toBe('Available');
 expect(display(boundary+1).available).toBe(2000n);
 const d=display(p.epoch+1801);expect(d.unlocked).toBe(3);expect(d.available).toBe(6000n);
 expect(decision({parameters:p,state:s},{mtp:p.epoch+1801}).phase).toBe('blocked');
 const registered=advance(s,0,0,offer(key,3000,512,1000,1)),paid=advance(registered,3,0);
 expect(releaseDisplay(p,paid,p.epoch+1801,now,now,true).available).toBe(5000n);
 expect(display(p.epoch+2401).next).toBeUndefined();
});
it('never invents available rewards from missing, unverified, stale or future-dated observations',()=>{
 for(const [mtp,at,current,verified] of [[undefined,now,now,true],[NaN,now,now,true],[boundary+1,now,now,false],[boundary+1,now,now+30001,true],[boundary+1,now+1,now,true]] as const){
  const d=releaseDisplay(p,initialState(p),mtp,at,current,verified);
  expect(d.available).toBeUndefined();expect(d.unlocked).toBeUndefined();expect(d.status(boundary)).toBe('Unavailable / unverified');
 }
});
it('formats timestamps in the selected local timezone with daylight-saving offsets',()=>{
 const before=localTimestamp(Date.parse('2027-03-14T06:59:59Z')/1000,'America/New_York');
 const after=localTimestamp(Date.parse('2027-03-14T07:00:00Z')/1000,'America/New_York');
 expect(before).toMatch(/01:59:59.*(EST|GMT-5)/);expect(after).toMatch(/03:00:00.*(EDT|GMT-4)/);
 const fallBefore=localTimestamp(Date.parse('2027-11-07T05:30:00Z')/1000,'America/New_York');
 const fallAfter=localTimestamp(Date.parse('2027-11-07T06:30:00Z')/1000,'America/New_York');
 expect(fallBefore).toMatch(/01:30:00.*(EDT|GMT-4)/);expect(fallAfter).toMatch(/01:30:00.*(EST|GMT-5)/);
 expect(localTimestamp(Date.parse('2027-01-01T00:00:00Z')/1000,'Asia/Tokyo')).toMatch(/09:00:00/);
});

it('parses local creation input into Unix time, accepts zero-second normalization and rejects a DST gap',()=>{
 const previous=process.env.TZ;
 try{
  process.env.TZ='America/New_York';
  expect(parseLocalDateTime('2027-03-14T01:30')).toBe(Date.parse('2027-03-14T06:30:00Z')/1000);
  const start=parseLocalDateTime('2027-03-14T01:30:00');
  expect(localDateTimeInput((start+3600)*1000)).toBe('2027-03-14T03:30:00');
  expect(()=>parseLocalDateTime('2027-03-14T02:30:00')).toThrow('daylight-saving');
 }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});
