const {request,config,requireLogin,failToast,linkWechat}=require('../../utils/api');
const format=require('../../utils/format');
Page({
  data:{course:null,config:null,loading:true,error:'',busy:false,paid:false,pending:false,orderId:'',needsWechat:false,binding:false},
  onLoad(options){this._id=options.courseId;this._orderId=options.orderId||'';this._loadId=0;this._paymentId=0;this._disposed=false;this.load();},
  onUnload(){this._disposed=true;this._loadId++;this._paymentId++;},
  onShow(){if(this._waiting&&getApp().globalData.token){this._waiting=false;this.load();}},
  load(){if(!requireLogin('/pages/checkout/index?courseId='+this._id+(this._orderId?'&orderId='+this._orderId:''))){this._waiting=true;return;}const loadId=++this._loadId;this.setData({loading:true,error:''});return Promise.all([request('/courses/'+encodeURIComponent(this._id)),config(true),request('/me')]).then(values=>{if(this._disposed||loadId!==this._loadId)return;getApp().setUser(values[2]);this.setData({course:format.course(values[0]),config:values[1],loading:false,paid:values[0].enrolled,needsWechat:!values[1].demoMode&&values[0].price>0&&!values[2].wechatLinked});}).catch(e=>{if(!this._disposed&&loadId===this._loadId)this.setData({loading:false,error:e.message});});},
  bindWechat(e){
    if(this.data.binding)return;
    if(!e.detail.code){this.setData({error:'未获取手机号授权，请授权与登录账号相同的手机号'});return;}
    this.setData({binding:true,error:''});
    return linkWechat(e.detail.code).then(()=>{if(!this._disposed)return this.load();}).catch(error=>{if(!this._disposed)this.setData({error:error.message});}).finally(()=>{if(!this._disposed)this.setData({binding:false});});
  },
  pay(){
    if(this._disposed||this.data.busy||this.data.paid||this.data.pending||!this.data.course||this.data.needsWechat)return;
    if(!requireLogin('/pages/checkout/index?courseId='+this._id))return;
    this.setData({busy:true,error:'',pending:false});
    const paymentId=++this._paymentId;
    const create=this._orderId?request('/orders/'+this._orderId):request('/orders',{method:'POST',data:{courseId:this._id}});
    return create.then(order=>this.prepareOrder(order,paymentId)).then(order=>{
      if(!order||!this.paymentActive(paymentId))return;
      if(order.status==='paid'){this.setData({paid:true});return;}
      if(this.data.config.demoMode)return request('/orders/'+order.id+'/demo-pay',{method:'POST'}).then(()=>{if(this.paymentActive(paymentId))this.setData({paid:true});});
      return request('/orders/'+order.id+'/pay',{method:'POST'}).then(result=>{
        if(!this.paymentActive(paymentId))return;
        if(result.paid){this.setData({paid:true});return;}
        if(result.demo||!result.paymentParams)throw new Error('未获取到有效微信支付参数，请检查支付配置');
        return new Promise((resolve,reject)=>wx.requestPayment(Object.assign({},result.paymentParams,{success:resolve,fail:error=>reject(new Error((error.errMsg||'').indexOf('cancel')!==-1?'已取消支付，可在我的订单继续付款':'微信支付未完成，请重试'))}))).then(()=>this.confirmPayment(0,order.id,paymentId));
      });
    }).catch(e=>{if(this.paymentActive(paymentId))this.setData({error:e.message});}).finally(()=>{if(this.paymentActive(paymentId))this.setData({busy:false});});
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
  paymentActive(paymentId){return !this._disposed&&paymentId===this._paymentId;},
  confirmPayment(attempt,orderId,paymentId){
    if(!this.paymentActive(paymentId))return Promise.resolve();
    return request('/orders/'+encodeURIComponent(orderId)).then(order=>{
    if(!this.paymentActive(paymentId))return;
    if(order.status==='paid'){this.setData({paid:true,pending:false,error:''});return;}
    if(attempt<4)return new Promise(resolve=>setTimeout(resolve,1200)).then(()=>this.confirmPayment(attempt+1,orderId,paymentId));
    this.setData({pending:true,error:'微信支付结果正在同步，请稍后刷新。课程将在服务端确认收款后开通。'});
  });},
  refresh(){if(this._disposed||this.data.busy)return;if(!this._orderId)return this.load();const paymentId=++this._paymentId;this.setData({busy:true,error:''});return this.confirmPayment(4,this._orderId,paymentId).catch(error=>{if(this.paymentActive(paymentId))failToast(error);}).finally(()=>{if(this.paymentActive(paymentId))this.setData({busy:false});});},
  learn(){wx.redirectTo({url:'/pages/course/index?id='+this._id});},
  orders(){wx.redirectTo({url:'/pages/orders/index'});}
});
