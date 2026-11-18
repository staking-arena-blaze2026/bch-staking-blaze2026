import {deriveHdPrivateNodeFromSeed,deriveHdPublicNode,deriveHdPublicNodeChild,encodeHdPublicKey,binToHex} from '@bitauth/libauth';
import {EventEmitter} from 'node:events';
import {expect,it,vi} from 'vitest';
import {browserWalletClient} from '../src/browserWalletClient';
import {queueCall} from '../src/queueClient';
const network=vi.hoisted(()=>({value:'mainnet'}));
vi.mock('../src/activeNetwork',()=>({get activeNetwork(){return network.value;},networkLeaving:false,selectedNetwork:()=>network.value}));
vi.mock('../src/queueClient',()=>({queueCall:vi.fn()}));
function setup(selected='mainnet'){network.value=selected;
 class WorkerMock{onmessage:((e:any)=>void)|null=null;terminate=vi.fn();constructor(){queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}));}postMessage(m:any){queueMicrotask(()=>this.onmessage?.({data:{id:m.id,result:[]}}));}}
 vi.stubGlobal('Worker',WorkerMock);
 const node=deriveHdPublicNode(deriveHdPrivateNodeFromSeed(new Uint8Array(32).fill(88))),encoded=encodeHdPublicKey({node,network:selected==='mainnet'?'mainnet':'testnet'});if(typeof encoded==='string')throw Error(encoded);
 const pub=(index:bigint)=>{const child=deriveHdPublicNodeChild(node,Number(index));if(typeof child==='string')throw Error(child);return child.publicKey;};
 const plan={label:'Claim; caller pays the measured fee',request:{broadcast:false,transaction:{version:2,inputs:[],outputs:[],locktime:0},sourceOutputs:[]},inputPaths:[[2,'receive',0]]};
 const manager=Object.assign(new EventEmitter(),{getSessionPaths:()=>[{name:'receive',xpub:encoded.hdPublicKey}],hasPath:(p:number)=>p===0,getPubkey:(_path:number,index:bigint)=>pub(index),signTransaction:vi.fn(async()=>({signedTransaction:'signed'}))});
 const events:string[]=[];
 vi.mocked(queueCall).mockImplementation(async i=>{events.push(String(i.operation));if(i.operation==='prepare')return {id:'claim',stage:'review',plan};if(i.operation==='authorize')return {owner:{publicKey:binToHex(pub(0n))},verifiedAt:Date.now(),plan};if(i.operation==='submit')return {stage:'pending'};return {};});
 return {wallet:browserWalletClient(manager as any,()=>{}),manager,plan,events};
}
it('requires explicit approval with wallet broadcast disabled, and retains bytes before submission',async()=>{const {wallet,manager,events}=setup();try{expect((await wallet.queue!({operation:'prepare',intent:{kind:'claim'}})).stage).toBe('pending');expect(manager.signTransaction).toHaveBeenCalledOnce();expect(manager.signTransaction).toHaveBeenCalledWith({transaction:expect.objectContaining({broadcast:false}),inputPaths:[[2,'receive',0]]},{signal:expect.any(AbortSignal)});expect(events).toEqual(['prepare','authorize','beginSigning','retain','submit']);}finally{wallet.close?.();}});
it('retains a returned signature across reconnection and never broadcasts with stale authorization',async()=>{const {wallet,manager,events}=setup();manager.signTransaction.mockImplementation(async()=>{manager.emit('reconnecting');return {signedTransaction:'signed'};});try{await expect(wallet.queue!({operation:'prepare'})).rejects.toThrow('authorization changed');expect(events).toContain('retain');expect(events).not.toContain('submit');}finally{wallet.close?.();}});
it('checks authorization again after the durable signing journal boundary',async()=>{const {wallet,manager,events}=setup(),original=vi.mocked(queueCall).getMockImplementation()!;vi.mocked(queueCall).mockImplementation(async(...args)=>{const result=await original(...args);if(args[0].operation==='beginSigning')manager.emit('reconnecting');return result;});try{await expect(wallet.queue!({operation:'prepare'})).rejects.toThrow('authorization changed');expect(manager.signTransaction).not.toHaveBeenCalled();expect(events).not.toContain('submit');expect(queueCall).toHaveBeenCalledWith({operation:'signingFailed',id:'claim',rejected:true,notRequested:true});}finally{wallet.close?.();}});
it('rejects worker requests enabling wallet broadcasting before prompting',async()=>{const {wallet,manager,plan}=setup();plan.request.broadcast=true;try{await expect(wallet.queue!({operation:'prepare'})).rejects.toThrow('fresh verified inputs');expect(manager.signTransaction).not.toHaveBeenCalled();}finally{wallet.close?.();}});

for(const kind of ['create','insert'])it(kind+' uses exactly one signing request and broadcasts only retained bytes',async()=>{const {wallet,manager,events}=setup();try{await wallet.queue!({operation:'prepare',intent:{kind}});expect(manager.signTransaction).toHaveBeenCalledOnce();expect(events).toEqual(['prepare','authorize','beginSigning','retain','submit']);expect(queueCall).toHaveBeenCalledWith({operation:'retain',id:'claim',raw:'signed'});}finally{wallet.close?.();}});
it('rejects unavailable atomic creation before requesting any signature',async()=>{const {wallet,manager}=setup();vi.mocked(queueCall).mockRejectedValue(Error('Atomic vault creation needs two eligible coins'));try{await expect(wallet.queue!({operation:'prepare',intent:{kind:'create'}})).rejects.toThrow('Atomic vault creation');expect(manager.signTransaction).not.toHaveBeenCalled();}finally{wallet.close?.();}});

for(const selected of ['mainnet','chipnet'])for(const count of [2,3]){
 it(selected+': '+count+' approvals progress automatically after explicit confirmation',async()=>{
  const {wallet,manager}=setup(selected);let step=0;const base={owner:{publicKey:binToHex(manager.getPubkey(0,0n))},verifiedAt:Date.now(),plan:{label:'self-send',request:{broadcast:false,transaction:{version:2,inputs:[],outputs:[],locktime:0},sourceOutputs:[]},inputPaths:[]}};
  const op=()=>({...base,id:'step'+step,stage:'review',step:step<count-1?'wallet-preparation':'action',approved:step>0,quote:{transactions:count-step,approvals:count-step,preparationFees:Array(count-step-1).fill('219'),creationFee:'400',totalFee:String(400+219*(count-step-1)),walletDebit:'50000',reserve:'40000',rewardCategory:'0'.repeat(64)}});
  vi.mocked(queueCall).mockImplementation(async i=>{if(i.operation==='prepare'||i.operation==='authorize'||i.operation==='confirm')return op();if(i.operation==='submit')return {...op(),stage:'pending',raw:'signed'};if(i.operation==='advance'){step++;return op();}return {};});
  const decide=(e:Event)=>{expect(manager.signTransaction).not.toHaveBeenCalled();expect((e as CustomEvent).detail.quote.approvals).toBe(count);(e as CustomEvent).detail.respond(true);};window.addEventListener('arena-preparation-confirm',decide);
  try{await wallet.queue!({operation:'prepare',intent:{kind:'create'}});expect(manager.signTransaction).toHaveBeenCalledTimes(count);}finally{window.removeEventListener('arena-preparation-confirm',decide);wallet.close?.();}
 });
 it(selected+': cancellation before '+count+' approvals never signs or broadcasts',async()=>{
  const {wallet,manager,events}=setup(selected),original=vi.mocked(queueCall).getMockImplementation()!;
  vi.mocked(queueCall).mockImplementation(async(...args)=>args[0].operation==='prepare'?{id:'cancel',stage:'review',plan:{},approved:false,quote:{approvals:count,transactions:count}}:original(...args));
  const decide=(e:Event)=>(e as CustomEvent).detail.respond(false);window.addEventListener('arena-preparation-confirm',decide);
  try{await expect(wallet.queue!({operation:'prepare',intent:{kind:'create'}})).rejects.toThrow('cancelled');expect(manager.signTransaction).not.toHaveBeenCalled();expect(events).not.toContain('submit');expect(queueCall).toHaveBeenCalledWith({operation:'discard',id:'cancel'});}finally{window.removeEventListener('arena-preparation-confirm',decide);wallet.close?.();}
 });
}
for(const selected of ['mainnet','chipnet'])for(const stop of [0,1,2])for(const failure of ['refusal','disconnect'])it(selected+': '+failure+' at approval '+(stop+1)+' stops the three-approval sequence',async()=>{
 const {wallet,manager,plan}=setup(selected);let step=0;const sent:string[]=[];
 const op=()=>({id:'part'+step,intent:{kind:'create'},owner:{publicKey:binToHex(manager.getPubkey(0,0n))},verifiedAt:Date.now(),plan,stage:'review',step:step<2?'wallet-preparation':'action',approved:step>0,quote:{transactions:3-step,approvals:3-step,preparationFees:Array(2-step).fill('219'),creationFee:'400',totalFee:String(400+219*(2-step)),walletDebit:'50000',reserve:'40000',rewardCategory:'0'.repeat(64)}});
 vi.mocked(queueCall).mockImplementation(async i=>{sent.push(String(i.operation));if(['prepare','authorize','confirm'].includes(String(i.operation)))return op();if(i.operation==='submit')return {...op(),stage:'pending',raw:'signed'};if(i.operation==='advance'){step++;return op();}return {};});
 manager.signTransaction.mockImplementation(async()=>{if(step===stop){if(failure==='refusal')return {error:'User rejected the transaction'} as any;manager.emit('disconnect');}return {signedTransaction:'signed'};});
 const decide=(e:Event)=>(e as CustomEvent).detail.respond(true);window.addEventListener('arena-preparation-confirm',decide);
 try{await expect(wallet.queue!({operation:'prepare',intent:{kind:'create'}})).rejects.toThrow(failure==='refusal'?'refused':'authorization changed');expect(manager.signTransaction).toHaveBeenCalledTimes(stop+1);expect(sent.filter(s=>s==='submit')).toHaveLength(stop);if(failure==='refusal')expect(queueCall).toHaveBeenCalledWith({operation:'signingFailed',id:'part'+stop,rejected:true});else expect(sent.filter(s=>s==='retain')).toHaveLength(stop+1);}finally{window.removeEventListener('arena-preparation-confirm',decide);wallet.close?.();}
});
it('resuming the first preparation reuses both completed steps and shows approval 3 of 3',async()=>{
 const {wallet,manager,plan}=setup(),progress:string[]=[];
 const op=(part:number)=>({id:'part'+part,completed:part,stage:part<2?'confirmed':'review',raw:part<2?'retained':undefined,step:part<2?'wallet-preparation':'action',approved:true,quote:{transactions:3-part,approvals:3-part},plan,verifiedAt:Date.now(),owner:{publicKey:binToHex(manager.getPubkey(0,0n))}});
 vi.mocked(queueCall).mockImplementation(async i=>{if(i.operation==='resume')return op(0);if(i.operation==='advance')return op(i.id==='part0'?1:2);if(i.operation==='authorize')return op(2);if(i.operation==='submit')return {...op(2),stage:'pending',raw:'signed'};return {};});
 const observe=(e:Event)=>progress.push((e as CustomEvent).detail);window.addEventListener('arena-wallet-progress',observe);
 try{await wallet.queue!({operation:'resume',id:'part0'});expect(manager.signTransaction).toHaveBeenCalledOnce();expect(progress.some(s=>s.includes('approval 3 of 3'))).toBe(true);}finally{window.removeEventListener('arena-wallet-progress',observe);wallet.close?.();}
});
it('searches more wallet addresses before offering preparation, preserving one approval when origins are found',async()=>{
 const {wallet,manager,plan}=setup(),original=vi.mocked(queueCall).getMockImplementation()!;let prepares=0;const popup=vi.fn();
 vi.mocked(queueCall).mockImplementation(async(...args)=>{if(args[0].operation==='prepare'){prepares++;return {id:'discovery'+prepares,intent:{kind:'create'},stage:'review',plan,approved:prepares>1,quote:{transactions:prepares===1?3:1,approvals:prepares===1?3:1}};}return original(...args);});window.addEventListener('arena-preparation-confirm',popup);
 try{await wallet.queue!({operation:'prepare',intent:{kind:'create'}});expect(prepares).toBe(2);expect(popup).not.toHaveBeenCalled();expect(manager.signTransaction).toHaveBeenCalledOnce();expect(queueCall).toHaveBeenCalledWith({operation:'discard',id:'discovery1'});}finally{window.removeEventListener('arena-preparation-confirm',popup);wallet.close?.();}
});
it('expands descriptor discovery for structured funding failures before signing',async()=>{
 const {wallet,manager}=setup(),original=vi.mocked(queueCall).getMockImplementation()!;let prepares=0;
 vi.mocked(queueCall).mockImplementation(async(...args)=>{if(args[0].operation==='prepare'&&++prepares===1)throw Object.assign(Error('Vault creation funding: verified inputs unavailable'),{details:{code:'creation-funding',available:'0'}});return original(...args);});
 try{await wallet.queue!({operation:'prepare',intent:{kind:'create'}});expect(prepares).toBe(2);expect(vi.mocked(queueCall).mock.calls.filter(c=>c[0].operation==='prepare').map(c=>c[1]?.length)).toEqual([2,40]);expect(manager.signTransaction).toHaveBeenCalledOnce();}finally{wallet.close?.();}
});
it('legacy inspection never reaches approval or submission, even if a retained entry is in review',async()=>{
 const {wallet,manager}=setup();vi.mocked(queueCall).mockResolvedValue({id:'old',stage:'review',step:'seed-funding',plan:{},error:'Unresolved reservation; inspect retained evidence'});
 try{const result=await wallet.queue!({operation:'resume',id:'old',retry:true});expect(result.step).toBe('seed-funding');expect(manager.signTransaction).not.toHaveBeenCalled();expect(vi.mocked(queueCall).mock.calls.map(c=>c[0].operation)).toEqual(['resume']);}finally{wallet.close?.();}
});
for(const selected of ['mainnet','chipnet'])it(selected+': resolving an old request requires explicit review and signs only the new self-send',async()=>{
 const {wallet,manager,plan}=setup(selected);let approved=false;const calls:string[]=[];
 const quote={transactions:1,approvals:1,preparationFees:[],creationFee:'0',totalFee:'185',walletDebit:'185',reserve:'0',rewardCategory:'0'.repeat(64),recovery:{operationId:'old-request',transactionId:'aa'.repeat(32),reservedBch:'866201',returnedBch:'864816'}};
 const op=()=>({id:'recovery',intent:{kind:'recover',operationId:'old-request'},step:'wallet-recovery',stage:'review',approved,recovery:{operationId:'old-request'},quote,plan,owner:{publicKey:binToHex(manager.getPubkey(0,0n))},verifiedAt:Date.now()});
 vi.mocked(queueCall).mockImplementation(async i=>{calls.push(String(i.operation));if(i.operation==='confirm')approved=true;if(i.operation==='submit')return {...op(),raw:'new-signed-self-send',stage:'pending'};return op();});
 const decide=(e:Event)=>{expect(manager.signTransaction).not.toHaveBeenCalled();expect((e as CustomEvent).detail.quote.recovery.operationId).toBe('old-request');(e as CustomEvent).detail.respond(true);};window.addEventListener('arena-preparation-confirm',decide);
 try{const result=await wallet.queue!({operation:'prepare',intent:{kind:'recover',operationId:'old-request'}});expect(result.stage).toBe('pending');expect(manager.signTransaction).toHaveBeenCalledOnce();expect(calls).toEqual(['prepare','confirm','authorize','beginSigning','retain','submit']);expect(calls).not.toContain('advance');}finally{window.removeEventListener('arena-preparation-confirm',decide);wallet.close?.();}
});
it('cancelling resolution never signs, submits or discards the old request',async()=>{
 const {wallet,manager,plan}=setup();const calls:any[]=[];vi.mocked(queueCall).mockImplementation(async i=>{calls.push(i);return {id:'new-recovery',intent:{kind:'recover'},step:'wallet-recovery',stage:'review',plan,recovery:{operationId:'old'},approved:false,quote:{transactions:1,approvals:1,recovery:{operationId:'old'}}};});
 const decide=(e:Event)=>(e as CustomEvent).detail.respond(false);window.addEventListener('arena-preparation-confirm',decide);
 try{await expect(wallet.queue!({operation:'prepare',intent:{kind:'recover',operationId:'old'}})).rejects.toThrow('resolution cancelled');expect(manager.signTransaction).not.toHaveBeenCalled();expect(calls).toEqual([{operation:'prepare',intent:{kind:'recover',operationId:'old'}},{operation:'discard',id:'new-recovery'}]);}finally{window.removeEventListener('arena-preparation-confirm',decide);wallet.close?.();}
});
