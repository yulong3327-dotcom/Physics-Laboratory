const {request, config, failToast} = require('../../utils/api');
Page({
  data:{mode:'wechat',phone:'',code:'',sending:false,busy:false,countdown:0,config:null,error:'',demoCode:'',agreed:false},
  onLoad(options){try{this._returnTo=decodeURIComponent(options.returnTo||'');}catch(e){this._returnTo='';}this.loadConfig();},
  onUnload(){clearInterval(this._timer);},
  loadConfig(){this.setData({error:''});config(true).then(c=>this.setData({config:c})).catch(e=>this.setData({error:e.message}));},
  changeMode(e){this.setData({mode:e.currentTarget.dataset.mode,error:''});},
  inputPhone(e){this.setData({phone:e.detail.value.replace(/\D/g,'').slice(0,11)});},
  inputCode(e){this.setData({code:e.detail.value.replace(/\D/g,'').slice(0,6)});},
  toggleAgreement(){this.setData({agreed:!this.data.agreed});},
  ensureConsent(){if(this.data.agreed)return true;failToast(new Error('请确认同意账号用于课程服务'));return false;},
  sendCode(){
    if(this.data.sending||this.data.countdown)return;
    if(!/^1[3-9]\d{9}$/.test(this.data.phone)){failToast(new Error('请输入正确的 11 位手机号'));return;}
    if(!this.ensureConsent())return;
    this.setData({sending:true,error:'',demoCode:''});
    request('/auth/sms/send',{method:'POST',data:{phone:this.data.phone}}).then(result=>{
      this.setData({demoCode:result.devCode||'',countdown:result.retryAfter||60});
      wx.showToast({title:result.devCode?'演示验证码已生成':'验证码已发送',icon:'none'});
      clearInterval(this._timer);this._timer=setInterval(()=>{const next=Math.max(0,this.data.countdown-1);this.setData({countdown:next});if(!next)clearInterval(this._timer);},1000);
    }).catch(e=>this.setData({error:e.message})).finally(()=>this.setData({sending:false}));
  },
  phoneLogin(){
    if(this.data.busy||!this.ensureConsent())return;
    if(!/^1[3-9]\d{9}$/.test(this.data.phone)||!/^\d{6}$/.test(this.data.code)){this.setData({error:'请填写正确的手机号与 6 位验证码'});return;}
    this.setData({busy:true,error:''});request('/auth/phone',{method:'POST',data:{phone:this.data.phone,code:this.data.code}}).then(r=>this.complete(r)).catch(e=>this.setData({error:e.message})).finally(()=>this.setData({busy:false}));
  },
  wechatLogin(){
    if(this.data.busy||!this.ensureConsent())return;
    this.setData({busy:true,error:''});
    wx.login({success:r=>{
      if(!r.code){this.setData({busy:false,error:'未获取微信登录凭证，请重新授权'});return;}
      request('/auth/wechat',{method:'POST',data:{code:r.code}}).then(result=>this.complete(result)).catch(e=>this.setData({error:e.message})).finally(()=>this.setData({busy:false}));
    },fail:()=>this.setData({busy:false,error:'微信登录未完成，请重试或使用手机号登录'})});
  },
  demoLogin(){
    if(this.data.busy||!this.data.config||!this.data.config.demoMode||!this.ensureConsent())return;
    this.setData({busy:true,error:''});request('/auth/demo',{method:'POST'}).then(r=>this.complete(r)).catch(e=>this.setData({error:e.message})).finally(()=>this.setData({busy:false}));
  },
  complete(result){
    getApp().setSession(result.token,result.user);
    wx.showToast({title:'登录成功',icon:'success'});
    const target=this._returnTo;
    const tabs=['/pages/discover/index','/pages/my-courses/index','/pages/profile/index'];
    if(tabs.indexOf(target)!==-1){wx.switchTab({url:target});return;}
    if(/^\/pages\/(course|checkout|learn|orders|materials)\/index(?:\?|$)/.test(target)){wx.redirectTo({url:target});return;}
    if(getCurrentPages().length>1)wx.navigateBack();else wx.switchTab({url:'/pages/my-courses/index'});
  }
});
