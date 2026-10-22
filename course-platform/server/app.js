import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { randomUUID, randomBytes, createHash, createHmac, timingSafeEqual, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve, join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { openDatabase } from './database.js';
import { wechatProvider, WechatAuthError, validWechatOpenid } from './wechat.js';
import { smsProvider } from './sms.js';
import { installStudentServices, contactShape } from './student-services.js';
import { logisticsProvider } from './logistics.js';
import { virtualPaymentProvider, VirtualPaymentError } from './virtual-payment.js';
import { vodProvider, vodReference, vodFileId, VodError } from './vod.js';

const here=dirname(fileURLToPath(import.meta.url));
const fail=(status,message)=>Object.assign(new Error(message),{status});
const now=()=>new Date().toISOString();
const hash=value=>createHash('sha256').update(value).digest('hex');
const safeEqual=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);};
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const textValue=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
const currency=value=>Number.isFinite(Number(value)) && Number(value)>=0 && Number(value)<=999999?Math.round(Number(value)*100)/100:null;
const savedArray=value=>{if(Array.isArray(value))return value;try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}};
const mediaLifetime=5*60*1000;

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
  const virtualPayment=options.virtualPaymentProvider||virtualPaymentProvider(env);
  const vod=options.vodProvider||vodProvider(env,{client:options.vodClient});
  const virtualMode=Boolean(env.WECHAT_VIRTUAL_OFFER_ID);
  const fetchVideo=options.mediaFetch||fetch;
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
  const userShape=u=>({id:u.id,nickname:u.name,name:u.name,phone:u.phone||'',avatar:'',createdAt:u.createdAt,role:'student',studentNumber:u.id,studentCode:u.id,wechatLinked:Boolean(u.openid && u.openid!=='demo-student'),authMethod:u.openid&&u.openid!=='demo-student'?'wechat':u.phone?'phone':'demo',...contactShape(get('SELECT * FROM student_contacts WHERE userId=?',u.id))});
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
  app.use(['/api/me','/api/my','/api/admin'],(req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
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
    return {...course,shippingEnabled:Boolean(course.shippingEnabled),tags:savedArray(course.tags),coverImage:course.coverImage||'',detailImages:savedArray(course.detailImages),productId:course.productId||'',teacherTitle:course.teacherRole,teacherAvatar:'',color:course.teacherColor,lessonCount:counts.count,studentCount:count,duration:counts.duration,enrolled:enrolled(userId,course.id),purchased:enrolled(userId,course.id),progressPercent,completedLessons};
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
    const course=get('SELECT title,shippingEnabled FROM courses WHERE id=?',order.courseId),user=get('SELECT name,phone FROM users WHERE id=?',order.userId);
    const {paymentCodeUrl,...safeOrder}=order;
    return {...safeOrder,paymentChannel:order.payChannel||null,amount:order.amount/100,amountFen:order.amount,courseTitle:course?.title||'已归档课程',shippingEnabled:Boolean(course?.shippingEnabled),shipment:studentServices.forOrder(order.id),userName:user?.name||'',phone:user?.phone||''};
  }
  function adminOrderShape(order) {
    const user=get('SELECT * FROM users WHERE id=?',order.userId);
    const identity=user?userShape(user):{studentNumber:order.userId,studentCode:order.userId,wechatLinked:false,authMethod:'unknown',...contactShape()};
    const payments=all('SELECT id,status,transactionId,amount,createdAt,paidAt,refundedAt,deliveredAt,duplicatePayment,remainingAmount,refundFinal,error FROM virtual_payments WHERE orderId=? ORDER BY createdAt,id',order.id);
    const duplicatePayments=payments.filter(payment=>payment.duplicatePayment);
    const refunds=all('SELECT r.* FROM virtual_refunds r JOIN virtual_payments p ON p.id=r.attemptId WHERE p.orderId=? ORDER BY r.createdAt,r.id',order.id);
    return {...orderShape(order),studentNumber:identity.studentNumber,studentCode:identity.studentCode,wechatLinked:identity.wechatLinked,authMethod:identity.authMethod,contactPhone:identity.contactPhone,wechatId:identity.wechatId,contactPhoneVerified:false,virtualPayments:payments.map(payment=>({...payment,amountFen:payment.amount,amount:payment.amount/100,duplicatePayment:Boolean(payment.duplicatePayment)})),virtualRefunds:refunds,duplicatePayment:duplicatePayments.length>0,duplicatePaymentCount:duplicatePayments.length,paymentReviewRequired:payments.filter(payment=>payment.status==='paid').length>1};
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

  // Attempt IDs, amounts and owners survive process restarts. Client callbacks
  // only wake reconciliation; access is granted from a server-side query result.
  const virtualChecks=new Map(),virtualRefundChecks=new Map(),virtualOrderLocks=new Map();let closed=false,reconciliationRunning=false;
  const virtualAttempts=orderId=>all('SELECT * FROM virtual_payments WHERE orderId=? ORDER BY createdAt,id',orderId);
  const hasVirtualPayment=order=>order.payChannel==='wechat-virtual' || Boolean(get('SELECT 1 FROM virtual_payments WHERE orderId=?',order.id));
  const virtualFailure=error=>error instanceof VirtualPaymentError?error:fail(502,'微信虚拟支付服务暂时不可用，请稍后重试');
  async function withVirtualOrderLock(orderId,action) {
    const previous=virtualOrderLocks.get(orderId)||Promise.resolve();
    const operation=previous.catch(()=>{}).then(action);virtualOrderLocks.set(orderId,operation);
    try{return await operation;}finally{if(virtualOrderLocks.get(orderId)===operation)virtualOrderLocks.delete(orderId);}
  }
  function reserveVirtualChannel(order) {
    const latest=get('SELECT * FROM orders WHERE id=?',order.id);
    if(latest.status!=='pending')throw fail(409,'订单状态已变化，请刷新支付结果');
    if(latest.payChannel && latest.payChannel!=='wechat-virtual')throw fail(409,'此订单已选择其他支付渠道，请继续原支付流程');
    // Reserve synchronously before any network operation can race another channel.
    run("UPDATE orders SET payChannel='wechat-virtual' WHERE id=?",order.id);
  }
  function claimVirtualAttempt(order,user,course) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const latest=get('SELECT * FROM orders WHERE id=?',order.id);
      if(latest.status!=='pending')throw fail(409,'订单状态已变化，请刷新支付结果');
      if(latest.payChannel && latest.payChannel!=='wechat-virtual')throw fail(409,'此订单已选择其他支付渠道，请继续原支付流程');
      const id=`VP${randomBytes(14).toString('hex')}`;
      run('INSERT INTO virtual_payments(id,orderId,openid,productId,amount,env,status,createdAt) VALUES(?,?,?,?,?,?,?,?)',id,order.id,user.openid,course.productId,order.amount,virtualPayment.envNumber,'pending',now());
      const attempt=get('SELECT * FROM virtual_payments WHERE id=?',id);
      run("UPDATE orders SET payChannel='wechat-virtual' WHERE id=?",order.id);
      db.exec('COMMIT');return attempt;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function recordVirtualPayment(attempt,transactionId,refunded,{finalRefund=false,remainingAmount}={}) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const current=get('SELECT * FROM virtual_payments WHERE id=?',attempt.id),order=get('SELECT * FROM orders WHERE id=?',attempt.orderId);
      if(order.payChannel!=='wechat-virtual')throw fail(409,'订单支付渠道不一致，请联系管理员核查');
      if(!refunded && current.status==='refunded' && current.refundFinal){db.exec('COMMIT');return false;}
      const duplicate=Boolean(get('SELECT 1 FROM virtual_payments WHERE orderId=? AND id!=? AND transactionId IS NOT NULL',order.id,attempt.id));
      run("UPDATE virtual_payments SET status=?,transactionId=?,paidAt=COALESCE(paidAt,?),refundedAt=CASE WHEN ? THEN COALESCE(refundedAt,?) ELSE refundedAt END,duplicatePayment=MAX(duplicatePayment,?) WHERE id=?",refunded?'refunded':'paid',transactionId,now(),refunded?1:0,now(),!current.transactionId&&duplicate?1:0,attempt.id);
      run('UPDATE virtual_payments SET remainingAmount=COALESCE(?,remainingAmount),refundFinal=MAX(refundFinal,?) WHERE id=?',remainingAmount??null,finalRefund?1:0,attempt.id);
      const active=get("SELECT 1 FROM virtual_payments WHERE orderId=? AND status='paid'",order.id);
      run('UPDATE orders SET status=?,transactionId=COALESCE(transactionId,?),paidAt=COALESCE(paidAt,?) WHERE id=?',active?'paid':'refunded',transactionId,now(),order.id);
      if(active)enroll(order.userId,order.courseId);
      else if(!get("SELECT 1 FROM orders WHERE userId=? AND courseId=? AND status='paid' AND id!=?",order.userId,order.courseId,order.id))run('DELETE FROM enrollments WHERE userId=? AND courseId=?',order.userId,order.courseId);
      db.exec('COMMIT');return !refunded;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  async function checkVirtualAttempt(attemptId) {
    if(virtualChecks.has(attemptId))return virtualChecks.get(attemptId);
    const checking=(async()=>{
      const attempt=get('SELECT * FROM virtual_payments WHERE id=?',attemptId);
      if(!attempt)throw fail(404,'虚拟支付记录不存在');
      if(attempt.env!==virtualPayment.envNumber)throw fail(503,'此订单的支付环境与当前配置不一致，请联系管理员核查');
      try {
        const remote=await virtualPayment.queryOrder({openid:attempt.openid,orderId:attempt.id});
        if(closed)throw fail(503,'服务正在重启，请稍后查询');
        const order=get('SELECT * FROM orders WHERE id=?',attempt.orderId);
        const status=remote?.status;
        if(status===0 && !attempt.transactionId && ['',attempt.id].includes(remote.order_id) && [0,attempt.env+1].includes(remote.env_type) && [0,attempt.amount].includes(remote.order_fee)) {
          run("UPDATE virtual_payments SET status='not_created',checkedAt=?,error=NULL WHERE id=?",Date.now(),attempt.id);return order;
        }
        if(!order || order.amount!==attempt.amount || remote?.order_id!==attempt.id || remote.env_type!==attempt.env+1 || ![0,7].includes(remote.order_type) || remote.order_fee!==attempt.amount || !Number.isInteger(status) || status<0 || status>10)throw fail(502,'微信支付订单信息与本地订单不一致，请联系管理员核查');
        if([2,3,4,5,7,8].includes(status) && remote.paid_fee!==attempt.amount)throw fail(502,'微信支付到账金额与订单不一致，请联系管理员核查');
        if([2,3,4,5,7,8].includes(status) && (typeof remote.wx_order_id!=='string' || !remote.wx_order_id || remote.wx_order_id.length>128 || (attempt.transactionId && attempt.transactionId!==remote.wx_order_id) || get('SELECT 1 FROM virtual_payments WHERE transactionId=? AND id!=?',remote.wx_order_id,attempt.id) || get('SELECT 1 FROM orders WHERE transactionId=? AND id!=?',remote.wx_order_id,order.id)))throw fail(502,'微信支付交易标识不一致，请联系管理员核查');
        if(remote.left_fee!==undefined && (!Number.isSafeInteger(remote.left_fee) || remote.left_fee<0 || remote.left_fee>attempt.amount))throw fail(502,'微信支付订单剩余金额无效，请联系管理员核查');
        run('UPDATE virtual_payments SET checkedAt=?,error=NULL WHERE id=?',Date.now(),attempt.id);
        if([2,3,4,5,7,8].includes(status)) {
          const fullyRefunded=remote.left_fee===0 || (status===8 && remote.refund_fee===attempt.amount && remote.left_fee===undefined);
          if(fullyRefunded) {
            recordVirtualPayment(attempt,remote.wx_order_id,true,{finalRefund:status===8,remainingAmount:0});
            return get('SELECT * FROM orders WHERE id=?',order.id);
          }
          // Refund finality belongs to the attempt. A different late payment is
          // retained and may restore entitlement, even on a refunded business order.
          if(!recordVirtualPayment(attempt,remote.wx_order_id,false,{remainingAmount:remote.left_fee}))return get('SELECT * FROM orders WHERE id=?',order.id);
          if([4,5,7,8].includes(status))run('UPDATE virtual_payments SET deliveredAt=COALESCE(deliveredAt,?) WHERE id=?',now(),attempt.id);
          else if(!attempt.deliveredAt) {
            await virtualPayment.notifyDelivered({openid:attempt.openid,orderId:attempt.id,wxOrderId:remote.wx_order_id});
            if(closed)throw fail(503,'服务正在重启，请稍后查询');
            run('UPDATE virtual_payments SET deliveredAt=? WHERE id=?',now(),attempt.id);
          }
        }else if(status===6 && !['paid','refunded'].includes(attempt.status)) {
          // Closing one attempt must leave the business order available to retry.
          run("UPDATE virtual_payments SET status='closed' WHERE id=?",attempt.id);
        }
        return get('SELECT * FROM orders WHERE id=?',order.id);
      }catch(error) {
        if(!closed && error?.code==='WECHAT_VIRTUAL_ORDER_NOT_FOUND' && !attempt.transactionId && !['paid','refunded'].includes(attempt.status)) {
          run("UPDATE virtual_payments SET status='not_created',checkedAt=?,error=NULL WHERE id=?",Date.now(),attempt.id);return get('SELECT * FROM orders WHERE id=?',attempt.orderId);
        }
        if(!closed)run('UPDATE virtual_payments SET checkedAt=?,error=? WHERE id=?',Date.now(),'RECONCILIATION_REQUIRED',attempt.id);
        throw virtualFailure(error);
      }
    })();
    virtualChecks.set(attemptId,checking);
    try{return await checking;}finally{virtualChecks.delete(attemptId);}
  }
  function claimVirtualRefund(attempt,message) {
    const merchantId=message.MchRefundId||null,wxId=message.WxRefundId||null;
    if(merchantId!==null && (typeof merchantId!=='string' || !/^[A-Za-z0-9_-]{8,32}$/.test(merchantId)))throw fail(400,'微信退款通知单号无效');
    if(wxId!==null && (typeof wxId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(wxId)))throw fail(400,'微信退款通知单号无效');
    if(!merchantId && !wxId)return null;
    const trusted=message.bodyAuthenticated===true;
    let expectedAmount=null;
    if(message.RefundFee!==undefined) {
      if(!/^\d+$/.test(String(message.RefundFee)) || !Number.isSafeInteger(Number(message.RefundFee)) || Number(message.RefundFee)<=0 || Number(message.RefundFee)>attempt.amount)throw fail(400,'微信退款通知金额无效');
      if(trusted)expectedAmount=Number(message.RefundFee);
    }
    const payWx=trusted&&typeof message.WxOrderId==='string'?message.WxOrderId:null;
    if(payWx && attempt.transactionId && payWx!==attempt.transactionId)throw fail(400,'微信退款通知原交易不一致');
    const existing=get('SELECT * FROM virtual_refunds WHERE attemptId=? AND ((? IS NOT NULL AND refundOrderId=?) OR (? IS NOT NULL AND wxRefundId=?))',attempt.id,merchantId,merchantId,wxId,wxId);
    if(existing) {
      if((existing.refundOrderId && merchantId && existing.refundOrderId!==merchantId) || (existing.wxRefundId && wxId && existing.wxRefundId!==wxId) || (existing.expectedAmount && expectedAmount && existing.expectedAmount!==expectedAmount))throw fail(400,'微信退款通知与已有记录不一致');
      run('UPDATE virtual_refunds SET refundOrderId=COALESCE(refundOrderId,?),wxRefundId=COALESCE(wxRefundId,?),payWxOrderId=COALESCE(payWxOrderId,?),expectedAmount=COALESCE(expectedAmount,?),linkVerified=MAX(linkVerified,?) WHERE id=?',merchantId,wxId,payWx,expectedAmount,trusted?1:0,existing.id);
      return existing.id;
    }
    const id=`VR${randomBytes(14).toString('hex')}`;
    run('INSERT INTO virtual_refunds(id,attemptId,refundOrderId,wxRefundId,payWxOrderId,expectedAmount,linkVerified,createdAt) VALUES(?,?,?,?,?,?,?,?)',id,attempt.id,merchantId,wxId,payWx,expectedAmount,trusted?1:0,now());
    return id;
  }
  async function checkVirtualRefund(refundId) {
    if(virtualRefundChecks.has(refundId))return virtualRefundChecks.get(refundId);
    const checking=(async()=>{
      const refund=get('SELECT * FROM virtual_refunds WHERE id=?',refundId),attempt=get('SELECT p.* FROM virtual_payments p JOIN virtual_refunds r ON r.attemptId=p.id WHERE r.id=?',refundId);
      if(!refund || !attempt)throw fail(404,'微信退款记录不存在');
      try {
        // The payment balance independently verifies the entitlement, including
        // when a plaintext notification cannot authenticate its claimed linkage.
        await checkVirtualAttempt(attempt.id);
        const current=get('SELECT * FROM virtual_payments WHERE id=?',attempt.id);
        if(refund.payWxOrderId && refund.payWxOrderId!==current.transactionId)throw fail(502,'微信退款对应的原交易不一致');
        const remote=await virtualPayment.queryOrder({openid:attempt.openid,...(refund.refundOrderId?{orderId:refund.refundOrderId}:{wxOrderId:refund.wxRefundId})});
        if(closed)throw fail(503,'服务正在重启，请稍后查询');
        if(!remote || (refund.refundOrderId && remote.order_id!==refund.refundOrderId) || typeof remote.order_id!=='string' || !/^[A-Za-z0-9_-]{8,32}$/.test(remote.order_id) || remote.env_type!==attempt.env+1 || ![1,8].includes(remote.order_type) || ![0,1,5,7,8].includes(remote.status) || !Number.isSafeInteger(remote.refund_fee) || remote.refund_fee<=0 || remote.refund_fee>attempt.amount || typeof remote.wx_order_id!=='string' || !remote.wx_order_id || remote.wx_order_id.length>128 || (refund.wxRefundId && remote.wx_order_id!==refund.wxRefundId) || (refund.expectedAmount && remote.refund_fee!==refund.expectedAmount))throw fail(502,'微信退款单信息与本地记录不一致');
        if((remote.pay_order_id!==undefined && remote.pay_order_id!==attempt.id) || (remote.pay_wx_order_id!==undefined && remote.pay_wx_order_id!==current.transactionId))throw fail(502,'微信退款单归属不一致');
        const linked=Boolean(refund.linkVerified || remote.pay_order_id===attempt.id || (current.transactionId && remote.pay_wx_order_id===current.transactionId));
        const status=remote.status===8?'refunded':remote.status===7?'failed':remote.status===5?'processing':'pending';
        run('UPDATE virtual_refunds SET refundOrderId=?,wxRefundId=?,amount=?,linkVerified=?,status=?,checkedAt=?,error=NULL WHERE id=?',remote.order_id,remote.wx_order_id,remote.refund_fee,linked?1:0,status,Date.now(),refund.id);
        const completed=get("SELECT COALESCE(SUM(amount),0) AS amount FROM virtual_refunds WHERE attemptId=? AND status='refunded' AND linkVerified=1",attempt.id).amount;
        if(completed>attempt.amount)throw fail(502,'微信退款累计金额超过支付金额，请联系管理员核查');
        if(completed===attempt.amount && current.transactionId)recordVirtualPayment(current,current.transactionId,true,{finalRefund:true,remainingAmount:0});
        // State 5 is still processing. Keep querying through state 7 or 8, and
        // refresh the payment balance after each observed refund transition.
        else await checkVirtualAttempt(attempt.id);
        return get('SELECT * FROM orders WHERE id=?',attempt.orderId);
      }catch(error) {
        if(!closed)run('UPDATE virtual_refunds SET checkedAt=?,error=? WHERE id=?',Date.now(),'RECONCILIATION_REQUIRED',refund.id);
        throw virtualFailure(error);
      }
    })();
    virtualRefundChecks.set(refundId,checking);
    try{return await checking;}finally{virtualRefundChecks.delete(refundId);}
  }
  async function checkVirtualOrder(orderId) {
    let failure;
    // Every prior attempt must be checked before issuing another outTradeNo.
    // Continue after an error so a separate paid attempt can still grant access.
    for(const attempt of virtualAttempts(orderId)) {
      try{await checkVirtualAttempt(attempt.id);}catch(error){failure ||= error;}
    }
    for(const refund of all("SELECT r.id FROM virtual_refunds r JOIN virtual_payments p ON p.id=r.attemptId WHERE p.orderId=? AND r.status IN ('pending','processing')",orderId)) {
      try{await checkVirtualRefund(refund.id);}catch(error){failure ||= error;}
    }
    const order=get('SELECT * FROM orders WHERE id=?',orderId);
    if(failure)throw failure;
    return order;
  }
  async function reconcileVirtualPayments({force=false}={}) {
    if(closed || reconciliationRunning || !virtualPayment.configured)return;
    reconciliationRunning=true;
    try {
      const timestamp=Date.now(),pendingDelay=force?0:60000,paidDelay=force?0:15*60000;
      const attempts=all("SELECT id FROM virtual_payments WHERE env=? AND (((status='pending' OR (status='refunded' AND refundFinal=0) OR (status='paid' AND deliveredAt IS NULL)) AND checkedAt<=?) OR ((status IN ('closed','not_created') OR (status='paid' AND deliveredAt IS NOT NULL)) AND checkedAt<=?)) ORDER BY checkedAt,createdAt LIMIT 50",virtualPayment.envNumber,force?timestamp:timestamp-pendingDelay,force?timestamp:timestamp-paidDelay);
      for(const attempt of attempts) {
        if(closed)break;
        try{await checkVirtualAttempt(attempt.id);}catch{/* Persistent rows are retried by the next scheduled run. */}
      }
      for(const refund of all("SELECT r.id FROM virtual_refunds r JOIN virtual_payments p ON p.id=r.attemptId WHERE p.env=? AND (r.status IN ('pending','processing') OR r.error IS NOT NULL) AND r.checkedAt<=? ORDER BY r.checkedAt,r.createdAt LIMIT 50",virtualPayment.envNumber,force?timestamp:timestamp-pendingDelay)) {
        if(closed)break;
        try{await checkVirtualRefund(refund.id);}catch{/* Persisted refund transitions retry after restart as well. */}
      }
    }finally{reconciliationRunning=false;}
  }

  app.get('/api/health',(req,res)=>res.json({ok:true,mode:demo?'demo':'production'}));
  app.get('/api/config',(req,res)=>res.json({demoMode:demo,wechatConfigured:wechat.appConfigured,smsConfigured,paymentConfigured:wechat.payConfigured,virtualPaymentConfigured:virtualPayment.configured,paymentMode:virtualMode?'wechat-virtual':'wechat',mode:demo?'development':'production',devLoginEnabled:demo,smsEnabled:smsConfigured||demo,wechatEnabled:wechat.appConfigured,paymentEnabled:virtualMode?virtualPayment.configured:wechat.payConfigured}));
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
  app.patch('/api/me',student,(req,res)=>{
    const updateName=Object.hasOwn(req.body,'nickname') || Object.hasOwn(req.body,'name');
    const updateContact=Object.hasOwn(req.body,'contactPhone') || Object.hasOwn(req.body,'wechatId');
    if(!updateName && !updateContact)throw fail(400,'请提供昵称或联系信息');
    const name=updateName?textValue(req.body.nickname||req.body.name,32):null;
    if(updateName && !name)throw fail(400,'昵称不能为空');
    db.exec('BEGIN IMMEDIATE');
    try {
      if(updateContact)studentServices.saveContact(req.auth.userId,req.body);
      if(updateName)run('UPDATE users SET name=? WHERE id=?',name,req.auth.userId);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    res.json(userShape(get('SELECT * FROM users WHERE id=?',req.auth.userId)));
  });
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
  app.post('/api/orders/:id/virtual-pay',student,loginLimit,asyncRoute(async(req,res)=>{
    if(!virtualPayment.configured)throw fail(503,'微信虚拟支付尚未配置完整，请联系管理员');
    const order=ownedOrder(req);
    if(order.status==='paid')return res.json({paid:true,order:orderShape(order),provider:'wechat-virtual'});
    if(order.status!=='pending')throw fail(409,'订单状态不能支付，请重新选课下单');
    const user=get('SELECT * FROM users WHERE id=?',req.auth.userId),course=findCourse(order.courseId);
    if(!validWechatOpenid(user?.openid) || user.openid==='demo-student')throw fail(409,'请先使用微信登录或在账号中关联微信');
    if(typeof req.body.code!=='string' || !req.body.code || req.body.code.length>256 || /\s/.test(req.body.code))throw fail(400,'请提供新的微信登录 code 以确认支付身份');
    if(!course.productId)throw fail(503,'此课程尚未配置微信虚拟支付商品，请联系管理员');
    if(order.amount!==Math.round(course.price*100) || order.amount<=0)throw fail(409,'课程价格已变化，请联系管理员核查原订单');
    reserveVirtualChannel(order);
    await withVirtualOrderLock(order.id,async()=>{
      const checked=await checkVirtualOrder(order.id);
      if(checked.status==='paid')return res.json({paid:true,order:orderShape(checked),provider:'wechat-virtual'});
      if(checked.status!=='pending')throw fail(409,'订单状态已变化，请先查询支付结果');
      // session_key is used only in this request and is never persisted or returned.
      let session;
      try{session=await wechat.login(req.body.code);}catch(error){throw error instanceof WechatAuthError?error:fail(502,'微信支付身份验证暂时不可用，请重新授权');}
      if(!validWechatOpenid(session?.openid) || session.openid!==user.openid)throw fail(403,'当前微信账号与订单购买账号不一致，请使用原微信账号授权');
      if(!session.session_key)throw fail(401,'微信登录态已失效，请重新授权后支付');
      const latest=get('SELECT * FROM orders WHERE id=?',order.id);
      if(latest.status==='paid')return res.json({paid:true,order:orderShape(latest),provider:'wechat-virtual'});
      if(latest.status!=='pending')throw fail(409,'订单状态已变化，请先查询支付结果');
      const attempt=claimVirtualAttempt(latest,user,course);
      try {
        const paymentParams=virtualPayment.createPayment({attemptId:attempt.id,productId:attempt.productId,amount:attempt.amount,openid:attempt.openid,sessionKey:session.session_key,attach:JSON.stringify({orderId:order.id})});
        res.setHeader('Cache-Control','private, no-store');res.json({...paymentParams,provider:'wechat-virtual'});
      }catch(error){throw virtualFailure(error);}
    });
  }));
  app.post('/api/orders/:id/sync-payment',student,asyncRoute(async(req,res)=>{
    const order=ownedOrder(req);
    if(!virtualAttempts(order.id).length)return res.json({order:orderShape(order)});
    if(!virtualPayment.configured)throw fail(503,'微信虚拟支付尚未配置完整，请联系管理员');
    const updated=await checkVirtualOrder(order.id);
    res.json({order:orderShape(updated)});
  }));
  const demoPay=(req,res)=>{ensureDemo();const order=ownedOrder(req);if(hasVirtualPayment(order))throw fail(409,'此订单已发起微信虚拟支付，请查询支付结果');if(order.status!=='paid') findCourse(order.courseId);res.json({demo:true,order:orderShape(settleOrder(order,`demo-${order.id}`))});};
  app.post(['/api/orders/:id/demo-pay','/api/orders/:id/dev-pay'],student,demoPay);
  app.post('/api/orders/:id/cancel',student,asyncRoute(async(req,res)=>{
    const order=ownedOrder(req);
    if(order.status==='paid')return res.json({paid:true,order:orderShape(order)});
    if(order.status==='cancelled')return res.json({cancelled:true,order:orderShape(order)});
    if(order.status!=='pending')throw fail(409,'订单状态不能取消');
    if(hasVirtualPayment(order))throw fail(409,'微信虚拟支付已发起，当前无法安全关闭支付单，请先查询支付结果');
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
    if(hasVirtualPayment(order))throw fail(409,'此订单已选择微信虚拟支付，请继续原支付流程');
    if(order.status!=='pending')throw fail(409,'订单状态不能支付');
    if(order.payChannel==='native')throw fail(409,'此订单已选择微信扫码支付，请继续使用二维码付款');
    const user=get('SELECT * FROM users WHERE id=?',req.auth.userId),course=findCourse(order.courseId);
    if(!wechat.payConfigured) throw fail(503,'微信支付商户参数尚未配置完整，当前无法付款');
    run("UPDATE orders SET payChannel='jsapi' WHERE id=? AND status='pending'",order.id);
    try {const params=await wechat.createPayment(order,user.openid,course.title);res.json({paymentParams:params,payment:{mode:'wechat',params}});} catch(error) {throw fail(502,'微信支付暂时不可用，请稍后重试');}
  }));
  app.post('/api/orders/:id/native-pay',student,asyncRoute(async(req,res)=>{
    if(demo) throw fail(503,'演示环境不提供真实微信扫码支付');
    const order=ownedOrder(req);if(order.status==='paid')return res.json({order:orderShape(order),paid:true});
    if(hasVirtualPayment(order))throw fail(409,'此订单已选择微信虚拟支付，请继续原支付流程');
    if(order.status!=='pending')throw fail(409,'订单状态不能支付');
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
      if(hasVirtualPayment(order))throw fail(409,'此订单已选择虚拟支付，不能使用普通微信支付通知开课');
      const expectedTradeType=order.payChannel==='native'?'NATIVE':'JSAPI';
      if(payment.trade_type!==expectedTradeType)throw fail(400,'支付通知交易类型与订单不一致');
      const user=get('SELECT openid FROM users WHERE id=?',order.userId);
      if(expectedTradeType==='JSAPI'&&(!user.openid || payment.payer?.openid!==user.openid)) throw fail(400,'支付通知付款用户不一致');
      if(expectedTradeType==='NATIVE'&&!payment.payer?.openid)throw fail(400,'二维码支付通知缺少付款用户信息');
      if(order.status==='paid' && order.transactionId!==payment.transaction_id) throw fail(409,'支付交易号不一致');
      settleOrder(order,payment.transaction_id);res.status(200).json({code:'SUCCESS',message:'成功'});
    } catch(error) {res.status(error.status||400).json({code:'FAIL',message:error.message});}
  });
  app.get('/api/payments/wechat-virtual/notify',(req,res,next)=>{
    try{res.type('text/plain').send(virtualPayment.verifyChallenge(req.query));}catch(error){next(virtualFailure(error));}
  });
  app.post('/api/payments/wechat-virtual/notify',express.text({type:['application/xml','text/xml','text/plain'],limit:'256kb'}),async(req,res)=>{
    try {
      const message=virtualPayment.verifyMessage(req.query,req.body);
      if(!['xpay_goods_deliver_notify','xpay_refund_notify'].includes(message.Event))return res.type('application/xml').send('<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>');
      const attemptId=message.OutTradeNo||message.MchOrderId;
      if(typeof attemptId!=='string')throw fail(400,'微信支付通知缺少订单号');
      const attempt=get('SELECT * FROM virtual_payments WHERE id=?',attemptId);
      if(!attempt)throw fail(404,'微信支付通知对应的订单不存在');
      if(message.OpenId!==undefined && message.OpenId!==attempt.openid)throw fail(400,'微信支付通知用户不一致');
      if(message.Env!==undefined && String(attempt.env)!==message.Env)throw fail(400,'微信支付通知环境不一致');
      if(message.Event==='xpay_refund_notify') {
        const refundId=claimVirtualRefund(attempt,message);
        if(refundId)await checkVirtualRefund(refundId);else await checkVirtualAttempt(attempt.id);
      }else await checkVirtualAttempt(attempt.id);
      res.type('application/xml').send('<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>');
    }catch(error) {
      const status=error instanceof VirtualPaymentError?error.status:error.status||502;
      res.status(status).type('application/xml').send('<xml><ErrCode>1</ErrCode><ErrMsg><![CDATA[retry]]></ErrMsg></xml>');
    }
  });

  function accessibleLesson(id,identity) {
    const lesson=get('SELECT * FROM lessons WHERE id=?',id);if(!lesson) throw fail(404,'课时不存在');
    const adminAccess=identity?.role==='admin';const course=findCourse(lesson.courseId,adminAccess,identity?.userId);
    if(!adminAccess && !lesson.preview && !enrolled(identity?.userId,course.id) && course.price!==0) throw fail(identity?403:401,'购买课程后即可学习本课时');
    return lesson;
  }
  const getAccessibleLesson=req=>accessibleLesson(req.params.id,req.auth);
  function uploadedVideoId(lesson) {
    const match=lesson.videoUrl.match(/^(?:upload:|\/api\/media\/)([a-z0-9-]+)$/i);
    return match?.[1]||null;
  }
  const sessionBinding=identity=>createHmac('sha256',secret).update(`media-session:${identity.hash}`).digest('hex');
  function mediaCookieSession(req) {
    const cookie=req.headers.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith('zhike_media='))?.slice('zhike_media='.length);
    if(!cookie || !/^[a-zA-Z0-9_-]{43}$/.test(cookie)) return null;
    return get('SELECT s.*,m.expires AS mediaExpires FROM media_sessions m JOIN sessions s ON s.hash=m.sessionHash WHERE m.hash=? AND m.expires>? AND s.expires>?',hash(cookie),Date.now(),Date.now());
  }
  function issueMediaCookie(req,res) {
    if(!req.auth)return;
    const existing=mediaCookieSession(req);
    if(existing?.hash===req.auth.hash && existing.mediaExpires>Date.now()+mediaLifetime/2)return;
    run('DELETE FROM media_sessions WHERE expires < ?',Date.now());
    const proof=randomBytes(32).toString('base64url');
    run('INSERT INTO media_sessions VALUES(?,?,?)',hash(proof),req.auth.hash,Math.min(req.auth.expires,Date.now()+mediaLifetime));
    // This cookie only authorizes media requests; copied URLs carry no login secret.
    res.cookie('zhike_media',proof,{httpOnly:true,secure:production,sameSite:'lax',path:'/api',maxAge:mediaLifetime});
  }
  function signedMedia(lesson,identity) {
    const uploadId=uploadedVideoId(lesson),resource=uploadId?`upload:${uploadId}`:`remote:${hash(lesson.videoUrl)}`;
    const expires=String(Math.min(identity?.expires||Infinity,Date.now()+mediaLifetime));
    const session=identity?sessionBinding(identity):'public';
    const signature=createHmac('sha256',secret).update(`${resource}:${lesson.id}:${session}:${expires}`).digest('hex');
    const path=uploadId?`/api/media/${uploadId}`:`/api/lessons/${lesson.id}/stream`;
    return {url:`${path}?${new URLSearchParams({lessonId:lesson.id,session,expires,signature})}`,expiresAt:Number(expires)};
  }
  function verifyMediaRequest(req,lesson,resource) {
    const expires=String(req.query.expires||''),signature=String(req.query.signature||''),session=String(req.query.session||'');
    const expected=createHmac('sha256',secret).update(`${resource}:${lesson.id}:${session}:${expires}`).digest('hex');
    if(!/^\d{13}$/.test(expires) || Number(expires)<=Date.now() || Number(expires)>Date.now()+mediaLifetime+5000 || !safeEqual(signature,expected)) throw fail(403,'视频凭证无效或已过期，请重新打开课时');
    if(session==='public') {
      // Recheck publication/preview so an old preview link cannot expose a newly paid lesson.
      accessibleLesson(lesson.id,null);
      return;
    }
    const identity=req.auth||mediaCookieSession(req);
    if(!identity || !safeEqual(session,sessionBinding(identity))) throw fail(403,'请在已登录的学习页面播放视频');
    accessibleLesson(lesson.id,identity);
  }
  const remoteHosts=new Set(String(env.VIDEO_REMOTE_HOSTS||'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean));
  if(demo) remoteHosts.add('interactive-examples.mdn.mozilla.net');
  function allowedRemoteVideo(value) {
    let parsed;try {parsed=new URL(value);} catch {throw fail(503,'视频源不可用，请联系管理员重新上传视频');}
    if(parsed.protocol!=='https:' || parsed.username || parsed.password || (parsed.port && parsed.port!=='443') || !remoteHosts.has(parsed.hostname.toLowerCase())) throw fail(503,'此视频尚未配置受保护的视频源，请联系管理员上传视频');
    return parsed;
  }
  const play=asyncRoute(async(req,res)=>{
    const lesson=getAccessibleLesson(req);const p=req.auth?.userId?get('SELECT * FROM progress WHERE userId=? AND lessonId=?',req.auth.userId,lesson.id):null;
    if(!lesson.videoUrl) throw fail(404,'本课时视频尚未上传，请稍后再试');
    const fileId=vodReference(lesson.videoUrl);
    if(fileId) {
      const record=ownedVodMedia(fileId),media=await refreshVodMedia(record);
      const playback=await vod.playback(media,req.auth?.expires);
      res.setHeader('Cache-Control','private, no-store');
      return res.json({...lessonShape(lesson,false),...playback,videoUrl:playback.url,progress:p?.position||0,demoVideo:false});
    }
    const uploadId=uploadedVideoId(lesson);
    if(uploadId && !get("SELECT 1 FROM uploads WHERE id=? AND kind='video'",uploadId))throw fail(404,'视频文件不存在，请联系管理员重新上传');
    if(!uploadId)allowedRemoteVideo(lesson.videoUrl);
    issueMediaCookie(req,res);
    const media=signedMedia(lesson,req.auth);
    res.setHeader('Cache-Control','private, no-store');
    res.json({...lessonShape(lesson,false),url:media.url,videoUrl:media.url,expiresAt:media.expiresAt,requiresAuthorizedDownload:Boolean(req.auth),playbackAuth:req.auth?'session':'public',progress:p?.position||0,demoVideo:lesson.videoUrl.includes('interactive-examples.mdn')});
  });
  app.get(['/api/lessons/:id/play','/api/lessons/:id'],play);
  app.get('/api/lessons/:id/stream',asyncRoute(async(req,res)=>{
    const lesson=get('SELECT * FROM lessons WHERE id=?',req.params.id);
    if(!lesson || uploadedVideoId(lesson) || vodReference(lesson.videoUrl) || req.query.lessonId!==lesson.id)throw fail(404,'视频不存在');
    verifyMediaRequest(req,lesson,`remote:${hash(lesson.videoUrl)}`);
    let target=allowedRemoteVideo(lesson.videoUrl),upstream;
    const headers={'Accept':'video/*,application/octet-stream','Accept-Encoding':'identity'};
    if(req.headers.range)headers.Range=req.headers.range;
    if(req.headers['if-range'])headers['If-Range']=req.headers['if-range'];
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try {
      for(let redirects=0;redirects<4;redirects++) {
        upstream=await fetchVideo(target,{method:req.method==='HEAD'?'HEAD':'GET',headers,redirect:'manual',signal:controller.signal});
        if(![301,302,303,307,308].includes(upstream.status))break;
        const location=upstream.headers.get('location');await upstream.body?.cancel();
        if(!location || redirects===3)throw fail(502,'视频源重定向异常');
        target=allowedRemoteVideo(new URL(location,target).href);
      }
    }catch(error){if(error.status)throw error;throw fail(502,'视频源暂时无法连接，请稍后再试');}finally{clearTimeout(timer);}
    if(![200,206,416].includes(upstream.status)) {await upstream.body?.cancel();throw fail(502,'视频源暂时不可用，请稍后再试');}
    if(upstream.status!==416 && !/^(video\/|application\/octet-stream)/i.test(upstream.headers.get('content-type')||'')) {await upstream.body?.cancel();throw fail(502,'视频源没有返回有效的视频文件');}
    res.status(upstream.status).setHeader('Cache-Control','private, no-store');
    for(const header of ['content-type','content-length','content-range','accept-ranges','last-modified','etag']) {const value=upstream.headers.get(header);if(value)res.setHeader(header,value);}
    if(req.method==='HEAD' || !upstream.body)return res.end();
    await pipeline(Readable.fromWeb(upstream.body),res);
  }));
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
    if(upload.kind==='video' && req.auth?.role!=='admin') {
      const lesson=get('SELECT * FROM lessons WHERE id=?',textValue(req.query.lessonId));
      if(!lesson || uploadedVideoId(lesson)!==upload.id)throw fail(403,'请通过课程页面访问视频');
      verifyMediaRequest(req,lesson,`upload:${upload.id}`);
    }
    if(upload.kind==='material' && req.auth?.role!=='admin') throw fail(403,'请通过课程资料下载入口访问');
    if(upload.kind==='cover')res.setHeader('Cross-Origin-Resource-Policy','cross-origin');
    res.setHeader('Cache-Control',upload.kind==='cover'?'public, max-age=3600':'private, no-store');res.type(upload.mime);res.sendFile(upload.storageName,{root:uploadsDir},error=>error&&next(error));
  });

  app.post('/api/admin/login',(req,res)=>{
    if(textValue(req.body.username,100)!==adminUsername || !bcrypt.compareSync(String(req.body.password||''),adminHash)) throw fail(401,'管理员账号或密码错误');
    res.json({token:issueSession(null,'admin'),user:{id:'admin',nickname:'课程管理员',name:'课程管理员',role:'admin'}});
  });
  app.use('/api/admin',admin);
  const vodShape=record=>({provider:'tencent-vod',uploadId:record.id,fileId:record.fileId,videoUrl:record.fileId?`vod:${record.fileId}`:'',name:record.name,duration:record.duration,size:record.size,status:record.status,ready:record.status==='ready',format:record.format,taskId:record.taskId||null,errorMessage:record.error||'',createdAt:record.createdAt});
  function ownedVodMedia(fileId) {
    if(!vod.configured)throw fail(503,'腾讯云点播尚未配置完整，请联系管理员');
    const record=get('SELECT * FROM vod_uploads WHERE fileId=? AND subAppId=?',fileId,vod.subAppId);
    if(!record)throw fail(404,'此视频未通过本后台上传确认，不能关联或播放');
    return record;
  }
  const vodRefreshes=new Map();
  async function refreshVodMedia(record,{force=false}={}) {
    if(!force && record.status==='ready' && record.checkedAt>Date.now()-30000 && record.sourceUrl && record.format)return {...record,ready:true};
    if(vodRefreshes.has(record.id))return vodRefreshes.get(record.id);
    const refreshing=(async()=>{
      const remote=await vod.describe(record.fileId);
      if(remote.sourceContext!==record.sourceContext)throw fail(403,'云点播视频与本次上传不匹配，不能关联课程');
      let status=remote.status,error='';
      if(!remote.ready && record.taskId) {
        const task=await vod.taskStatus(record.taskId);
        if(task.status==='failed'){status='failed';error=task.message;}
      }
      run('UPDATE vod_uploads SET name=?,status=?,duration=?,size=?,format=?,sourceUrl=?,error=?,checkedAt=? WHERE id=?',remote.name,status,remote.duration,remote.size,remote.format,remote.sourceUrl,error,Date.now(),record.id);
      return {...get('SELECT * FROM vod_uploads WHERE id=?',record.id),ready:status==='ready'};
    })();vodRefreshes.set(record.id,refreshing);
    try{return await refreshing;}finally{vodRefreshes.delete(record.id);}
  }
  app.get('/api/admin/vod/config',asyncRoute(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    if(!vod.configured)return res.json({...vod.publicConfig,protectionReady:false});
    try {
      await vod.ensureProtection();
      res.json({...vod.publicConfig,protectionReady:true});
    } catch(error) {
      res.json({...vod.publicConfig,uploadConfigured:false,playbackConfigured:false,protectionReady:false,message:error instanceof VodError?error.message:'暂时无法确认云点播保护状态，请稍后重试'});
    }
  }));
  app.post('/api/admin/vod/upload-signature',asyncRoute(async(req,res)=>{
    const id=randomUUID(),sourceContext=`course-upload:${id}:${randomBytes(12).toString('hex')}`;
    const signature=await vod.uploadSignature(sourceContext);
    run('INSERT INTO vod_uploads(id,subAppId,sourceContext,name,createdAt) VALUES(?,?,?,?,?)',id,vod.subAppId,sourceContext,textValue(req.body.name,200),now());
    res.setHeader('Cache-Control','private, no-store');res.json({...signature,uploadId:id,provider:'tencent-vod',subAppId:vod.subAppId});
  }));
  app.post('/api/admin/vod/media/confirm',asyncRoute(async(req,res)=>{
    const fileId=vodFileId(req.body.fileId),uploadId=textValue(req.body.uploadId,80);
    if(!fileId)throw fail(400,'请提供有效的云点播 FileId');
    const record=get('SELECT * FROM vod_uploads WHERE id=? AND subAppId=?',uploadId,vod.subAppId);
    if(!record)throw fail(404,'上传记录不存在或不属于当前点播应用');
    if(record.fileId && record.fileId!==fileId)throw fail(409,'此上传记录已关联其他视频');
    const existing=get('SELECT id FROM vod_uploads WHERE fileId=?',fileId);
    if(existing && existing.id!==record.id)throw fail(409,'此视频已由其他上传记录确认');
    const remote=await vod.describe(fileId);
    if(remote.sourceContext!==record.sourceContext)throw fail(403,'云点播视频与本次上传不匹配，不能关联课程');
    run('UPDATE vod_uploads SET fileId=?,name=?,status=?,duration=?,size=?,format=?,sourceUrl=?,checkedAt=? WHERE id=?',fileId,remote.name,remote.status,remote.duration,remote.size,remote.format,remote.sourceUrl,Date.now(),record.id);
    if(!remote.ready && !record.taskId) {
      const taskId=await vod.transcode(fileId,record.id);
      run("UPDATE vod_uploads SET taskId=?,status='processing',error=NULL WHERE id=?",taskId,record.id);
    }
    res.json(vodShape(get('SELECT * FROM vod_uploads WHERE id=?',record.id)));
  }));
  app.get('/api/admin/vod/media/:fileId',asyncRoute(async(req,res)=>{
    const media=await refreshVodMedia(ownedVodMedia(req.params.fileId),{force:true});
    res.setHeader('Cache-Control','private, no-store');res.json(vodShape(media));
  }));
  app.post('/api/admin/vod/media/:fileId/transcode',asyncRoute(async(req,res)=>{
    const record=ownedVodMedia(req.params.fileId);
    if(record.status!=='failed')throw fail(409,'只有转码失败的视频可以重新发起转码');
    const taskId=await vod.transcode(record.fileId,`${record.id}-${randomBytes(3).toString('hex')}`);
    run("UPDATE vod_uploads SET taskId=?,status='processing',error=NULL,checkedAt=0 WHERE id=?",taskId,record.id);res.json(vodShape(get('SELECT * FROM vod_uploads WHERE id=?',record.id)));
  }));
  const statistics=(req,res)=>{
    const revenue=get("SELECT COALESCE(SUM(amount),0) AS value FROM orders WHERE status='paid'").value/100;
    const students=get('SELECT COUNT(*) AS value FROM users').value,courses=get("SELECT COUNT(*) AS value FROM courses WHERE status!='archived'").value,orders=get('SELECT COUNT(*) AS value FROM orders').value;
    const paidOrders=get("SELECT COUNT(*) AS value FROM orders WHERE status='paid'").value;
    res.json({revenue,totalRevenue:revenue,students,totalStudents:students,courses,totalCourses:courses,orders,totalOrders:orders,paidOrders,recentOrders:all('SELECT * FROM orders ORDER BY createdAt DESC LIMIT 8').map(adminOrderShape),paymentReviewRequired:get("SELECT COUNT(*) AS value FROM (SELECT orderId FROM virtual_payments WHERE status='paid' GROUP BY orderId HAVING COUNT(*)>1)").value,publishedCourses:get("SELECT COUNT(*) AS value FROM courses WHERE status='published'").value,materials:get('SELECT COUNT(*) AS value FROM materials').value});
  };
  app.get(['/api/admin/stats','/api/admin/overview'],statistics);
  app.get('/api/admin/courses',(req,res)=>res.json(all(`SELECT * FROM courses ${req.query.includeArchived==='true'?'':"WHERE status!='archived'"} ORDER BY createdAt DESC,id`).map(c=>courseShape(c))));
  app.get('/api/admin/courses/:id',(req,res)=>res.json(fullCourse(findCourse(req.params.id,true),null,true)));
  function courseInput(body,previous={}) {
    const merged={...previous,...body};
    function imageUrl(value) {
      if(value===undefined || value==='')return '';
      if(typeof value!=='string' || value.length>2000 || /[\x00-\x20]/.test(value))throw fail(400,'课程图片须为有效的上传图片地址或 HTTPS 地址');
      const media=value.match(/^\/api\/media\/([a-z0-9-]+)$/i);
      if(media) {
        if(!get("SELECT 1 FROM uploads WHERE id=? AND kind='cover'",media[1]))throw fail(400,'课程图片文件不存在或不是图片');
        return value;
      }
      let parsed;try {parsed=new URL(value);}catch{throw fail(400,'课程图片地址无效');}
      if(parsed.protocol!=='https:' || parsed.username || parsed.password)throw fail(400,'课程图片仅支持 HTTPS 地址和上传图片');
      return parsed.href;
    }
    const detailImages=body.detailImages===undefined?savedArray(previous.detailImages):body.detailImages;
    if(!Array.isArray(detailImages) || detailImages.length>20)throw fail(400,'课程详情图片须为数组，最多 20 张');
    const tags=body.tags===undefined?savedArray(previous.tags):body.tags;
    if(!Array.isArray(tags) || tags.length>8 || tags.some(tag=>typeof tag!=='string'))throw fail(400,'课程标签须为文字数组，最多 8 个');
    const productId=body.productId===undefined?(previous.productId||''):body.productId;
    if(typeof productId!=='string' || productId.length>128 || (productId && !/^[a-zA-Z0-9_.-]+$/.test(productId)))throw fail(400,'商品编号须为 128 位以内的字母、数字、点、下划线或短横线');
    if(body.shippingEnabled!==undefined && typeof body.shippingEnabled!=='boolean')throw fail(400,'讲义寄送选项必须为布尔值');
    const result={title:textValue(merged.title,120),subtitle:textValue(merged.subtitle,300),subject:textValue(merged.subject,20),grade:textValue(merged.grade,20),type:textValue(merged.type,20),price:currency(merged.price),originalPrice:currency(merged.originalPrice??merged.price),teacher:textValue(merged.teacher,40),teacherRole:textValue(body.teacherTitle??body.teacherRole??previous.teacherRole??'主讲老师',40),teacherColor:textValue(body.color??body.teacherColor??previous.teacherColor??'#ff8a21',30),description:textValue(merged.description,10000),coverTheme:textValue(merged.coverTheme||'orange',50),tags:JSON.stringify(tags.map(t=>textValue(t,30)).filter(Boolean)),status:textValue(merged.status||'draft',20),coverImage:imageUrl(merged.coverImage),detailImages:JSON.stringify(detailImages.map(imageUrl).filter(Boolean)),productId,shippingEnabled:(body.shippingEnabled??previous.shippingEnabled)?1:0};
    if(!result.title || !result.subject || !result.grade || !result.type || !result.teacher) throw fail(400,'请填写课程名称、科目、年级、类型和主讲老师');
    if(result.price===null || result.originalPrice===null) throw fail(400,'课程价格必须是 0 到 999999 之间的有效金额');
    if(!['published','draft'].includes(result.status)) throw fail(400,'课程状态必须为 published 或 draft');
    if(!/^#[0-9a-f]{3,8}$/i.test(result.teacherColor)) result.teacherColor='#ff8a21';
    return result;
  }
  app.post('/api/admin/courses',(req,res)=>{const data=courseInput(req.body),id=randomUUID();run(`INSERT INTO courses(id,${Object.keys(data).join(',')},createdAt) VALUES(${Array(Object.keys(data).length+2).fill('?').join(',')})`,id,...Object.values(data),now());res.status(201).json(fullCourse(findCourse(id,true),null,true));});
  app.put('/api/admin/courses/:id',(req,res)=>{const previous=findCourse(req.params.id,true),data=courseInput(req.body,previous);run(`UPDATE courses SET ${Object.keys(data).map(k=>`${k}=?`).join(',')} WHERE id=?`,...Object.values(data),previous.id);res.json(fullCourse(findCourse(previous.id,true),null,true));});
  app.delete('/api/admin/courses/:id',(req,res)=>{findCourse(req.params.id,true);run("UPDATE courses SET status='archived' WHERE id=?",req.params.id);res.json({ok:true,archived:true});});
  async function lessonInput(body,previous={}) {
    const title=textValue(body.title??previous.title,200),duration=Number(body.duration??previous.duration??0),video=textValue(body.videoUrl??previous.videoUrl,2000);
    if(!title || !Number.isInteger(duration) || duration<1 || duration>86400) throw fail(400,'请填写课时名称和 1 到 86400 秒的时长');
    if(video && !/^https:\/\//.test(video) && !/^upload:[a-z0-9-]+$/i.test(video) && !/^\/api\/media\/[a-z0-9-]+$/i.test(video) && !vodReference(video)) throw fail(400,'视频地址须为 HTTPS 链接、已上传的视频或已确认的云点播视频');
    if(vodReference(video)) {
      const media=await refreshVodMedia(ownedVodMedia(vodReference(video)),{force:true});
      if(!media.ready)throw fail(409,media.status==='failed'?'云视频转码失败，请重新转码后保存课时':'云视频正在转码，完成后才可保存课时');
    }
    const uploadId=video.startsWith('upload:')?video.slice(7):video.startsWith('/api/media/')?video.split('/').pop():null;
    if(uploadId && !get("SELECT 1 FROM uploads WHERE id=? AND kind='video'",uploadId)) throw fail(400,'上传的视频不存在');
    return {title,duration,preview:(body.isPreview??body.preview??body.freePreview??previous.preview)?1:0,videoUrl:video,sortOrder:Math.max(0,Math.floor(Number(body.sort??body.sortOrder??previous.sortOrder??0)||0))};
  }
  app.post('/api/admin/courses/:id/lessons',asyncRoute(async(req,res)=>{const course=findCourse(req.params.id,true),data=await lessonInput(req.body),id=randomUUID();run('INSERT INTO lessons VALUES(?,?,?,?,?,?,?)',id,course.id,...Object.values(data));res.status(201).json(lessonShape(get('SELECT * FROM lessons WHERE id=?',id),true));}));
  app.put('/api/admin/lessons/:id',asyncRoute(async(req,res)=>{const previous=get('SELECT * FROM lessons WHERE id=?',req.params.id);if(!previous) throw fail(404,'课时不存在');const data=await lessonInput(req.body,previous);run(`UPDATE lessons SET ${Object.keys(data).map(k=>`${k}=?`).join(',')} WHERE id=?`,...Object.values(data),previous.id);res.json(lessonShape(get('SELECT * FROM lessons WHERE id=?',previous.id),true));}));
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
  app.get('/api/admin/orders',(req,res)=>res.json(all('SELECT * FROM orders ORDER BY createdAt DESC').map(adminOrderShape)));
  app.get('/api/admin/students',(req,res)=>res.json(all('SELECT u.*,COUNT(e.courseId) AS enrolledCount FROM users u LEFT JOIN enrollments e ON e.userId=u.id GROUP BY u.id ORDER BY u.createdAt DESC').map(u=>({...userShape(u),enrolledCount:u.enrolledCount}))));

  const studentServices=installStudentServices(app,{db,student,admin,userShape,logistics:options.logisticsProvider||logisticsProvider(env)});
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
  let reconcileTimer,startupTimer;
  if(virtualPayment.configured && options.virtualReconciliation!==false) {
    const interval=Math.max(10,Number(options.virtualReconcileIntervalMs)||60000);
    reconcileTimer=setInterval(()=>{void reconcileVirtualPayments();},interval);reconcileTimer.unref();
    startupTimer=setTimeout(()=>{void reconcileVirtualPayments({force:true});},Math.max(0,Number(options.virtualReconcileStartupMs)||1000));startupTimer.unref();
  }
  return {app,db,reconcileVirtualPayments,close:()=>{closed=true;clearInterval(reconcileTimer);clearTimeout(startupTimer);db.close();},config:{demo,uploadsDir,databasePath}};
}
