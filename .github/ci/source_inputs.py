"""Fail when a critical operation gains an unmapped local source dependency."""
import posixpath,re

def source_edges(tree,group,match):
    queue=[p for p in tree if p.endswith(('.ts','.tsx','.js','.mjs','.vue','.cjs','.py')) and any(match(p,q) for q in group['paths']) and not p.startswith('.github/')]
    seen=set();dependencies=set()
    while queue:
        file=queue.pop()
        if file in seen:continue
        seen.add(file)
        for spec in re.findall(r"(?:from\s*|import\s*\(|require\s*\()['\"]([^'\"\n]+)['\"]",tree[file]['data'].decode(errors='replace')):
            if spec.startswith(('@server/','@client/','@shared/')):target='src/'+spec[1:]
            elif spec.startswith('@/'):
                prefix='apps/web/src/' if file.startswith('apps/web/') else 'frontend/src/' if file.startswith('frontend/') else 'src/client/' if file.startswith('src/client/') else 'src/'
                target=prefix+spec[2:]
            elif spec in group.get('workspace_sources',{}):target=group['workspace_sources'][spec]
            elif spec.startswith('.'):target=posixpath.normpath(posixpath.join(posixpath.dirname(file),spec))
            else:continue
            choices=[target]+([target[:-3]+'.ts'] if target.endswith('.js') else [])+[target+ext for ext in ['.ts','.tsx','.js','.mjs','.vue','/index.ts','/index.js']]
            target=next((p for p in choices if p in tree),None)
            if target and any(match(target,pattern) for pattern in group.get('presentation_dependencies',[])):continue
            if target and not target.endswith(('.css','.svg','.png','.jpg','.woff2')):dependencies.add(target);queue.append(target)
    return dependencies

def audit(tree,config,match):
    for id,g in config['groups'].items():
        for path in source_edges(tree,{**g,'workspace_sources':config.get('workspace_sources',{})},match):
            if not any(match(path,q) for q in g['paths']):raise ValueError(f'Unmapped critical dependency: {path} consumed by {id}')
