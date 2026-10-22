#!/usr/bin/env python3
"""Risk-based local entrypoint. Never discovers a production data source."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
spec=importlib.util.spec_from_file_location('selector',Path(__file__).with_name('select_checks.py'))
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
def main():
    p=argparse.ArgumentParser();p.add_argument('--base');p.add_argument('--plan-only',action='store_true');p.add_argument('--full',action='store_true');p.add_argument('--production',action='store_true');args=p.parse_args()
    base=args.base or s.git('merge-base','origin/main','HEAD').strip()
    if args.production:
        from types import SimpleNamespace
        s.resolve_context(SimpleNamespace(base=None,production=True,mode='affected',output=str(s.ROOT/'.ci-work')),s.load_map())
        base=json.loads((s.ROOT/'.ci-work/context.json').read_text())['base']
    command=['python3',str(s.ROOT/'.github/ci/select_checks.py'),'plan','--base',base,'--target','HEAD' if args.production else 'WORKTREE','--channel','all']
    if args.full:command+=['--mode','full']
    subprocess.run(command,cwd=s.ROOT,check=True)
    if args.plan_only:return
    plan=json.loads((s.ROOT/'.ci-work/plan.json').read_text())
    for id,row in plan['checks'].items():
        if row['state']!='run':continue
        if s.load_map()['groups'][id]['mysql'] and not os.environ.get('CAMPUS_CI_MYSQL_PORT'):
            raise s.PlanError('Selected check needs an owned disposable MySQL. Set CAMPUS_CI_MYSQL_PORT; no database is guessed.')
        subprocess.run(['python3',str(s.ROOT/'.github/ci/run_check.py'),'--plan','.ci-work/plan.json','--check',id,*([] if args.production else ['--working-tree']),'--mysql-port',os.environ.get('CAMPUS_CI_MYSQL_PORT','3306')],cwd=s.ROOT,check=True)
if __name__=='__main__':
    try:main()
    except (s.PlanError,subprocess.CalledProcessError) as error:print(str(error),file=sys.stderr);sys.exit(1)
