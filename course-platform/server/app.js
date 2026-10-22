import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes, createHash, createHmac, timingSafeEqual, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve, join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.js';
import { wechatProvider, WechatAuthError, validWechatOpenid } from './wechat.js';
import { smsProvider } from './sms.js';

const here=dirname(fileURLToPath(import.meta.url));
const fail=(status,message)=>Object.assign(new Error(message),{status});
const now=()=>new Date().toISOString();
const hash=value=>createHash('sha256').update(value).digest('hex');
const safeEqual=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);};
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const textValue=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
const currency=value=>Number.isFinite(Number(value)) && Number(value)>=0 && Number(value)<=999999?Math.round(Number(value)*100)/100:null;

export function createApp(options={}) {
  const env={...process.env,...options.env};
  const production=env.NODE_ENV==='production';
  const demo=env.DEMO_MODE===undefined?!production:env.DEMO_MODE==='true';
  if(production && demo) throw new Error('生产环境禁止 DEMO_MODE=true');
  const adminUsername=env.ADMIN_USERNAME||'admin';
  const adminPassword=env.ADMIN_PASSWORD||(demo?'admin123456':'');
  const secret=env.SESSION_SECRET||(demo?randomBytes(32).toString('hex'):'');
  if(!demo && (adminPassword.length<12 || adminPassword==='admin123456' || adminPassword.toLowerCase().includes('replace') || secret.length<32 || secret.startsWith('replace-'))) throw new Error('生产启动需要至少 12 位独立管理员密码和至少 32 位 SESSION_SECRET，禁止使用默认值');
  const uploadsDir=resolve(options.uploadsDir||env.UPLOAD_DIR||join(here,'data/uploads'));
  const databasePath=options.databasePath||env.DATABASE_PATH||join(here,'data/courses.sqlite');
  const db=openDatabase(databasePath,uploadsDir,{seedDemoContent:options.seedDemoContent??demo});
  const wechat=options.wechatProvider||wechatProvider(env);
  const sms=options.smsProvider||smsProvider(env);
  const smsConfigured=sms.configured;
  const adminHash=bcrypt.hashSync(adminPassword,10);
  const app=express();
  app.disable('x-powered-by');
  if(env.TRUST_PROXY) app.set('trust proxy',env.TRUST_PROXY==='true'?1:Number(env.TRUST_PROXY));
  app.use(helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:'same-origin'}}));
  app.use(express.json({limit:'256kb',verify:(req,res,buffer)=>{req.rawBody=buffer.toString('utf8');}}));
  const loginLimit=rateLimit({windowMs:15*60*1000,limit:50,standardHeaders:'draft-8',legacyHeaders:false,handler:(req,res)=>res.status(429).json({message:'操作过于频繁，请稍后再试'})});
  const smsLimit=rateLimit({windowMs:60*60*1000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,handler:(req,res)=>res.status(429).json({message:'验证码发送过于频繁，请稍后再试'})});
  app.use('/api/auth',loginLimit); app.use('/api/admin/login',loginLimit);
  const run=(sql,...values)=>db.prepare(sql).run(...values);
  const get=(sql,...values)=>db.prepare(sql).get(...values);
  const all=(sql,...values)=>db.prepare(sql).all(...values);
  const userShape=u=>({id:u.id,nickname:u.name,name:u.name,phone:u.phone||'',avatar:'',createdAt:u.createdAt,role:'student',wechatLinked:Boolean(u.openid && u.openid!=='demo-student')});
  function issueSession(userId,role='student') {
    const token=randomBytes(32).toString('base64url');
    run('DELETE FROM sessions WHERE expires < ?',Date.now());
    run('INSERT INTO sessions VALUES(?,?,?,?)',hash(token),userId,role,Date.now()+7*24*60*60*1000);
    return token;
  }
  function optionalAuth(req,res,next) {
    const bearer=req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if(bearer) {
      const session=get('SELECT * FROM sessions WHERE hash=? AND expires>?',hash(bearer),Date.now());
      if(session) req.auth=session;
    }
    next();
  }
  app.use('/api',optionalAuth);
  const auth=(req,res,next)=>req.auth?next():next(fail(401,'请先登录'));
  const admin=(req,res,next)=>req.auth?.role==='admin'?next():next(fail(req.auth?403:401,'请先登录管理后台'));
  const student=(req,res,next)=>req.auth?.role==='student'?next():next(fail(401,'请先使用学生账号登录'));
  function ensureDemo() {if(!demo) throw fail(403,'生产环境不提供演示功能');}
  function findCourse(id,adminAccess=false,userId=null) {
    const course=get('SELECT * FROM courses WHERE id=?',id);
    if(!course || (!adminAccess && course.status!=='published' && !enrolled(userId,id))) throw fail(404,'课程不存在或尚未上架');
    return course;
  }
  const enrolled=(userId,courseId)=>Boolean(userId && get('SELECT 1 FROM enrollments WHERE userId=? AND courseId=?',userId,courseId));
  function enroll(userId,courseId) {run('INSERT OR IGNORE INTO enrollments VALUES(?,?,?)',userId,courseId,now());}
  function createUser({phone=null,openid=null,name='知课同学'}) {
    const id=randomUUID();run('INSERT INTO users VALUES(?,?,?,?,?)',id,phone,openid,name,now());
    if(get("SELECT 1 FROM courses WHERE id='course-experience' AND status='published' AND price=0")) enroll(id,'course-experience');
    return get('SELECT * FROM users WHERE id=?',id);
  }
  function loginResponse(user,res) {res.json({token:issueSession(user.id),user:userShape(user)});}
  function courseShape(course,userId) {
    const counts=get('SELECT COUNT(*) AS count,COALESCE(SUM(duration),0) AS duration FROM lessons WHERE courseId=?',course.id);
    const count=get('SELECT COUNT(*) AS count FROM enrollments WHERE courseId=?',course.id).count;
    const lessons=all('SELECT l.id,l.duration,p.position,p.completed FROM lessons l LEFT JOIN progress p ON p.lessonId=l.id AND p.userId=? WHERE l.courseId=?',userId||'',course.id);
    const completedLessons=lessons.filter(l=>l.completed).length;
    const progressPercent=counts.duration?Math.min(100,Math.round(lessons.reduce((sum,l)=>sum+(l.completed?l.duration:Math.min(l.position||0,l.duration)),0)/counts.duration*100)):0;
    return {...course,tags:JSON.parse(course.tags),teacherTitle:course.teacherRole,teacherAvatar:'',color:course.teacherColor,lessonCount:counts.count,studentCount:count,duration:counts.duration,enrolled:enrolled(userId,course.id),purchased:enrolled(userId,course.id),progressPercent,completedLessons};
  }
  function lessonShape(lesson,canWatch=false) {return {...lesson,preview:Boolean(lesson.preview),isPreview:Boolean(lesson.preview),freePreview:Boolean(lesson.preview),sort:lesson.sortOrder,videoUrl:canWatch?lesson.videoUrl:''};}
  function materialShape(material) {return {id:material.id,courseId:material.courseId,name:material.name,title:material.name,fileName:material.fileName,size:material.size,mimeType:material.mime,type:material.mime,createdAt:material.createdAt};}
  function fullCourse(course,userId,adminAccess=false) {
    const canWatch=adminAccess||enrolled(userId,course.id)||course.price===0;
    const lessonRows=all('SELECT * FROM lessons WHERE courseId=? ORDER BY sortOrder,id',course.id);
    const lessons=lessonRows.map(l=>lessonShape(l,adminAccess));
    const materials=all('SELECT m.*,u.name AS fileName,u.size,u.mime,u.createdAt FROM materials m JOIN uploads u ON u.id=m.uploadId WHERE m.courseId=?',course.id).map(materialShape);
    const progresses=all('SELECT p.* FROM progress p JOIN lessons l ON l.id=p.lessonId WHERE p.userId=? AND l.courseId=?',userId||'',course.id);
    return {...courseShape(course,userId),lessons,materials,progress:Object.fromEntries(progresses.map(p=>[p.lessonId,p.position])),completedLessonIds:progresses.filter(p=>p.completed).map(p=>p.lessonId),canWatch};
  }
  function orderShape(order) {
    const course=get('SELECT title FROM courses WHERE id=?',order.courseId),user=get('SELECT name,phone FROM users WHERE id=?',order.userId);
    const {paymentCodeUrl,...safeOrder}=order;
    return {...safeOrder,paymentChannel:order.payChannel||null,amount:order.amount/100,amountFen:order.amount,courseTitle:course?.title||'已归档课程',userName:user?.name||'',phone:user?.phone||''};
  }
  function ownedOrder(req) {
    const order=get('SELECT * FROM orders WHERE id=? AND userId=?',req.params.id,req.auth.userId);
    if(!order) throw fail(404,'订单不存在');return order;
  }
  function settleOrder(order,transactionId) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing=get('SELECT * FROM orders WHERE id=?',order.id);
      if(existing.status==='paid') {db.exec('COMMIT');return existing;}
      if(existing.status!=='pending') throw fail(409,'订单状态不能支付');
      run('UPDATE orders SET status=?,paidAt=?,transactionId=? WHERE id=?','paid',now(),transactionId,order.id);
      enroll(order.userId,order.courseId);db.exec('COMMIT');return get('SELECT * FROM orders WHERE id=?',order.id);
    } catch(error) {db.exec('ROLLBACK');throw error;}
  }

  app.get('/api/health',(req,res)=>res.json({ok:true,mode:demo?'demo':'production'}));
  app.get('/api/config',(req,res)=>res.json({demoMode:demo,wechatConfigured:wechat.appConfigured,smsConfigured,paymentConfigured:wechat.payConfigured,mode:demo?'development':'production',devLoginEnabled:demo,smsEnabled:smsConfigured||demo,wechatEnabled:wechat.appConfigured,paymentEnabled:wechat.payConfigured}));
  const demoLogin=(req,res)=>{ensureDemo();let user=get('SELECT * FROM users WHERE openid=?','demo-student');if(!user) user=createUser({openid:'demo-student',name:'林同学'});loginResponse(user,res);};
  app.post(['/api/auth/demo','/api/auth/dev'],demoLogin);
  app.post('/api/auth/sms/send',smsLimit,asyncRoute(async(req,res)=>{
    const phone=textValue(req.body.phone,20);if(!/^1[3-9]\d{9}$/.test(phone)) throw fail(400,'请输入正确的 11 位中国大陆手机号');
    if(!demo && !smsConfigured) throw fail(503,'真实短信服务尚未配置，请联系管理员');
    const previous=get('SELECT sentAt FROM sms_codes WHERE phone=?',phone);
    if(previous && Date.now()-previous.sentAt<60000) throw fail(429,'请 60 秒后再获取验证码');
    const code=String(randomInt(100000,1000000));
    if(!demo) {
      try {await sms.send(phone,code);} catch(error) {if(!options.quiet)console.error('短信供应商发送失败:',error.message);throw fail(502,'短信发送失败，请检查签名、模板、账户余额或服务商配置');}
    }
    run('INSERT INTO sms_codes VALUES(?,?,?,?,?) ON CONFLICT(phone) DO UPDATE SET hash=excluded.hash,expires=excluded.expires,attempts=0,sentAt=excluded.sentAt',phone,hash(`${secret}:${phone}:${code}`),Date.now()+5*60*1000,0,Date.now());
    res.json({message:demo?'演示验证码已生成，未发送真实短信':'验证码已发送',expiresIn:300,retryAfter:60,...(demo?{devCode:code,demoCode:code}:{} )});
  }));
  const phoneLogin=(req,res)=>{
    const phone=textValue(req.body.phone,20),code=textValue(req.body.code,12),record=get('SELECT * FROM sms_codes WHERE phone=?',phone);
    if(!record || record.expires<Date.now() || record.attempts>=5) throw fail(400,'验证码已失效，请重新获取');
    run('UPDATE sms_codes SET attempts=attempts+1 WHERE phone=?',phone);
    if(!safeEqual(record.hash,hash(`${secret}:${phone}:${code}`))) throw fail(400,'验证码错误');
    run('DELETE FROM sms_codes WHERE phone=?',phone);
    let user=get('SELECT * FROM users WHERE phone=?',phone);if(!user) user=createUser({phone,name:`同学${phone.slice(-4)}`});loginResponse(user,res);
  };
  app.post(['/api/auth/phone','/api/auth/sms/login'],phoneLogin);
  const wechatLogin=asyncRoute(async(req,res)=>{
    if(req.body.demo===true) {ensureDemo();return demoLogin(req,res);}
    if(!wechat.appConfigured) throw fail(503,'微信登录尚未配置 AppID 和 AppSecret，请管理员完成后端配置');
    if(typeof req.body.code!=='string' || !req.body.code.trim() || req.body.code.length>256 || /\s/.test(req.body.code)) throw fail(400,'缺少有效的微信登录 code，请重新授权');
    const code=req.body.code;
    const phoneCode=req.body.phoneCode;
    if(phoneCode!==undefined && (typeof phoneCode!=='string' || !phoneCode || phoneCode.length>512 || /\s/.test(phoneCode))) throw fail(400,'微信手机号授权凭证无效，请重新授权');
    let session,phone;
    try {
      session=await wechat.login(code);
      if(!validWechatOpenid(session?.openid)) throw new WechatAuthError(502,'微信未返回有效的用户标识，请重新授权');
      if(phoneCode) {
        phone=await wechat.phone(phoneCode);
        if(typeof phone!=='string' || !/^1[3-9]\d{9}$/.test(phone)) throw new WechatAuthError(502,'微信未返回有效的中国大陆手机号，请重新授权');
      }
    } catch(error) {throw fail(error instanceof WechatAuthError?error.status:502,error instanceof WechatAuthError?error.message:'微信登录服务暂时不可用，请稍后重试');}
    let user=get('SELECT * FROM users WHERE openid=?',session.openid);
    const phoneUser=phone?get('SELECT * FROM users WHERE phone=?',phone):null;
    if(user?.phone && phone && user.phone!==phone) throw fail(409,'授权手机号与当前微信账号已绑定手机号不一致，请使用原手机号登录或联系管理员处理');
    if(user && phoneUser && user.id!==phoneUser.id) throw fail(409,'此手机号已绑定其他账号，请使用手机号登录后联系管理员处理');
    if(!user && phoneUser) {
      if(phoneUser.openid && phoneUser.openid!==session.openid) throw fail(409,'此手机号已绑定其他微信账号');
      run('UPDATE users SET openid=? WHERE id=?',session.openid,phoneUser.id);user=get('SELECT * FROM users WHERE id=?',phoneUser.id);
    }
    if(!user) user=createUser({openid:session.openid,phone:phone||null});
    else if(phone && !user.phone) {run('UPDATE users SET phone=? WHERE id=?',phone,user.id);user=get('SELECT * FROM users WHERE id=?',user.id);}
    loginResponse(user,res);
  });
  app.post(['/api/auth/wechat','/api/auth/wechat-phone'],wechatLogin);
  app.post('/api/auth/logout',auth,(req,res)=>{run('DELETE FROM sessions WHERE hash=?',req.auth.hash);res.json({ok:true});});
  app.get('/api/me',student,(req,res)=>res.json(userShape(get('SELECT * FROM users WHERE id=?',req.auth.userId))));
  app.patch('/api/me',student,(req,res)=>{const name=textValue(req.body.nickname||req.body.name,32);if(!name) throw fail(400,'昵称不能为空');run('UPDATE users SET name=? WHERE id=?',name,req.auth.userId);res.json(userShape(get('SELECT * FROM users WHERE id=?',req.auth.userId)));});
  app.post('/api/me/wechat',student,loginLimit,asyncRoute(async(req,res)=>{
    if(!wechat.appConfigured) throw fail(503,'微信关联尚未配置 AppID 和 AppSecret，请联系管理员');
    const code=textValue(req.body.code,256),phoneCode=textValue(req.body.phoneCode,512);
    if(!code || !phoneCode) throw fail(400,'请同时提供微信登录 code 和手机号授权 phoneCode');
    let identity,phone;
    try {identity=await wechat.login(code);phone=await wechat.phone(phoneCode);} catch(error) {throw fail(error instanceof WechatAuthError?error.status:502,error instanceof WechatAuthError?error.message:'微信授权服务暂时不可用，请稍后重试');}
    if(!validWechatOpenid(identity?.openid) || !/^1[3-9]\d{9}$/.test(phone||'')) throw fail(502,'微信未返回有效的账号或手机号，请重新授权');
    db.exec('BEGIN IMMEDIATE');
    try {
      const current=get('SELECT * FROM users WHERE id=?',req.auth.userId);
      if(!current) throw fail(401,'当前账号不存在，请重新登录');
      if(current.openid && current.openid!==identity.openid) throw fail(409,'当前账号已关联另一微信账号，请使用原微信授权');
      if(current.phone && current.phone!==phone) throw fail(409,'授权手机号与当前登录手机号不一致，请使用相同手机号的微信授权');
      if(!current.phone && !current.openid) throw fail(409,'当前账号尚未验证手机号，请先使用手机号登录后再关联微信');
      const owner=get('SELECT id FROM users WHERE (openid=? OR phone=?) AND id!=?',identity.openid,phone,current.id);
      if(owner) throw fail(409,'此微信或手机号已属于其他账号，无法关联；请联系管理员处理');
      run('UPDATE users SET openid=?,phone=? WHERE id=?',identity.openid,phone,current.id);
      const updated=get('SELECT * FROM users WHERE id=?',current.id);
      db.exec('COMMIT');
      res.json(userShape(updated));
    } catch(error) {db.exec('ROLLBACK');throw error;}
  }));
  app.get('/api/courses',(req,res)=>{
    const conditions=["status='published'"],params=[];
    for(const field of ['subject','grade','type']) if(req.query[field]) {conditions.push(`${field}=?`);params.push(String(req.query[field]));}
    const q=textValue(req.query.q||req.query.search,100);if(q) {conditions.push('(title LIKE ? OR teacher LIKE ? OR subtitle LIKE ?)');params.push(`%${q}%`,`%${q}%`,`%${q}%`);}
    res.json(all(`SELECT * FROM courses WHERE ${conditions.join(' AND ')} ORDER BY createdAt,id`,...params).map(c=>courseShape(c,req.auth?.userId)));
  });
  app.get('/api/courses/:id',(req,res)=>res.json(fullCourse(findCourse(req.params.id,req.auth?.role==='admin',req.auth?.userId),req.auth?.userId,req.auth?.role==='admin')));
  app.get(['/api/my/courses','/api/me/courses'],student,(req,res)=>res.json(all('SELECT c.* FROM courses c JOIN enrollments e ON e.courseId=c.id WHERE e.userId=? ORDER BY e.createdAt DESC',req.auth.userId).map(c=>courseShape(c,req.auth.userId))));
  app.get(['/api/my/orders','/api/me/orders'],student,(req,res)=>res.json(all('SELECT * FROM orders WHERE userId=? ORDER BY createdAt DESC',req.auth.userId).map(orderShape)));
  app.post('/api/orders',student,(req,res)=>{
    const course=findCourse(textValue(req.body.courseId));
    if(enrolled(req.auth.userId,course.id)) throw fail(409,'你已拥有这门课程，可直接前往学习');
    let order=get("SELECT * FROM orders WHERE userId=? AND courseId=? AND status='pending'",req.auth.userId,course.id);
    if(!order) {const id=`ZK${Date.now()}${randomBytes(6).toString('hex')}`;run('INSERT INTO orders(id,userId,courseId,amount,status,transactionId,createdAt,paidAt,payChannel,paymentCodeUrl) VALUES(?,?,?,?,?,?,?,?,?,?)',id,req.auth.userId,course.id,Math.round(course.price*100),'pending',null,now(),null,'',null);order=get('SELECT * FROM orders WHERE id=?',id);}
    if(order.amount===0) order=settleOrder(order,`free-${order.id}`);
    res.status(201).json(orderShape(order));
  });
  app.get('/api/orders/:id',student,(req,res)=>res.json(orderShape(ownedOrder(req))));
  const demoPay=(req,res)=>{ensureDemo();const order=ownedOrder(req);if(order.status!=='paid') findCourse(order.courseId);res.json({demo:true,order:orderShape(settleOrder(order,`demo-${order.id}`))});};
  app.post(['/api/orders/:id/demo-pay','/api/orders/:id/dev-pay'],student,demoPay);
  app.post('/api/orders/:id/cancel',student,asyncRoute(async(req,res)=>{
    const order=ownedOrder(req);
    if(order.status==='paid')return res.json({paid:true,order:orderShape(order)});
    if(order.status==='cancelled')return res.json({cancelled:true,order:orderShape(order)});
    if(order.status!=='pending')throw fail(409,'订单状态不能取消');
    if(!demo && order.payChannel) {
      if(!wechat.closePayment)throw fail(503,'当前微信支付适配器不支持关闭订单');
      try {await wechat.closePayment(order);} catch(error) {throw fail(502,error.message);}
    }
    run("UPDATE orders SET status='cancelled',paymentCodeUrl=NULL,paymentCodeCreatedAt=NULL WHERE id=? AND status='pending'",order.id);
    const cancelled=get('SELECT * FROM orders WHERE id=?',order.id);
    res.json({cancelled:true,order:orderShape(cancelled)});
  }));
  app.post('/api/orders/:id/pay',student,asyncRoute(async(req,res)=>{
    if(demo) return demoPay(req,res);
    const order=ownedOrder(req);if(order.status==='paid') return res.json({order:orderShape(order),paid:true});
    if(order.payChannel==='native')throw fail(409,'此订单已选择微信扫码支付，请继续使用二维码付款');
    const user=get('SELECT * FROM users WHERE id=?',req.auth.userId),course=findCourse(order.courseId);
    if(!wechat.payConfigured) throw fail(503,'微信支付商户参数尚未配置完整，当前无法付款');
    try {const params=await wechat.createPayment(order,user.openid,course.title);run("UPDATE orders SET payChannel='jsapi' WHERE id=? AND status='pending'",order.id);res.json({paymentParams:params,payment:{mode:'wechat',params}});} catch(error) {throw fail(502,error.message);}
  }));
  app.post('/api/orders/:id/native-pay',student,asyncRoute(async(req,res)=>{
    if(demo) throw fail(503,'演示环境不提供真实微信扫码支付');
    const order=ownedOrder(req);if(order.status==='paid')return res.json({order:orderShape(order),paid:true});
    if(order.payChannel==='jsapi')throw fail(409,'此订单已选择小程序内微信支付，请继续在小程序完成付款');
    const course=findCourse(order.courseId);
    if(!wechat.payConfigured)throw fail(503,'微信 Native 扫码支付未配置商户证书，请联系管理员');
    try{
      if(order.paymentCodeUrl && (!order.paymentCodeCreatedAt || Date.now()-order.paymentCodeCreatedAt>=105*60*1000)) {
        await wechat.closePayment(order);
        run("UPDATE orders SET status='cancelled',paymentCodeUrl=NULL,paymentCodeCreatedAt=NULL WHERE id=? AND status='pending'",order.id);
        return res.json({cancelled:true,order:orderShape(get('SELECT * FROM orders WHERE id=?',order.id))});
      }
      run("UPDATE orders SET payChannel='native' WHERE id=? AND status='pending'",order.id);
      const payment=order.paymentCodeUrl?{codeUrl:order.paymentCodeUrl}:await wechat.createNativePayment(order,course.title);
      run("UPDATE orders SET payChannel='native',paymentCodeUrl=?,paymentCodeCreatedAt=? WHERE id=? AND status='pending'",payment.codeUrl,Date.now(),order.id);
      res.json({codeUrl:payment.codeUrl,order:orderShape(get('SELECT * FROM orders WHERE id=?',order.id))});
    }catch(error){if(error.status)throw error;throw fail(502,error.message);}
  }));
  app.post('/api/payments/wechat/notify',(req,res)=>{
    try {
      const payment=wechat.verifyNotification(req.headers,req.rawBody);
      if(payment.mchid!==env.WECHAT_MCH_ID || payment.appid!==env.WECHAT_APP_ID || payment.trade_state!=='SUCCESS' || payment.amount?.currency!=='CNY') throw fail(400,'支付通知商户或状态无效');
      const order=get('SELECT * FROM orders WHERE id=?',payment.out_trade_no);
      if(!order || order.amount!==payment.amount.total || !payment.transaction_id) throw fail(400,'支付通知订单或金额不一致');
      const expectedTradeType=order.payChannel==='native'?'NATIVE':'JSAPI';
      if(payment.trade_type!==expectedTradeType)throw fail(400,'支付通知交易类型与订单不一致');
      const user=get('SELECT openid FROM users WHERE id=?',order.userId);
      if(expectedTradeType==='JSAPI'&&(!user.openid || payment.payer?.openid!==user.openid)) throw fail(400,'支付通知付款用户不一致');
      if(expectedTradeType==='NATIVE'&&!payment.payer?.openid)throw fail(400,'二维码支付通知缺少付款用户信息');
      if(order.status==='paid' && order.transactionId!==payment.transaction_id) throw fail(409,'支付交易号不一致');
      settleOrder(order,payment.transaction_id);res.status(200).json({code:'SUCCESS',message:'成功'});
    } catch(error) {res.status(error.status||400).json({code:'FAIL',message:error.message});}
  });

  function getAccessibleLesson(req) {
    const lesson=get('SELECT * FROM lessons WHERE id=?',req.params.id);if(!lesson) throw fail(404,'课时不存在');
    const adminAccess=req.auth?.role==='admin';const course=findCourse(lesson.courseId,adminAccess,req.auth?.userId);
    if(!adminAccess && !lesson.preview && !enrolled(req.auth?.userId,course.id) && course.price!==0) throw fail(req.auth?403:401,'购买课程后即可学习本课时');
    return lesson;
  }
  function signedMedia(uploadId) {
    const expires=String(Date.now()+60*60*1000);const signature=createHmac('sha256',secret).update(`${uploadId}:${expires}`).digest('hex');
    return `/api/media/${uploadId}?expires=${expires}&signature=${signature}`;
  }
  function videoUrl(lesson) {
    if(lesson.videoUrl.startsWith('upload:')) return signedMedia(lesson.videoUrl.slice(7));
    const match=lesson.videoUrl.match(/^\/api\/media\/([^?]+)/);if(match) return signedMedia(match[1]);
    return lesson.videoUrl;
  }
  const play=(req,res)=>{
    const lesson=getAccessibleLesson(req);const p=req.auth?.userId?get('SELECT * FROM progress WHERE userId=? AND lessonId=?',req.auth.userId,lesson.id):null;
    if(!lesson.videoUrl) throw fail(404,'本课时视频尚未上传，请稍后再试');
    res.json({...lessonShape(lesson,true),url:videoUrl(lesson),videoUrl:videoUrl(lesson),progress:p?.position||0,demoVideo:lesson.videoUrl.includes('interactive-examples.mdn')});
  };
  app.get(['/api/lessons/:id/play','/api/lessons/:id'],play);
  app.post('/api/lessons/:id/progress',student,(req,res)=>{
    const lesson=getAccessibleLesson(req);if(!enrolled(req.auth.userId,lesson.courseId)) throw fail(403,'请先选课后再记录学习进度');
    const seconds=Number(req.body.seconds??req.body.position);if(!Number.isFinite(seconds) || seconds<0) throw fail(400,'学习进度必须是有效的非负秒数');
    const position=Math.min(seconds,lesson.duration),completed=req.body.completed===true || position>=lesson.duration*0.95?1:0;
    run('INSERT INTO progress VALUES(?,?,?,?,?,?) ON CONFLICT(userId,lessonId) DO UPDATE SET position=excluded.position,duration=excluded.duration,completed=MAX(progress.completed,excluded.completed),updatedAt=excluded.updatedAt',req.auth.userId,lesson.id,position,lesson.duration,completed,now());
    res.json({ok:true,seconds:position,completed:Boolean(completed)});
  });
  app.get('/api/materials/:id/download',auth,(req,res,next)=>{
    const material=get('SELECT m.*,u.storageName,u.name AS fileName,u.mime FROM materials m JOIN uploads u ON u.id=m.uploadId WHERE m.id=?',req.params.id);
    if(!material) throw fail(404,'资料不存在');
    const course=findCourse(material.courseId,req.auth.role==='admin',req.auth.userId);
    if(req.auth.role!=='admin' && !enrolled(req.auth.userId,course.id)) throw fail(403,'选课或购买后可下载讲义资料');
    res.setHeader('Cache-Control','private, no-store');res.download(join(uploadsDir,material.storageName),material.fileName,error=>error&&next(error));
  });
  app.get('/api/media/:id',(req,res,next)=>{
    const upload=get('SELECT * FROM uploads WHERE id=?',req.params.id);if(!upload) throw fail(404,'文件不存在');
    const expires=String(req.query.expires||''),signature=String(req.query.signature||'');
    const validSignature=Number(expires)>Date.now() && Number(expires)<Date.now()+61*60*1000 && safeEqual(signature,createHmac('sha256',secret).update(`${upload.id}:${expires}`).digest('hex'));
    if(upload.kind!=='cover' && req.auth?.role!=='admin' && !validSignature) throw fail(403,'文件访问凭证无效，请从课程页面重新打开');
    if(upload.kind==='material' && req.auth?.role!=='admin') throw fail(403,'请通过课程资料下载入口访问');
    res.setHeader('Cache-Control',upload.kind==='cover'?'public, max-age=3600':'private, no-store');res.type(upload.mime);res.sendFile(join(uploadsDir,upload.storageName),error=>error&&next(error));
  });

  app.post('/api/admin/login',(req,res)=>{
    if(textValue(req.body.username,100)!==adminUsername || !bcrypt.compareSync(String(req.body.password||''),adminHash)) throw fail(401,'管理员账号或密码错误');
    res.json({token:issueSession(null,'admin'),user:{id:'admin',nickname:'课程管理员',name:'课程管理员',role:'admin'}});
  });
  app.use('/api/admin',admin);
  const statistics=(req,res)=>{
    const revenue=get("SELECT COALESCE(SUM(amount),0) AS value FROM orders WHERE status='paid'").value/100;
    const students=get('SELECT COUNT(*) AS value FROM users').value,courses=get("SELECT COUNT(*) AS value FROM courses WHERE status!='archived'").value,orders=get('SELECT COUNT(*) AS value FROM orders').value;
    const paidOrders=get("SELECT COUNT(*) AS value FROM orders WHERE status='paid'").value;
    res.json({revenue,totalRevenue:revenue,students,totalStudents:students,courses,totalCourses:courses,orders,totalOrders:orders,paidOrders,recentOrders:all('SELECT * FROM orders ORDER BY createdAt DESC LIMIT 8').map(orderShape),publishedCourses:get("SELECT COUNT(*) AS value FROM courses WHERE status='published'").value,materials:get('SELECT COUNT(*) AS value FROM materials').value});
  };
  app.get(['/api/admin/stats','/api/admin/overview'],statistics);
  app.get('/api/admin/courses',(req,res)=>res.json(all("SELECT * FROM courses WHERE status!='archived' ORDER BY createdAt DESC,id").map(c=>courseShape(c))));
  app.get('/api/admin/courses/:id',(req,res)=>res.json(fullCourse(findCourse(req.params.id,true),null,true)));
  function courseInput(body,previous={}) {
    const merged={...previous,...body};
    const result={title:textValue(merged.title,120),subtitle:textValue(merged.subtitle,300),subject:textValue(merged.subject,20),grade:textValue(merged.grade,20),type:textValue(merged.type,20),price:currency(merged.price),originalPrice:currency(merged.originalPrice??merged.price),teacher:textValue(merged.teacher,40),teacherRole:textValue(body.teacherTitle??body.teacherRole??previous.teacherRole??'主讲老师',40),teacherColor:textValue(body.color??body.teacherColor??previous.teacherColor??'#ff8a21',30),description:textValue(merged.description,10000),coverTheme:textValue(merged.coverTheme||'orange',50),tags:JSON.stringify(Array.isArray(merged.tags)?merged.tags.slice(0,8).map(t=>textValue(t,30)):typeof merged.tags==='string'?JSON.parse(merged.tags):[]),status:textValue(merged.status||'draft',20)};
    if(!result.title || !result.subject || !result.grade || !result.type || !result.teacher) throw fail(400,'请填写课程名称、科目、年级、类型和主讲老师');
    if(result.price===null || result.originalPrice===null) throw fail(400,'课程价格必须是 0 到 999999 之间的有效金额');
    if(!['published','draft'].includes(result.status)) throw fail(400,'课程状态必须为 published 或 draft');
    if(!/^#[0-9a-f]{3,8}$/i.test(result.teacherColor)) result.teacherColor='#ff8a21';
    return result;
  }
  app.post('/api/admin/courses',(req,res)=>{const data=courseInput(req.body),id=randomUUID();run('INSERT INTO courses VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,...Object.values(data),now());res.status(201).json(fullCourse(findCourse(id,true),null,true));});
  app.put('/api/admin/courses/:id',(req,res)=>{const previous=findCourse(req.params.id,true),data=courseInput(req.body,previous);run(`UPDATE courses SET ${Object.keys(data).map(k=>`${k}=?`).join(',')} WHERE id=?`,...Object.values(data),previous.id);res.json(fullCourse(findCourse(previous.id,true),null,true));});
  app.delete('/api/admin/courses/:id',(req,res)=>{findCourse(req.params.id,true);run("UPDATE courses SET status='archived' WHERE id=?",req.params.id);res.json({ok:true,archived:true});});
  function lessonInput(body,previous={}) {
    const title=textValue(body.title??previous.title,200),duration=Number(body.duration??previous.duration??0),video=textValue(body.videoUrl??previous.videoUrl,2000);
    if(!title || !Number.isInteger(duration) || duration<1 || duration>86400) throw fail(400,'请填写课时名称和 1 到 86400 秒的时长');
    if(video && !/^https:\/\//.test(video) && !/^upload:[a-z0-9-]+$/i.test(video) && !/^\/api\/media\/[a-z0-9-]+$/i.test(video)) throw fail(400,'视频地址须为 HTTPS 链接或已上传的视频');
    const uploadId=video.startsWith('upload:')?video.slice(7):video.startsWith('/api/media/')?video.split('/').pop():null;
    if(uploadId && !get("SELECT 1 FROM uploads WHERE id=? AND kind='video'",uploadId)) throw fail(400,'上传的视频不存在');
    return {title,duration,preview:(body.isPreview??body.preview??body.freePreview??previous.preview)?1:0,videoUrl:video,sortOrder:Math.max(0,Math.floor(Number(body.sort??body.sortOrder??previous.sortOrder??0)||0))};
  }
  app.post('/api/admin/courses/:id/lessons',(req,res)=>{const course=findCourse(req.params.id,true),data=lessonInput(req.body),id=randomUUID();run('INSERT INTO lessons VALUES(?,?,?,?,?,?,?)',id,course.id,...Object.values(data));res.status(201).json(lessonShape(get('SELECT * FROM lessons WHERE id=?',id),true));});
  app.put('/api/admin/lessons/:id',(req,res)=>{const previous=get('SELECT * FROM lessons WHERE id=?',req.params.id);if(!previous) throw fail(404,'课时不存在');const data=lessonInput(req.body,previous);run(`UPDATE lessons SET ${Object.keys(data).map(k=>`${k}=?`).join(',')} WHERE id=?`,...Object.values(data),previous.id);res.json(lessonShape(get('SELECT * FROM lessons WHERE id=?',previous.id),true));});
  app.delete('/api/admin/lessons/:id',(req,res)=>{run('DELETE FROM progress WHERE lessonId=?',req.params.id);run('DELETE FROM lessons WHERE id=?',req.params.id);res.json({ok:true});});
  const allowedExtensions=new Set(['.mp4','.webm','.mov','.pdf','.txt','.md','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.jpg','.jpeg','.png','.webp']);
  const storage=multer.diskStorage({destination:(req,file,callback)=>callback(null,uploadsDir),filename:(req,file,callback)=>callback(null,`${randomUUID()}${extname(file.originalname).toLowerCase()}`)});
  const uploader=multer({storage,limits:{fileSize:250*1024*1024,files:1,fields:8},fileFilter:(req,file,callback)=>{if(!allowedExtensions.has(extname(file.originalname).toLowerCase())) return callback(fail(400,'支持 MP4/WebM/MOV 视频、PDF/Office/文本讲义和 JPG/PNG/WebP 图片'));callback(null,true);}}).single('file');
  function uploadMiddleware(req,res,next) {uploader(req,res,error=>{if(error) return next(error);next();});}
  function saveUpload(req) {
    if(!req.file) throw fail(400,'请选择需要上传的文件');
    const file=req.file,extension=extname(file.originalname).toLowerCase();
    const kind=['.mp4','.webm','.mov'].includes(extension)?'video':['.jpg','.jpeg','.png','.webp'].includes(extension)?'cover':'material';
    const mimeByExtension={'.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime','.pdf':'application/pdf','.txt':'text/plain','.md':'text/markdown','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
    const id=randomUUID();let name=file.originalname;try {name=Buffer.from(name,'latin1').toString('utf8');if(name.includes('\uFFFD')) name=file.originalname;} catch {}
    name=name.replace(/[\\/\r\n]/g,'_').slice(0,180);
    run('INSERT INTO uploads VALUES(?,?,?,?,?,?,?)',id,file.filename,name,file.size,mimeByExtension[extension]||'application/octet-stream',kind,now());
    return {uploadId:id,id,url:`/api/media/${id}`,name,fileName:name,size:file.size,mimeType:mimeByExtension[extension]||'application/octet-stream',kind};
  }
  app.post(['/api/admin/uploads','/api/admin/upload'],uploadMiddleware,(req,res)=>res.status(201).json(saveUpload(req)));
  app.post('/api/admin/courses/:id/materials',(req,res,next)=>{findCourse(req.params.id,true);if(req.is('multipart/form-data')) return uploadMiddleware(req,res,next);next();},(req,res)=>{
    const course=findCourse(req.params.id,true);let upload;
    if(req.file) upload=saveUpload(req);else if(req.body.uploadId) {const row=get('SELECT * FROM uploads WHERE id=?',req.body.uploadId);if(row) upload={uploadId:row.id,name:row.name,kind:row.kind};}
    if(!upload) throw fail(400,'请选择讲义文件或提供有效的 uploadId');
    if(upload.kind==='video' || upload.kind==='cover') throw fail(400,'讲义请上传 PDF、Office 文档或文本文件');
    const id=randomUUID(),name=textValue(req.body.title||req.body.name||upload.name,180);run('INSERT INTO materials VALUES(?,?,?,?)',id,course.id,name,upload.uploadId);
    const material=get('SELECT m.*,u.name AS fileName,u.size,u.mime,u.createdAt FROM materials m JOIN uploads u ON u.id=m.uploadId WHERE m.id=?',id);res.status(201).json(materialShape(material));
  });
  app.delete('/api/admin/materials/:id',(req,res)=>{run('DELETE FROM materials WHERE id=?',req.params.id);res.json({ok:true});});
  app.get('/api/admin/orders',(req,res)=>res.json(all('SELECT * FROM orders ORDER BY createdAt DESC').map(orderShape)));
  app.get('/api/admin/students',(req,res)=>res.json(all('SELECT u.*,COUNT(e.courseId) AS enrolledCount FROM users u LEFT JOIN enrollments e ON e.userId=u.id GROUP BY u.id ORDER BY u.createdAt DESC').map(u=>({...userShape(u),enrolledCount:u.enrolledCount}))));

  app.use('/api',(req,res)=>res.status(404).json({message:'接口不存在'}));
  const webDist=resolve(options.webDir||join(here,'../web/dist'));
  if(existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('/{*path}',(req,res)=>res.sendFile('index.html',{root:webDist}));
  }
  app.use((error,req,res,next)=>{
    if(res.headersSent) return next(error);
    const status=error.status||(error instanceof multer.MulterError?400:500);
    if(status>=500 && !options.quiet) console.error(error);
    res.status(status).json({message:error instanceof multer.MulterError?(error.code==='LIMIT_FILE_SIZE'?'文件过大，单个文件最大 250 MB':'上传文件不符合要求'):status>=500&&!error.status?'服务暂时不可用，请稍后重试':error.message});
  });
  return {app,db,close:()=>db.close(),config:{demo,uploadsDir,databasePath}};
}
