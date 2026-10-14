"""Offline HTTP integration tests: real PHP/cURL, controlled API and JPEG fixtures."""
import base64,io,json,os,subprocess,tempfile,threading,time,unittest,zipfile
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
ROOT=Path(__file__).parent
JPEG=base64.b64decode('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwClRRRX1555/9k=')
class ThumbnailTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.requests=[];self.mode='success';self.polls=0
  self.id='a'*32;self.directory=self.root/self.id;self.directory.mkdir();(self.directory/'input.mp4').write_bytes(b'fixture-input')
  self.job={'id':self.id,'owner':'fixture-owner','name':'fixture.mp4','time_sec':4,'status':'queued','created_at':int(time.time())}
  self.save(self.job);test=self
  class Handler(BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def send(self,code,data,kind='application/json'):
    self.send_response(code);self.send_header('Content-Type',kind);self.end_headers();self.wfile.write(data)
   def body(self):return self.rfile.read(int(self.headers.get('Content-Length',0)))
   def do_POST(self):
    data=json.loads(self.body());test.requests.append((self.path,dict(self.headers),data))
    if test.mode=='unauthorized':return self.send(401,b'{}')
    result={'upload_url':test.origin+'/storage-upload','upload_headers':{'Authorization':'Bearer fixture-upload-token','Content-Type':'video/mp4'},'file_uri':'gs://fixture/input.mp4'} if self.path.endswith('upload-url') else {'job_id':'job_fixture'}
    self.send(200,json.dumps(result).encode())
   def do_PUT(self):
    test.requests.append((self.path,dict(self.headers),self.body().decode()));self.send(200,b'')
   def do_GET(self):
    test.requests.append((self.path,dict(self.headers),None))
    if self.path.startswith('/v1/jobs/'):
     test.polls+=1;status='PROCESSING' if test.polls==1 else 'COMPLETED'
     if test.mode in ['REJECTED','FAILED','PARTIAL']:status=test.mode
     self.send(200,json.dumps({'status':status,'bundle':{'download_url':test.origin+'/bundle?token=fixture-download-token'}}).encode())
    elif self.path.startswith('/bundle'):
     self.send_response(307);self.send_header('Location',test.origin+'/archive');self.end_headers()
    else:self.send(200,test.bundle(),'application/zip')
  self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler);self.origin='http://127.0.0.1:'+str(self.server.server_port)
  threading.Thread(target=self.server.serve_forever,daemon=True).start()
 def save(self,data):(self.directory/'job.json').write_text(json.dumps(data))
 def state(self):return json.loads((self.directory/'job.json').read_text())
 def bundle(self):
  b=io.BytesIO()
  with zipfile.ZipFile(b,'w') as z:
   z.writestr('output/poster.jpg',b'not-jpeg' if self.mode=='bad_jpeg' else JPEG)
   if self.mode=='traversal':z.writestr('../outside.txt','bad')
   if self.mode=='ambiguous':z.writestr('another.jpg',JPEG)
   if self.mode=='symlink':
    info=zipfile.ZipInfo('link.jpg');info.create_system=3;info.external_attr=(0o120777<<16);z.writestr(info,'/etc/passwd')
  return b.getvalue()
 def run_worker(self,**overrides):
  env=dict(os.environ,MEDIA_ROOT=str(self.root),MEDIARUNTIME_API_KEY='fixture-account-key',MEDIARUNTIME_BASE_URL=self.origin,MEDIARUNTIME_LOCAL_TEST='1');env.update(overrides)
  result=subprocess.run(['php',str(ROOT/'worker.php'),'--once'],env=env,capture_output=True,text=True,timeout=15)
  self.assertEqual(result.returncode,0,result.stderr)
  for secret in ['fixture-account-key','fixture-upload-token','fixture-download-token']:self.assertNotIn(secret,result.stdout+result.stderr)
 def tearDown(self):self.server.shutdown();self.server.server_close();self.temp.cleanup()
 def test_real_curl_workflow_saves_jpeg_and_keeps_account_key_off_storage(self):
  self.run_worker();self.assertEqual(self.state()['status'],'processing');self.run_worker()
  self.assertEqual(self.state()['status'],'ready');self.assertEqual((self.directory/'thumbnail.jpg').read_bytes(),JPEG)
  self.assertEqual(self.state()['image']['width'],8);self.assertFalse((self.directory/'input.mp4').exists());self.assertFalse((self.directory/'bundle.zip').exists())
  submit=next(r for r in self.requests if r[0]=='/v1/jobs');self.assertEqual(submit[2]['outputs'],[{'type':'mp4','preset':'poster_frame_v1','poster_time_sec':4,'poster_format':'jpg'}]);self.assertEqual(submit[1]['Idempotency-Key'],'php-poster-'+self.id)
  for path,headers,_ in self.requests:self.assertEqual(headers.get('X-API-Key'),'fixture-account-key' if path.startswith('/v1/') else None)
  upload=next(r for r in self.requests if r[0]=='/storage-upload');self.assertEqual(upload[1]['Authorization'],'Bearer fixture-upload-token')
  for path,headers,_ in self.requests:
   if path.startswith('/bundle') or path=='/archive':self.assertNotIn('Authorization',headers)
 def test_saved_job_id_resumes_without_upload_or_submit(self):
  self.job.update(source_uri='gs://fixture/input.mp4',job_id='job_existing');self.save(self.job);self.polls=1;self.run_worker()
  self.assertEqual(self.state()['status'],'ready');self.assertTrue(all(r[2] is None for r in self.requests))
 def test_bad_archives_fail_without_publishing_jpeg(self):
  for mode in ['traversal','ambiguous','symlink','bad_jpeg']:
   with self.subTest(mode=mode):
    self.mode=mode;self.polls=1;self.save(self.job)
    for _ in range(3):self.run_worker()
    self.assertEqual(self.state()['status'],'failed');self.assertFalse((self.directory/'thumbnail.jpg').exists());self.assertFalse((self.root/'outside.txt').exists())
 def test_remote_failure_stops_without_bundle_download(self):
  for mode in ['FAILED','REJECTED','PARTIAL']:
   with self.subTest(mode=mode):
    self.mode=mode;self.requests=[];self.save(self.job);self.run_worker();self.assertEqual(self.state()['status'],'failed');self.assertFalse(any(r[0].startswith('/bundle') for r in self.requests))
 def test_missing_key_and_insecure_api_are_not_sent(self):
  for overrides in [{'MEDIARUNTIME_API_KEY':''},{'MEDIARUNTIME_LOCAL_TEST':'0'}]:
   self.save(self.job);self.run_worker(**overrides);self.assertEqual(self.requests,[])
 def test_finished_job_is_unchanged_and_deadline_makes_no_api_request(self):
  self.job['status']='ready';self.save(self.job);self.run_worker();self.assertEqual(self.requests,[])
  self.job.update(status='queued',created_at=int(time.time())-1801);self.save(self.job);self.run_worker();self.assertEqual(self.state()['status'],'failed');self.assertEqual(self.requests,[])
 def test_saved_copy_survives_rerun_without_remote_requests(self):
  self.polls=1;self.run_worker();self.requests=[];self.run_worker();self.assertEqual(self.requests,[]);self.assertEqual((self.directory/'thumbnail.jpg').read_bytes(),JPEG)

 def test_browser_endpoints_validate_csrf_and_keep_saved_images_private(self):
  import socket,urllib.request,urllib.error,http.cookiejar,re
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
  env=dict(os.environ,MEDIA_ROOT=str(self.root),MEDIARUNTIME_API_KEY='fixture-account-key',MEDIARUNTIME_BASE_URL=self.origin,MEDIARUNTIME_LOCAL_TEST='1')
  server=subprocess.Popen(['php','-d','session.save_path='+str(self.root),'-S','127.0.0.1:'+str(port),'-t',str(ROOT/'public')],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  origin='http://127.0.0.1:'+str(port)+'/';client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
  try:
   for _ in range(40):
    try:html=client.open(origin).read().decode();break
    except urllib.error.URLError:time.sleep(.05)
   csrf=re.search(r'name="csrf" value="([a-f0-9]+)"',html)[1]
   with self.assertRaises(urllib.error.HTTPError) as denied:client.open(urllib.request.Request(origin+'upload.php',data=b'csrf=wrong'))
   self.assertEqual(denied.exception.code,403)
   boundary='fixtureBoundary';video=b'\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom'
   fields=(f'--{boundary}\r\nContent-Disposition: form-data; name="csrf"\r\n\r\n{csrf}\r\n--{boundary}\r\nContent-Disposition: form-data; name="time_sec"\r\n\r\n4\r\n--{boundary}\r\nContent-Disposition: form-data; name="video"; filename="fixture.mp4"\r\nContent-Type: video/mp4\r\n\r\n').encode()
   request=urllib.request.Request(origin+'upload.php',data=fields+video+f'\r\n--{boundary}--\r\n'.encode(),headers={'Content-Type':'multipart/form-data; boundary='+boundary})
   response=client.open(request);self.assertEqual(response.status,202);id=json.load(response)['id']
   self.run_worker();self.run_worker()
   status=json.load(client.open(origin+'status.php?id='+id));self.assertEqual(status['status'],'ready');self.assertNotIn('job_id',status);self.assertNotIn('source_uri',status)
   image=client.open(origin+status['image_url']);self.assertEqual(image.headers['Content-Type'],'image/jpeg');self.assertEqual(image.read(),JPEG)
   for url in ['status.php?id='+id,'image.php?id='+id,'.env','../app.php']:
    with self.assertRaises(urllib.error.HTTPError) as denied:urllib.request.urlopen(origin+url)
    self.assertEqual(denied.exception.code,404)
  finally:server.terminate();server.wait(timeout=5)

if __name__=='__main__':unittest.main(verbosity=2)
