"""Public version evidence without project environment files or credentials."""
import argparse
import json
from pathlib import Path
import re

p=argparse.ArgumentParser();p.add_argument('--product',required=True);p.add_argument('--sha',required=True);p.add_argument('--frontend',required=True);p.add_argument('--marker');a=p.parse_args()
if not re.fullmatch('[0-9a-f]{40}',a.sha): p.error('Exact SHA required')
dest=Path(a.frontend);dest.mkdir(parents=True,exist_ok=True)
(dest/'release.json').write_text(json.dumps({'product':a.product,'releaseSha':a.sha})+'\n')
if a.marker: Path(a.marker).write_text(a.sha+'\n')
