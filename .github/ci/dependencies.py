"""Lock-format adapters. Resolve only declared critical dependency closures."""
import json,re,hashlib
PARSED_LOCKS={}
def parsed(text,kind):
    key=(kind,hashlib.sha256(text.encode()).hexdigest())
    if key not in PARSED_LOCKS:
        if kind=='yaml':
            import yaml
            PARSED_LOCKS[key]=yaml.safe_load(text)
        else:PARSED_LOCKS[key]=json.loads(text)
    return PARSED_LOCKS[key]

def project_dependencies(tree,path,roots,node,root):
    if not roots:return []
    if path not in tree:raise ValueError('Missing lock '+path)
    text=tree[path]['data'].decode()
    if path.endswith('package-lock.json'):
        return node({'operation':'dependencies','lock':parsed(text,'json'),'roots':roots},root)
    if path.endswith('pnpm-lock.yaml'):
        lock=parsed(text,'yaml');snapshots=lock.get('snapshots',{});packages=lock.get('packages',{});seen=set()
        def add(name,version=None):
            candidates=[k for k in snapshots if k.startswith(name+'@') and (version is None or k==name+'@'+str(version))]
            if not candidates:raise ValueError('Unresolved pnpm dependency '+name+'@'+str(version))
            for key in candidates:
                if key in seen:continue
                seen.add(key)
                entry=snapshots[key]
                for dep,v in {**entry.get('dependencies',{}),**entry.get('optionalDependencies',{})}.items():
                    if str(v).startswith(('link:','workspace:')):continue # workspace code is an explicit source input
                    add(dep,v)
        for name in roots:add(name)
        return [[k,snapshots[k],packages.get(k.split('(')[0])] for k in sorted(seen)]
    if path.endswith('bun.lock'):
        lock=node({'operation':'parse-jsonc','text':text},root);packages=lock['packages'];seen=set()
        def add(name):
            keys=[k for k in packages if k==name or k.endswith('/'+name)]
            if not keys:raise ValueError('Unresolved Bun dependency '+name)
            for k in keys:
                if k in seen:continue
                seen.add(k);meta=packages[k][2] if len(packages[k])>2 else {}
                for dep in {**meta.get('dependencies',{}),**meta.get('peerDependencies',{}),**meta.get('optionalDependencies',{})}:
                    if meta.get('optionalPeers') and dep in meta['optionalPeers']:continue
                    if dep in meta.get('optionalDependencies',{}) and not any(k==dep or k.endswith('/'+dep) for k in packages):continue
                    add(dep)
        for name in roots:add(name)
        return [[k,packages[k]] for k in sorted(seen)]
    raise ValueError('Unsupported dependency lock '+path)
