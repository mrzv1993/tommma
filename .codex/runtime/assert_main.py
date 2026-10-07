"""Reject a release that no longer corresponds to the current remote main."""
import os
import re
import subprocess
import sys

def sha(*args):
    return subprocess.check_output(['git',*args],text=True).strip()

def main():
    release=os.environ.get('RELEASE_SHA') or os.environ.get('GITHUB_SHA') or sha('rev-parse','HEAD')
    if not re.fullmatch('[0-9a-f]{40}',release): raise RuntimeError('Exact release SHA required')
    if sha('rev-parse','HEAD') != release: raise RuntimeError('Checkout and release SHA differ')
    subprocess.run(['git','fetch','--no-tags','origin','main'],check=True,stdout=subprocess.DEVNULL)
    if sha('rev-parse','FETCH_HEAD') != release:
        raise RuntimeError('This release is stale or outside main. A newer main must be deployed instead.')
    print('Current main verified:',release)

if __name__ == '__main__':
    try: main()
    except RuntimeError as error: print(str(error),file=sys.stderr);sys.exit(1)
