"""Inspect stock trace data; no rewrite or third-party dependencies."""
import collections
import json
import sys
import zipfile

archive = zipfile.ZipFile(sys.argv[1])
events = []
for name in archive.namelist():
    if name.endswith('.trace'):
        events.extend(json.loads(line) for line in archive.read(name).decode().splitlines())
calls = [event for event in events if event['type'] == 'before']
groups = []
for event in calls:
    if event.get('title', '').startswith('probe-'):
        end = next(e['endTime'] for e in events if e['type'] == 'after' and e['callId'] == event['callId'])
        # Group's 'after' marks groupEnd in stock traces.
        members = [c for c in calls if event['startTime'] < c['startTime'] < end]
        groups.append({'title': event['title'], 'methods': dict(collections.Counter(c['method'] for c in members))})
snapshots = [event for event in events if event['type'] == 'frame-snapshot']
serialized = json.dumps(snapshots)
result = {'methods': dict(collections.Counter(c['method'] for c in calls)), 'groups': groups,
          'domSnapshotsContainEmptyHost': 'AYME-RECORDER-TRIAL' in serialized,
          'domSnapshotsContainToolbarText': 'Assert visibility' in serialized}
print(json.dumps(result, indent=2))
