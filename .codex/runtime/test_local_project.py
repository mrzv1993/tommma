import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('local_project', HERE/'local_project.py')
local = importlib.util.module_from_spec(spec); spec.loader.exec_module(local)

class LocalTests(unittest.TestCase):
    def test_production_credentials_and_inherited_node_options_are_excluded(self):
        with patch.dict(os.environ, {'DATABASE_URL':'synthetic-production-url','OPENAI_API_KEY':'synthetic-production-key','NODE_OPTIONS':'synthetic-option'}):
            env=local.clean_env()
            self.assertNotIn('DATABASE_URL',env); self.assertNotIn('OPENAI_API_KEY',env); self.assertNotIn('NODE_OPTIONS',env)

    def test_env_files_cannot_restore_an_omitted_production_key(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder,'.env').write_text('SYNTHETIC_PRIVATE_KEY=should-not-load\n')
            code="const fs=require('node:fs');if(fs.existsSync('.env'))process.exit(1);try{fs.readFileSync('.env');process.exit(2)}catch(e){if(e.code!=='ENOENT')process.exit(3)};fs.promises.readFile('.env').then(()=>process.exit(4),e=>{if(e.code!=='ENOENT')process.exit(5)})"
            subprocess.run(['node','--require',str(HERE/'local-env-guard.cjs'),'-e',code],cwd=folder,check=True,env=local.clean_env())

    def test_mock_network_connections_to_nonloopback_are_rejected_before_connect(self):
        env=local.clean_env();env['CODEX_LOCAL_DATA_MODE']='mocks'
        code="const net=require('node:net');for(const args of [[443,'203.0.113.1'],[{host:'outside.example',port:443}]]){let blocked=false;try{new net.Socket().connect(...args)}catch(e){blocked=true}if(!blocked)process.exit(1)}"
        subprocess.run(['node','--require',str(HERE/'local-env-guard.cjs'),'-e',code],env=env,check=True)

    def test_another_checkouts_local_data_cannot_be_reused(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);data=root/'.codex-local';data.mkdir();(data/'owner.json').write_text(json.dumps({'root':'/another/folder','project':'test'}))
            with self.assertRaisesRegex(RuntimeError,'another checkout'): local.Runtime(root,'mocks',{'project':'test'})

class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.requests=[]
        requests=self.requests
        class Upstream(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                requests.append({key.lower():value for key,value in self.headers.items()})
                valid=self.headers.get('Origin') == 'http://'+self.headers.get('Host','')
                self.send_response(200 if valid else 403);self.end_headers();self.wfile.write(b'ok')
            def do_GET(self):
                requests.append({key.lower():value for key,value in self.headers.items()});self.send_response(200)
                if self.path.startswith('/api'):
                    self.send_header('Content-Type','application/json');self.send_header('Set-Cookie','__Host-test=fake; Secure; HttpOnly; Path=/');self.end_headers();self.wfile.write(b'{"ok":true}')
                else:self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(b'<html><body>Test frontend</body></html>')
        self.upstream=ThreadingHTTPServer(('127.0.0.1',0),Upstream)
        threading.Thread(target=self.upstream.serve_forever,daemon=True).start();self.addCleanup(self.upstream.server_close);self.addCleanup(self.upstream.shutdown)
        self.port=local.free_port();self.origin=f'http://127.0.0.1:{self.port}'
        settings=Path(self.temp.name,'gateway.json');settings.write_text(json.dumps({'root':self.temp.name,'mode':'prod','url':self.origin,'web':f'http://127.0.0.1:{self.upstream.server_port}','api':f'http://localhost:{self.upstream.server_port}'}))
        self.process=subprocess.Popen(['node',str(HERE/'local-gateway.mjs'),str(settings)],env=local.clean_env(),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        self.addCleanup(self.cleanup)
        for _ in range(60):
            try:urllib.request.urlopen(self.origin+'/__codex/status',timeout=.2).close();break
            except OSError:time.sleep(.05)
        else:raise RuntimeError('Gateway did not start')

    def cleanup(self):
        self.process.terminate()
        try:self.process.wait(timeout=2)
        except subprocess.TimeoutExpired:self.process.kill();self.process.wait()
        self.process.stderr.close()

    def test_cookie_and_account_identity_are_preserved_and_origin_is_rewritten(self):
        req=urllib.request.Request(self.origin+'/api/test',headers={'Origin':self.origin,'Cookie':'__Host-test=fake'})
        with urllib.request.urlopen(req) as response:
            self.assertIn('Secure',response.headers['Set-Cookie']);self.assertIn('HttpOnly',response.headers['Set-Cookie'])
        self.assertEqual(self.requests[-1]['cookie'],'__Host-test=fake')
        self.assertEqual(self.requests[-1]['origin'],f'http://localhost:{self.upstream.server_port}')

    def test_foreign_origin_never_reaches_the_api(self):
        before=len(self.requests)
        req=urllib.request.Request(self.origin+'/api/test',headers={'Origin':'https://outside.example'})
        with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(req)
        self.assertEqual(error.exception.code,403);self.assertEqual(len(self.requests),before)

    def test_foreign_websocket_origin_is_rejected(self):
        with socket.create_connection(('127.0.0.1',self.port)) as sock:
            sock.sendall(f'GET /api/ws HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\nOrigin: https://outside.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'.encode())
            self.assertIn(b'403 Forbidden',sock.recv(1024))

    def test_mode_label_is_local_frontend_only(self):
        with urllib.request.urlopen(self.origin+'/') as response:self.assertIn('Прод: реальные данные',response.read().decode())
        with urllib.request.urlopen(self.origin+'/api/test') as response:self.assertEqual(json.load(response),{'ok':True})

    def test_local_web_post_preserves_host_for_native_csrf_validation(self):
        req=urllib.request.Request(self.origin+'/form',data=b'test',headers={'Origin':self.origin})
        with urllib.request.urlopen(req) as response:self.assertEqual(response.status,200)
        self.assertEqual(self.requests[-1]['host'],self.origin.removeprefix('http://'))

    def test_double_slash_path_does_not_change_the_configured_upstream(self):
        with socket.create_connection(('127.0.0.1',self.port)) as sock:
            sock.sendall(f'GET //outside.example/api HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\nConnection: close\r\n\r\n'.encode())
            self.assertIn(b'200 OK',sock.recv(1024))
        self.assertEqual(self.requests[-1]['host'],self.origin.removeprefix('http://'))

if __name__=='__main__':unittest.main()
