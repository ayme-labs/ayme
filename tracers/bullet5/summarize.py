import json,sys
for f in sys.argv[1:]:
  d=json.load(open(f)); print("==",f.split('/')[-1])
  for t in d['trials']:
    st=t.get('steps',[])
    pageSteps=[s['k'] for s in st if s['liMintedBy']=='page']
    firstDup=next((s['k'] for s in st if s['nodeDupes']),None)
    firstNodeMint=next((s['k'] for s in st if s['nodeMints']),None)
    errStep=next((s['k'] for s in st if s.get('agentAddError')),None)
    print(t['trial'], 'loadMints',t.get('pageMintsAtLoad'),'firstCapNodeMints',t.get('nodeMintsAtFirstCapture'),'liByPage@',pageSteps,'pageMs',[s.get('liPageMintAfterClickMs') for s in st if s.get('liPageMintAfterClickMs') is not None],'capMs',sorted(set(s.get('captureAfterClickMs') for s in st if s.get('captureAfterClickMs'))),'firstNodeMint@',firstNodeMint,'firstDup@',firstDup,'agentAddErr@',errStep,'finalNodeDupes',len(t.get('nodeFinal',{}).get('dupes',[])),'nodeMints',len(t.get('allNodeMints',[])))
    print('   agentSnap', 'ERR '+t['agentSnapshot']['text'][:100] if t.get('agentSnapshot',{}).get('isError') else ('dupes %s'%t.get('agentSnapshot',{}).get('dupes')), '| look',t.get('inspectorLook'),'| countItems',t.get('agentCountItems'))
    print('   nodeClick',t.get('nodeClick')); print('   agentClick',t.get('agentClick'), t.get('agentClickPrefixed')); 
    if t.get('fatal'): print('   FATAL',t['fatal'][:300])
