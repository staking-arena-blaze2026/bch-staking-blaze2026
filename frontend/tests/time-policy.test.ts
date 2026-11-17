import {expect,it} from 'vitest';
import {minutesToSeconds,validateNewTime} from '../../src/v3/time-policy';

it.each([['chipnet',1,60],['mainnet',10,600]] as const)('enforces the %s minimum and converts minutes exactly',(network,minimum,seconds)=>{
 expect(minutesToSeconds(String(minimum),network,'Duration')).toBe(seconds);
 expect(minutesToSeconds('60',network,'Interval')).toBe(3600);
 expect(()=>minutesToSeconds(String(minimum-1),network,'Duration')).toThrow('at least '+minimum+' minute');
 expect(()=>validateNewTime(seconds-1,network,'Interval')).toThrow('at least '+minimum+' minute');
 expect(validateNewTime(seconds,network,'Interval')).toBe(seconds);
});
it.each(['',' ','1.5','NaN','Infinity','9007199254740992','9007199254740991'])('rejects invalid or unsafe minute input %j',value=>{
 expect(()=>minutesToSeconds(value,'chipnet','Interval')).toThrow();
});
it('retains second-based isolated regtest fixtures',()=>{
 expect(validateNewTime(1,'regtest','Interval')).toBe(1);
});
