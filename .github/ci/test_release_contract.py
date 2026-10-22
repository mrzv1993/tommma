import unittest
from pathlib import Path
class Release(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.source=(Path(__file__).resolve().parents[2]/'deploy.sh').read_text()
 def test_shared_host_is_serialized(self):
  self.assertIn('/var/lock/moths-production-deploy.lock',self.source);self.assertIn('flock -w 1800 8',self.source)
 def test_local_fixtures_are_excluded(self):
  self.assertIn('--exclude ".ci-work/"',self.source);self.assertIn('--exclude ".env"',self.source);self.assertIn('--exclude "node_modules/"',self.source)
 def test_exact_source_and_health_guards_remain(self):
  self.assertIn('RELEASE_SHA',self.source);self.assertIn('--sha "$5"',self.source);self.assertIn('prisma migrate status',self.source)
  workflow=(Path(__file__).resolve().parents[2]/'.github/workflows/deploy.yml').read_text()
  self.assertIn('verify_release.py --sha',workflow)
if __name__=='__main__':unittest.main()
