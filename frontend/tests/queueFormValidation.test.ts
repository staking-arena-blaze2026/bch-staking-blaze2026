import {it,expect} from 'vitest';
import {creationValidation,offerValidation} from '../src/queueFormValidation';
import {ZERO} from '../../src/queue/model';
for(const network of ['mainnet','chipnet'] as const){
 it(network+': enforces the same reward minimum and network-specific intervals',()=>{
  const fields={stakingCategory:ZERO,rewardCategory:ZERO,cap:'0.00001199',interval:network==='mainnet'?'10':'1',releases:'8',epoch:'2027-01-01T12:00:00'};
  expect(creationValidation(fields,network).errors.cap).toContain('1,200');
  const valid=creationValidation({...fields,cap:'0.00001200'},network);expect(valid.errors).toEqual({});expect(valid.parameters!.cap*BigInt(valid.parameters!.releases)).toBe(9600n);
  expect(creationValidation({...fields,cap:'0.00001200',releases:'1001'},network).errors.releases).toContain('1,000');
  expect(creationValidation({...fields,cap:'0.00001200',interval:'0'},network).errors.interval).toBeTruthy();
  const offers=offerValidation(valid.parameters!,{stake:'0.00001200',reward:'0.00001199',duration:'1'},9600n);expect(offers.errors.reward).toContain('0.00001200');
 });
}
