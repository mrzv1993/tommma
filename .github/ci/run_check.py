#!/usr/bin/env python3
"""Execute a bound critical profile with no inherited application credentials."""
import argparse,importlib.util,json,os,re,subprocess,sys,time
import xml.etree.ElementTree as ET
from pathlib import Path
spec=importlib.util.spec_from_file_location('selector',Path(__file__).with_name('select_checks.py'));s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)

def validate_report(report,minimum=1):
    if report.get('numPassedTests',0)<minimum or report.get('numFailedTests',0) or report.get('numPendingTests',0) or report.get('numTodoTests',0) or report.get('success') is False:raise s.PlanError('Required Vitest contract empty, skipped or failed')

def execute(command,env):
    argv=command['argv'];cwd=s.ROOT/command.get('cwd','.');reporter=command.get('reporter','process');minimum=command.get('min_passed',1)
    if reporter=='vitest':
        report=s.ROOT/'.ci-work'/('vitest-'+s.digest(argv)+'.json');report.parent.mkdir(parents=True,exist_ok=True);report.unlink(missing_ok=True)
        argv=[*argv,'--reporter=json','--outputFile='+str(report)]
    if reporter=='pytest':
        report=s.ROOT/'.ci-work'/('pytest-'+s.digest(argv)+'.xml');report.parent.mkdir(parents=True,exist_ok=True);report.unlink(missing_ok=True)
        argv=[*argv,'--junitxml='+str(report)]
    proc=subprocess.run(argv,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    print(proc.stdout,end='',flush=True)
    if proc.returncode:raise s.PlanError('Selected command failed: '+str(argv))
    if reporter=='process' and any(re.search(r'(?:test[^/]*\.(?:cjs|mjs|ts)|\.integration\.ts)$',a) for a in argv) and not proc.stdout.strip():raise s.PlanError('Required standalone contract produced no success evidence')
    if reporter=='vitest':
        if not report.exists():raise s.PlanError('Missing required Vitest report')
        validate_report(json.loads(report.read_text()),minimum)
    elif reporter=='pytest':
        if not report.exists():raise s.PlanError('Missing required pytest report')
        root=ET.parse(report).getroot();cases=root.findall('.//testcase')
        if len(cases)<minimum or any(case.find(tag) is not None for case in cases for tag in ['failure','error','skipped']):raise s.PlanError('Required pytest contract empty, skipped or failed')
    elif reporter!='process':
        patterns={'tap':r'^# pass (\d+)','bun':r'(\d+) pass\b','pytest':r'(\d+) passed\b','unittest':r'Ran (\d+) tests?'}
        if reporter=='bun' and re.search(r'\b[1-9][0-9]* skip\b',proc.stdout):raise s.PlanError('Required Bun case skipped')
        counts=re.findall(patterns[reporter],proc.stdout,re.M)
        if not counts or sum(map(int,counts))<minimum:raise s.PlanError('Required profile empty or skipped: '+str(argv))
        if reporter=='tap' and (re.search(r'^# cancelled [1-9]',proc.stdout,re.M) or (not any(a.startswith('--test-name-pattern=') for a in argv) and re.search(r'^# skipped [1-9]',proc.stdout,re.M))):raise s.PlanError('Required TAP case skipped/cancelled')

def main():
    p=argparse.ArgumentParser();p.add_argument('--plan',required=True);p.add_argument('--check',required=True);p.add_argument('--output',default='.ci-work/result/receipt.json');p.add_argument('--working-tree',action='store_true');p.add_argument('--mysql-port');args=p.parse_args()
    config=s.load_map();plan=json.loads(Path(args.plan).read_text());row=plan['checks'][args.check];group=config['groups'][args.check]
    sha=s.git('rev-parse','HEAD').strip();target='WORKTREE' if args.working_tree else sha
    if target!=plan['target'] or row['state']!='run':raise s.PlanError('Plan does not authorize exact source/check')
    tree=s.snapshot(target);projected=s.projections(tree,config)
    if s.fingerprint(args.check,tree,config,projected,plan['conditions'])!=row['fingerprint']:raise s.PlanError('Inputs changed before execution')
    if not args.working_tree and s.git('status','--porcelain','--untracked-files=no').strip():raise s.PlanError('Execution requires clean committed sources')
    observed={'node':s.run(['node','--version']).decode().strip(),'platform':s.run(['node','-p',"process.platform+'-'+process.arch"]).decode().strip(),'toolchain':s.runtime_identity()}
    s.verify_runtime(plan['conditions'],observed)
    if group['runtime'].get('python_dependencies') and s.python_packages()!=plan['conditions'].get('python_packages'):
        raise s.PlanError('Installed Python dependency closure differs from the plan')
    env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','TMPDIR','TEMP','TMP','LANG','LC_ALL','TZ'] or (k.startswith('GITHUB_') and not re.search('TOKEN|SECRET|KEY|PASSWORD',k))}
    env.update(CI='true',NODE_ENV='test',PYTEST_DISABLE_PLUGIN_AUTOLOAD='1');env.update(group.get('env',{}))
    if group.get('fixture'):
        if os.environ.get('CI_FIXTURE_READY')!=group['fixture']:raise s.PlanError('Required isolated database fixture is not ready')
        execute({'argv':['bash','.github/ci/fixture.sh','migrate',group['fixture']]},env)
    executed=[]
    for cmd in group['commands']:execute(cmd,env);executed.append(cmd['argv'])
    if not executed:raise s.PlanError('Required group executed no checks')
    receipt={'version':2,'repository':plan['repository'],'check':args.check,'fingerprint':row['fingerprint'],'source_sha':target,'conditions':row['conditions'],'outcome':'passed','commands':executed,'observed_runtime':observed,'run_id':int(os.environ.get('GITHUB_RUN_ID','0')),'run_attempt':int(os.environ.get('GITHUB_RUN_ATTEMPT','0')),'job_name':'Critical / '+args.check,'timestamp':int(time.time())}
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(s.canonical(receipt)+'\n')
if __name__=='__main__':
    try:main()
    except (s.PlanError,ValueError,KeyError,OSError) as error:print(str(error),file=sys.stderr);sys.exit(1)
