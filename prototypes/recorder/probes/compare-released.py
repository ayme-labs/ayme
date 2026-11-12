"""Value comparison of YAML-style package text, without treating trees as YAML."""
import difflib
import json
import re
import sys
from pathlib import Path

export = Path("<scratchpad>")
released = export / "released-recording/.ayme/recordings/rec_20261112T132544402Z/package.yaml"
prototype = Path(sys.argv[1] if len(sys.argv) > 1 else "prototypes/recorder/reader-kit/.ayme/recordings/latest.yaml")

def fields(text, indent):
    return dict(re.findall(r"^" + " " * indent + r"(\w+): (.*)$", text, re.M))

def tree(text):
    return [re.sub(r"\[ref=[^]]+\]", "[ref=*]", line[6:]) for line in text.splitlines() if line.strip()]

def parse(path):
    text = path.read_text()
    visits, points = text.split("traceActionPoints:\n")
    chunks = visits.split("\n  - visitId: ")
    result = {"header": fields(chunks[0], 0), "visits": [], "points": []}
    for chunk in chunks[1:]:
        baseline, timeline = chunk.split("\n    timelineEntries:", 1)
        metadata, baseline = baseline.split("\n    baselineTree:\n", 1)
        visit = {"visitId": metadata.splitlines()[0], **fields(metadata, 4), "baseline": tree(baseline), "entries": []}
        for e in timeline.split("\n      - kind: ")[1:]:
            head, _, change = e.partition("\n        changeTree:\n")
            visit["entries"].append({"kind": head.splitlines()[0], **fields(head, 8), "interaction": fields(head, 10), "change": tree(change)})
        result["visits"].append(visit)
    for point in points.split("  - interactionId: ")[1:]:
        result["points"].append({"interactionId": point.splitlines()[0], **fields(point, 4)})
    return result

left, right = parse(released), parse(prototype)
report = ["# Released vs stock prototype: exact value comparison", "", f"Released: {released}", f"Prototype: {prototype.resolve()}", "", "Raw values below; only tree refs are replaced by `*` for tree comparisons. Interaction and trace refs remain exact. Minus is released, plus is prototype. Timing differences are separate from structure.", ""]

def values(label, a, b):
    report.append(f"## {label}")
    report.extend(f"- `{k}`: released `{a.get(k, '<absent>')}`; prototype `{b.get(k, '<absent>')}`" for k in sorted(a.keys() | b.keys()))
    report.append("")

def diff(label, a, b):
    report.append(f"### {label}")
    delta = list(difflib.unified_diff(a, b, fromfile="released", tofile="prototype", lineterm=""))
    report.extend(["```diff", *delta, "```", ""] if delta else ["Identical after ref normalization.", ""])

values("Header (all values)", left["header"], right["header"])
for a, b in zip(left["visits"], right["visits"]):
    values(f"{a['visitId']} metadata", {k:v for k,v in a.items() if k not in ["baseline","entries"]}, {k:v for k,v in b.items() if k not in ["baseline","entries"]})
    diff("Baseline, including every content/state mark", a["baseline"], b["baseline"])
    ae = [e for e in a["entries"] if e["kind"] == "interaction"]
    be = [e for e in b["entries"] if e["kind"] == "interaction"]
    used = set()
    for e in be:
        match = next((x for i,x in enumerate(ae) if i not in used and all(x["interaction"].get(k) == e["interaction"].get(k) for k in ["type","targetSelector"])), None)
        if match is None:
            report.append(f"Prototype-only interaction: `{json.dumps(e)}`\n")
            continue
        used.add(ae.index(match))
        label = f"{match['interaction']['id']} / {e['interaction']['id']} ({e['interaction'].get('targetSelector')})"
        values(label, {"timestamp": match["timestamp"], **match["interaction"]}, {"timestamp": e["timestamp"], **e["interaction"]})
        diff("Interaction Change Tree", match["change"], e["change"])
        lp = next(x for x in left["points"] if x["interactionId"] == match["interaction"]["id"])
        rp = next(x for x in right["points"] if x["interactionId"] == e["interaction"]["id"])
        values("Trace point", lp, rp)
    for i,e in enumerate(ae):
        if i not in used: report.append(f"Released-only interaction: `{json.dumps(e)}`\n")
    for name,v in [("Released",a),("Prototype",b)]:
        report.append(f"### {name} unassigned changes (every timestamp and tree)")
        for e in v["entries"]:
            if e["kind"] == "change": report.extend([f"Timestamp `{e['timestamp']}`", "```text", *e["change"], "```"])
        report.append("")
print("\n".join(report))

print("## Complete raw diff (every value, including all refs)\n")
print("```diff")
print("\n".join(difflib.unified_diff(released.read_text().splitlines(), prototype.read_text().splitlines(), fromfile="released", tofile="prototype", lineterm="")))
print("```")
assert len(left["visits"]) == len(right["visits"]) == 3
assert len(left["points"]) == 12 and len(right["points"]) == 8
print("\nCompared 3 visits, 12 released and 8 prototype interactions; complete raw diff above.")
