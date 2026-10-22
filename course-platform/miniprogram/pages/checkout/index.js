const {request,config,requireLogin,failToast,linkWechat}=require('../../utils/api');
const format=require('../../utils/format');
Page({
  data:{course:null,config:null,loading:true,error:'',busy:false,paid:false,pending:false,orderId:'',needsWechat:false,binding:false},
  onLoad(options){this._id=options.courseId;this._orderId=options.orderId||'';this._loadId=0;this._paymentId=0;this._disposed=false;this.load();},
  onUnload(){this._disposed=true;this._loadId++;this._paymentId++;},
  onShow(){if(this._loadedAuthToken!==undefined&&this._loadedAuthToken!==(getApp().globalData.token||'')){this._paymentId++;this._orderId='';this.setData({busy:false,pending:false,paid:false,orderId:''});this.load();}else if(this._waiting&&getApp().globalData.token){this._waiting=false;this.load();}else if(this.data.pending&&!this.data.busy&&this._orderId)this.refresh();},
  load(){if(!requireLogin('/pages/checkout/index?courseId='+this._id+(this._orderId?'&orderId='+this._orderId:''))){this._waiting=true;return;}const loadId=++this._loadId,authToken=getApp().globalData.token||'';this._loadedAuthToken=authToken;this.setData({loading:true,error:''});return Promise.all([request('/courses/'+encodeURIComponent(this._id)),config(true),request('/me')]).then(values=>{if(this._disposed||loadId!==this._loadId||authToken!==(getApp().globalData.token||''))return;getApp().setUser(values[2]);this.setData({course:format.course(values[0]),config:values[1],loading:false,paid:values[0].enrolled,needsWechat:!values[1].demoMode&&values[0].price>0&&!values[2].wechatLinked});}).catch(e=>{if(!this._disposed&&loadId===this._loadId&&authToken===(getApp().globalData.token||''))this.setData({loading:false,error:e.message});});},
  bindWechat(e){
    if(this.data.binding)return;
    if(!e.detail.code){this.setData({error:'未获取手机号授权，请授权与登录账号相同的手机号'});return;}
    this.setData({binding:true,error:''});
    return linkWechat(e.detail.code).then(()=>{if(!this._disposed)return this.load();}).catch(error=>{if(!this._disposed)this.setData({error:error.message});}).finally(()=>{if(!this._disposed)this.setData({binding:false});});
  },
  pay(){
    if(this._disposed||this.data.busy||this.data.paid||this.data.pending||!this.data.course||this.data.needsWechat)return;
    if(!requireLogin('/pages/checkout/index?courseId='+this._id))return;
    if(this.virtualEnabled()&&this.data.course.price>0){
      if(!this.data.config.virtualPaymentConfigured){this.setData({error:'微信虚拟支付尚未完成配置，请稍后再试'});return;}
      if(typeof wx.requestVirtualPayment!=='function'||(wx.canIUse&&!wx.canIUse('requestVirtualPayment'))){this.setData({error:'当前微信版本不支持课程支付，请更新微信后在手机中重试'});return;}
    }
    this._paymentAuthToken=getApp().globalData.token||'';
    this.setData({busy:true,error:'',pending:false});
    const paymentId=++this._paymentId;
    const create=this._orderId?request('/orders/'+this._orderId):request('/orders',{method:'POST',data:{courseId:this._id}});
    return create.then(order=>this.prepareOrder(order,paymentId)).then(order=>{
      if(!order||!this.paymentActive(paymentId))return;
      if(order.status==='paid'){this.setData({paid:true});return;}
      if(this.data.config.demoMode)return request('/orders/'+order.id+'/demo-pay',{method:'POST'}).then(()=>{if(this.paymentActive(paymentId))this.setData({paid:true});});
      if(this.virtualEnabled()&&this.data.course.price>0)return this.payVirtual(order,paymentId);
      return request('/orders/'+order.id+'/pay',{method:'POST'}).then(result=>{
        if(!this.paymentActive(paymentId))return;
        if(result.paid){this.setData({paid:true});return;}
        if(result.demo||!result.paymentParams)throw new Error('未获取到有效微信支付参数，请检查支付配置');
        return new Promise((resolve,reject)=>wx.requestPayment(Object.assign({},result.paymentParams,{success:resolve,fail:error=>reject(new Error((error.errMsg||'').indexOf('cancel')!==-1?'已取消支付，可在我的订单继续付款':'微信支付未完成，请重试'))}))).then(()=>this.confirmPayment(0,order.id,paymentId));
      });
    }).catch(e=>{if(this.paymentActive(paymentId))this.setData({error:e.message});}).finally(()=>{if(this.paymentActive(paymentId))this.setData({busy:false});});
  },
  virtualEnabled(){return !!(this.data.config&&(this.data.config.paymentMode==='wechat-virtual'||this.data.config.paymentMode==='virtual'||this.data.config.virtualPaymentConfigured));},
  payVirtual(order,paymentId){
    return new Promise((resolve,reject)=>wx.login({timeout:10000,success:result=>result.code?resolve(result.code):reject(new Error('未获取微信登录凭证，请重新登录后支付')),fail:()=>reject(new Error('微信身份验证失败，请稍后重试'))})).then(code=>{
      if(!this.paymentActive(paymentId))return;
      return request('/orders/'+encodeURIComponent(order.id)+'/virtual-pay',{method:'POST',data:{code}});
    }).then(result=>{
      if(!result||!this.paymentActive(paymentId))return;
      if(result.paid){this.setData({paid:true,pending:false});return;}
      if(result.provider!=='wechat-virtual'||result.mode!=='short_series_goods'||!result.signData||!result.paySig||!result.signature)throw new Error('未获取有效课程支付参数，请稍后重试');
      return new Promise(resolve=>wx.requestVirtualPayment({mode:result.mode,signData:result.signData,paySig:result.paySig,signature:result.signature,success:()=>resolve(null),fail:resolve})).then(failure=>{
        if(!this.paymentActive(paymentId))return;
        if(!failure)return this.confirmPayment(0,order.id,paymentId,true);
        // A client callback cannot decide whether money was received. Query the server even after cancellation.
        return this.fetchPaymentOrder(order.id,true).then(updated=>{
          if(!this.paymentActive(paymentId))return;
          if(updated.status==='paid'){this.setData({paid:true,pending:false,error:''});return;}
          throw new Error(this.virtualFailure(failure));
        },()=>{if(this.paymentActive(paymentId))this.setData({pending:true,error:'支付结果尚未确认，请刷新结果。服务端确认收款后才会开通课程。'});});
      });
    });
  },
  virtualFailure(error){
    const code=Number(error.errCode),message=error.errMsg||'';
    if(code===-2||message.indexOf('cancel')!==-1)return '已取消支付，可在我的订单继续付款';
    if(code===-15007)return '微信身份凭证已过期，请重新点击支付';
    if(code===-15002)return '支付单号已使用，请刷新订单后重试';
    if(code===-15010||code===-15014)return '课程商品尚未生效，请稍后再试';
    if(code===-15013)return '课程价格配置不一致，请联系老师处理';
    return '微信课程支付未完成，请确认当前设备支持虚拟支付后重试';
  },
  prepareOrder(order,paymentId){
    if(!this.paymentActive(paymentId))return;
    this._orderId=order.id;this.setData({orderId:order.id});
    if(this.data.config.demoMode||order.status!=='pending'||order.paymentChannel!=='native')return order;
    return new Promise((resolve,reject)=>wx.showModal({
      title:'切换为小程序支付',
      content:'此订单已在网页生成扫码付款二维码。是否关闭原扫码订单，重新使用小程序微信支付？关闭后原二维码将失效。',
      confirmText:'确认切换',cancelText:'暂不切换',
      success:result=>resolve(!!result.confirm),fail:()=>reject(new Error('未能确认切换支付方式，请重试'))
    })).then(confirmed=>{
      if(!this.paymentActive(paymentId))return;
      if(!confirmed){this.setData({error:'已保留原扫码订单，可返回网页继续扫码付款。'});return;}
      return request('/orders/'+encodeURIComponent(order.id)+'/cancel',{method:'POST'}).then(result=>{
        if(!this.paymentActive(paymentId))return;
        if(result.paid||(result.order&&result.order.status==='paid'))return Object.assign({},order,result.order,{status:'paid'});
        if(!result.cancelled||!result.order||result.order.status!=='cancelled')throw new Error('原扫码订单尚未确认关闭，请稍后重试');
        this._orderId='';this.setData({orderId:''});
        return request('/orders',{method:'POST',data:{courseId:this._id}}).then(newOrder=>this.prepareOrder(newOrder,paymentId));
      });
    });
  },
  paymentActive(paymentId){return !this._disposed&&paymentId===this._paymentId&&(!this._paymentAuthToken||this._paymentAuthToken===(getApp().globalData.token||''));},
  fetchPaymentOrder(orderId,virtual){return request('/orders/'+encodeURIComponent(orderId)+(virtual?'/sync-payment':''),virtual?{method:'POST'}:undefined).then(result=>result.order||result);},
  confirmPayment(attempt,orderId,paymentId,virtual){
    if(!this.paymentActive(paymentId))return Promise.resolve();
    return this.fetchPaymentOrder(orderId,virtual===undefined?this.virtualEnabled():virtual).then(order=>{
    if(!this.paymentActive(paymentId))return;
    if(order.status==='paid'){this.setData({paid:true,pending:false,error:''});return;}
    if(order.status==='cancelled'||order.status==='refunded'){this.setData({pending:false,error:order.status==='refunded'?'此订单已退款，课程访问权限以当前有效订单为准':'此订单已关闭，请返回课程重新下单'});this._orderId='';return;}
    if(attempt<4)return new Promise(resolve=>setTimeout(resolve,1200)).then(()=>this.confirmPayment(attempt+1,orderId,paymentId,virtual));
    this.setData({pending:true,error:'微信支付结果正在同步，请稍后刷新。课程将在服务端确认收款后开通。'});
  });},
  refresh(){if(this._disposed||this.data.busy)return;if(!this._orderId)return this.load();this._paymentAuthToken=getApp().globalData.token||'';const paymentId=++this._paymentId;this.setData({busy:true,error:''});return this.confirmPayment(4,this._orderId,paymentId).catch(error=>{if(this.paymentActive(paymentId))failToast(error);}).finally(()=>{if(this.paymentActive(paymentId))this.setData({busy:false});});},
  learn(){wx.redirectTo({url:'/pages/course/index?id='+this._id});},
  orders(){wx.redirectTo({url:'/pages/orders/index'});}
});
