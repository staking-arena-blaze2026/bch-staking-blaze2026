import {activeNetwork} from './activeNetwork';
import indexerWorkerUrl from './indexer.bootstrap.worker.ts?worker&url';
import {workerDiagnostic,formatWorkerDiagnostic,probeWorkerResource,type WorkerDiagnostic} from './workerDiagnostics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { envelopeSchema, keeperSchema, type Envelope } from './model';
import { browserConfig, indexerSource } from './browserConfig';
import { apiBaseUrl } from './api';
import { loadSnapshot, saveSnapshot } from './snapshot';
export const REFRESH_MS = 10000;
export function useArena() {
  const [catalogVersion,setCatalogVersion]=useState(0);
  useEffect(()=>{const changed=(event:Event)=>{if(event.type==='storage'&&(event as StorageEvent).key!=='arena-chipnet-local-vaults-v1')return;setPending(true);setCatalogVersion(v=>v+1);};window.addEventListener('arena-vault-catalog',changed);window.addEventListener('storage',changed);return()=>{window.removeEventListener('arena-vault-catalog',changed);window.removeEventListener('storage',changed);};},[]);
  const [config] = useState(() => {
    if(activeNetwork==='mainnet')return {base:null,source:'off' as const,error:null};
    try { const base = apiBaseUrl(); return { base, source:indexerSource(base), error: null }; }
    catch (e) { return { base: null, source:'off' as const, error: (e as Error).message }; }
  });
  const endpoint = config.source === 'api' && config.base ? `${config.base}/vaults` : null;
  const [saved] = useState(() => endpoint ? loadSnapshot(endpoint) : undefined);
  const [data,setData] = useState<Envelope | undefined>(saved?.data);
  const [fromSnapshot,setFromSnapshot] = useState(!!saved);
  // Historical preferences never authorize processing and remain preserved across network switches.
  const [settlements,setSettlements]=useState<import('zod').z.infer<typeof keeperSchema>['statuses']>({});
  const controls=useRef<(message:unknown)=>void>(()=>{});
  const [providerStatus,setProviderStatus] = useState('Connecting');
  const [error,setError] = useState<string|null>(null);
  const [pending,setPending] = useState(!!endpoint || config.source === 'electrum');
  const [receivedAt,setReceivedAt] = useState<number | undefined>(saved?.receivedAt);
  const [now,setNow] = useState(Date.now());
  const request = useRef<() => void>(() => {});
  useEffect(() => {
    if (config.source === 'electrum') {
      let worker:Worker|undefined,startup:ReturnType<typeof setTimeout>|undefined,retry:ReturnType<typeof setTimeout>|undefined;
      let disposed=false,generation=0,attempts=0,failed=false;
      const clock=setInterval(()=>setNow(Date.now()),1000);
      const workerUrl=new URL(indexerWorkerUrl,import.meta.url);
      // The Vite worker URL import supplies the same compiled URL for launch and diagnostics.
      const detach=()=>{clearTimeout(startup);if(worker){worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();worker=undefined;}};
      const launch=()=>{
        if(disposed)return;clearTimeout(retry);detach();const current=++generation;failed=false;attempts++;
        setPending(true);setProviderStatus(`Starting indexer (attempt ${attempts}/3)`);
        const active=()=>!disposed&&current===generation;
        const fail=(diagnostic:WorkerDiagnostic)=>{
          if(!active()||failed)return;failed=true;detach();
          const message=formatWorkerDiagnostic(diagnostic);setError(message);setPending(false);setProviderStatus('Worker unavailable');
          window.dispatchEvent(new CustomEvent('arena-indexer-diagnostic',{detail:diagnostic}));
          let resourceUrl=workerUrl;try{const candidate=new URL(diagnostic.message.match(/https?:\/\/[^\s)]+/)?.[0]??diagnostic.filename??workerUrl.href,workerUrl);if(candidate.origin===workerUrl.origin)resourceUrl=candidate;}catch{/* Retain the known bootstrap URL. */}
          void probeWorkerResource(resourceUrl.href).then(resource=>{if(active()&&failed){const detail={...diagnostic,resource};setError(formatWorkerDiagnostic(detail));window.dispatchEvent(new CustomEvent('arena-indexer-diagnostic',{detail}));}});
          if(attempts<3){setProviderStatus(`Worker failed; restarting in ${attempts}s (${attempts+1}/3)`);retry=setTimeout(launch,attempts*1000);}
        };
        try{
          const settings=browserConfig();
          worker=new Worker(workerUrl,{type:'module'});
          startup=setTimeout(()=>fail(workerDiagnostic('Worker readiness timed out after 30 seconds',workerUrl.href,'startup')),30000);
          worker.onmessage=event=>{
            if(!active()||failed)return;
            if(event.data?.type==='ready'){clearTimeout(startup);worker?.postMessage({type:'start',config:settings});return;}
            if(event.data?.type==='error'){
              if(event.data.fatal){fail(event.data.diagnostic??workerDiagnostic(event.data.error,workerUrl.href,'worker'));return;}
              setError(formatWorkerDiagnostic(workerDiagnostic(event.data.error,workerUrl.href,'indexing')));setPending(false);return;
            }
            if(event.data?.type!=='snapshot')return;
            const keeper=keeperSchema.safeParse(event.data.keeper);
            if(keeper.success) {
              setSettlements(keeper.data.statuses);

            }
            const parsed=envelopeSchema.safeParse(event.data.envelope);
            if(!parsed.success || parsed.data.chain!=='chipnet') {setError('Browser indexer returned an incompatible response');setPending(false);return;}
            const h=parsed.data.health;
            setProviderStatus(`${h.phase||'Connecting'}${event.data.role==='follower'?' · following another tab':''}${parsed.data.tip?` · indexed height ${parsed.data.tip.height}`:''}${h.transactions?` · ${h.transactions} transactions checked`:''}${h.endpoint?` · ${new URL(h.endpoint).host}`:''}`);
            if(parsed.data.tip) {setData({...parsed.data,health:{...h,role:event.data.role}});setFromSnapshot(!!event.data.cached);}
            setPending(!!h.syncing || (!parsed.data.tip && !h.error));
            setError(parsed.data.health.error || null);
            if(parsed.data.health.updatedAt)setReceivedAt(Date.parse(parsed.data.health.updatedAt));
          };
          worker.onerror=event=>fail(workerDiagnostic(event,workerUrl.href,'startup / runtime'));
          worker.onmessageerror=()=>fail(workerDiagnostic('Worker response could not be deserialized',workerUrl.href,'message loading'));
        }catch(error){fail(workerDiagnostic(error,workerUrl.href,'construction / configuration'));}
      };
      // A previous catalog's projection remains historical while the replacement initializes.
      setFromSnapshot(!!data);setError(null);launch();
      request.current=()=>{if(failed){attempts=0;launch();}else worker?.postMessage({type:'refresh'});};
      controls.current=message=>{if(!failed)worker?.postMessage(message);};
      const reconnect=()=>{if(document.visibilityState==='visible')request.current();};
      document.addEventListener('visibilitychange',reconnect);window.addEventListener('online',reconnect);
      return()=>{disposed=true;generation++;clearTimeout(retry);detach();controls.current=()=>{};clearInterval(clock);request.current=()=>{};document.removeEventListener('visibilitychange',reconnect);window.removeEventListener('online',reconnect);};
    }

    if (!endpoint) {
      setError(config.error ?? 'No API is configured for this static website.');
      return;
    }
    const url = endpoint;
    let stopped = false, busy = false, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController;
    async function refresh() {
      if (stopped || busy) return;
      busy = true; clearTimeout(timer); setPending(true); controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(url, { cache:'no-store', credentials:'omit', signal:controller.signal });
        if (!response.ok) throw Error(`Indexer returned HTTP ${response.status}.`);
        const parsed = envelopeSchema.safeParse(await response.json());
        if (!parsed.success) throw Error('The indexer response is incompatible or malformed. Expected a compatible v0.3.0 chipnet/regtest envelope with transaction confirmation metadata.');
        if (!stopped) {
          const received = Date.now();
          setData(parsed.data); setReceivedAt(received); setFromSnapshot(false); setError(null);
          saveSnapshot(url, parsed.data, received);
        }
      } catch (e) {
        if (!stopped) setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'Indexer request timed out.');
      } finally {
        clearTimeout(timeout); busy = false;
        if (!stopped) { setPending(false); timer = setTimeout(refresh,REFRESH_MS); }
      }
    }
    request.current = () => { void refresh(); };
    void refresh();
    const clock = setInterval(() => setNow(Date.now()),1000);
    const reconnect = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange',reconnect); window.addEventListener('online',reconnect);
    return () => { stopped = true; clearTimeout(timer); clearInterval(clock); controller?.abort(); document.removeEventListener('visibilitychange',reconnect); window.removeEventListener('online',reconnect); };
  },[endpoint, config.error, config.source,catalogVersion]);
  const processPeriod=useCallback((category:string)=>controls.current({type:'process-period',category}),[]);
  return { automatic:true as const, settlements, processPeriod, data, error, pending, receivedAt, now, fromSnapshot, configured: !!endpoint || config.source === 'electrum', source:config.source, providerStatus, refresh:useCallback(() => request.current(),[]) };
}
