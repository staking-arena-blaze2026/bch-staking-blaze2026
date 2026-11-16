#!/usr/bin/env python3
"""Read-only ASERT cross-check against the pinned BCHN preview and v29.2 source.
Not full block validation; never used to authorize a transaction or choose a peer.
"""
import os
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
data=json.loads((root/('docs/blaze2026/chipnet-upgrade/restoration-live.json' if os.environ.get('CHIPNET_RESTORE_AUDIT') else 'docs/blaze2026/chipnet-upgrade/electrum-live.json')).read_text())
POW_LIMIT=int('00000000'+'ff'*28,16)
def target(bits):
    n=int(bits,16); size=n>>24; word=n&0x7fffff
    return word >> (8*(3-size)) if size<=3 else word << (8*(size-3))
def compact(n):
    size=(n.bit_length()+7)//8
    word=n << (8*(3-size)) if size<=3 else n >> (8*(size-3))
    if word & 0x800000: word>>=8; size+=1
    return f'{(size<<24)|word:08x}'
def asert(time_diff,tick_diff,ratio):
    numerator=(time_diff-(tick_diff+600))*65536
    exponent=(abs(numerator)//3600)*(1 if numerator>=0 else -1)
    shifts=exponent>>16; frac=exponent & 65535
    factor=65536+((195766423245049*frac+971821376*frac*frac+5127*frac*frac*frac+(1<<47))>>48)
    value=target('1d00ffff')*factor; shift=shifts-16
    value=value<<shift if shift>0 else value>>-shift
    value*=ratio
    return compact(min(POW_LIMIT,max(1,value)))
def expected(prev,current,activation,upgraded):
    active=upgraded and prev['height']>=activation
    interval=60 if active else 600
    if current['time']>prev['time']+2*interval:return '1d00ffff'
    parent_ticks=(min(prev['height'],activation)*600+max(0,prev['height']-activation)*60) if upgraded else prev['height']*600
    return asert(prev['time']-1605451779,parent_ticks-16844*600,10 if active else 1)
results=[]
for source in data['observations']:
    if not source.get('firstMtpCrossing'):continue
    activation=source['firstMtpCrossing']['height']; checks=[]
    for prev,current in zip(source['headers'],source['headers'][1:]):
        checks.append({'height':current['height'],'actualBits':current['bits'],'old600SecondBits':expected(prev,current,activation,False),'previewBits':expected(prev,current,activation,True)})
    before=[c for c in checks if c['height']<=activation]; after=[c for c in checks if c['height']>activation]
    results.append({'endpoint':source['endpoint'],'activationParentHeight':activation,'preActivationChecks':len(before),'preActivationOldMatches':all(c['actualBits']==c['old600SecondBits'] for c in before),'preActivationPreviewMatches':all(c['actualBits']==c['previewBits'] for c in before),'postActivationChecks':len(after),'postActivationOldMatches':all(c['actualBits']==c['old600SecondBits'] for c in after),'postActivationPreviewMatches':all(c['actualBits']==c['previewBits'] for c in after),'firstPreviewMismatch':next((c for c in after if c['actualBits']!=c['previewBits']),None),'checks':checks})
report={'at':data['at'],'sourceCommit':'3e6827e95c7a17497e09ac15556debd116dea1d0','anchor':{'height':16844,'bits':'1d00ffff','parentTime':1605451779,'legacyInterval':600,'newInterval':60,'halfLife':3600},'scope':'Contextual header difficulty only. Independent native preview validation is recorded separately; this does not verify transaction scripts, subsidies or full blocks.','results':results}
(root/('docs/blaze2026/chipnet-upgrade/restoration-difficulty.json' if os.environ.get('CHIPNET_RESTORE_AUDIT') else 'docs/blaze2026/chipnet-upgrade/difficulty-rules-comparison.json')).write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps([{k:v for k,v in r.items() if k!='checks'} for r in results],indent=2))
