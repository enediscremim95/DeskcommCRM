"""Lê snapshot privado de consulta READ ONLY; nunca se conecta nem escreve no banco."""
import json, re, sys
from collections import defaultdict
from pathlib import Path

def phone(raw):
    d = re.sub(r'\D', '', raw or '')
    if len(d) in (10, 11) and not (raw or '').startswith('+'):
        d = '55' + d
    if re.fullmatch(r'55[1-9][0-9][6-9][0-9]{7}', d):
        d = d[:4] + '9' + d[4:]
    return d

def audit(snapshot):
    contacts = snapshot['contacts'] or []
    parent = {c['id']: c['id'] for c in contacts}
    def root(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    seen = {}
    for c in contacts:
        for kind, value in [('phone',phone(c['phone'])), ('email',(c['email'] or '').strip().lower())]:
            if not value: continue
            key = (c['organization_id'],kind,value)
            if key in seen: parent[root(c['id'])] = root(seen[key])
            seen[key] = c['id']
    groups = defaultdict(list)
    for c in contacts: groups[(c['organization_id'],root(c['id']))].append(c['id'])
    lead_groups = defaultdict(list)
    for lead in snapshot['leads'] or []:
        if lead['contact_id'] not in parent: continue
        lead_groups[(lead['organization_id'],root(lead['contact_id']),lead['pipeline_id'])].append(lead['id'])
    report = []
    for org in snapshot['organizations']:
        cg = [sorted(ids) for (oid,_),ids in groups.items() if oid == org['id'] and len(ids)>1]
        lg = [sorted(ids) for (oid,_,_),ids in lead_groups.items() if oid == org['id'] and len(ids)>1]
        report.append({**org,'contact_groups':len(cg),'extra_contacts':sum(len(g)-1 for g in cg),'card_groups':len(lg),'extra_cards':sum(len(g)-1 for g in lg), 'contacts':cg,'cards':lg})
    return report

if __name__ == '__main__':
    source, dest = map(Path, sys.argv[1:])
    result = audit(json.loads(source.read_text()))
    dest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    for r in result: print(f"{r['name']}: {r['extra_contacts']} contatos extras / {r['extra_cards']} cards extras ({r['card_groups']} grupos candidatos)")
