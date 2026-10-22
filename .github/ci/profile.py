#!/usr/bin/env python3
"""Provision only a named synthetic fixture, from the repository's check map."""
import argparse,importlib.util,json,os,re,subprocess,time
from pathlib import Path
spec=importlib.util.spec_from_file_location('selector',Path(__file__).with_name('select_checks.py'));s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
def call(argv,**kw):return subprocess.run(argv,check=True,**kw)
def main():
 p=argparse.ArgumentParser();p.add_argument('command',choices=['resolve','start']);p.add_argument('fixture',nargs='?');a=p.parse_args();config=s.load_map();definitions=config.get('fixtures',{})
 if a.command=='resolve':
  plan=json.loads((s.ROOT/'.ci-work/preliminary.json').read_text());selected={config['groups'][i].get('fixture') for i,r in plan['checks'].items() if r['state']=='run'}-{'' ,None}
  images={definitions[i]['image'] for i in selected}
  if len(images)>1:raise s.PlanError('This fixture adapter requires one isolated database runtime per plan')
  identity=''
  if images:
   image=next(iter(images));value=s.run(['docker','buildx','imagetools','inspect',image,'--format','{{json .Manifest.Digest}}']).decode().strip().strip('"')
   if not re.fullmatch('sha256:[a-f0-9]{64}',value):raise s.PlanError('Database image digest unavailable')
   identity=image.split(':')[0]+'@'+value
  with open(os.environ['GITHUB_OUTPUT'],'a') as f:f.write('identity='+identity+'\n')
 else:
  d=definitions[a.fixture];image=os.environ['CI_MYSQL_IMAGE']
  if not re.fullmatch(re.escape(d['image'].split(':')[0])+r'@sha256:[a-f0-9]{64}',image):raise s.PlanError('Fixture runtime differs from planned image')
  argv=['docker','run','-d','--name','critical-database']
  for k,v in d['env'].items():argv+=['-e',k+'='+v]
  argv+=['-p','127.0.0.1:'+d['port']+':'+d.get('container_port',d['port']),image];call(argv)
  for _ in range(90):
   if subprocess.run(['docker','exec','critical-database',*d['ready']],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:return
   time.sleep(2)
  raise s.PlanError('Disposable fixture did not become ready')
if __name__=='__main__':main()
