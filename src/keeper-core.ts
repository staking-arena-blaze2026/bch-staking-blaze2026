import {finalityLimit} from './consensus-clock.js';
import { TransactionBuilder, Network, type NetworkProvider, type SpendableUtxo, type Unlocker } from 'cashscript';
import { binToHex, createVirtualMachineBch2026, decodeTransaction, encodeCashAddress, hash160, hexToBin, hashTransaction, type Output } from '@bitauth/libauth';
import { Buffer } from './bytes.js';
import { contracts, contract, rankings, termsFor, utxo } from './arena-core.js';
import type { VaultState } from './indexer-core.js';
import { hashState, nextState, remainingCommitment, periodBoundary } from './registry.js';

export interface Sponsor { input: SpendableUtxo; unlocker: Unlocker }
export type Sponsorship = (vault: VaultState, action: number) => Promise<Sponsor | undefined>;
export interface KeeperClock { height: number; mtp: number; nextBlockTicks?:number }
export class FeeFundingUnavailable extends Error { constructor() { super('Fee sponsorship required to preserve reward reserve: safe fee funding unavailable without an external BCH sponsor'); } }
export type KeeperDecision = {phase:'waiting'|'complete';period:number} | {phase:'activation-required'|'settlement-required';period:number;action:2|3|5;slot:number};
export function keeperDecision(vault: VaultState, clock: KeeperClock): KeeperDecision {
  if (!Number.isSafeInteger(clock.height) || clock.height < 0 || !Number.isSafeInteger(clock.mtp) || clock.mtp < 500000000 || clock.mtp > 2147483647) throw Error('Invalid verified chain clock');
  const state = Buffer.from(vault.witness,'hex'), period = state.readUInt32LE(0);
  if(period >= vault.config.periods) return {phase:'complete' as const,period};
  if(!state[4] && clock.mtp <= periodBoundary(vault.config,period)) return {phase:'waiting' as const,period};
  const ranked=rankings(state,true),action=!state[4]?2:ranked.length?3:5,slot=action===3?ranked[0]!.slot:0;
  return {phase:action===2?'activation-required' as const:'settlement-required' as const,period,action,slot};
}
export function sourceOutput(input: SpendableUtxo): Output {
  return {valueSatoshis:input.satoshis,lockingBytecode:hexToBin(input.lockingBytecode!),
    ...(input.token?{token:{category:hexToBin(input.token.category),amount:input.token.amount,...(input.token.nft?{nft:{capability:input.token.nft.capability,commitment:hexToBin(input.token.nft.commitment)}}:{})}}:{})};
}
/** VM verifies covenant ranking/ties, frozen state, outputs, rewards, reserves and token conservation.
 * Height/MTP finality, live UTXOs, chain selection and network relay remain separate checks. */
export function validateKeeperTransaction(raw: string, sources: Output[], clock: KeeperClock, expectedFee?: bigint) {
  const tx=decodeTransaction(hexToBin(raw));if(typeof tx==='string')throw Error('Malformed keeper transaction');
  if(tx.version!==2 || tx.inputs.length!==sources.length || tx.inputs.some(i=>i.sequenceNumber===0xffffffff || i.sequenceNumber<0x80000000)) throw Error('Keeper sequence/version mismatch');
  const finalAt=tx.locktime<500000000?finalityLimit(clock):clock.mtp;
  if(tx.locktime>=finalAt)throw Error('Keeper transaction is not final at the verified height/MTP');
  const fee=sources.reduce((n,o)=>n+o.valueSatoshis,0n)-tx.outputs.reduce((n,o)=>n+o.valueSatoshis,0n);
  if(fee<=0n || (expectedFee!==undefined && fee!==expectedFee))throw Error('Keeper fee mismatch');
  const valid=createVirtualMachineBch2026().verify({transaction:tx,sourceOutputs:sources});
  if(valid!==true)throw Error(`Local covenant validation failed: ${String(valid)}`);
  return {txid:hashTransaction(hexToBin(raw)),fee,transaction:tx};
}
/** Identical covenant transaction layout for Node and browser. Browser supplies no sponsor/key. */
export async function buildKeeperTransition(vault: VaultState, provider: NetworkProvider, clock: KeeperClock, sponsorship?: Sponsorship) {
  if(provider.network!==Network.CHIPNET && provider.network!==Network.REGTEST)throw Error('Keeper transactions are chipnet/regtest only');
  const decision=keeperDecision(vault,clock);if(!('action' in decision))return;
  const {action,slot,period}=decision,state=Buffer.from(vault.witness,'hex');
  const sponsor=await sponsorship?.(vault,action);
  if(sponsor?.input.token)throw Error('Fee sponsorship must be BCH-only');
  const cs=await contracts(vault.config,vault.category,provider),next=nextState(state,action,slot),ranked=rankings(state,true);
  const stateInput=utxo(vault.transaction,0),poolInput=utxo(vault.transaction,1);
  if(stateInput.lockingBytecode!==cs.registry.lockingBytecode || poolInput.lockingBytecode!==cs.pool.lockingBytecode || stateInput.token?.nft?.commitment!==hashState(state))throw Error('Keeper source state mismatch');
  // Fees and allocation carriers must be covered by pre-transition excess BCH.
  // Advancing a period may release unused rewards, but those rewards never fund this fee.
  const protectedBefore=BigInt(vault.config.periods-period)*BigInt(vault.config.cap)+1000n;
  if(!sponsor&&stateInput.satoshis-protectedBefore<(action===3?12000n:10000n))throw new FeeFundingUnavailable();
  const reward=action===3?BigInt(ranked[0]!.reward):0n;
  const amount=stateInput.satoshis-reward-(sponsor?0n:action===3?12000n:10000n);
  if(amount<BigInt(vault.config.periods-next.readUInt32LE(0))*BigInt(vault.config.cap)+1000n)throw new FeeFundingUnavailable();
  const builder=new TransactionBuilder({provider}).setLocktime(action===2?periodBoundary(vault.config,period):clock.mtp-1)
    .addInput(stateInput,cs.registry.unlock.transition(state,BigInt(action),BigInt(slot),Buffer.alloc(0),Buffer.alloc(0)))
    .addInput(poolInput,cs.pool.unlock.spend());
  if(sponsor)builder.addInput(sponsor.input,sponsor.unlocker);
  builder.addOutput({to:cs.registry.tokenAddress,amount,token:{category:vault.category,amount:0n,nft:{capability:'mutable',commitment:hashState(next)}}});
  const remaining=remainingCommitment(next);
  builder.addOutput({to:cs.pool.tokenAddress,amount:1000n,...(remaining?{token:{category:vault.config.stakingCategory,amount:remaining}}:{})});
  if(action===3) {
    const winner=ranked[0]!,address=encodeCashAddress({prefix:provider.network===Network.CHIPNET?'bchtest':'bchreg',type:'p2pkh',payload:hash160(Buffer.from(winner.owner,'hex'))});
    if(typeof address==='string')throw Error(address);
    builder.addOutput({to:address.address,amount:reward});
    const allocation=await contract('StakeAllocation',[termsFor(vault.config,vault.category,state,slot)],provider);
    builder.addOutput({to:allocation.tokenAddress,amount:2000n,token:{category:vault.config.stakingCategory,amount:BigInt(winner.stake)}});
  }
  const raw=builder.build(),sources=[stateInput,poolInput,...(sponsor?[sponsor.input]:[])].map(sourceOutput);
  const validated=validateKeeperTransaction(raw,sources,clock,sponsor?undefined:10000n);
  return {raw,action,slot,period,txid:validated.txid,fee:validated.fee.toString(),sourceOutputs:sources};
}
