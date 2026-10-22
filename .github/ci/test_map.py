"""Real project-map scenarios; never runs product code or accesses a database."""
import importlib.util,json,copy,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('selector',Path(__file__).with_name('select_checks.py'));s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
class MapContract(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.config=s.load_map();cls.tree=s.snapshot('WORKTREE');cls.conditions={'node':'synthetic-v1','platform':'fixture','mysql_image':'mysql@sha256:'+'1'*64}
 def make(self,after,**kw):return s.plan('a'*40,'b'*40,self.config,trees=(self.tree,after),conditions=self.conditions,**kw)
 def selected(self,p):return {i for i,r in p['checks'].items() if r['state']=='run'}
 def change(self,path,tree=None):
  t=(tree or self.tree).copy();value=t[path];suffix=b'\nexport const selectiveInputProbe=1;\n' if path.endswith(('.ts','.js','.mjs','.cjs','.tsx')) else b'\n# critical input probe\n'
  t[path]={**value,'data':value['data']+suffix};return t
 def test_01_copy_css_none(self):
  for path in ['docs/selective-probe.css','.github/ci/README.md']:
   t=self.tree.copy();t[path]={'mode':'100644','data':b'Cosmetic documentation update'};self.assertEqual(self.selected(self.make(t)),set())
 def test_02_ordinary_ui_none(self):
  t=self.tree.copy();roots=self.config.get('client_roots',[])
  path=(roots[0]+'selective-navigation-probe.ts') if roots else 'docs/selective-navigation-probe.md'
  t[path]={'mode':'100644','data':b'export const panelExpanded=true;'};self.assertEqual(self.selected(self.make(t)),set())
 def test_03_actual_operation_selects_its_profile(self):
  for id,g in self.config['groups'].items():
   if id=='ci.mechanism':continue
   candidates=[p for p in g['paths'] if p in self.tree and p.endswith(('.ts','.py','.mjs','.cjs','.json','.sql')) and not p.startswith('.github/')]
   if not candidates:continue
   p=self.make(self.change(candidates[0]));self.assertIn(id,self.selected(p),id)
 def test_04_payment_style_projection(self):
  for path,mode in self.config['projections'].items():
   if mode!='vue-critical' or path not in self.tree:continue
   t=self.tree.copy();t[path]={**t[path],'data':t[path]['data']+b'\n<style>.selectiveProbe{padding:3px;color:blue}</style>\n'}
   self.assertEqual(self.selected(self.make(t)),set(),path)
 def test_05_unclassified_destructive_client_write_blocks(self):
  roots=self.config.get('client_roots',[])
  if not roots:return
  t=self.tree.copy();t[roots[0]+'selective-destructive-probe.ts']={'mode':'100644','data':b'fetch("/api/records",{method:"DELETE"});'}
  with self.assertRaises(s.PlanError):self.make(t)
 def test_06_unknown_server_blocks(self):
  t=self.tree.copy();t['backend/selective-unclassified.py']={'mode':'100644','data':b'delete_all_records()'}
  with self.assertRaises(s.PlanError):self.make(t)
 def test_07_delete_critical_input_selects(self):
  id,g=next((i,g) for i,g in self.config['groups'].items() if i!='ci.mechanism')
  path=next(p for p in g['paths'] if p in self.tree and not p.startswith('.github/'))
  t=self.tree.copy();del t[path]
  # Removing an import can legitimately require map dependency review; never green-skip.
  try:p=self.make(t)
  except s.PlanError:return
  self.assertIn(id,self.selected(p))
 def test_08_dorny_cannot_omit_selected_area(self):
  t=self.change('.github/ci/select_checks.py')
  with self.assertRaises(s.PlanError):self.make(t,dorny='[]')
 def test_09_manual_full_is_explicit_critical_only(self):
  p=self.make(self.tree,mode='full');self.assertEqual(self.selected(p),set(self.config['groups']))
  for g in self.config['groups'].values():
   for cmd in g['commands']:
    self.assertFalse(any(x in cmd['argv'] for x in ['test:frontend','test:unit','--passWithNoTests','--workspaces']))
 def test_10_cosmetics_preserve_successful_inputs(self):
  t=self.tree.copy();t['docs/selective-copy-probe.md']={'mode':'100644','data':b'Button copy'};a=self.make(self.tree);b=self.make(t)
  self.assertEqual({i:r['fingerprint'] for i,r in a['checks'].items()},{i:r['fingerprint'] for i,r in b['checks'].items()})
if __name__=='__main__':unittest.main()
