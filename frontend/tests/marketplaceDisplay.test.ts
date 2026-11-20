import {expect,it} from 'vitest';
import {assetLabel as marketAsset,assetAmount as marketReward} from '../src/assetAmounts';
it('formats exact BCH and category-identified raw token amounts without inventing metadata',()=>{
 expect(marketReward({kind:'bch'},1000n)).toBe('0.00001000 BCH');
 const asset={kind:'token' as const,category:'ab'.repeat(32)};
 expect(marketAsset(asset)).toBe('CashToken abababab…abababab');
 expect(marketReward(asset,1000n)).toBe('1000 raw units of CashToken abababab…abababab');
});
