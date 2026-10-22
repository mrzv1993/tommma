#!/usr/bin/env python3
"""Repository critical-check planner. Product code is never executed while planning.

The map is the sole source of paths. Unknown effects and malformed evidence fail
closed. Local fixtures can exercise all phases without GitHub/production access.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
from functools import lru_cache
import io
import json
import os
import platform
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zipfile
sys.path.insert(0,str(Path(__file__).resolve().parent))
from source_inputs import audit as audit_source_inputs
from dependencies import project_dependencies

ROOT = Path(__file__).resolve().parents[2]
MAP = '.github/ci/checks.json'
HEX = re.compile(r'^[0-9a-f]{40}$')
DIGEST = re.compile(r'^[0-9a-f]{64}$')

class PlanError(RuntimeError):
    pass

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)

def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()

def run(argv, cwd=ROOT, **kwargs):
    result = subprocess.run(argv, cwd=cwd, capture_output=True, **kwargs)
    if result.returncode:
        error = result.stderr.decode(errors='replace') if isinstance(result.stderr, bytes) else result.stderr
        raise PlanError(f'Command failed: {argv[0]} {argv[1] if len(argv)>1 else ""}: {error[:1500]}')
    return result.stdout

def git(*args, root=ROOT):
    return run(['git', *args], cwd=root).decode('utf-8')

@lru_cache(maxsize=4096)
def pattern_regex(pattern):
    # Deliberately limited picomatch-compatible glob subset; no negation/braces.
    pieces = []; i = 0
    while i < len(pattern):
        if pattern[i:i+3] == '**/': pieces.append('(?:.*/)?'); i += 3
        elif pattern[i:i+2] == '**': pieces.append('.*'); i += 2
        elif pattern[i] == '*': pieces.append('[^/]*'); i += 1
        else: pieces.append(re.escape(pattern[i])); i += 1
    return re.compile(''.join(pieces))

def matches(path, pattern):
    return pattern_regex(pattern).fullmatch(path) is not None

def any_path(path, patterns):
    return any(matches(path, p) for p in patterns)

def unique_json(pairs):
    result={}
    for key,value in pairs:
        if key in result: raise PlanError('Duplicate JSON configuration key: '+key)
        result[key]=value
    return result

def load_map(root=ROOT):
    try: config = json.loads((root / MAP).read_text(),object_pairs_hook=unique_json)
    except (ValueError, OSError) as error: raise PlanError(f'Invalid check map: {error}') from error
    validate(config, root)
    return config

def validate(config, root=None):
    if config.get('version') != 2 or not config.get('repository') or not isinstance(config.get('groups'), dict) or not config['groups']:
        raise PlanError('Invalid map schema/version/groups')
    if not isinstance(config.get('noncritical'),list) or not isinstance(config.get('global_inputs'),list) or not isinstance(config.get('projections'),dict): raise PlanError('Invalid map input classifications')
    if any(mode not in ['bytes','typescript','tsx-critical','vue-critical','package-critical'] for mode in config['projections'].values()): raise PlanError('Unknown source projection')
    groups = config['groups']
    for id, group in groups.items():
        required={'reason','paths','tests','mysql','commands','consumers','ffmpeg','dictionary','packages','lock','runtime','config'}
        if not required.issubset(group) or set(group)-required-{'secondary_locks','comparison_base','fixture','env','presentation_dependencies'}: raise PlanError('Invalid group schema: '+id)
        if any(not isinstance(group[k],list) for k in ['paths','tests','mysql','commands','consumers','packages','config']): raise PlanError('Invalid group list fields')
        if not isinstance(group['ffmpeg'],bool) or not isinstance(group['dictionary'],bool): raise PlanError('Invalid runtime flags')
        if group['mysql'] or group['ffmpeg'] or group['dictionary']:raise PlanError('Use an explicit repository fixture/runtime adapter; Campus-only adapters are unavailable')
        if not isinstance(group.get('comparison_base',False),bool): raise PlanError('Invalid comparison-base flag')
        if not re.fullmatch(r'[a-z][a-z0-9.-]+', id) or not group.get('reason') or not group.get('paths'):
            raise PlanError(f'Invalid group {id}')
        if not group.get('commands') and not group.get('mysql'): raise PlanError(f'Empty required check {id}')
        for consumer in group.get('consumers', []):
            if consumer not in groups: raise PlanError(f'Unknown consumer {consumer}')
        for pattern in group['paths']:
            if not isinstance(pattern, str) or pattern.startswith(('/', '!')) or '..' in pattern.split('/') or re.search(r'[?\[\]{}\\]', pattern):
                raise PlanError(f'Unsupported path pattern {pattern!r}')
        for command in group.get('commands', []):
            if set(command)-{'argv','cwd','min_passed','reporter'} or not isinstance(command.get('min_passed',1),int) or command.get('min_passed',1)<1: raise PlanError('Invalid required command/report contract')
            args = command.get('argv')
            if not isinstance(args, list) or not args or not all(isinstance(a, str) for a in args): raise PlanError(f'Invalid command in {id}')
            if Path(command.get('cwd','.')).is_absolute() or '..' in Path(command.get('cwd','.')).parts: raise PlanError('Unsafe command working directory')
            if any(a in ['--passWithNoTests', '--if-present', '--workspaces'] for a in args): raise PlanError('Required check can silently skip')
            if args[:3] in [['npm', 'run', 'check'], ['npm', 'run', 'test:frontend'], ['npm', 'run', 'test:ui']]: raise PlanError('Broad/frontend command in required check')
            for arg in args:
                path = Path(command.get('cwd', '.')) / arg
                if root and re.search(r'\.(test\.(ts|mjs)|_test\.py|test_select_checks\.py)$', arg) and not (root / path).is_file():
                    raise PlanError(f'Missing required test {path}')
        for case in group.get('mysql', []):
            if not re.fullmatch(r'(campus|wordroom)_[a-z0-9_]*test_[a-z0-9_]+', case.get('schema', '')): raise PlanError('Unsafe test schema')
            if root and not (root / case['file']).is_file(): raise PlanError(f'Missing MySQL test {case["file"]}')
    active = set(); done = set()
    def visit(id):
        if id in active: raise PlanError(f'Consumer cycle at {id}')
        if id in done: return
        active.add(id)
        for c in groups[id].get('consumers', []): visit(c)
        active.remove(id); done.add(id)
    for id in groups: visit(id)

def snapshot(ref, root=ROOT):
    if ref == 'WORKTREE':
        paths = git('ls-files', '-co', '--exclude-standard', '-z', root=root).split('\0')
        result={}
        for p in set(paths):
            if not p:continue
            file=root/p
            if file.is_symlink():result[p]={'mode':'120000','data':os.readlink(file).encode()}
            elif file.is_file():result[p]={'mode':'100755' if os.access(file,os.X_OK) else '100644','data':file.read_bytes()}
        return result
    sha = git('rev-parse', '--verify', ref + '^{commit}', root=root).strip()
    rows = git('ls-tree', '-rz', sha, root=root).split('\0')
    entries = []
    for row in rows:
        if not row: continue
        info, path = row.split('\t', 1); mode, kind, oid = info.split()
        if kind != 'blob': raise PlanError(f'Unsupported tree entry {path}: {kind}')
        entries.append((path, mode, oid))
    # One batch process: safe even with spaces/newlines in file paths.
    proc = subprocess.run(['git', 'cat-file', '--batch'], input=('\n'.join(oid for _,_,oid in entries)+'\n').encode(), cwd=root, capture_output=True, check=True)
    stream = io.BytesIO(proc.stdout); result = {}
    for path, mode, _ in entries:
        header = stream.readline().decode().split(); size = int(header[2]); data = stream.read(size); stream.read(1)
        result[path] = {'mode': mode, 'data': data}
    return result

def changed_paths(before, after):
    return sorted(p for p in before.keys() | after.keys() if before.get(p) != after.get(p))

def closure(ids, config):
    selected = set(ids)
    while True:
        expanded = selected | {c for id in selected for c in config['groups'][id].get('consumers', [])}
        if expanded == selected: return selected
        selected = expanded

NODE_CACHE = {}
PROJECTION_CACHE = {}
def node(request, root=ROOT):
    key = digest(request)
    if key in NODE_CACHE: return NODE_CACHE[key]
    try:
        value = json.loads(run(['node', str(ROOT / '.github/ci/fingerprint.mjs')], cwd=root, input=canonical(request).encode()))
        NODE_CACHE[key] = value
        return value
    except (ValueError, OSError) as error: raise PlanError(f'Fingerprint failed: {error}') from error

def projections(tree, config, root=ROOT):
    paths = [p for p in sorted(tree) if any(any_path(p,g['paths']) for g in config['groups'].values())]
    if any(tree[p]['mode']=='120000' for p in paths): raise PlanError('Critical inputs cannot be symlinks')
    mixed = [p for p in paths if p in config.get('projections', {})]
    keys={p:(p,config['projections'][p],hashlib.sha256(tree[p]['data']).hexdigest()) for p in mixed}
    missing=[p for p in mixed if keys[p] not in PROJECTION_CACHE]
    values=node({'files':[{'path':p,'text':tree[p]['data'].decode(),'projection':config['projections'][p]} for p in missing]},root) if missing else []
    if len(values)!=len(missing):raise PlanError('Incomplete source projection')
    PROJECTION_CACHE.update((keys[p],v) for p,v in zip(missing,values))
    result = {p: hashlib.sha256(tree[p]['data']).hexdigest() for p in paths}
    result.update((p,PROJECTION_CACHE[keys[p]]) for p in mixed);return result

def python_packages():
    import importlib.metadata
    roots=load_map().get('python_roots',[]);pending=list(roots);found={}
    while pending:
        name=pending.pop();name=re.sub('[-_.]+','-',name).lower()
        if name in found:continue
        try:distribution=importlib.metadata.distribution(name)
        except importlib.metadata.PackageNotFoundError:
            if any(re.sub('[-_.]+','-',r).lower()==name for r in roots):found[name]='unavailable-local'
            continue
        found[name]=distribution.version
        for requirement in distribution.requires or []:
            match=re.match(r'[A-Za-z0-9_.-]+',requirement)
            if match:pending.append(match.group())
    return found

def runtime_identity():
    """Significant toolchain, independent of unrelated runner image rollouts."""
    release=platform.freedesktop_os_release() if sys.platform=='linux' else {}
    bash=run(['bash','--version']).decode().splitlines()[0]
    extra={}
    for tool in load_map().get('runtime_tools',[]):
        extra[tool]=run([tool,'--version']).decode().strip()
    return {'extra':extra,'os':release.get('ID',sys.platform),'os_version':release.get('VERSION_ID',platform.mac_ver()[0]),'python':platform.python_version(),'libc':list(platform.libc_ver()),'bash':bash}

def verify_runtime(planned,observed):
    for key in ['node','platform','toolchain']:
        if observed.get(key)!=planned.get(key):raise PlanError('Significant runtime differs from planned conditions: '+key)

def check_conditions(group, conditions):
    conditions={k:v for k,v in conditions.items() if k!='python_packages' or group['runtime'].get('python_dependencies')}
    return {k:v for k,v in conditions.items() if (k!='mysql_image' or group['mysql'] or group.get('fixture')) and (k!='comparison_base' or group.get('comparison_base')) and (not k.startswith('ffmpeg_') or group['ffmpeg'])}

def fingerprint(id, tree, config, projected, conditions, root=ROOT, environment_only=False):
    group = config['groups'][id]
    conditions = check_conditions(group,conditions)
    entries = [[p,tree[p]['mode'],projected[p]] for p in sorted(projected) if any_path(p,group['paths'])]
    for p in group.get('config', []):
        if p in tree: entries.append([p,tree[p]['mode'],hashlib.sha256(tree[p]['data']).hexdigest()])
    lock_path = group['lock']
    if lock_path not in tree: raise PlanError(f'Missing lock {lock_path}')
    packages = project_dependencies(tree, lock_path, group['packages'], node, root)
    config_entries = [[p,tree[p]['mode'],hashlib.sha256(tree[p]['data']).hexdigest()] for p in group.get('config',[]) if p in tree]
    secondary = [[item['path'],project_dependencies(tree,item['path'],item['packages'],node,root)] for item in group.get('secondary_locks',[])]
    # Script commands are pinned individually; unrelated package metadata/copy is not an input.
    scripts = []
    for command in group.get('commands', []):
        args = command['argv']; cwd = command.get('cwd','.')
        if args[:2] == ['npm','run']:
            manifest = json.loads(tree[('' if cwd == '.' else cwd+'/')+'package.json']['data'])
            value = manifest.get('scripts',{}).get(args[2])
            if not value: raise PlanError(f'Missing script {args[2]}')
            scripts.append([cwd,args[2],value])
    if environment_only: return digest({'packages':packages,'secondary':secondary,'scripts':scripts,'config':config_entries,'runtime':conditions})
    contract = {k:v for k,v in group.items() if k not in ['reason','consumers']}
    contract['fixture_definition']=config.get('fixtures',{}).get(group.get('fixture'))
    executor_packages = [[item['path'],project_dependencies(tree,item['path'],item['packages'],node,root)] for item in config.get('compiler_inputs',[])]
    return digest({'contract':contract,'entries':entries,'packages':packages,'secondary':secondary,'executor_packages':executor_packages,'scripts':scripts,'runtime':conditions,'executor_version':config['executor_version'],'executor_inputs':[[p,hashlib.sha256(tree[p]['data']).hexdigest()] for p in ['.github/ci/fixture.sh','.github/ci/select_checks.py','.github/ci/fingerprint.mjs','.github/ci/run_check.py','.github/ci/source_inputs.py','.github/ci/dependencies.py','.github/ci/profile.py','.github/ci/setup.sh','.github/workflows/critical-checks.yml'] if p in tree]})

def plan(base, target, config, root=ROOT, mode='affected', conditions=None, dorny=None, trees=None, channel='all', trust_scope='production', branch=''):
    conditions = conditions or {'node':'20','platform':'linux-x64','mysql_image':'mysql:8.4','configuration_epoch':'synthetic-v1'}
    conditions = {**conditions,'comparison_base':base}
    before, after = trees if trees is not None else (snapshot(base,root), snapshot(target,root))
    try: audit_source_inputs(after,config,matches)
    except ValueError as error: raise PlanError(str(error)) from error
    paths = changed_paths(before,after)
    old_config = json.loads(before[MAP]['data'],object_pairs_hook=unique_json) if MAP in before else None
    if old_config: validate(old_config)
    projected_before = projections(before,config,root); projected_after = projections(after,config,root)
    raw = {id for id,g in config['groups'].items() if any(any_path(p,g['paths']) for p in paths)}
    if dorny is not None and raw != set(json.loads(dorny)):
        raise PlanError('paths-filter outputs disagree with map/path inventory')
    meaningful = [p for p in paths if p not in config.get('projections',{}) or (before.get(p,{}).get('mode'),projected_before.get(p)) != (after.get(p,{}).get('mode'),projected_after.get(p))]
    seeds = {id for id,g in config['groups'].items() if any(any_path(p,g['paths']) for p in meaningful)}
    unknown = [p for p in meaningful if not any(any_path(p,g['paths']) for g in config['groups'].values()) and not any_path(p,config['noncritical']) and not any_path(p,config['global_inputs'])]
    # Unregistered client write sinks are not covered by the ordinary-UI exemption.
    # This is an uncertainty guard, not a claim of whole-program dataflow analysis.
    client_candidates = [p for p in meaningful if p.startswith(tuple(config.get('client_roots',['src/']))) and p.endswith(('.ts','.vue','.tsx','.js')) and p in after and not any(any_path(p,g['paths']) for g in config['groups'].values())]
    if client_candidates:
        writes = node({'operation':'audit-writes','files':[{'path':p,'text':after[p]['data'].decode()} for p in client_candidates]},root)
        for p, is_write in zip(client_candidates, writes):
            if not is_write: continue
            mode = 'vue-critical' if p.endswith('.vue') else 'tsx-critical' if p.endswith('.tsx') else 'typescript'
            projected = node({'files':[{'path':p,'text':after[p]['data'].decode(),'projection':mode}] + ([{'path':p,'text':before[p]['data'].decode(),'projection':mode}] if p in before else [])},root)
            if len(projected)<2 or projected[0]!=projected[1]: unknown.append(p+' (unclassified client write)')
    if unknown: raise PlanError('Unresolved critical effect; classify paths in map: '+', '.join(unknown[:25]))
    # Changing a group's map or lock/runtime inputs invalidates only that group.
    hashes = {}; old_hashes = {}
    for id in config['groups']:
        hashes[id] = fingerprint(id,after,config,projected_after,conditions,root)
        if any(any_path(p,config['global_inputs']) for p in meaningful):
            try:
                old_environment = fingerprint(id,before,old_config if old_config and id in old_config['groups'] else config,projected_before,conditions,root,environment_only=True)
            except (PlanError,ValueError) as error:
                if not any(text in str(error) for text in ['Missing locked dependency','Unresolved pnpm dependency','Unresolved Bun dependency']): raise
                old_environment={'missing_old_dependency':id}
            new_environment = fingerprint(id,after,config,projected_after,conditions,root,environment_only=True)
            if old_environment != new_environment: seeds.add(id)
        if old_config and id in old_config['groups'] and old_config['groups'][id] != config['groups'][id]: seeds.add(id)
    selected = closure(seeds,config) if mode == 'affected' else set(config['groups'])
    if channel != 'all':raise PlanError('This repository has one release channel')
    return {'version':2,'repository':config['repository'],'base':base,'target':target,'mode':mode,'channel':channel,'trust_scope':trust_scope,'branch':branch,'conditions':conditions,'changed_paths':paths,'meaningful_paths':meaningful,'areas':sorted(raw),'unresolved':[], 'checks':{id:{'state':'run' if id in selected else 'not_required','fingerprint':hashes[id],'reason':config['groups'][id]['reason'] if id in selected else 'No affected critical consumer','conditions':check_conditions(config['groups'][id],conditions),'direct':id in seeds,'selected_by':([p for p in meaningful if any_path(p,config['groups'][id]['paths']) or any_path(p,config['global_inputs'])] if id in seeds else ['dependency:'+seed for seed in sorted(seeds) if id in closure({seed},config)])} for id in config['groups']}}

def summary(plan, path):
    lines = ['## Critical check plan',f'- Base: `{plan["base"]}`',f'- Target: `{plan["target"]}`',f'- Mode: `{plan["mode"]}`',f'- Changed paths: {len(plan["changed_paths"])}','', '| Check | Decision | Reason / producer |','|---|---|---|']
    lines.insert(4,'- Areas: '+', '.join(plan['areas']))
    names=[p.replace('`','').replace('\n',' ') for p in plan['changed_paths'][:200]]
    lines.insert(5,'- Range: `'+plan['base']+'..'+plan['target']+'`')
    lines.insert(6,'- Changed files: '+', '.join('`'+p+'`' for p in names))
    for id,row in plan['checks'].items():
        reason = row.get('producer',{}).get('url') or row['reason']
        if row['state']=='run': reason += '; inputs: '+', '.join(row.get('selected_by',[]))
        reason=reason.replace('|','\\|').replace('\n',' ')
        lines.append(f'| {id} | {row["state"]} | {reason} |')
    Path(path).write_text('\n'.join(lines)+'\n')

class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        result = super().redirect_request(req, fp, code, msg, headers, newurl)
        if result is not None: result.remove_header('Authorization')
        return result

def api(path, token, repository, raw=False):
    if not re.fullmatch(r'[\w.-]+/[\w.-]+',repository): raise PlanError('Invalid repository')
    request = urllib.request.Request('https://api.github.com/repos/'+repository+'/'+path,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'})
    with urllib.request.build_opener(SafeRedirect()).open(request, timeout=30) as response:
        body = response.read(2_000_001)
        if len(body)>2_000_000: raise PlanError('Oversized evidence API response')
        return body if raw else json.loads(body)

def trusted_receipt(receipt, metadata, row, plan):
    if receipt.get('version') != 2 or receipt.get('repository') != plan['repository'] or receipt.get('fingerprint') != row['fingerprint'] or receipt.get('outcome') != 'passed': return False
    if receipt.get('conditions') != row.get('conditions',plan['conditions']) or not HEX.fullmatch(receipt.get('source_sha','')): return False
    if metadata.get('head_repository',{}).get('full_name') != plan['repository']: return False
    production_source=metadata.get('head_branch')=='main' and metadata.get('event') in ['push','workflow_dispatch']
    same_branch_source=plan.get('trust_scope')=='branch' and bool(plan.get('branch')) and metadata.get('head_branch')==plan['branch'] and metadata.get('event') in ['push','pull_request']
    if not (production_source or same_branch_source):return False
    if metadata.get('head_sha') != receipt['source_sha'] or metadata.get('id') != receipt.get('run_id') or metadata.get('run_attempt') != receipt.get('run_attempt'): return False
    allowed=['.github/workflows/deploy.yml','.github/workflows/ci.yml']
    if same_branch_source:allowed.append('.github/workflows/ci.yml')
    if metadata.get('path') not in allowed: return False
    return True

def runtime_reuse_unavailable(id, plan):
    group=load_map()['groups'][id]
    return (bool(group['mysql'] or group.get('fixture')) and '@sha256:' not in plan['conditions'].get('mysql_image','')) or (group['ffmpeg'] and (not plan['conditions'].get('ffmpeg_version') or not DIGEST.fullmatch(plan['conditions'].get('ffmpeg_build',''))))

def reuse(plan, token):
    if not token: return plan
    # A missing/expired/unauthorized lookup is a miss. Corrupt matched artifacts fail.
    for id,row in plan['checks'].items():
        if row['state'] != 'run': continue
        if runtime_reuse_unavailable(id, plan): continue
        name = 'critical-'+id+'-'+row['fingerprint']
        try:
            listing = api('actions/artifacts?per_page=100&name='+name,token,plan['repository'])
        except (urllib.error.URLError,TimeoutError): continue
        for artifact in listing.get('artifacts',[]):
            if artifact.get('expired'): continue
            run_id = artifact.get('workflow_run',{}).get('id')
            meta = api(f'actions/runs/{run_id}',token,plan['repository'])
            same_branch=plan.get('trust_scope')=='branch' and bool(plan.get('branch')) and meta.get('head_branch')==plan['branch'] and meta.get('event') in ['push','pull_request']
            main_source=meta.get('head_branch')=='main' and meta.get('event') in ['push','workflow_dispatch']
            if not (same_branch or main_source): continue
            data = api(f'actions/artifacts/{artifact["id"]}/zip',token,plan['repository'],True)
            if artifact.get('digest') != 'sha256:'+hashlib.sha256(data).hexdigest(): raise PlanError('Evidence archive digest mismatch')
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                infos=archive.infolist()
                if len(infos)!=1 or infos[0].filename!='receipt.json' or infos[0].file_size>100000: raise PlanError('Malformed evidence archive')
                receipt=json.loads(archive.read(infos[0]))
            meta=api(f'actions/runs/{run_id}/attempts/{receipt.get("run_attempt",0)}',token,plan['repository'])
            if receipt.get('job_name')!='Critical / '+id or receipt.get('check')!=id or not trusted_receipt(receipt,meta,row,plan): continue
            jobs = api(f'actions/runs/{run_id}/attempts/{receipt["run_attempt"]}/jobs?per_page=100',token,plan['repository'])
            producer = next((j for j in jobs.get('jobs',[]) if j.get('name','').endswith('Critical / '+id)),None)
            if not producer or producer.get('conclusion')!='success': continue
            row.update(state='reused',producer={'run_id':run_id,'job_id':producer['id'],'artifact_id':artifact['id'],'url':producer['html_url']})
            break
    return plan

def gate(plan, receipts, matrix_result):
    if plan.get('repository')!=load_map()['repository'] or not HEX.fullmatch(plan.get('base','')) or not HEX.fullmatch(plan.get('target','')):raise PlanError('Unbound repository/source range')
    if set(plan.get('checks',{})) != set(load_map()['groups']): raise PlanError('Missing/unknown planned check groups')
    if plan.get('unresolved') or plan.get('version') != 2: raise PlanError('Invalid/unresolved plan')
    required = {id:row for id,row in plan['checks'].items() if row['state']=='run'}
    if set(receipts)-set(required):raise PlanError('Unexpected unplanned result')
    if required and matrix_result != 'success': raise PlanError('Required jobs failed/cancelled/unexpectedly skipped')
    if not required and matrix_result not in ['skipped','success']: raise PlanError('Unexpected matrix failure')
    for id,row in plan['checks'].items():
        if row['state'] == 'run':
            receipt=receipts.get(id,{})
            if receipt.get('version')!=2 or receipt.get('repository')!=plan['repository'] or receipt.get('check')!=id or not receipt.get('commands'):raise PlanError('Unbound/empty check receipt')
            if receipt.get('outcome')!='passed' or receipt.get('fingerprint')!=row['fingerprint'] or receipt.get('source_sha')!=plan['target'] or receipt.get('conditions')!=row.get('conditions',plan['conditions']): raise PlanError('Missing/invalid result: '+id)
        elif row['state']=='reused':
            if not row.get('producer',{}).get('artifact_id'): raise PlanError('Unverified reused result')
        elif row['state']!='not_required': raise PlanError('Unexpected check state')
    return True

def resolve_context(args, config):
    target=git('rev-parse','HEAD').strip(); event_name=os.environ.get('CI_EVENT',os.environ.get('GITHUB_EVENT_NAME',''))
    event=json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text()) if os.environ.get('GITHUB_EVENT_PATH') else {}
    base=args.base
    if args.production:
        # Read only version metadata. No production credentials, content or writes.
        def public(url):
            with urllib.request.urlopen(url, timeout=20) as response: return json.load(response)
        identity=config.get('production_identity')
        if not identity: raise PlanError('This repository has no configured production identity')
        identities=[]
        for item in identity:
            value=public(item['url'])
            for field in item['field'].split('.'): value=value[field]
            identities.append(value)
        base=identities[0]
        if len(set(identities))!=1 or not HEX.fullmatch(base or ''): raise PlanError('Active frontend/backend identity disagrees')
        # Delivery repositories bind the immutable source pin separately; the
        # published delivery commit is identified in their release metadata.
    elif not base and event_name=='pull_request':
        base=git('merge-base',event['pull_request']['base']['sha'],target).strip()
    elif not base and event_name=='push':
        if os.environ.get('GITHUB_REF_NAME')=='main':
            # origin/main already points at this push; use its complete event range.
            base=event.get('before')
        else:
            # Whole unmerged branch, including earlier failed pushes and rewrites.
            base=git('merge-base','origin/main',target).strip()
    if not base or not HEX.fullmatch(base) or base=='0'*40: raise PlanError('Explicit trustworthy base SHA required (no last-commit fallback)')
    try:git('cat-file','-e',base+'^{commit}')
    except PlanError: git('fetch','--no-tags','origin',base)
    git('merge-base','--is-ancestor',base,target)
    # Generated once from the map; dorny gets no independent path rules.
    filters={id:g['paths'] for id,g in config['groups'].items()}
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    (out/'filters.json').write_text(canonical(filters))
    context={'base':base,'target':target,'push_before':event.get('before'),'event':event_name,'mode':args.mode,'production':args.production,'branch':event.get('pull_request',{}).get('head',{}).get('ref',os.environ.get('GITHUB_REF_NAME',''))}
    (out/'context.json').write_text(canonical(context))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'],'a') as f:f.write(f'base={base}\nsha={target}\n')

def main():
    parser=argparse.ArgumentParser(); sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('validate')
    p=sub.add_parser('prepare');p.add_argument('--base');p.add_argument('--production',action='store_true');p.add_argument('--mode',choices=['affected','full'],default='affected');p.add_argument('--output',default='.ci-work')
    p=sub.add_parser('plan');p.add_argument('--base');p.add_argument('--target',default='HEAD');p.add_argument('--context');p.add_argument('--mode',choices=['affected','full'],default='affected');p.add_argument('--dorny');p.add_argument('--reuse',action='store_true');p.add_argument('--channel',choices=['all'],default='all');p.add_argument('--output',default='.ci-work/plan.json')
    p=sub.add_parser('gate');p.add_argument('--plan',required=True);p.add_argument('--receipts',required=True);p.add_argument('--matrix-result',required=True)
    args=parser.parse_args();config=load_map()
    if args.command=='validate':print(f'Valid: {len(config["groups"])} critical groups');return
    if args.command=='prepare':resolve_context(args,config);return
    if args.command=='plan':
        context=json.loads(Path(args.context).read_text()) if args.context else {}
        base=context.get('base',args.base);target=context.get('target',args.target)
        if not base: raise PlanError('A base SHA is required')
        base=git('rev-parse','--verify',base+'^{commit}').strip()
        if target!='WORKTREE':target=git('rev-parse','--verify',target+'^{commit}').strip()
        conditions={'node':run(['node','--version']).decode().strip(),'platform':run(['node','-p',"process.platform+'-'+process.arch"]).decode().strip(),'mysql_image':os.environ.get('CI_MYSQL_IMAGE','unresolved-local'),'toolchain':runtime_identity(),'python_packages':python_packages(),'configuration_epoch':'toolchain-v3','ffmpeg_version':os.environ.get('CI_FFMPEG_VERSION',''),'ffmpeg_build':os.environ.get('CI_FFMPEG_BUILD','')}
        result=plan(base,target,config,mode=context.get('mode',args.mode),conditions=conditions,dorny=args.dorny,channel=args.channel,trust_scope='production' if context.get('production') else 'branch',branch=context.get('branch',''))
        result['observed_runner_image']=os.environ.get('ImageVersion','local-fixture')
        if args.reuse:result=reuse(result,os.environ.get('GH_TOKEN',''))
        path=Path(args.output);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(canonical(result)+'\n');summary(result,path.with_suffix('.md'))
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as f:f.write(path.with_suffix('.md').read_text())
        matrix=[{'check':id,'fingerprint':row['fingerprint'],'mysql':bool(config['groups'][id]['mysql']),'ffmpeg':config['groups'][id]['ffmpeg'],'dictionary':config['groups'][id]['dictionary'],'fixture':config['groups'][id].get('fixture','')} for id,row in result['checks'].items() if row['state']=='run']
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'],'a') as f:f.write('matrix='+canonical({'include':matrix})+'\nhas_checks='+str(bool(matrix)).lower()+'\nsha='+result['target']+'\n')
        print(canonical({'selected':[r['check'] for r in matrix],'reused':[id for id,r in result['checks'].items() if r['state']=='reused']}));return
    if args.command=='gate':
        evidence={}
        for p in Path(args.receipts).rglob('receipt.json'):
            row=json.loads(p.read_text());id=row.get('check')
            if id in evidence:raise PlanError('Duplicate group result')
            evidence[id]=row
        result=json.loads(Path(args.plan).read_text())
        if result.get('target')!=git('rev-parse','HEAD').strip():raise PlanError('Gate checkout differs from plan target')
        gate(result,evidence,args.matrix_result);print('Critical gate passed')

if __name__=='__main__':
    try:main()
    except (PlanError,ValueError,KeyError,OSError) as error:print(str(error),file=sys.stderr);sys.exit(1)
