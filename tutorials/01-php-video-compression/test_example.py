"""Offline HTTP integration tests. No real media is processed or credits used."""
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from zipfile import ZipFile

SCRIPT = Path(__file__).with_name('compress.php')

class CompressionExampleTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.output = Path(self.directory.name) / 'result.zip'
        self.requests = []
        self.mode = 'success'
        self.polls = 0
        test = self
        archive = io.BytesIO()
        with ZipFile(archive, 'w') as z:
            z.writestr('FIXTURE.txt', 'Offline test fixture, not processed media.\n')
        self.bundle = archive.getvalue()
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def send(self, code, body, content_type='application/json'):
                self.send_response(code)
                self.send_header('Content-Type', content_type)
                self.end_headers()
                self.wfile.write(body)
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                test.requests.append((self.path, dict(self.headers), body))
                self.send(401 if test.mode == 'unauthorized' else 200,
                          b'{"job_id":"job_fixture_001"}')
            def do_GET(self):
                test.requests.append((self.path, dict(self.headers), None))
                if self.path.startswith('/v1/jobs/'):
                    test.polls += 1
                    if test.mode == 'bad_json': return self.send(200, b'<not-json>')
                    status = 'PROCESSING' if test.polls == 1 else 'COMPLETED'
                    if test.mode in ['FAILED', 'REJECTED', 'PARTIAL']: status = test.mode
                    if test.mode == 'timeout': status = 'PROCESSING'
                    data = {'status': status, 'bundle': {'download_url': test.origin + '/bundle?token=fixture'}}
                    if test.mode == 'missing_bundle': data.pop('bundle')
                    self.send(200, json.dumps(data).encode())
                elif self.path.startswith('/bundle'):
                    self.send_response(302)
                    self.send_header('Location', test.origin + '/signed-download')
                    self.end_headers()
                else:
                    self.send(200, b'not a zip' if test.mode == 'invalid_zip' else test.bundle, 'application/zip')
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.origin = 'http://127.0.0.1:' + str(self.server.server_port)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.directory.cleanup()

    def run_example(self, **overrides):
        env = {k: v for k, v in os.environ.items() if not k.startswith('MEDIARUNTIME_')}
        env.update(MEDIARUNTIME_API_KEY='fixture-secret', MEDIARUNTIME_SOURCE='https://example.com/fixture.mp4',
                   MEDIARUNTIME_IDEMPOTENCY_KEY='tutorial-fixture-001', MEDIARUNTIME_BASE_URL=self.origin,
                   MEDIARUNTIME_LOCAL_TEST='1', MEDIARUNTIME_DOWNLOAD_PATH=str(self.output),
                   MEDIARUNTIME_POLL_SECONDS='1', MEDIARUNTIME_TIMEOUT_SECONDS='5')
        env.update(overrides)
        result = subprocess.run(['php', str(SCRIPT)], env=env, capture_output=True, text=True, timeout=15)
        self.assertNotIn('fixture-secret', result.stdout + result.stderr)
        self.assertNotIn('token=fixture', result.stdout + result.stderr)
        return result

    def test_submit_poll_download_and_keep_key_off_bundle_requests(self):
        r = self.run_example()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.output.read_bytes(), self.bundle)
        self.assertEqual(self.requests[0][2]['outputs'], ['video.web'])
        self.assertEqual(self.requests[0][1]['Idempotency-Key'], 'tutorial-fixture-001')
        for path, headers, _ in self.requests:
            self.assertEqual(headers.get('X-API-Key'), 'fixture-secret' if path.startswith('/v1/') else None)
        self.assertIn('Status: PROCESSING', r.stdout)
        self.assertIn('Status: COMPLETED', r.stdout)

    def test_resume_does_not_submit_again(self):
        r = self.run_example(MEDIARUNTIME_JOB_ID='job_fixture_001', MEDIARUNTIME_SOURCE='', MEDIARUNTIME_IDEMPOTENCY_KEY='')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(all(body is None for _, _, body in self.requests))

    def test_existing_file_is_preserved_without_api_call(self):
        self.output.write_bytes(b'keep this file')
        r = self.run_example()
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(self.output.read_bytes(), b'keep this file')
        self.assertEqual(self.requests, [])

    def test_failure_paths_leave_no_output_or_temporary_download(self):
        for mode in ['FAILED', 'REJECTED', 'PARTIAL', 'unauthorized', 'bad_json', 'missing_bundle', 'invalid_zip', 'timeout']:
            with self.subTest(mode=mode):
                self.mode, self.polls = mode, 0
                r = self.run_example(MEDIARUNTIME_TIMEOUT_SECONDS='2' if mode == 'timeout' else '5')
                self.assertNotEqual(r.returncode, 0)
                self.assertFalse(self.output.exists())
                self.assertEqual(list(Path(self.directory.name).glob('.mr-download-*')), [])

    def test_missing_key_and_insecure_api_url_fail_before_network(self):
        for values in [{'MEDIARUNTIME_API_KEY': ''}, {'MEDIARUNTIME_LOCAL_TEST': '0'}]:
            self.assertNotEqual(self.run_example(**values).returncode, 0)
        self.assertEqual(self.requests, [])

if __name__ == '__main__': unittest.main(verbosity=2)
