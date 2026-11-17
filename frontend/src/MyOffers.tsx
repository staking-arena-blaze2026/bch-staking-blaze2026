import {Buffer} from '../../src/bytes';
import {ownedOffers,allocationStatus} from '../../src/v3/my-offers';
import type {Config,Snapshot} from '../../src/v3/indexer';
import type {Operation} from '../../src/v3/wallet';
import {assetAmount,assetLabel} from './createAssets';
export function MyOffers({owner,live,listings,busy,operations,act}:{owner:string;live:boolean;listings:Record<string,{snapshot?:Snapshot;error?:string;at:number}>;busy:boolean;operations:Operation[];act:(config:Config,slot:number,allocation?:string)=>void}){
 const rows=Object.values(listings).flatMap(listing=>listing.snapshot?ownedOffers(listing.snapshot,owner).map(offer=>({...offer,listing,snapshot:listing.snapshot!})):[]);
 return <section className="panel"><h1>My Offers</h1>{owner?<p>{live?'Connected wallet':'Last connected wallet · offline'}: <code>{owner}</code></p>:<p>Connect your wallet to find your offers. Your public owner identity will be remembered for read-only viewing.</p>}
 <p>Offers are read from on-chain records across discovered vaults. Historical offers remain visible. Wallet approval is required for every spending transaction.</p>
 {owner&&!rows.length&&<p>No owned offers found in the vaults checked so far.</p>}
 {rows.map(({record:r,allocations,recovery,status,listing,snapshot:s})=>{
 const processing=operations.find(o=>o.owner?.publicKey===owner&&o.config?.genesis===s.config.genesis&&o.slot===r.slot&&o.kind==='action'&&o.step!=='complete');
 return <article key={s.config.genesis+':'+r.slot}><h2><a href={'#/v3/vault/'+s.config.genesis}>Vault {s.config.genesis.slice(0,12)}</a> · Offer {r.slot+1}</h2>
 <p><strong>{status}</strong>{recovery?' · Recovery pending':processing?' · Cancellation pending':''}{listing.error?' · Last verified snapshot; verification unavailable':''}</p>
 <p>Stake: {assetAmount(s.config.stakingAsset,BigInt(r.stake))} · Asset: {assetLabel(s.config.stakingAsset)} · Requested reward: {assetAmount(s.config.rewardAsset,BigInt(r.reward))} · Staking duration: {r.duration} seconds</p>
 {r.maxWins>1&&<p>Legacy offer: {r.wins} / {r.maxWins} wins. Each winning allocation retains its own lock and withdrawal. Unused commitment: {assetAmount(s.config.stakingAsset,r.refunded&&!recovery?0n:BigInt(r.stake)*BigInt(r.maxWins-r.wins))}.</p>}
 {status==='ACTIVE'&&!r.cancelled&&<button disabled={busy} onClick={()=>act(s.config,r.slot)}>Cancel</button>}
 {recovery&&<><p>Cancellation removed this offer from the queue. The unused stake has not yet been returned. Continue with explicit wallet approval.</p><button disabled={busy} onClick={()=>act(s.config,r.slot)}>Continue cancellation</button></>}
 {allocations.map(a=>{const terms=Buffer.from(a.terms),maturity=a.sourceMtp+(terms.readUInt32LE(74)&65535)*512,op=operations.find(o=>o.allocation===a.id&&o.config?.genesis===s.config.genesis&&o.step!=='complete');return <div key={a.id}><p>{allocationStatus(a)} · Reward paid at win · Stake {assetAmount(s.config.stakingAsset,BigInt(terms.readUInt32LE(70)))} · Maturity: blockchain MTP {new Date(maturity*1000).toISOString()}{a.pending||op?' · Withdrawal pending':''}</p>{!a.withdrawal&&a.mature&&<><p>The owner authorizes withdrawal of the full stake and funds the BCH transaction fee.</p><button disabled={busy} onClick={()=>act(s.config,r.slot,a.id)}>Get my stake back</button></>}<p>Winning transaction: <code>{a.input.txid}</code>{a.pending&&<> · Withdrawal pending: <code>{a.pending}</code></>}{a.withdrawal&&<> · Confirmed withdrawal: <code>{a.withdrawal}</code></>}</p></div>;})}
 <details><summary>Transaction history</summary>{s.offerHistory?.filter(h=>h.slot===r.slot).map(h=><p key={h.txid}>{({0:'Registration',1:'Cancellation',3:'Reward paid / allocation',4:'Unused stake recovered'} as Record<number,string>)[h.action]??'Vault transition'} · {h.pending?'Pending':'Confirmed'} · <code>{h.txid}</code></p>)}{operations.filter(o=>o.owner?.publicKey===owner&&o.config?.genesis===s.config.genesis&&(o.slot===r.slot||allocations.some(a=>a.id===o.allocation))).map(o=><p key={o.id}>{o.kind} · {o.step} / {o.stage} · {o.txid} {o.error}</p>)}</details>
 </article>;})}</section>;
}
