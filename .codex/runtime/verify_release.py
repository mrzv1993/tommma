"""Verify the configured frontend, backend and readiness evidence for one SHA."""
import argparse
import json
import time
import urllib.request
from pathlib import Path

p=argparse.ArgumentParser();p.add_argument('--config',default='.codex/project.json');p.add_argument('--sha',required=True);a=p.parse_args()
c=json.loads(Path(a.config).read_text())['deploy']
if not c.get('frontendVersionUrl') or not c.get('healthUrl'): raise SystemExit('Confirmed production origin and version endpoints are not configured')
def get(url):
    request=urllib.request.Request(url,headers={'Cache-Control':'no-cache'})
    with urllib.request.urlopen(request,timeout=10) as response:
        body=response.read()
        return json.loads(body) if 'application/json' in response.headers.get('Content-Type','') else None
for attempt in range(10):
    try:
        web=get(c['frontendVersionUrl']);assert web[c.get('versionField','releaseSha')]==a.sha, 'Frontend version differs'
        health=get(c['healthUrl'])
        if c.get('backendVersionField'): assert health[c['backendVersionField']]==a.sha, 'Backend version differs'
        if health: assert health.get('ok',True) and health.get('status','ok')=='ok', 'Backend is unhealthy'
        if c.get('readyUrl'):
            ready=get(c['readyUrl']);assert ready.get('ok') and ready[c.get('backendVersionField','releaseSha')]==a.sha, 'Readiness or version differs'
        print('Frontend, backend and configured readiness verified:',a.sha);break
    except (OSError,ValueError,AssertionError,KeyError):
        if attempt==9: raise
        time.sleep(3)
