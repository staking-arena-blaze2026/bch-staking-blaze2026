/** Evidence from a sized candidate, never the wallet application's balance. */
export class BchFundingError extends Error {
 constructor(readonly required:bigint,readonly available:bigint,readonly fee:bigint,readonly phase='creation',readonly preparationFees=0n){
  super(`Insufficient BCH: tested ${phase} needs ${required} satoshis including ${fee} fee satoshis and non-dust change; ${available} satoshis selected`);
 }
}
export class TokenFundingError extends Error {
 constructor(readonly category:string,readonly required:bigint,readonly available:bigint){
  super('Insufficient tokens in the selected wallet inputs');
 }
 get balance(){return {category:this.category,required:this.required,available:this.available};}
}
export const errorMessage=(e:unknown):string=>(e instanceof Error?e.message:String(e)).replace(/^(?:Error:\s*)+/,'');
