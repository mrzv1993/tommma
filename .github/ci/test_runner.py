"""Negative report contracts: an empty/skipped runner must never earn a receipt."""
import importlib.util,json,os,sys,unittest
from pathlib import Path
sp=importlib.util.spec_from_file_location('runner',Path(__file__).with_name('run_check.py'));r=importlib.util.module_from_spec(sp);sp.loader.exec_module(r)
class Reports(unittest.TestCase):
 def execute(self,script,reporter,minimum=1,extra=()):
  r.execute({'argv':[sys.executable,'-c',script,*extra],'reporter':reporter,'min_passed':minimum},{'PATH':os.environ['PATH']})
 def test_vitest_requires_passed_not_pending(self):
  for data in [{'numPassedTests':0,'success':True},{'numPassedTests':1,'numPendingTests':1,'success':True},{'numPassedTests':1,'numFailedTests':1,'success':True}]:
   with self.assertRaises(r.s.PlanError):r.validate_report(data)
  r.validate_report({'numPassedTests':2,'success':True},2)
 def xml(self,value):
  return 'import sys,pathlib; path=next(x.split("=",1)[1] for x in sys.argv if x.startswith("--junitxml="));pathlib.Path(path).write_text('+repr(value)+')'
 def test_pytest_valid_report(self):self.execute(self.xml('<testsuites><testsuite><testcase name="required"/></testsuite></testsuites>'),'pytest')
 def test_pytest_empty_failed_and_skipped_reports(self):
  for value in ['<testsuites/>','<testsuites><testsuite><testcase><skipped/></testcase></testsuite></testsuites>','<testsuites><testsuite><testcase><failure/></testcase></testsuite></testsuites>']:
   with self.assertRaises(r.s.PlanError):self.execute(self.xml(value),'pytest')
 def test_tap_does_not_accept_all_skipped(self):
  with self.assertRaises(r.s.PlanError):self.execute('print("# pass 0\\n# skipped 3")','tap')
  with self.assertRaises(r.s.PlanError):self.execute('print("# pass 1\\n# skipped 1")','tap')
 def test_explicit_pattern_still_requires_all_named_cases(self):
  self.execute('print("# pass 2\\n# skipped 1")','tap',2,['--test-name-pattern=required'])
  with self.assertRaises(r.s.PlanError):self.execute('print("# pass 1\\n# skipped 2")','tap',2,['--test-name-pattern=required'])
if __name__=='__main__':unittest.main()
