import { randomUUID } from 'node:crypto';

const failure=(status,message)=>Object.assign(new Error(message),{status});
const now=()=>new Date().toISOString();
const mainlandPhone=/^1[3-9]\d{9}$/;
const own=(body,key)=>Object.prototype.hasOwnProperty.call(body,key);
function field(value,label,max,{empty=false}={}) {
  if(typeof value!=='string' || value.length>max || /[\x00-\x1f\x7f]/.test(value))throw failure(400,`${label}格式无效或超过 ${max} 个字符`);
  const text=value.trim();
  if(!empty && !text)throw failure(400,`请填写${label}`);
  return text;
}

// Self-reported contact details never participate in authentication or account merging.
export function contactShape(record) {
  const contactPhone=record?.contactPhone||'',wechatId=record?.wechatId||'';
  return {contactPhone,wechatId,contactCompleted:Boolean(contactPhone&&wechatId),contactInfoCompleted:Boolean(contactPhone&&wechatId),contactPhoneVerified:false};
}

export function installStudentServices(app,{db,student,admin,userShape,logistics}) {
  const run=(sql,...values)=>db.prepare(sql).run(...values);
  const get=(sql,...values)=>db.prepare(sql).get(...values);
  const all=(sql,...values)=>db.prepare(sql).all(...values);
  function transaction(action) {
    db.exec('BEGIN IMMEDIATE');
    try{const value=action();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}
  }
  const addressShape=record=>({id:record.id,recipient:record.recipient,phone:record.phone,province:record.province,city:record.city,district:record.district,detail:record.detail,isDefault:Boolean(record.isDefault),createdAt:record.createdAt,updatedAt:record.updatedAt});
  const addressSnapshot=record=>Object.fromEntries(['recipient','phone','province','city','district','detail'].map(key=>[key,record[key]]));
  function ownedAddress(id,userId) {
    const address=get('SELECT * FROM student_addresses WHERE id=? AND userId=?',id,userId);
    if(!address)throw failure(404,'收货地址不存在');
    return address;
  }
  function addressInput(body,previous={}) {
    const merged={...previous,...body};
    const result={recipient:field(merged.recipient,'收件人',50),phone:field(merged.phone,'收件手机号',11),province:field(merged.province,'省份',50),city:field(merged.city,'城市',50),district:field(merged.district,'区县',50),detail:field(merged.detail,'详细地址',500)};
    if(!mainlandPhone.test(result.phone))throw failure(400,'请输入正确的 11 位中国大陆收件手机号');
    if(own(body,'isDefault') && typeof body.isDefault!=='boolean')throw failure(400,'默认地址选项必须为布尔值');
    result.isDefault=own(body,'isDefault')?body.isDefault:Boolean(previous.isDefault);
    return result;
  }
  function shipmentShape(record) {
    if(!record)return null;
    const course=get('SELECT title FROM courses WHERE id=?',record.courseId),user=get('SELECT name FROM users WHERE id=?',record.userId),contact=get('SELECT * FROM student_contacts WHERE userId=?',record.userId);
    return {id:record.id,orderId:record.orderId,courseId:record.courseId,courseTitle:course?.title||'已归档课程',userId:record.userId,userName:user?.name||'',studentNumber:record.userId,...contactShape(contact),address:JSON.parse(record.addressSnapshot),status:record.status,carrier:record.carrier,courierName:record.carrier,courierCode:record.courierCode||'',trackingNumber:record.trackingNumber,note:record.note,createdAt:record.createdAt,updatedAt:record.updatedAt,shippedAt:record.shippedAt,deliveredAt:record.deliveredAt};
  }
  function ownedShipment(id,userId) {
    const shipment=get('SELECT * FROM shipments WHERE id=? AND userId=?',id,userId);
    if(!shipment)throw failure(404,'寄送记录不存在');
    return shipment;
  }
  const tracking=async(req,res,next)=>{
    try {
      // Recheck ownership on every request, even when the provider returns a cache hit.
      const shipment=req.auth.role==='admin'?get('SELECT * FROM shipments WHERE id=?',req.params.id):ownedShipment(req.params.id,req.auth.userId);
      if(!shipment)throw failure(404,'寄送记录不存在');
      if(!logistics.configured)throw failure(503,'真实物流查询尚未配置，请联系管理员开通快递100并配置服务凭据');
      if(!['shipped','delivered'].includes(shipment.status))return res.json({configured:true,status:shipment.status,message:shipment.status==='cancelled'?'寄送申请已取消':'讲义尚未发货',events:[],checkedAt:null,carrier:shipment.courierCode||'',trackingNumber:shipment.trackingNumber||''});
      const address=JSON.parse(shipment.addressSnapshot);
      const result=await logistics.query({courierCode:shipment.courierCode,trackingNumber:shipment.trackingNumber,phone:address.phone});
      res.setHeader('Cache-Control','private, no-store');res.json({...result,courierName:shipment.carrier});
    }catch(error){next(error);}
  };
  app.get(['/api/me/shipments/:id/tracking','/api/my/shipments/:id/tracking'],student,tracking);
  app.get('/api/admin/shipments/:id/tracking',admin,tracking);
  app.get('/api/admin/logistics/config',admin,(req,res)=>res.json(logistics.publicConfig()));
  function saveContact(userId,body) {
    const previous=get('SELECT * FROM student_contacts WHERE userId=?',userId);
    const merged={...contactShape(previous)};
    if(own(body,'contactPhone')) {
      merged.contactPhone=field(body.contactPhone,'联系手机号',11,{empty:true});
      if(merged.contactPhone && !mainlandPhone.test(merged.contactPhone))throw failure(400,'请输入正确的 11 位中国大陆联系手机号');
    }
    if(own(body,'wechatId')) {
      merged.wechatId=field(body.wechatId,'微信号',20,{empty:true});
      if(merged.wechatId && !/^[a-zA-Z][a-zA-Z0-9_-]{5,19}$/.test(merged.wechatId))throw failure(400,'微信号须为 6 到 20 位，以字母开头，仅含字母、数字、下划线或减号');
    }
    if(!own(body,'contactPhone') && !own(body,'wechatId'))throw failure(400,'请提供联系手机号或微信号');
    run('INSERT INTO student_contacts(userId,contactPhone,wechatId,updatedAt) VALUES(?,?,?,?) ON CONFLICT(userId) DO UPDATE SET contactPhone=excluded.contactPhone,wechatId=excluded.wechatId,updatedAt=excluded.updatedAt',userId,merged.contactPhone,merged.wechatId,now());
  }
  const updateContact=(req,res)=>{
    saveContact(req.auth.userId,req.body);
    // Match /api/me's response so clients can update their signed-in user in place.
    res.json(userShape(get('SELECT * FROM users WHERE id=?',req.auth.userId)));
  };
  app.patch('/api/me/contact',student,updateContact);
  app.get(['/api/my/addresses','/api/me/addresses'],student,(req,res)=>res.json(all('SELECT * FROM student_addresses WHERE userId=? ORDER BY isDefault DESC,createdAt DESC,id',req.auth.userId).map(addressShape)));
  app.post(['/api/my/addresses','/api/me/addresses'],student,(req,res)=>{
    const input=addressInput(req.body),id=randomUUID(),timestamp=now();
    const record=transaction(()=>{
      const count=get('SELECT COUNT(*) AS count FROM student_addresses WHERE userId=?',req.auth.userId).count;
      if(count>=20)throw failure(400,'每位学员最多保存 20 个收货地址');
      const isDefault=input.isDefault || count===0;
      if(isDefault)run('UPDATE student_addresses SET isDefault=0 WHERE userId=?',req.auth.userId);
      run('INSERT INTO student_addresses(id,userId,recipient,phone,province,city,district,detail,isDefault,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,req.auth.userId,input.recipient,input.phone,input.province,input.city,input.district,input.detail,isDefault?1:0,timestamp,timestamp);
      return ownedAddress(id,req.auth.userId);
    });
    res.status(201).json(addressShape(record));
  });
  const updateAddress=(req,res)=>{
    const record=transaction(()=>{
      const previous=ownedAddress(req.params.id,req.auth.userId),input=addressInput(req.body,previous);
      // The existing default stays selected until another address is made default.
      const isDefault=input.isDefault || Boolean(previous.isDefault);
      if(isDefault)run('UPDATE student_addresses SET isDefault=0 WHERE userId=?',req.auth.userId);
      run('UPDATE student_addresses SET recipient=?,phone=?,province=?,city=?,district=?,detail=?,isDefault=?,updatedAt=? WHERE id=? AND userId=?',input.recipient,input.phone,input.province,input.city,input.district,input.detail,isDefault?1:0,now(),previous.id,req.auth.userId);
      return ownedAddress(previous.id,req.auth.userId);
    });
    res.json(addressShape(record));
  };
  app.put(['/api/my/addresses/:id','/api/me/addresses/:id'],student,updateAddress);
  app.patch(['/api/my/addresses/:id','/api/me/addresses/:id'],student,updateAddress);
  app.delete(['/api/my/addresses/:id','/api/me/addresses/:id'],student,(req,res)=>{
    transaction(()=>{
      const previous=ownedAddress(req.params.id,req.auth.userId);
      run('DELETE FROM student_addresses WHERE id=? AND userId=?',previous.id,req.auth.userId);
      if(previous.isDefault) {
        const replacement=get('SELECT id FROM student_addresses WHERE userId=? ORDER BY createdAt DESC,id LIMIT 1',req.auth.userId);
        if(replacement)run('UPDATE student_addresses SET isDefault=1,updatedAt=? WHERE id=?',now(),replacement.id);
      }
    });
    res.json({ok:true});
  });
  app.get(['/api/my/shipments','/api/me/shipments'],student,(req,res)=>res.json(all('SELECT * FROM shipments WHERE userId=? ORDER BY createdAt DESC,id',req.auth.userId).map(shipmentShape)));
  app.get(['/api/my/shipments/:id','/api/me/shipments/:id'],student,(req,res)=>res.json(shipmentShape(ownedShipment(req.params.id,req.auth.userId))));
  app.post(['/api/my/shipments','/api/me/shipments'],student,(req,res)=>{
    const orderId=field(req.body.orderId,'订单编号',128),addressId=field(req.body.addressId,'地址编号',128);
    let created=false;
    const record=transaction(()=>{
      const order=get('SELECT * FROM orders WHERE id=? AND userId=?',orderId,req.auth.userId);
      if(!order)throw failure(404,'订单不存在');
      if(order.status!=='paid')throw failure(403,'只有已付款的订单可以申请寄送');
      const address=ownedAddress(addressId,req.auth.userId);
      const previous=get('SELECT * FROM shipments WHERE orderId=?',order.id);
      if(previous)return previous;
      const course=get('SELECT shippingEnabled FROM courses WHERE id=?',order.courseId);
      if(!course?.shippingEnabled)throw failure(400,'该课程未提供实物讲义寄送');
      const id=randomUUID(),timestamp=now();
      run('INSERT INTO shipments(id,orderId,userId,courseId,addressSnapshot,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)',id,order.id,req.auth.userId,order.courseId,JSON.stringify(addressSnapshot(address)),'pending',timestamp,timestamp);
      created=true;return get('SELECT * FROM shipments WHERE id=?',id);
    });
    res.status(created?201:200).json(shipmentShape(record));
  });
  app.patch(['/api/my/shipments/:id','/api/me/shipments/:id'],student,(req,res)=>{
    const addressId=field(req.body.addressId,'地址编号',128);
    const record=transaction(()=>{
      const previous=ownedShipment(req.params.id,req.auth.userId);
      if(previous.status!=='pending')throw failure(409,'仅待发货的寄送申请可以修改地址');
      if(get('SELECT status FROM orders WHERE id=?',previous.orderId)?.status!=='paid')throw failure(403,'订单尚未付款或已退款，无法修改寄送申请');
      const address=ownedAddress(addressId,req.auth.userId);
      run('UPDATE shipments SET addressSnapshot=?,updatedAt=? WHERE id=?',JSON.stringify(addressSnapshot(address)),now(),previous.id);
      return ownedShipment(previous.id,req.auth.userId);
    });
    res.json(shipmentShape(record));
  });
  app.post(['/api/my/shipments/:id/receive','/api/me/shipments/:id/receive'],student,(req,res)=>{
    const record=transaction(()=>{
      const previous=ownedShipment(req.params.id,req.auth.userId);
      if(previous.status==='delivered')return previous;
      if(previous.status!=='shipped')throw failure(409,'只有已发货的讲义可以确认收货');
      const timestamp=now();run("UPDATE shipments SET status='delivered',deliveredAt=?,updatedAt=? WHERE id=?",timestamp,timestamp,previous.id);
      return ownedShipment(previous.id,req.auth.userId);
    });
    res.json(shipmentShape(record));
  });
  app.get('/api/admin/shipments',admin,(req,res)=>res.json(all('SELECT * FROM shipments ORDER BY createdAt DESC,id').map(shipmentShape)));
  app.patch('/api/admin/shipments/:id',admin,(req,res)=>{
    const record=transaction(()=>{
      const previous=get('SELECT * FROM shipments WHERE id=?',req.params.id);
      if(!previous)throw failure(404,'寄送记录不存在');
      const status=req.body.status??previous.status;
      if(!['shipped','pending','cancelled'].includes(status))throw failure(400,'寄送状态必须为 pending、shipped 或 cancelled');
      const transitions={pending:['pending','shipped','cancelled'],cancelled:['cancelled','pending'],shipped:['shipped'],delivered:[]};
      if(!transitions[previous.status].includes(status))throw failure(409,'当前寄送状态不支持该操作');
      const carrier=own(req.body,'courierName')?field(req.body.courierName,'快递公司',80,{empty:true}):own(req.body,'carrier')?field(req.body.carrier,'快递公司',80,{empty:true}):previous.carrier;
      const courierCode=own(req.body,'courierCode')?field(req.body.courierCode,'快递公司编码',40,{empty:true}):previous.courierCode;
      if(courierCode && !/^[a-zA-Z0-9_-]+$/.test(courierCode))throw failure(400,'快递公司编码格式无效');
      if(courierCode && !logistics.validCarrier(courierCode))throw failure(400,'请选择物流服务支持的快递公司');
      const trackingNumber=own(req.body,'trackingNumber')?field(req.body.trackingNumber,'快递单号',80,{empty:true}):previous.trackingNumber;
      const note=own(req.body,'note')?field(req.body.note,'寄送备注',1000,{empty:true}):previous.note;
      if(status==='shipped') {
        if(!carrier || !courierCode || !trackingNumber)throw failure(400,'发货时必须填写快递公司、快递公司编码和快递单号');
        if(!/^[a-zA-Z0-9-]{6,32}$/.test(trackingNumber))throw failure(400,'快递单号须为 6 到 32 位字母、数字或减号');
        if(previous.status==='pending' && get('SELECT status FROM orders WHERE id=?',previous.orderId)?.status!=='paid')throw failure(409,'订单已退款或未付款，不能发货');
      }
      const timestamp=now();
      run('UPDATE shipments SET status=?,carrier=?,courierCode=?,trackingNumber=?,note=?,updatedAt=?,shippedAt=? WHERE id=?',status,carrier,courierCode,trackingNumber,note,timestamp,status==='shipped'?(previous.shippedAt||timestamp):previous.shippedAt,previous.id);
      return get('SELECT * FROM shipments WHERE id=?',previous.id);
    });
    res.json(shipmentShape(record));
  });
  return {shipmentShape,saveContact,updateContact,forOrder:orderId=>shipmentShape(get('SELECT * FROM shipments WHERE orderId=?',orderId))};
}
