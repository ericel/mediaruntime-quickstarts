"""Offline HTTP integration tests: real PHP/cURL, controlled API and M4A fixtures."""
import base64,io,json,os,subprocess,tempfile,threading,time,unittest,zipfile
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
ROOT=Path(__file__).parent
M4A=b'\x00\x00\x00\x18ftypM4A '+b'\0'*48
class AudioTest(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.requests=[];self.mode='success';self.polls=0
  self.id='a'*32;self.directory=self.root/self.id;self.directory.mkdir();(self.directory/'input.wav').write_bytes(b'fixture-input')
  self.job={'id':self.id,'owner':'fixture-owner','name':'fixture.wav','input_bytes':96044,'status':'queued','created_at':int(time.time())}
  self.save(self.job);test=self
  class Handler(BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def send(self,code,data,kind='application/json'):
    self.send_response(code);self.send_header('Content-Type',kind);self.end_headers();self.wfile.write(data)
   def body(self):return self.rfile.read(int(self.headers.get('Content-Length',0)))
   def do_POST(self):
    data=json.loads(self.body());test.requests.append((self.path,dict(self.headers),data))
    if test.mode=='unauthorized':return self.send(401,b'{}')
    result={'upload_url':test.origin+'/storage-upload','upload_headers':{'Authorization':'Bearer fixture-upload-token','Content-Type':'audio/wav'},'file_uri':'gs://fixture/input.wav'} if self.path.endswith('upload-url') else {'job_id':'job_fixture'}
    self.send(200,json.dumps(result).encode())
   def do_PUT(self):
    test.requests.append((self.path,dict(self.headers),self.body()));self.send(200,b'')
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
   z.writestr('output/converted.m4a',b'not-audio' if self.mode=='bad_audio' else M4A)
   if self.mode=='traversal':z.writestr('../outside.txt','bad')
   if self.mode=='ambiguous':z.writestr('another.m4a',M4A)
   if self.mode=='symlink':
    info=zipfile.ZipInfo('link.m4a');info.create_system=3;info.external_attr=(0o120777<<16);z.writestr(info,'/etc/passwd')
  return b.getvalue()
 def run_worker(self,**overrides):
  env=dict(os.environ,MEDIA_ROOT=str(self.root),MEDIARUNTIME_API_KEY='fixture-account-key',MEDIARUNTIME_BASE_URL=self.origin,MEDIARUNTIME_LOCAL_TEST='1');env.update(overrides)
  result=subprocess.run(['php',str(ROOT/'worker.php'),'--once'],env=env,capture_output=True,text=True,timeout=15)
  self.assertEqual(result.returncode,0,result.stderr)
  for secret in ['fixture-account-key','fixture-upload-token','fixture-download-token']:self.assertNotIn(secret,result.stdout+result.stderr)
 def tearDown(self):self.server.shutdown();self.server.server_close();self.temp.cleanup()
 def test_real_curl_workflow_saves_audio_and_keeps_account_key_off_storage(self):
  self.run_worker();self.assertEqual(self.state()['status'],'processing');self.run_worker()
  self.assertEqual(self.state()['status'],'ready');self.assertEqual((self.directory/'audio.m4a').read_bytes(),M4A)
  self.assertEqual(self.state()['audio']['bytes'],len(M4A));self.assertFalse((self.directory/'input.wav').exists());self.assertFalse((self.directory/'bundle.zip').exists())
  submit=next(r for r in self.requests if r[0]=='/v1/jobs');self.assertEqual(submit[2]['outputs'],['audio.web']);self.assertEqual(submit[1]['Idempotency-Key'],'php-audio-'+self.id);self.assertFalse(submit[2]['deliver_webhook'])
  for path,headers,_ in self.requests:self.assertEqual(headers.get('X-API-Key'),'fixture-account-key' if path.startswith('/v1/') else None)
  upload=next(r for r in self.requests if r[0]=='/storage-upload');self.assertEqual(upload[1]['Authorization'],'Bearer fixture-upload-token')
  for path,headers,_ in self.requests:
   if path.startswith('/bundle') or path=='/archive':self.assertNotIn('Authorization',headers)
 def test_saved_job_id_resumes_without_upload_or_submit(self):
  self.job.update(source_uri='gs://fixture/input.wav',job_id='job_existing');self.save(self.job);self.polls=1;self.run_worker()
  self.assertEqual(self.state()['status'],'ready');self.assertTrue(all(r[2] is None for r in self.requests))
 def test_bad_archives_fail_without_publishing_audio(self):
  for mode in ['traversal','ambiguous','symlink','bad_audio']:
   with self.subTest(mode=mode):
    self.mode=mode;self.polls=1;self.save(self.job)
    for _ in range(3):self.run_worker()
    self.assertEqual(self.state()['status'],'failed');self.assertFalse((self.directory/'audio.m4a').exists());self.assertFalse((self.root/'outside.txt').exists())
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
  self.polls=1;self.run_worker();self.requests=[];self.run_worker();self.assertEqual(self.requests,[]);self.assertEqual((self.directory/'audio.m4a').read_bytes(),M4A)

 def test_browser_upload_playback_ranges_and_session_privacy(self):
  import socket,urllib.request,urllib.error,http.cookiejar,re,wave
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
   self.assertEqual(denied.exception.code,403);denied.exception.close()
   b=io.BytesIO()
   with wave.open(b,'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(24000);w.writeframes(b'\0'*48000)
   audio=b.getvalue();boundary='fixtureBoundary'
   fields=(f'--{boundary}\r\nContent-Disposition: form-data; name="csrf"\r\n\r\n{csrf}\r\n--{boundary}\r\nContent-Disposition: form-data; name="audio"; filename="fixture.wav"\r\nContent-Type: audio/wav\r\n\r\n').encode()
   def upload(data):return urllib.request.Request(origin+'upload.php',data=fields+data+f'\r\n--{boundary}--\r\n'.encode(),headers={'Content-Type':'multipart/form-data; boundary='+boundary})
   with self.assertRaises(urllib.error.HTTPError) as denied:client.open(upload(b'not audio'))
   self.assertEqual(denied.exception.code,422);denied.exception.close()
   response=client.open(upload(audio));self.assertEqual(response.status,202);id=json.load(response)['id']
   self.run_worker();self.run_worker()
   status=json.load(client.open(origin+'status.php?id='+id));self.assertEqual(status['status'],'ready');self.assertNotIn('job_id',status);self.assertNotIn('source_uri',status)
   url=origin+status['media_url'];media=client.open(url);self.assertEqual(media.headers['Content-Type'],'audio/mp4');self.assertEqual(media.read(),M4A)
   for header,expected in [('bytes=4-7',M4A[4:8]),('bytes=8-',M4A[8:]),('bytes=-5',M4A[-5:]),('bytes=0-999',M4A)]:
    response=client.open(urllib.request.Request(url,headers={'Range':header}));self.assertEqual(response.status,206);self.assertEqual(response.read(),expected)
   for header in ['bytes=999-','bytes=9-2','bytes=-0','bytes=0-1,5-6','bytes=-','garbage']:
    with self.assertRaises(urllib.error.HTTPError) as denied:client.open(urllib.request.Request(url,headers={'Range':header}))
    self.assertEqual(denied.exception.code,416);denied.exception.close()
   head=client.open(urllib.request.Request(url,method='HEAD'));self.assertEqual(head.read(),b'');self.assertEqual(int(head.headers['Content-Length']),len(M4A))
   downloaded=client.open(url+'&download=1');self.assertIn('attachment',downloaded.headers['Content-Disposition']);self.assertEqual(downloaded.read(),M4A)
   for url in ['status.php?id='+id,'media.php?id='+id,'.env','../app.php']:
    with self.assertRaises(urllib.error.HTTPError) as denied:urllib.request.urlopen(origin+url)
    self.assertEqual(denied.exception.code,404);denied.exception.close()
  finally:server.terminate();server.wait(timeout=5)

if __name__=='__main__':unittest.main(verbosity=2)
