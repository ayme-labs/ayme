import json, sys, os, collections
for d in sys.argv[1:]:
    r = json.load(open(f'{d}/report.json'))['run']
    e2e = collections.Counter()
    for res in r['results']:
        for a in res['attempts']:
            for s in a['steps']:
                if s.get('api') == 'agent.act' and s.get('cache'):
                    c = s['cache']; e2e[c['mode'].replace('self-finalized', 'e2e-replayed') + ('/' + c['reason'] if c.get('reason') else '')] += 1
    ours = collections.Counter(); extra = []
    if os.path.exists(f'{d}/runsteps.jsonl'):
        for l in open(f'{d}/runsteps.jsonl'):
            j = json.loads(l); src = j['source']
            if src == 'solver':
                src = 'solver' + ('(after failed ' + j['failedCall']['tool'] + ')' if j.get('failedCall') else '') + ('+stored' if j.get('stored') else '') + ('+repair' if j.get('repair') else '')
                if j.get('skipped'): extra.append(j['skipped'])
                if j.get('turn'): extra.append({k: j['turn'].get(k) for k in ('turns', 'costUsd')} | {'sessionStarted': j.get('sessionStarted'), 'tools': j.get('toolCalls')})
            ours[src] += 1
    tests = f"{r.get('summary', {}).get('passed', '')}"
    print(f"{os.path.basename(d):22} e2e={dict(e2e)} executor={dict(ours)}", *extra, sep='\n    ' if extra else ' ')
