"""Portable planner/trust/gate contract; project maps have separate real-path cases."""
import copy,importlib.util,json,io,zipfile,hashlib,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('selector',Path(__file__).with_name('select_checks.py'));s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
class Contract(unittest.TestCase):
    def setUp(self):
        g={'reason':'Critical saved value','paths':['server/save.ts','tests/save.test.ts'],'tests':[],'commands':[{'argv':['node','--test','tests/save.test.ts']}],'mysql':[],'consumers':[],'ffmpeg':False,'dictionary':False,'packages':[],'lock':'package-lock.json','runtime':{},'config':[]}
        self.config={'version':2,'executor_version':2,'repository':'owner/project','groups':{'data.save':g},'noncritical':['src/**','docs/**'],'projections':{},'global_inputs':['package-lock.json'],'client_roots':[]}
        self.tree={p:{'mode':'100644','data':v.encode()} for p,v in {'server/save.ts':'export const amount=1;','tests/save.test.ts':'// fixture','package-lock.json':'{}'}.items()}
        self.conditions={'node':'v22','platform':'linux-x64'}
    def make(self,after=None,**kw):return s.plan('a'*40,'b'*40,self.config,conditions=self.conditions,trees=(self.tree,after or self.tree),**kw)
    def selected(self,p):return [i for i,r in p['checks'].items() if r['state']=='run']
    def change(self,path='server/save.ts'):
        t=copy.deepcopy(self.tree);t[path]={'mode':'100644','data':b'export const amount=2;'};return t
    def test_ui_none(self):self.assertEqual(self.selected(self.make(self.change('src/navigation.ts'))),[])
    def test_critical_selected(self):self.assertEqual(self.selected(self.make(self.change())),['data.save'])
    def test_delete_and_both_rename_sides(self):
        t=copy.deepcopy(self.tree);del t['server/save.ts'];p=self.make(t);self.assertEqual(self.selected(p),['data.save'])
        t['server/unclassified.ts']={'mode':'100644','data':b'export const amount=1;'}
        with self.assertRaises(s.PlanError):self.make(t)
    def test_unknown_blocks(self):
        with self.assertRaises(s.PlanError):self.make(self.change('backend/unknown.ts'))
    def test_dorny_disagreement_blocks(self):
        with self.assertRaises(s.PlanError):self.make(self.change(),dorny='[]')
    def test_empty_commands_invalid(self):
        c=copy.deepcopy(self.config);c['groups']['data.save']['commands']=[]
        with self.assertRaises(s.PlanError):s.validate(c)
    def test_consumer_cycle_invalid(self):
        c=copy.deepcopy(self.config);c['groups']['data.save']['consumers']=['data.save']
        with self.assertRaises(s.PlanError):s.validate(c)
    def test_duplicate_map_key_invalid(self):
        with self.assertRaises(s.PlanError):json.loads('{"a":1,"a":2}',object_pairs_hook=s.unique_json)
    def test_ui_preserves_fingerprint(self):
        critical=self.make(self.change());t=self.change();t['docs/note.md']={'mode':'100644','data':b'new copy'}
        self.assertEqual(critical['checks']['data.save']['fingerprint'],self.make(t)['checks']['data.save']['fingerprint'])
    def test_gate_missing_cancelled_and_empty(self):
        p=self.make(self.change())
        with patch.object(s,'load_map',return_value=self.config):
            for result in ['success','cancelled','skipped','failure']:
                with self.assertRaises(s.PlanError):s.gate(p,{},result)
            self.assertTrue(s.gate(self.make(),{},'skipped'))
    def test_gate_accepts_only_bound_nonempty_receipt(self):
        p=self.make(self.change());row=p['checks']['data.save']
        receipt={'version':2,'repository':p['repository'],'check':'data.save','outcome':'passed','fingerprint':row['fingerprint'],'source_sha':p['target'],'conditions':row['conditions'],'commands':[['node','--test','tests/save.test.ts']]}
        with patch.object(s,'load_map',return_value=self.config):
            self.assertTrue(s.gate(p,{'data.save':receipt},'success'))
            for key,value in [('repository','foreign/project'),('commands',[]),('source_sha','c'*40),('check','wrong.check')]:
                with self.assertRaises(s.PlanError):s.gate(p,{'data.save':{**receipt,key:value}},'success')
    def test_trust_scope(self):
        p=self.make(self.change());row=p['checks']['data.save'];r={'version':2,'repository':p['repository'],'fingerprint':row['fingerprint'],'conditions':row['conditions'],'source_sha':'c'*40,'outcome':'passed','run_id':1,'run_attempt':1}
        meta={'head_repository':{'full_name':p['repository']},'head_branch':'main','event':'push','head_sha':'c'*40,'id':1,'run_attempt':1,'path':'.github/workflows/ci.yml'}
        self.assertTrue(s.trusted_receipt(r,meta,row,p))
        for key,value in [('head_branch','foreign'),('event','pull_request'),('head_sha','d'*40),('run_attempt',2),('path','.github/workflows/foreign.yml')]:
            m={**meta,key:value};self.assertFalse(s.trusted_receipt(r,m,row,p))
    def test_corrupt_archive_and_failed_producer(self):
        p=self.make(self.change());row=p['checks']['data.save'];receipt={'version':2,'repository':p['repository'],'check':'data.save','fingerprint':row['fingerprint'],'conditions':row['conditions'],'source_sha':'c'*40,'outcome':'passed','run_id':1,'run_attempt':1,'job_name':'Critical / data.save'}
        out=io.BytesIO()
        with zipfile.ZipFile(out,'w') as z:z.writestr('receipt.json',json.dumps(receipt))
        raw=out.getvalue()
        producer_status=['cancelled']
        def api(path,token,repo,raw_mode=False):
            if path.startswith('actions/artifacts?'):return {'artifacts':[{'id':2,'workflow_run':{'id':1},'digest':'sha256:'+hashlib.sha256(raw).hexdigest()}]}
            if path.endswith('/zip'):return raw
            if '/jobs?' in path:return {'jobs':[{'name':'Critical / data.save','id':3,'html_url':'https://example.test','conclusion':producer_status[0]}]}
            return {'head_repository':{'full_name':p['repository']},'head_branch':'main','event':'push','head_sha':'c'*40,'id':1,'run_attempt':1,'path':'.github/workflows/ci.yml'}
        with patch.object(s,'api',api),patch.object(s,'load_map',return_value=self.config):
            self.assertEqual(self.selected(s.reuse(p,'fixture')),['data.save'])
            producer_status[0]='success'
            reused=s.reuse(copy.deepcopy(p),'fixture')
            self.assertEqual(reused['checks']['data.save']['state'],'reused')
            self.assertTrue(s.gate(reused,{},'skipped'))
        original=api
        def corrupt(path,*args):
            value=original(path,*args)
            if path.startswith('actions/artifacts?'):value['artifacts'][0]['digest']='sha256:'+'0'*64
            return value
        with patch.object(s,'api',corrupt),patch.object(s,'load_map',return_value=self.config):
            with self.assertRaises(s.PlanError):s.reuse(p,'fixture')
if __name__=='__main__':unittest.main()
