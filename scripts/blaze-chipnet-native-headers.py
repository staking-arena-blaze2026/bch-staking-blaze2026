#!/usr/bin/env python3
"""Extend the previously signature-verified isolated header reference, offline.
Never touches the original node; datadir and binary are mandatory explicit args.
"""
import json,subprocess,sys,time
from pathlib import Path
binary,datadir=sys.argv[1:]
root=Path(__file__).resolve().parents[1]
def rpc(method,*args):
 r=subprocess.run([str(Path(binary).with_name('bitcoin-cli')),f'-datadir={datadir}',method,*[json.dumps(a) if not isinstance(a,str) else a for a in args]],capture_output=True,text=True)
 if r.returncode:raise RuntimeError(r.stderr)
 try:return json.loads(r.stdout)
 except json.JSONDecodeError:return r.stdout.strip()
node=subprocess.Popen([binary,f'-datadir={datadir}','-connect=0','-dnsseed=0'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
for _ in range(100):
 try:rpc('getnetworkinfo');break
 except RuntimeError:
  if node.poll() is not None:raise RuntimeError('Isolated reference startup failed')
  time.sleep(.1)
try:
 rpc('setnetworkactive',False)
 data=json.loads((root/'docs/blaze2026/chipnet-upgrade/restoration-live.json').read_text());results=[]
 for source in data['observations']:
  if 'headers' not in source:raise RuntimeError('Provider audit unavailable')
  for h in source['headers']:rpc('submitheader',h['hex'])
  header=rpc('getblockheader',source['tip']['hash'])
  results.append({'endpoint':source['endpoint'],'height':header['height'],'hash':header['hash'],'ticks':header['ticks'],'next_target_time':header['next_target_time'],'chainwork':header['chainwork'],'allContextualHeadersAccepted':True})
 report={'at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'node':rpc('getnetworkinfo')['subversion'],'networkactive':rpc('getnetworkinfo')['networkactive'],'results':results,'scope':'Native contextual header validation through each current provider tip. Not full-block synchronization or script/subsidy verification.'}
 (root/'docs/blaze2026/chipnet-upgrade/restoration-native-headers.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
finally:
 rpc('stop')
 node.wait(timeout=30)
