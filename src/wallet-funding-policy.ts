/** Resource/fee bound, not a covenant or BCH consensus input limit.
 * Reserve 2 kB for outputs/metadata and up to 148 bytes per P2PKH input.
 * V3 funding pays 10,000 sats: this keeps it above 1 sat/byte and below
 * BCHN's 100 kB standard transaction ceiling. Exact serialized size is checked too.
 */
export const FUNDING_BYTE_BUDGET=10_000;
export const MAX_FUNDING_INPUTS=Math.floor((FUNDING_BYTE_BUDGET-2000)/148);
export class FundingSelectionError extends Error {
 constructor(readonly code:'balance'|'input-limit'|'tokens',message:string,readonly required?:bigint,readonly available?:bigint,readonly inputs?:number){super(message);}
}
export function checkFundingInputCount(count:number){
 if(count>MAX_FUNDING_INPUTS)throw new FundingSelectionError('input-limit',`Wallet funds require ${count} inputs; this transaction supports up to ${MAX_FUNDING_INPUTS} within its 10,000-byte fee budget. Choose different funding or explicitly consolidate in your wallet.`,undefined,undefined,count);
}
