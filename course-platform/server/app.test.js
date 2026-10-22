import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app.js';
import { WechatAuthError } from './wechat.js';

async function fixture(t, env={},options={}) {
  const dir=mkdtempSync(join(tmpdir(),'zhike-test-'));
  const settings={databasePath:join(dir,'courses.sqlite'),uploadsDir:join(dir,'uploads'),quiet:true,seedDemoContent:env.NODE_ENV!=='production',...options,env:{NODE_ENV:'test',DEMO_MODE:'true',...env}};
  const instance=createApp(settings);
  const server=instance.app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));instance.close();rmSync(dir,{recursive:true,force:true});});
  async function request(path,{token,method='GET',body}={}) {
    const headers={};if(token) headers.Authorization=`Bearer ${token}`;
    if(body && !(body instanceof FormData)) headers['Content-Type']='application/json';
    const response=await fetch(`${base}/api${path}`,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
    const contentType=response.headers.get('content-type')||'';
    return {status:response.status,data:contentType.includes('application/json')?await response.json():await response.text(),headers:response.headers};
  }
  return {...instance,base,request,settings,dir};
}

function insertCourse(db,id='course-math') {
  db.prepare('INSERT INTO courses(id,title,subtitle,subject,grade,type,price,originalPrice,teacher,teacherRole,teacherColor,description,coverTheme,tags,status,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,'测试课程','测试课程副标题','数学','高二','系统课',299,399,'测试老师','主讲老师','#6793ef','课程说明','blue','[]','published',new Date().toISOString());
}

test('web routes work under a dot-prefixed parent without exposing private files',async t=>{
  const parent=mkdtempSync(join(tmpdir(),'.zhike-web-'));
  const webDir=join(parent,'web');mkdirSync(webDir);
  writeFileSync(join(webDir,'index.html'),'<!doctype html><title>Course platform</title>');
  writeFileSync(join(webDir,'.env'),'PRIVATE_TEST_MARKER');
  const f=await fixture(t,{}, {webDir});
  t.after(()=>rmSync(parent,{recursive:true,force:true}));
  for(const path of ['/','/admin','/courses/example']) {
    const response=await fetch(f.base+path);
    assert.equal(response.status,200,path);
    assert.match(response.headers.get('content-type'),/text\/html/);
    assert.match(await response.text(),/Course platform/);
  }
  const hidden=await fetch(f.base+'/.env');
  assert.doesNotMatch(await hidden.text(),/PRIVATE_TEST_MARKER/);
  assert.equal((await f.request('/missing')).status,404);
});

test('student flow: catalog, preview, SMS, paid access, ownership, progress and persistent database',async t=>{
  const f=await fixture(t),r=f.request;
  assert.equal((await r('/health')).data.mode,'demo');
  const catalog=await r('/courses');assert.ok(catalog.data.length>=6);
  const course=catalog.data.find(c=>c.price>0);
  const detail=(await r(`/courses/${course.id}`)).data;
  assert.equal(detail.enrolled,false);assert.equal(detail.lessons[1].videoUrl,'');
  assert.equal((await r(`/lessons/${detail.lessons[1].id}/play`)).status,401);
  assert.equal((await r(`/lessons/${detail.lessons[0].id}/play`)).status,200);
  const material=detail.materials[0];assert.equal((await r(`/materials/${material.id}/download`)).status,401);
  const sent=await r('/auth/sms/send',{method:'POST',body:{phone:'13800138001'}});
  assert.match(sent.data.devCode,/^\d{6}$/);
  assert.equal((await r('/auth/phone',{method:'POST',body:{phone:'13800138001',code:'wrong'}})).status,400);
  const login=await r('/auth/phone',{method:'POST',body:{phone:'13800138001',code:sent.data.devCode}});
  assert.equal(login.status,200);const {token,user}=login.data;assert.equal(user.phone,'13800138001');
  assert.equal((await r('/auth/phone',{method:'POST',body:{phone:'13800138001',code:sent.data.devCode}})).status,400);
  assert.equal((await r('/my/courses',{token})).data.length,1);
  assert.equal((await r(`/materials/${material.id}/download`,{token})).status,403);
  const order=await r('/orders',{method:'POST',token,body:{courseId:course.id,status:'paid',amount:0}});
  assert.equal(order.status,201);assert.equal(order.data.status,'pending');assert.equal(order.data.amount,course.price);
  assert.equal((await r('/orders',{method:'POST',token,body:{courseId:course.id}})).data.id,order.data.id);
  const other=(await r('/auth/demo',{method:'POST',body:{}})).data;
  assert.equal((await r(`/orders/${order.data.id}/pay`,{method:'POST',token:other.token})).status,404);
  const paid=await r(`/orders/${order.data.id}/pay`,{method:'POST',token});assert.equal(paid.data.demo,true);assert.equal(paid.data.order.status,'paid');
  assert.equal((await r(`/orders/${order.data.id}/demo-pay`,{method:'POST',token})).data.order.transactionId,paid.data.order.transactionId);
  assert.equal((await r(`/lessons/${detail.lessons[1].id}/play`,{token})).status,200);
  const download=await r(`/materials/${material.id}/download`,{token});assert.equal(download.status,200);assert.ok(download.data.includes('学习讲义'));assert.match(download.headers.get('content-disposition'),/attachment/);
  assert.equal((await r(`/lessons/${detail.lessons[1].id}/progress`,{method:'POST',token,body:{seconds:1800,completed:true}})).status,200);
  const updated=(await r(`/courses/${course.id}`,{token})).data;assert.ok(updated.completedLessonIds.includes(detail.lessons[1].id));assert.ok(updated.progressPercent>0);
  const {DatabaseSync}=await import('node:sqlite');const second=new DatabaseSync(f.settings.databasePath);assert.equal(second.prepare('SELECT status FROM orders WHERE id=?').get(order.data.id).status,'paid');second.close();
  assert.equal((await r('/auth/logout',{method:'POST',token})).status,200);assert.equal((await r('/me',{token})).status,401);
});

test('admin CRUD, private uploads, signed video playback, files and role isolation',async t=>{
  const f=await fixture(t),r=f.request;
  assert.equal((await r('/admin/stats')).status,401);
  const student=(await r('/auth/demo',{method:'POST',body:{}})).data;
  assert.equal((await r('/admin/stats',{token:student.token})).status,403);
  assert.equal((await r('/admin/login',{method:'POST',body:{username:'admin',password:'bad'}})).status,401);
  const admin=(await r('/admin/login',{method:'POST',body:{username:'admin',password:'admin123456'}})).data;
  const token=admin.token;
  assert.equal((await r('/admin/stats',{token})).status,200);
  const input={title:'测试数学课程',subtitle:'测试副标题',subject:'数学',grade:'高二',type:'专题课',price:88,originalPrice:128,teacher:'测试老师',teacherTitle:'资深教师',color:'#ff8a21',description:'测试说明',tags:['测试'],status:'draft'};
  let created=await r('/admin/courses',{method:'POST',token,body:input});assert.equal(created.status,201,JSON.stringify(created));const id=created.data.id;assert.equal(created.data.teacherTitle,'资深教师');
  assert.equal((await r(`/courses/${id}`)).status,404);
  const bad=new FormData();bad.append('file',new Blob(['evil']), 'bad.html');assert.equal((await r('/admin/uploads',{method:'POST',token,body:bad})).status,400);
  const video=new FormData();video.append('file',new Blob(['demovideo'],{type:'video/mp4'}),'lesson.mp4');
  const upload=await r('/admin/uploads',{method:'POST',token,body:video});assert.equal(upload.status,201);
  const blockedVideo=await fetch(f.base+upload.data.url);assert.equal(blockedVideo.status,403);assert.equal(blockedVideo.headers.get('cross-origin-resource-policy'),'same-origin');
  let lesson=await r(`/admin/courses/${id}/lessons`,{method:'POST',token,body:{title:'测试课时',duration:100,videoUrl:upload.data.url,isPreview:false,sort:1}});
  assert.equal(lesson.status,201);assert.equal(lesson.data.isPreview,false);
  const pdf=new FormData();pdf.append('file',new Blob(['demo handout'],{type:'application/pdf'}),'handout.pdf');
  const material=await r(`/admin/courses/${id}/materials`,{method:'POST',token,body:pdf});assert.equal(material.status,201);
  created=await r(`/admin/courses/${id}`,{method:'PUT',token,body:{status:'published',title:'测试课程更新'}});assert.equal(created.status,200);assert.equal(created.data.title,'测试课程更新');
  assert.equal((await r(`/courses/${id}`)).data.lessons[0].videoUrl,'');
  assert.equal((await r(`/lessons/${lesson.data.id}/play`,{token:student.token})).status,403);
  const order=(await r('/orders',{method:'POST',token:student.token,body:{courseId:id}})).data;
  await r(`/orders/${order.id}/pay`,{method:'POST',token:student.token});
  const play=await r(`/lessons/${lesson.data.id}/play`,{token:student.token});assert.match(play.data.url,/signature=/);
  assert.equal((await fetch(f.base+play.data.url)).status,403);
  const allowedVideo=await fetch(f.base+play.data.url,{headers:{Authorization:`Bearer ${student.token}`}});assert.equal(allowedVideo.status,200);assert.equal(allowedVideo.headers.get('cross-origin-resource-policy'),'same-origin');
  assert.equal((await fetch(f.base+play.data.url.replace(/signature=[^&]+/,'signature=bad'))).status,403);
  assert.equal((await r(`/materials/${material.data.id}/download`,{token:student.token})).status,200);
  assert.equal((await r('/admin/orders',{token})).data[0].courseTitle,'测试课程更新');
  assert.ok((await r('/admin/students',{token})).data[0].enrolledCount>=1);
  assert.equal((await r(`/admin/materials/${material.data.id}`,{method:'DELETE',token})).status,200);
  assert.equal((await r(`/materials/${material.data.id}/download`,{token:student.token})).status,404);
  assert.equal((await r(`/admin/lessons/${lesson.data.id}`,{method:'DELETE',token})).status,200);
  assert.equal((await r(`/admin/courses/${id}`,{method:'DELETE',token})).data.archived,true);
  assert.equal((await r(`/courses/${id}`)).status,404);
});

test('course artwork and product metadata are validated, persisted and returned consistently',async t=>{
  const f=await fixture(t),r=f.request;
  const admin=(await r('/admin/login',{method:'POST',body:{username:'admin',password:'admin123456'}})).data;
  const image=new FormData();image.append('file',new Blob([Uint8Array.from([137,80,78,71,13,10,26,10])],{type:'image/png'}),'cover.png');
  const upload=(await r('/admin/uploads',{method:'POST',token:admin.token,body:image})).data;
  assert.equal(upload.kind,'cover');const artwork=await fetch(f.base+upload.url);assert.equal(artwork.status,200);assert.equal(artwork.headers.get('cross-origin-resource-policy'),'cross-origin');assert.match(artwork.headers.get('cache-control'),/^public,/);
  const existing=(await r('/courses/course-math')).data;
  assert.equal(existing.coverImage,'');assert.deepEqual(existing.detailImages,[]);assert.equal(existing.productId,'');
  const input={title:'含课程封面的课程',subject:'数学',grade:'高二',type:'专题课',teacher:'测试老师',price:99,originalPrice:199,status:'published',coverImage:upload.url,detailImages:[upload.url,'https://images.example.com/lesson-detail.png'],productId:'course_math_2026',tags:['附带讲义'],description:'适用对象：高中学生。\n服务说明：课程视频与配套讲义。'};
  const created=await r('/admin/courses',{method:'POST',token:admin.token,body:input});
  assert.equal(created.status,201,JSON.stringify(created.data));const id=created.data.id;
  for(const path of [`/courses/${id}`,`/admin/courses/${id}`]) {
    const response=(await r(path,{token:admin.token})).data;
    assert.equal(response.coverImage,upload.url);assert.deepEqual(response.detailImages,input.detailImages);assert.equal(response.productId,input.productId);assert.equal(response.description,input.description);
  }
  assert.equal((await r('/courses')).data.find(course=>course.id===id).coverImage,upload.url);
  const revised=await r(`/admin/courses/${id}`,{method:'PUT',token:admin.token,body:{title:'仅修改标题'}});
  assert.equal(revised.data.coverImage,upload.url);assert.deepEqual(revised.data.detailImages,input.detailImages);assert.equal(revised.data.productId,input.productId);
  const doc=new FormData();doc.append('file',new Blob(['private document']),'material.txt');
  const document=(await r('/admin/uploads',{method:'POST',token:admin.token,body:doc})).data;
  const blockedDocument=await fetch(f.base+document.url);assert.equal(blockedDocument.status,403);assert.equal(blockedDocument.headers.get('cross-origin-resource-policy'),'same-origin');
  for(const invalid of [{coverImage:document.url},{coverImage:'/api/media/missing'},{coverImage:'javascript:alert(1)'},{coverImage:'http://insecure.example.com/p.png'},{coverImage:'https://user:password@images.example.com/a.png'},{detailImages:'not-an-array'},{detailImages:Array(21).fill(upload.url)},{detailImages:[{}]},{productId:'product\nattack'},{productId:'x'.repeat(129)},{tags:'[]'}]) {
    const result=await r(`/admin/courses/${id}`,{method:'PUT',token:admin.token,body:invalid});assert.equal(result.status,400,JSON.stringify(invalid));
  }
  assert.equal((await r(`/courses/${id}`)).data.productId,input.productId);
  await r(`/admin/courses/${id}`,{method:'DELETE',token:admin.token});
  assert.ok((await r('/admin/courses?includeArchived=true',{token:admin.token})).data.some(course=>course.id===id));
  assert.ok(!(await r('/admin/courses',{token:admin.token})).data.some(course=>course.id===id));
});

test('existing production databases migrate artwork and product columns without rewriting content or purchases',async t=>{
  const {DatabaseSync}=await import('node:sqlite');
  const dir=mkdtempSync(join(tmpdir(),'zhike-migration-'));const databasePath=join(dir,'legacy.sqlite');
  const legacy=new DatabaseSync(databasePath);
  legacy.exec("CREATE TABLE courses (id TEXT PRIMARY KEY,title TEXT NOT NULL,subtitle TEXT NOT NULL,subject TEXT NOT NULL,grade TEXT NOT NULL,type TEXT NOT NULL,price REAL NOT NULL,originalPrice REAL NOT NULL,teacher TEXT NOT NULL,teacherRole TEXT NOT NULL,teacherColor TEXT NOT NULL,description TEXT NOT NULL,coverTheme TEXT NOT NULL,tags TEXT NOT NULL,status TEXT NOT NULL,createdAt TEXT NOT NULL)");
  insertCourse(legacy,'production-course');legacy.close();
  const f=await fixture(t,{NODE_ENV:'production',DEMO_MODE:'false',ADMIN_PASSWORD:'Secure-Test-Password-9292',SESSION_SECRET:'a-test-secret-with-64-characters-for-production-configuration-checking'},{databasePath});
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const response=await f.request('/courses');assert.equal(response.data.length,1);const course=response.data[0];
  assert.equal(course.id,'production-course');assert.equal(course.title,'测试课程');assert.equal(course.price,299);assert.equal(course.coverImage,'');assert.deepEqual(course.detailImages,[]);assert.equal(course.productId,'');
  const columns=f.db.prepare('PRAGMA table_info(courses)').all().map(column=>column.name);
  for(const column of ['coverImage','detailImages','productId'])assert.ok(columns.includes(column));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM courses').get().count,1);
  // Opening the same file again applies migrations idempotently.
  const second=createApp({...f.settings,uploadsDir:join(dir,'other-uploads')});second.close();
  assert.equal((await f.request('/courses')).data[0].id,'production-course');
});

test('private video URLs require the issuing session on every GET, HEAD and Range request',async t=>{
  const f=await fixture(t),r=f.request;
  const buyer=(await r('/auth/demo',{method:'POST',body:{}})).data;
  const sms=(await r('/auth/sms/send',{method:'POST',body:{phone:'13800138024'}})).data;
  const outsider=(await r('/auth/phone',{method:'POST',body:{phone:'13800138024',code:sms.devCode}})).data;
  const admin=(await r('/admin/login',{method:'POST',body:{username:'admin',password:'admin123456'}})).data;
  const video=new FormData();video.append('file',new Blob(['0123456789abcdef'],{type:'video/mp4'}),'private.mp4');
  const upload=(await r('/admin/uploads',{method:'POST',token:admin.token,body:video})).data;
  const lesson=(await r('/admin/courses/course-math/lessons',{method:'POST',token:admin.token,body:{title:'收费完整视频',duration:60,videoUrl:upload.url,isPreview:false}})).data;
  assert.equal((await r(`/lessons/${lesson.id}/play`,{token:outsider.token})).status,403);
  const order=(await r('/orders',{method:'POST',token:buyer.token,body:{courseId:'course-math'}})).data;await r(`/orders/${order.id}/pay`,{method:'POST',token:buyer.token});
  const play=await r(`/lessons/${lesson.id}/play`,{token:buyer.token});assert.equal(play.status,200);assert.equal(play.data.playbackAuth,'session');assert.equal(play.data.requiresAuthorizedDownload,true);
  assert.ok(play.data.expiresAt>Date.now());assert.ok(play.data.expiresAt<=Date.now()+5*60*1000);
  const cookie=play.headers.get('set-cookie').split(';')[0];assert.match(play.headers.get('set-cookie'),/HttpOnly/);assert.match(play.headers.get('set-cookie'),/SameSite=Lax/);
  const url=f.base+play.data.url;
  for(const method of ['GET','HEAD']) {
    assert.equal((await fetch(url,{method})).status,403);
    assert.equal((await fetch(url,{method,headers:{Authorization:`Bearer ${outsider.token}`,Range:'bytes=0-3'}})).status,403);
    assert.equal((await fetch(url,{method,headers:{Cookie:cookie}})).status,200);
  }
  const range=await fetch(url,{headers:{Authorization:`Bearer ${buyer.token}`,Range:'bytes=2-5'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 2-5/16');assert.equal(await range.text(),'2345');assert.equal(range.headers.get('cache-control'),'private, no-store');
  assert.equal((await fetch(url,{headers:{Cookie:cookie,Authorization:`Bearer ${outsider.token}`}})).status,403);
  assert.equal((await fetch(url.replace(/lessonId=[^&]+/,'lessonId=course-math-lesson-1'),{headers:{Cookie:cookie}})).status,403);
  assert.equal((await fetch(url.replace(/expires=\d+/,`expires=${Date.now()-1000}`),{headers:{Cookie:cookie}})).status,403);
  assert.equal((await fetch(f.base+upload.url,{headers:{Authorization:`Bearer ${buyer.token}`,Range:'bytes=0-3'}})).status,403);
  f.db.prepare('DELETE FROM enrollments WHERE userId=? AND courseId=?').run(buyer.user.id,'course-math');
  assert.equal((await fetch(url,{headers:{Cookie:cookie,Range:'bytes=0-3'}})).status,403);
  f.db.prepare('INSERT INTO enrollments VALUES(?,?,?)').run(buyer.user.id,'course-math',new Date().toISOString());
  assert.equal((await fetch(url,{headers:{Cookie:cookie}})).status,200);
  await r('/auth/logout',{method:'POST',token:buyer.token});
  assert.equal((await fetch(url,{headers:{Cookie:cookie,Range:'bytes=0-3'}})).status,403);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM media_sessions').get().count,0);
});

test('public preview links recheck preview and source, while remote video streams never expose the source URL',async t=>{
  const upstreamCalls=[];
  const f=await fixture(t,{VIDEO_REMOTE_HOSTS:'video.example.com'}, {mediaFetch:async(url,options)=>{
    upstreamCalls.push({url:String(url),options});
    if(String(url).includes('redirect'))return new Response(null,{status:302,headers:{location:'https://not-allowed.example.com/private.mp4'}});
    return new Response(options.method==='HEAD'?null:'remotevideo',{status:options.headers.Range?206:200,headers:{'Content-Type':'video/mp4','Content-Length':11,'Accept-Ranges':'bytes',...(options.headers.Range?{'Content-Range':'bytes 0-10/11'}:{})}});
  }}),r=f.request;
  const admin=(await r('/admin/login',{method:'POST',body:{username:'admin',password:'admin123456'}})).data;
  const lesson=(await r('/admin/courses/course-math/lessons',{method:'POST',token:admin.token,body:{title:'公开试看',duration:60,videoUrl:'https://video.example.com/lesson.mp4',isPreview:true}})).data;
  const play=await r(`/lessons/${lesson.id}/play`);assert.equal(play.status,200);assert.equal(play.data.playbackAuth,'public');assert.doesNotMatch(JSON.stringify(play.data),/video\.example\.com/);
  let stream=await fetch(f.base+play.data.url,{headers:{Range:'bytes=0-10'}});assert.equal(stream.status,206);assert.equal(await stream.text(),'remotevideo');assert.equal(upstreamCalls[0].options.headers.Authorization,undefined);assert.equal(upstreamCalls[0].options.headers.Cookie,undefined);assert.equal(upstreamCalls[0].options.redirect,'manual');
  await r(`/admin/lessons/${lesson.id}`,{method:'PUT',token:admin.token,body:{isPreview:false}});
  assert.equal((await fetch(f.base+play.data.url,{headers:{Range:'bytes=0-10'}})).status,401);assert.equal(upstreamCalls.length,1);
  await r(`/admin/lessons/${lesson.id}`,{method:'PUT',token:admin.token,body:{isPreview:true,videoUrl:'https://video.example.com/redirect.mp4'}});
  assert.equal((await fetch(f.base+play.data.url)).status,403);
  const redirected=(await r(`/lessons/${lesson.id}/play`)).data;
  assert.equal((await fetch(f.base+redirected.url)).status,503);
  assert.equal(upstreamCalls.length,2);
  await r(`/admin/lessons/${lesson.id}`,{method:'PUT',token:admin.token,body:{videoUrl:'https://unconfigured.example.com/lesson.mp4'}});
  assert.equal((await r(`/lessons/${lesson.id}/play`)).status,503);
});

test('production rejects defaults and never fakes SMS, WeChat or payments',async t=>{
  assert.throws(()=>createApp({env:{NODE_ENV:'production',DEMO_MODE:'true'}}),/禁止/);
  assert.throws(()=>createApp({env:{NODE_ENV:'production',DEMO_MODE:'false',ADMIN_PASSWORD:'admin123456',SESSION_SECRET:'short'}}),/生产启动/);
  const f=await fixture(t,{NODE_ENV:'production',DEMO_MODE:'false',ADMIN_PASSWORD:'Secure-Test-Password-9292',SESSION_SECRET:'a-test-secret-with-64-characters-for-production-configuration-checking'}),r=f.request;
  assert.equal((await r('/health')).data.mode,'production');
  assert.equal((await r('/auth/demo',{method:'POST',body:{}})).status,403);
  assert.equal((await r('/auth/wechat',{method:'POST',body:{code:'fake'}})).status,503);
  assert.equal((await r('/auth/sms/send',{method:'POST',body:{phone:'13800138009'}})).status,503);
  assert.equal((await r('/courses')).data.length,0);
  insertCourse(f.db);
  f.db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run('test-user','13800138009',null,'测试学生',new Date().toISOString());
  const crypto=await import('node:crypto');const token='production-student-token';
  f.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),'test-user','student',Date.now()+60000);
  const course=(await r('/courses')).data.find(c=>c.price>0);
  const order=(await r('/orders',{method:'POST',token,body:{courseId:course.id}})).data;
  assert.equal((await r(`/orders/${order.id}/demo-pay`,{method:'POST',token})).status,403);
  assert.equal((await r(`/orders/${order.id}/pay`,{method:'POST',token})).status,503);
  assert.equal((await r(`/orders/${order.id}`,{token})).data.status,'pending');
  assert.equal((await r('/payments/wechat/notify',{method:'POST',body:{event_type:'TRANSACTION.SUCCESS'}})).status,400);
});

test('production sends SMS through the configured provider without exposing the verification code',async t=>{
  let delivery;
  const f=await fixture(t,{NODE_ENV:'production',DEMO_MODE:'false',ADMIN_PASSWORD:'Secure-Test-Password-9292',SESSION_SECRET:'a-test-secret-with-64-characters-for-production-configuration-checking'}, {smsProvider:{configured:true,async send(phone,code){delivery={phone,code};}}}),r=f.request;
  const sent=await r('/auth/sms/send',{method:'POST',body:{phone:'13800138022'}});
  assert.equal(sent.status,200);assert.equal(sent.data.devCode,undefined);assert.equal(sent.data.demoCode,undefined);
  assert.equal(sent.data.message,'验证码已发送');assert.equal(delivery.phone,'13800138022');assert.match(delivery.code,/^\d{6}$/);
  const login=await r('/auth/phone',{method:'POST',body:{phone:delivery.phone,code:delivery.code}});
  assert.equal(login.status,200);assert.equal(login.data.user.phone,delivery.phone);
});

test('unpublished and archived courses remain available to buyers while preventing outside access and purchases',async t=>{
  const f=await fixture(t),r=f.request;
  const buyer=(await r('/auth/demo',{method:'POST',body:{}})).data;
  const admin=(await r('/admin/login',{method:'POST',body:{username:'admin',password:'admin123456'}})).data;
  const sms=(await r('/auth/sms/send',{method:'POST',body:{phone:'13800138007'}})).data;
  const outsider=(await r('/auth/phone',{method:'POST',body:{phone:'13800138007',code:sms.devCode}})).data;
  const course=(await r('/courses/course-math')).data;
  const buyerOrder=(await r('/orders',{method:'POST',token:buyer.token,body:{courseId:course.id}})).data;
  assert.equal((await r(`/orders/${buyerOrder.id}/pay`,{method:'POST',token:buyer.token})).status,200);
  const pending=(await r('/orders',{method:'POST',token:outsider.token,body:{courseId:course.id}})).data;
  assert.equal((await r(`/admin/courses/${course.id}`,{method:'PUT',token:admin.token,body:{status:'draft'}})).status,200);
  for(const state of ['draft','archived']) {
    if(state==='archived') assert.equal((await r(`/admin/courses/${course.id}`,{method:'DELETE',token:admin.token})).status,200);
    assert.ok(!(await r('/courses')).data.some(c=>c.id===course.id));
    assert.ok((await r('/my/courses',{token:buyer.token})).data.some(c=>c.id===course.id));
    assert.equal((await r(`/courses/${course.id}`,{token:buyer.token})).status,200);
    assert.equal((await r(`/lessons/${course.lessons[1].id}/play`,{token:buyer.token})).status,200);
    assert.equal((await r(`/materials/${course.materials[0].id}/download`,{token:buyer.token})).status,200);
    assert.equal((await r(`/courses/${course.id}`,{token:outsider.token})).status,404);
    assert.equal((await r(`/lessons/${course.lessons[0].id}/play`,{token:outsider.token})).status,404);
    assert.equal((await r(`/materials/${course.materials[0].id}/download`,{token:outsider.token})).status,404);
    assert.equal((await r('/orders',{method:'POST',token:outsider.token,body:{courseId:course.id}})).status,404);
    assert.equal((await r(`/orders/${pending.id}/pay`,{method:'POST',token:outsider.token})).status,404);
    assert.equal((await r(`/orders/${pending.id}/demo-pay`,{method:'POST',token:outsider.token})).status,404);
  }
  assert.equal((await r(`/orders/${buyerOrder.id}`,{token:buyer.token})).data.status,'paid');
});

test('missing lesson videos return clear 404; removing the gift course does not break new account creation',async t=>{
  const f=await fixture(t),r=f.request;
  f.db.prepare("UPDATE lessons SET videoUrl='' WHERE id='course-experience-lesson-1'").run();
  const play=await r('/lessons/course-experience-lesson-1/play');assert.equal(play.status,404);assert.match(play.data.message,/尚未上传/);
  f.db.prepare("UPDATE courses SET status='archived' WHERE id='course-experience'").run();
  const student=await r('/auth/demo',{method:'POST',body:{}});assert.equal(student.status,200);
  assert.equal((await r('/my/courses',{token:student.data.token})).data.length,0);
});

test('WeChat login reuses the verified identity and keeps WeChat session secrets on the server',async t=>{
  const wechatProvider={appConfigured:true,payConfigured:false,async login(code){
    if(code==='expired')throw new WechatAuthError(400,'微信登录凭证已失效');
    return {openid:code==='another-user'?'openid-b':'openid-a',session_key:'private-wechat-session-key',unionid:'private-union-id'};
  }};
  const f=await fixture(t,{NODE_ENV:'production',DEMO_MODE:'false',ADMIN_PASSWORD:'Secure-Test-Password-9292',SESSION_SECRET:'a-test-secret-with-64-characters-for-production-configuration-checking'},{wechatProvider}),r=f.request;
  assert.equal((await r('/auth/wechat',{method:'POST',body:{}})).status,400);
  const first=await r('/auth/wechat',{method:'POST',body:{code:'first-code'}});
  assert.equal(first.status,200);assert.equal(first.data.user.wechatLinked,true);assert.ok(first.data.token);
  assert.equal(first.data.user.phone,'');
  assert.deepEqual(Object.keys(first.data).sort(),['token','user']);
  assert.doesNotMatch(JSON.stringify(first.data),/openid-a|private-wechat-session-key|private-union-id|session_key/);
  const again=await r('/auth/wechat',{method:'POST',body:{code:'fresh-code-for-same-user'}});
  assert.equal(again.data.user.id,first.data.user.id);assert.notEqual(again.data.token,first.data.token);
  const another=await r('/auth/wechat',{method:'POST',body:{code:'another-user'}});
  assert.notEqual(another.data.user.id,first.data.user.id);
  assert.equal((await r('/me',{token:first.data.token})).data.id,first.data.user.id);
  assert.equal((await r('/me',{token:another.data.token})).data.id,another.data.user.id);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM users').get().count,2);
  const expired=await r('/auth/wechat',{method:'POST',body:{code:'expired'}});
  assert.equal(expired.status,400);assert.match(expired.data.message,/失效/);assert.equal(expired.data.token,undefined);
});

test('WeChat login rejects malformed provider identities and phone responses before creating accounts',async t=>{
  let identity={openid:'verified-openid'},phone='13800138019',loginCalls=0;
  const f=await fixture(t,{}, {wechatProvider:{appConfigured:true,payConfigured:false,async login(){loginCalls++;return identity;},async phone(){return phone;}}}),r=f.request;
  for(const code of [{},[],123,'','x'.repeat(257),'white space']) {
    assert.equal((await r('/auth/wechat',{method:'POST',body:{code}})).status,400);
  }
  assert.equal(loginCalls,0);
  for(identity of [undefined,null,{}, {openid:{}},{openid:' '},{openid:'openid\nattack'},{openid:'x'.repeat(129)}]) {
    const result=await r('/auth/wechat',{method:'POST',body:{code:'fresh-code'}});
    assert.equal(result.status,502);assert.equal(result.data.token,undefined);
  }
  identity={openid:'verified-openid'};
  for(phone of [undefined,'',13800138019,'+8613800138019','not-a-phone','1380013801']) {
    const result=await r('/auth/wechat',{method:'POST',body:{code:'fresh-code',phoneCode:'phone-code'}});
    assert.equal(result.status,502);assert.equal(result.data.token,undefined);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM users').get().count,0);
  phone='13800138019';
  const valid=await r('/auth/wechat',{method:'POST',body:{code:'fresh-code',phoneCode:'phone-code'}});
  assert.equal(valid.status,200);assert.equal(valid.data.user.phone,phone);
  phone='13800138020';
  const changed=await r('/auth/wechat',{method:'POST',body:{code:'fresh-code',phoneCode:'phone-code'}});
  assert.equal(changed.status,409);assert.equal(changed.data.token,undefined);
  assert.equal(f.db.prepare('SELECT phone FROM users').get().phone,'13800138019');
});

test('WeChat login never exposes unexpected provider errors or request credentials',async t=>{
  const f=await fixture(t,{}, {wechatProvider:{appConfigured:true,payConfigured:false,async login(){throw new Error('request failed https://api.weixin.qq.com?secret=never-expose-this');}}}),r=f.request;
  const result=await r('/auth/wechat',{method:'POST',body:{code:'fresh-code'}});
  assert.equal(result.status,502);assert.doesNotMatch(result.data.message,/never-expose|secret|https/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM users').get().count,0);
});

test('linking WeChat requires matching verified phone, preserves the current account and rejects identity conflicts',async t=>{
  const identities={matching:{openid:'wx-phone-user'},differentPhone:{openid:'wx-other-phone'},ownedOpenid:{openid:'wx-owned'},wxCurrent:{openid:'wx-current'},differentOpenid:{openid:'wx-different'},wxUnbound:{openid:'wx-unbound'}};
  const phones={matching:'13800138011',differentPhone:'13800138012',ownedOpenid:'13800138013',wxCurrent:'13800138014',ownedPhone:'13800138011',wxUnbound:'13800138015'};
  const calls=[];
  const f=await fixture(t,{}, {wechatProvider:{appConfigured:true,payConfigured:false,async login(code){calls.push(['login',code]);if(code==='reject') throw new Error('微信凭证无效');return identities[code];},async phone(code){calls.push(['phone',code]);return phones[code];}}}),r=f.request;
  const crypto=await import('node:crypto');
  function account(id,phone,openid) {
    f.db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id,phone,openid,`同学 ${id}`,new Date().toISOString());
    const token=`test-token-${id}`;f.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),id,'student',Date.now()+60000);
    return token;
  }
  const phoneToken=account('phone-user','13800138011',null);
  const mismatchToken=account('mismatch-user','13800138016',null);
  const conflictToken=account('conflict-user','13800138013',null);
  account('openid-owner','13800138017','wx-owned');
  const wxToken=account('wx-user',null,'wx-current');
  const wxConflictToken=account('wx-conflict-user',null,'wx-unbound');
  f.db.prepare('INSERT INTO enrollments VALUES(?,?,?)').run('phone-user','course-math',new Date().toISOString());
  assert.equal((await r('/me',{token:phoneToken})).data.wechatLinked,false);
  assert.equal((await r('/me/wechat',{method:'POST',body:{code:'matching',phoneCode:'matching'}})).status,401);
  assert.equal((await r('/me/wechat',{method:'POST',token:phoneToken,body:{demo:true}})).status,400);
  assert.equal(calls.length,0);
  const matching=await r('/me/wechat',{method:'POST',token:phoneToken,body:{code:'matching',phoneCode:'matching'}});
  assert.equal(matching.status,200);assert.equal(matching.data.id,'phone-user');assert.equal(matching.data.wechatLinked,true);assert.equal(matching.data.phone,'13800138011');assert.equal(matching.data.token,undefined);
  assert.ok((await r('/my/courses',{token:phoneToken})).data.some(c=>c.id==='course-math'));
  assert.equal((await r('/me',{token:phoneToken})).data.id,'phone-user');
  assert.equal((await r('/me/wechat',{method:'POST',token:phoneToken,body:{code:'matching',phoneCode:'matching'}})).status,200);
  const mismatch=await r('/me/wechat',{method:'POST',token:mismatchToken,body:{code:'differentPhone',phoneCode:'differentPhone'}});assert.equal(mismatch.status,409);assert.match(mismatch.data.message,/不一致/);
  assert.equal(f.db.prepare('SELECT openid FROM users WHERE id=?').get('mismatch-user').openid,null);
  const conflict=await r('/me/wechat',{method:'POST',token:conflictToken,body:{code:'ownedOpenid',phoneCode:'ownedOpenid'}});assert.equal(conflict.status,409);assert.match(conflict.data.message,/其他账号/);
  assert.equal(f.db.prepare('SELECT openid FROM users WHERE id=?').get('conflict-user').openid,null);
  const sameWx=await r('/me/wechat',{method:'POST',token:wxToken,body:{code:'wxCurrent',phoneCode:'wxCurrent'}});assert.equal(sameWx.status,200);assert.equal(sameWx.data.id,'wx-user');assert.equal(sameWx.data.phone,'13800138014');
  const changedWx=await r('/me/wechat',{method:'POST',token:wxToken,body:{code:'differentOpenid',phoneCode:'wxCurrent'}});assert.equal(changedWx.status,409);assert.match(changedWx.data.message,/另一微信/);
  const ownedPhone=await r('/me/wechat',{method:'POST',token:wxConflictToken,body:{code:'wxUnbound',phoneCode:'ownedPhone'}});assert.equal(ownedPhone.status,409);assert.equal(f.db.prepare('SELECT phone FROM users WHERE id=?').get('wx-conflict-user').phone,null);
  assert.equal((await r('/me/wechat',{method:'POST',token:wxConflictToken,body:{code:'reject',phoneCode:'wxUnbound'}})).status,502);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM users').get().count,6);
});

test('WeChat link endpoint never simulates authorization when credentials are missing',async t=>{
  const f=await fixture(t),r=f.request;
  const student=(await r('/auth/demo',{method:'POST',body:{}})).data;
  const linked=await r('/me/wechat',{method:'POST',token:student.token,body:{demo:true,code:'fake',phoneCode:'fake'}});
  assert.equal(linked.status,503);assert.equal((await r('/me',{token:student.token})).data.wechatLinked,false);
});

test('WeChat Pay signed and encrypted callbacks validate merchant, amount and payer, then settle idempotently',async t=>{
  const crypto=await import('node:crypto');
  const keyDir=mkdtempSync(join(tmpdir(),'zhike-pay-'));
  const keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const privatePath=join(keyDir,'private.pem'),publicPath=join(keyDir,'platform.pem');
  writeFileSync(privatePath,keys.privateKey);writeFileSync(publicPath,keys.publicKey);
  t.after(()=>rmSync(keyDir,{recursive:true,force:true}));
  const apiKey='0123456789abcdef0123456789abcdef';
  const f=await fixture(t,{NODE_ENV:'production',DEMO_MODE:'false',ADMIN_PASSWORD:'Secure-Test-Password-9292',SESSION_SECRET:'a-test-secret-with-64-characters-for-production-configuration-checking',WECHAT_APP_ID:'wx-test',WECHAT_APP_SECRET:'app-secret',WECHAT_MCH_ID:'merchant-test',WECHAT_MCH_SERIAL_NO:'merchant-serial',WECHAT_PRIVATE_KEY_PATH:privatePath,WECHAT_API_V3_KEY:apiKey,WECHAT_PLATFORM_CERT_PATH:publicPath,WECHAT_PLATFORM_SERIAL_NO:'platform-serial',WECHAT_PAY_NOTIFY_URL:'https://example.com/api/payments/wechat/notify'});
  insertCourse(f.db);
  f.db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run('pay-user',null,'openid-test','支付测试同学',new Date().toISOString());
  f.db.prepare('INSERT INTO orders(id,userId,courseId,amount,status,transactionId,createdAt,paidAt,payChannel,paymentCodeUrl) VALUES(?,?,?,?,?,?,?,?,?,?)').run('pay-order','pay-user','course-math',29900,'pending',null,new Date().toISOString(),null,'jsapi',null);
  const payment={appid:'wx-test',mchid:'merchant-test',trade_type:'JSAPI',trade_state:'SUCCESS',out_trade_no:'pay-order',transaction_id:'wx-transaction',amount:{total:29900,currency:'CNY'},payer:{openid:'openid-test'}};
  async function notify(value,tamper=false) {
    const nonce=crypto.randomBytes(6).toString('hex'),associated='transaction';
    const cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(apiKey),Buffer.from(nonce));cipher.setAAD(Buffer.from(associated));
    const encrypted=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]);
    const body=JSON.stringify({event_type:'TRANSACTION.SUCCESS',resource:{algorithm:'AEAD_AES_256_GCM',ciphertext:encrypted.toString('base64'),nonce,associated_data:associated}});
    const timestamp=String(Math.floor(Date.now()/1000)),signer=crypto.createSign('RSA-SHA256');signer.update(`${timestamp}\n${nonce}\n${body}\n`);
    const signature=signer.sign(keys.privateKey,'base64');
    const response=await fetch(`${f.base}/api/payments/wechat/notify`,{method:'POST',headers:{'Content-Type':'application/json','Wechatpay-Timestamp':timestamp,'Wechatpay-Nonce':nonce,'Wechatpay-Serial':'platform-serial','Wechatpay-Signature':tamper?'invalid':signature},body});
    return {status:response.status,data:await response.json()};
  }
  assert.equal((await notify(payment,true)).status,400);
  assert.equal((await notify({...payment,amount:{total:1,currency:'CNY'}})).status,400);
  assert.equal((await notify({...payment,payer:{openid:'other-user'}})).status,400);
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get('pay-order').status,'pending');
  assert.equal((await notify(payment)).status,200);
  assert.equal((await notify(payment)).status,200);
  assert.equal(f.db.prepare('SELECT status FROM orders WHERE id=?').get('pay-order').status,'paid');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM enrollments WHERE userId=? AND courseId=?').get('pay-user','course-math').count,1);
  assert.equal((await notify({...payment,transaction_id:'another-transaction'})).status,409);
});

test('production Native payment keeps QR URLs private, closes expired orders and settles only from its callback',async t=>{
  const created=[],closed=[];
  const wechatProvider={appConfigured:true,payConfigured:true,async createNativePayment(order,title){created.push({id:order.id,title});return {codeUrl:'weixin://wxpay/bizpayurl?pr=private-test'};},async closePayment(order){closed.push(order.id);return {closed:true};},verifyNotification(headers,rawBody){return JSON.parse(rawBody);}};
  const f=await fixture(t,{NODE_ENV:'production',DEMO_MODE:'false',ADMIN_PASSWORD:'Secure-Test-Password-9292',SESSION_SECRET:'a-test-secret-with-64-characters-for-production-configuration-checking',WECHAT_APP_ID:'wx-test',WECHAT_MCH_ID:'merchant-test'}, {wechatProvider}),r=f.request;
  insertCourse(f.db);
  f.db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run('native-user','13800138020',null,'扫码支付同学',new Date().toISOString());
  const crypto=await import('node:crypto');const token='native-student-token';
  f.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),'native-user','student',Date.now()+60000);
  const order=(await r('/orders',{method:'POST',token,body:{courseId:'course-math'}})).data;
  const first=await r(`/orders/${order.id}/native-pay`,{method:'POST',token});
  assert.equal(first.status,200);assert.equal(first.data.codeUrl,'weixin://wxpay/bizpayurl?pr=private-test');
  assert.equal(first.data.order.paymentCodeUrl,undefined);assert.equal(first.data.order.paymentChannel,'native');
  const second=await r(`/orders/${order.id}/native-pay`,{method:'POST',token});
  assert.equal(second.data.codeUrl,first.data.codeUrl);assert.equal(created.length,1);
  assert.equal((await r('/my/orders',{token})).data[0].paymentCodeUrl,undefined);
  const payment={appid:'wx-test',mchid:'merchant-test',trade_type:'NATIVE',trade_state:'SUCCESS',out_trade_no:order.id,transaction_id:'native-transaction',amount:{total:29900,currency:'CNY'},payer:{openid:'wechat-payer'}};
  const wrongType=await r('/payments/wechat/notify',{method:'POST',body:{...payment,trade_type:'JSAPI'}});
  assert.equal(wrongType.status,400);assert.equal((await r(`/orders/${order.id}`,{token})).data.status,'pending');
  assert.equal((await r('/payments/wechat/notify',{method:'POST',body:payment})).status,200);
  assert.equal((await r(`/orders/${order.id}`,{token})).data.status,'paid');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM enrollments WHERE userId=? AND courseId=?').get('native-user','course-math').count,1);
  insertCourse(f.db,'course-expiring');
  const expiring=(await r('/orders',{method:'POST',token,body:{courseId:'course-expiring'}})).data;
  assert.equal((await r(`/orders/${expiring.id}/native-pay`,{method:'POST',token})).status,200);
  f.db.prepare('UPDATE orders SET paymentCodeCreatedAt=? WHERE id=?').run(Date.now()-106*60*1000,expiring.id);
  const expired=await r(`/orders/${expiring.id}/native-pay`,{method:'POST',token});
  assert.equal(expired.status,200);assert.equal(expired.data.cancelled,true);assert.equal(expired.data.order.paymentCodeUrl,undefined);
  assert.equal((await r(`/orders/${expiring.id}`,{token})).data.status,'cancelled');assert.deepEqual(closed,[expiring.id]);
  const replacement=(await r('/orders',{method:'POST',token,body:{courseId:'course-expiring'}})).data;
  assert.notEqual(replacement.id,expiring.id);
  await r(`/orders/${replacement.id}/native-pay`,{method:'POST',token});
  const cancelled=await r(`/orders/${replacement.id}/cancel`,{method:'POST',token});
  assert.equal(cancelled.status,200);assert.equal(cancelled.data.cancelled,true);assert.equal(cancelled.data.order.paymentCodeUrl,undefined);
  assert.equal((await r(`/orders/${replacement.id}`,{token})).data.status,'cancelled');assert.deepEqual(closed,[expiring.id,replacement.id]);
});
