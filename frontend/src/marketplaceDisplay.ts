import type {Asset} from '../../src/v3/model';
import {bch} from './model';
// No trusted token metadata is currently available. Never infer tickers or decimals.
export const marketAsset=(asset:Asset)=>asset.kind==='bch'?'BCH':`CashToken ${asset.category.slice(0,8)}…${asset.category.slice(-8)}`;
export const marketReward=(asset:Asset,cap:bigint)=>`${asset.kind==='bch'?bch(cap):cap.toString()} ${marketAsset(asset)}`;
