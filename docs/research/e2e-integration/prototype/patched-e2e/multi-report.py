import json, sys
for d in sys.argv[1:]:
    print('==', d)
    try: lines = open(f'{d}/runsteps.jsonl').read().splitlines()
    except FileNotFoundError: lines = []
    for l in lines:
        j = json.loads(l); r = j['result']; u = r.get('usage', {})
        print(f"  {j['test'][-34:]:34} {'NEW ' if j['sessionStarted'] else 'same'} turns={r.get('numTurns')} wall={j['wallMs']/1000:.1f}s cost=${r.get('turnCostUsd',0):.4f} cacheR={u.get('cache_read_input_tokens')} cacheW={u.get('cache_creation_input_tokens')} out={u.get('output_tokens')} tools={j['toolCalls']} fail={(j['replayedToolFailure'] or {}).get('tool')} prefix={(j['replayedPrefix'] or {}).get('stopReason')}")
    r = json.load(open(f'{d}/report.json'))['run']
    for res in r['results']:
        for a in res['attempts']:
            acts = [s for s in a['steps'] if s.get('api') == 'agent.act']
            print('  ', res.get('title', '')[:50] if isinstance(res.get('title'), str) else '', [(s['cache']['mode'], s['cache'].get('reason'), s['cache'].get('totalActions')) for s in acts if s.get('cache')], a.get('status') or res.get('status'))
