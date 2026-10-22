const {request,config,requireLogin,failToast,linkWechat}=require('../../utils/api');
const format=require('../../utils/format');
Page({
  data:{course:null,config:null,loading:true,error:'',busy:false,paid:false,pending:false,orderId:'',needsWechat:false,binding:false},
  onLoad(options){this._id=options.courseId;this._orderId=options.orderId||'';this.load();},
  onShow(){if(this._waiting&&getApp().globalData.token){this._waiting=false;this.load();}},
  load(){if(!requireLogin('/pages/checkout/index?courseId='+this._id+(this._orderId?'&orderId='+this._orderId:''))){this._waiting=true;return;}this.setData({loading:true,error:''});Promise.all([request('/courses/'+encodeURIComponent(this._id)),config(true),request('/me')]).then(values=>{getApp().setUser(values[2]);this.setData({course:format.course(values[0]),config:values[1],loading:false,paid:values[0].enrolled,needsWechat:!values[1].demoMode&&values[0].price>0&&!values[2].wechatLinked});}).catch(e=>this.setData({loading:false,error:e.message}));},
  bindWechat(e){
    if(this.data.binding)return;
    if(!e.detail.code){this.setData({error:'未获取手机号授权，请授权与登录账号相同的手机号'});return;}
    this.setData({binding:true,error:''});
    linkWechat(e.detail.code).then(()=>this.load()).catch(error=>this.setData({error:error.message})).finally(()=>this.setData({binding:false}));
  },
  pay(){
    if(this.data.busy||!this.data.course||this.data.needsWechat)return;
    if(!requireLogin('/pages/checkout/index?courseId='+this._id))return;
    this.setData({busy:true,error:'',pending:false});
    const create=this._orderId?request('/orders/'+this._orderId):request('/orders',{method:'POST',data:{courseId:this._id}});
    create.then(order=>{
      this._orderId=order.id;this.setData({orderId:order.id});if(order.status==='paid'){this.setData({paid:true});return;}
      if(this.data.config.demoMode)return request('/orders/'+order.id+'/demo-pay',{method:'POST'}).then(()=>{this.setData({paid:true});});
      return request('/orders/'+order.id+'/pay',{method:'POST'}).then(result=>{
        if(result.paid){this.setData({paid:true});return;}
        if(result.demo||!result.paymentParams)throw new Error('未获取到有效微信支付参数，请检查支付配置');
        return new Promise((resolve,reject)=>wx.requestPayment(Object.assign({},result.paymentParams,{success:resolve,fail:error=>reject(new Error((error.errMsg||'').indexOf('cancel')!==-1?'已取消支付，可在我的订单继续付款':'微信支付未完成，请重试'))}))).then(()=>this.confirmPayment(0));
      });
    }).catch(e=>{this.setData({error:e.message});}).finally(()=>this.setData({busy:false}));
  },
  confirmPayment(attempt){return request('/orders/'+this._orderId).then(order=>{
    if(order.status==='paid'){this.setData({paid:true,pending:false,error:''});return;}
    if(attempt<4)return new Promise(resolve=>setTimeout(resolve,1200)).then(()=>this.confirmPayment(attempt+1));
    this.setData({pending:true,error:'微信支付结果正在同步，请稍后刷新。课程将在服务端确认收款后开通。'});
  });},
  refresh(){if(!this._orderId){this.load();return;}this.setData({busy:true,error:''});this.confirmPayment(4).catch(failToast).finally(()=>this.setData({busy:false}));},
  learn(){wx.redirectTo({url:'/pages/course/index?id='+this._id});},
  orders(){wx.redirectTo({url:'/pages/orders/index'});}
});
