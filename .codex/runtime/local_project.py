#!/usr/bin/env python3
"""Owned local processes and synthetic databases; project-specific commands stay in JSON."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = Path(__file__).resolve().parent

def clean_env():
    return {key: value for key, value in os.environ.items() if key in ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'TERM']}

def free_port(preferred=0):
    with socket.socket() as sock:
        try: sock.bind(('127.0.0.1', preferred))
        except OSError: sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

def run(command, cwd, env, **kwargs):
    return subprocess.run(command, cwd=cwd, env=env, check=True, **kwargs)

def get_status(root):
    path = root / '.codex-local/runtime.json'
    if not path.exists(): return None
    data = json.loads(path.read_text())
    if data['root'] != str(root): raise RuntimeError('Runtime owner does not match the selected folder')
    req = urllib.request.Request('http://127.0.0.1:' + str(data['controlPort']) + '/status', headers={'Authorization': 'Bearer ' + data['token']})
    try:
        with urllib.request.urlopen(req, timeout=2) as response: return json.load(response)
    except OSError: return None

def stop(root):
    data = get_status(root)
    if not data: return
    raw = json.loads((root / '.codex-local/runtime.json').read_text())
    req = urllib.request.Request('http://127.0.0.1:' + str(raw['controlPort']) + '/stop', data=b'', headers={'Authorization': 'Bearer ' + raw['token']})
    urllib.request.urlopen(req, timeout=3).close()
    for _ in range(300):
        if get_status(root) is None: return
        time.sleep(.1)
    raise RuntimeError('Owned runtime did not stop; no unrelated process will be killed')

class Runtime:
    def __init__(self, root, mode, config):
        self.root, self.mode, self.config = root, mode, config
        self.data = root / '.codex-local'
        self.data.mkdir(mode=0o700, exist_ok=True)
        self.owner = {'root': str(root), 'project': config['project']}
        marker = self.data / 'owner.json'
        if marker.exists() and json.loads(marker.read_text()) != self.owner: raise RuntimeError('Local data belongs to another checkout')
        self.lock = (self.data/'runtime.lock').open('a')
        try: fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.lock.close()
            raise RuntimeError('This checkout already owns a running or starting runtime')
        marker.write_text(json.dumps(self.owner)); marker.chmod(0o600)
        saved = self.data / 'ports.json'
        ports = json.loads(saved.read_text()) if saved.exists() else {}
        keys = ['webPort', 'apiPort', 'dbPort', 'gatewayPort'] + config['local'].get('extraPorts', [])
        self.values = {key: str(free_port(ports.get(key, 0))) for key in keys}
        for key in self.values:
            while list(self.values.values()).count(self.values[key]) > 1: self.values[key] = str(free_port())
        saved.write_text(json.dumps({k: int(v) for k, v in self.values.items()}))
        host = 'localhost' if mode == 'mocks' else '127.0.0.1'
        self.values.update({'root': str(root), 'data': str(self.data), 'url': f"http://{host}:{self.values['gatewayPort']}", 'webUrl': f"http://127.0.0.1:{self.values['webPort']}", 'apiUrl': f"http://127.0.0.1:{self.values['apiPort']}", 'dbName': 'codex_' + config['project'].replace('-', '_') + '_dev'})
        secret_file = self.data / 'local-secret'
        if not secret_file.exists(): secret_file.write_text(secrets.token_hex(32)); secret_file.chmod(0o600)
        self.values['localSecret'] = secret_file.read_text()
        self.env = clean_env()
        self.children, self.finished = [], threading.Event()
        self.shutdown_lock = threading.Lock()
        self.env.update({'NODE_ENV': 'development', 'CODEX_LOCAL_DATA_MODE': mode, 'CODEX_LOCAL_OUTBOX': str(self.data / 'outbox.jsonl'), 'NODE_OPTIONS': '--require=' + json.dumps(str(HERE / 'local-env-guard.cjs')), 'HOST': '127.0.0.1'})

    def expand(self, value):
        for key, val in self.values.items(): value = value.replace('{' + key + '}', val)
        return value

    def command(self, spec, wait=False):
        if isinstance(spec, list): spec = {'argv': spec}
        cwd = self.root / self.expand(spec.get('cwd', '.'))
        cwd.mkdir(parents=True, exist_ok=True)
        env = {**self.env, **{k: self.expand(v) for k, v in spec.get('env', {}).items()}}
        command = [self.expand(arg) for arg in spec['argv']]
        if wait: run(command, cwd, env)
        else:
            child = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True)
            self.children.append(child)
            return child

    def database(self):
        engine = self.config['local'].get('database')
        if not engine: return
        env = clean_env(); env['PGPASSWORD'] = self.values['localSecret']
        pg = Path('/opt/homebrew/opt/postgresql@16/bin')
        pg = pg if pg.exists() else Path(shutil.which('postgres') or '').parent
        mysql = Path(shutil.which('mysqld') or '/opt/homebrew/opt/mysql/bin/mysqld').parent
        data = self.data / engine
        if engine == 'postgres':
            if not (pg / 'initdb').exists(): raise RuntimeError('Install PostgreSQL 16 before mock launch')
            pw = self.data / 'pg-password'; pw.write_text(self.values['localSecret']); pw.chmod(0o600)
            if not (data / 'PG_VERSION').exists(): run([str(pg/'initdb'), '-D', str(data), '-U', 'codex_mock', '--auth-local=trust', '--auth-host=scram-sha-256', '--pwfile='+str(pw), '--encoding=UTF8', '--no-locale'], self.root, env, stdout=subprocess.DEVNULL)
            sock = Path('/tmp') / ('codex-local-' + hashlib.sha256(str(self.root).encode()).hexdigest()[:12]); sock.mkdir(mode=0o700, exist_ok=True)
            child = subprocess.Popen([str(pg/'postgres'), '-D', str(data), '-h', '127.0.0.1', '-p', self.values['dbPort'], '-k', str(sock)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True); self.children.append(child)
            for _ in range(100):
                p = subprocess.run([str(pg/'pg_isready'), '-h', '127.0.0.1', '-p', self.values['dbPort']], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if p.returncode == 0: break
                if child.poll() is not None: raise RuntimeError('Owned PostgreSQL failed to start')
                time.sleep(.1)
            else: raise RuntimeError('Owned PostgreSQL did not become ready')
            args = [str(pg/'psql'), '-h', '127.0.0.1', '-p', self.values['dbPort'], '-U', 'codex_mock', '-d', 'postgres', '-tAc']
            exists = subprocess.check_output(args + ["SELECT 1 FROM pg_database WHERE datname='"+self.values['dbName']+"'"], env=env, text=True).strip()
            if not exists: run(args + ['CREATE DATABASE '+self.values['dbName']], self.root, env, stdout=subprocess.DEVNULL)
            self.values['databaseUrl'] = f"postgresql://codex_mock:{self.values['localSecret']}@127.0.0.1:{self.values['dbPort']}/{self.values['dbName']}"
            self.values['databaseUrlPython'] = self.values['databaseUrl'].replace('postgresql://', 'postgresql+psycopg://', 1)
        elif engine == 'mysql':
            if not (mysql/'mysqld').exists(): raise RuntimeError('Install MySQL before mock launch')
            if not data.exists(): run([str(mysql/'mysqld'), '--no-defaults', '--initialize-insecure', '--datadir='+str(data)], self.root, env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            sock_dir = Path('/tmp') / ('codex-mysql-' + hashlib.sha256(str(self.root).encode()).hexdigest()[:12])
            sock_dir.mkdir(mode=0o700, exist_ok=True)
            sock = sock_dir/'mysql.sock'
            child = subprocess.Popen([str(mysql/'mysqld'), '--no-defaults', '--datadir='+str(data), '--socket='+str(sock), '--pid-file='+str(self.data/'mysql.pid'), '--bind-address=127.0.0.1', '--port='+self.values['dbPort'], '--mysqlx=OFF'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True); self.children.append(child)
            for _ in range(150):
                p = subprocess.run([str(mysql/'mysqladmin'), '--no-defaults', '--socket='+str(sock), '-uroot', 'ping'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if p.returncode == 0: break
                if child.poll() is not None: raise RuntimeError('Owned MySQL failed to start')
                time.sleep(.1)
            else: raise RuntimeError('Owned MySQL did not become ready')
            run([str(mysql/'mysql'), '--no-defaults', '--socket='+str(sock), '-uroot', '-e', f"CREATE DATABASE IF NOT EXISTS {self.values['dbName']}; CREATE USER IF NOT EXISTS 'codex_mock'@'localhost' IDENTIFIED BY '{self.values['localSecret']}'; GRANT ALL ON {self.values['dbName']}.* TO 'codex_mock'@'localhost';"], self.root, env, stdout=subprocess.DEVNULL)
            self.values['databaseUrl'] = f"mysql://codex_mock:{self.values['localSecret']}@127.0.0.1:{self.values['dbPort']}/{self.values['dbName']}"
            for label in self.config['local'].get('extraDatabases', []):
                if not label.isalpha(): raise RuntimeError('Invalid owned local database label')
                name = self.values['dbName'].replace('_dev', '_'+label+'_dev')
                run([str(mysql/'mysql'), '--no-defaults', '--socket='+str(sock), '-uroot', '-e', f"CREATE DATABASE IF NOT EXISTS {name}; GRANT ALL ON {name}.* TO 'codex_mock'@'localhost';"], self.root, env, stdout=subprocess.DEVNULL)
                self.values[label+'DatabaseUrl'] = f"mysql://codex_mock:{self.values['localSecret']}@127.0.0.1:{self.values['dbPort']}/{name}"
        else: raise RuntimeError('Unsupported local database adapter')

    def shutdown(self):
        with self.shutdown_lock:
            if self.finished.is_set(): return
            for child in reversed(self.children):
                if child.poll() is None:
                    try: os.killpg(child.pid, signal.SIGTERM)
                    except ProcessLookupError: pass
            for child in reversed(self.children):
                try: child.wait(timeout=8)
                except subprocess.TimeoutExpired: os.killpg(child.pid, signal.SIGKILL); child.wait()
            (self.data/'runtime.json').unlink(missing_ok=True)
            self.lock.close()
            self.finished.set()

    def bootstrap_sql_mode(self, value=None):
        # The old CRM bootstrap contains a data backfill incompatible with
        # ONLY_FULL_GROUP_BY. Adjust only this owned test server while replaying
        # its historical migrations, and restore strict mode before app startup.
        sock = '/tmp/codex-mysql-' + hashlib.sha256(str(self.root).encode()).hexdigest()[:12] + '/mysql.sock'
        args = [shutil.which('mysql'), '--no-defaults', '--socket='+sock, '-uroot', '-NBe']
        if value is None: return subprocess.check_output(args+['SELECT @@GLOBAL.sql_mode'],env=clean_env(),text=True).strip()
        if any(char not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_,' for char in value): raise RuntimeError('Invalid owned bootstrap SQL mode')
        run(args+["SET GLOBAL sql_mode='"+value+"'"],self.root,clean_env(),stdout=subprocess.DEVNULL)

    def start(self):
        for spec in self.config['local'].get('prepare', []): self.command(spec, wait=True)
        if self.mode == 'mocks': self.database()
        profile = self.config['local'][self.mode]
        self.env.update({k: self.expand(v) for k, v in profile.get('env', {}).items()})
        if self.mode == 'mocks':
            bootstrap = self.config['local'].get('mysqlBootstrapSqlMode')
            previous = self.bootstrap_sql_mode() if bootstrap else None
            try:
                if bootstrap: self.bootstrap_sql_mode(bootstrap)
                for spec in profile.get('migrate', []): self.command(spec, wait=True)
            finally:
                if previous is not None: self.bootstrap_sql_mode(previous)
            stamp = self.data/'seeded'
            if not stamp.exists():
                for spec in profile.get('seed', []): self.command(spec, wait=True)
                stamp.write_text('Synthetic fixtures only\n')
            for spec in profile.get('services', []): self.command(spec)
        self.command(profile.get('web', self.config['local']['web']))
        gateway = {'root': str(self.root), 'mode': self.mode, 'url': self.values['url'], 'web': self.values['webUrl'], 'api': self.expand(profile.get('api', '{webUrl}')), 'apiStripPrefix': profile.get('stripApiPrefix', False), 'apiPrefixes': self.config['local'].get('apiPrefixes', ['/api']), 'label': profile.get('dataLabel')}
        settings = self.data/'gateway.json'; settings.write_text(json.dumps(gateway)); settings.chmod(0o600)
        self.children.append(subprocess.Popen(['node', str(HERE/'local-gateway.mjs'), str(settings)], env=clean_env(), start_new_session=True))
        token = secrets.token_hex(32)
        runtime = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                if self.headers.get('Authorization') != 'Bearer '+token: self.send_error(403); return
                branch = subprocess.check_output(['git', '-C', str(runtime.root), 'branch', '--show-current'], text=True).strip()
                sha = subprocess.check_output(['git', '-C', str(runtime.root), 'rev-parse', 'HEAD'], text=True).strip()
                dirty = bool(subprocess.check_output(['git', '-C', str(runtime.root), 'status', '--porcelain'], text=True).strip())
                status = {'running': True, 'root': str(runtime.root), 'mode': runtime.mode, 'url': runtime.values['url'], 'branch': branch, 'commit': sha, 'dirty': dirty, 'dataOrigin': 'owned-local-'+str(runtime.config['local'].get('database') or 'files') if runtime.mode=='mocks' else gateway['api']}
                self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(json.dumps(status).encode())
            def do_POST(self):
                if self.path!='/stop' or self.headers.get('Authorization') != 'Bearer '+token: self.send_error(403); return
                self.send_response(200); self.end_headers(); threading.Thread(target=runtime.shutdown, daemon=True).start()
        controller = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=controller.serve_forever, daemon=True).start()
        record = self.data/'runtime.json'; record.write_text(json.dumps({'root': str(self.root), 'controlPort': controller.server_port, 'token': token})); record.chmod(0o600)
        for sig in [signal.SIGINT, signal.SIGTERM]: signal.signal(sig, lambda *args: self.shutdown())
        print(json.dumps({'url': self.values['url'], 'mode': self.mode, 'root': str(self.root)}, ensure_ascii=False), flush=True)
        try:
            while not self.finished.wait(.3):
                if any(child.poll() is not None for child in self.children): raise RuntimeError('An owned process stopped unexpectedly; check its error above')
        finally: self.shutdown(); controller.shutdown(); controller.server_close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('command', choices=['mocks', 'prod', 'status', 'stop']); parser.add_argument('--project', required=True); args = parser.parse_args()
    root = Path(args.project).resolve()
    if args.command == 'status': print(json.dumps(get_status(root) or {'running': False, 'root': str(root)}, ensure_ascii=False, indent=2))
    elif args.command == 'stop': stop(root)
    else:
        config = json.loads((root/'.codex/project.json').read_text())
        profile = config['local'][args.command]
        if profile.get('blockedReason'): raise SystemExit(profile['blockedReason'])
        stop(root)
        runtime = Runtime(root, args.command, config)
        try: runtime.start()
        finally: runtime.shutdown()
