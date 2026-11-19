/** Policy rates are BCH/kB; return an integer sat/byte ceiling. */
export function policyRate(...rates:(string|number)[]){
 let result=1n;
 for(const rate of rates){
  if(typeof rate!=='number'&&(typeof rate!=='string'||rate.trim()===''))throw Error('Invalid relay fee policy');
  const n=Number(rate);if(!Number.isFinite(n)||n<0||n>0.001)throw Error('Invalid relay fee policy');
  const satPerByte=BigInt(Math.ceil(n*100000-1e-10));if(satPerByte>result)result=satPerByte;
 }
 return result;
}
