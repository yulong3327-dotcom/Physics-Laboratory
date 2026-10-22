const {request, config, failToast} = require('../../utils/api');
Page({
  data:{mode:'wechat',phone:'',code:'',sending:false,busy:false,countdown:0,config:null,error:'',demoCode:'',agreed:false},
  onLoad(options){this._disposed=false;this._completed=false;this._loginId=0;this._configId=0;this._smsId=0;try{this._returnTo=decodeURIComponent(options.returnTo||'');}catch(e){this._returnTo='';}return this.loadConfig();},
  onUnload(){this._disposed=true;this.cancelLogin();this._configId++;this._smsId++;clearInterval(this._timer);},
  loadConfig(){if(this._disposed||this._completed)return;const configId=++this._configId;this.setData({error:''});return config(true).then(c=>{if(!this._disposed&&!this._completed&&configId===this._configId)this.setData({config:c});}).catch(e=>{if(!this._disposed&&!this._completed&&configId===this._configId)this.setData({error:e.message});});},
  changeMode(e){if(this._disposed||this._completed)return;const mode=e.currentTarget.dataset.mode;if(mode!==this.data.mode&&(mode==='wechat'||mode==='phone')){this.cancelLogin();this.setData({mode,error:'',busy:false});}},
  inputPhone(e){this.setData({phone:e.detail.value.replace(/\D/g,'').slice(0,11)});},
  inputCode(e){this.setData({code:e.detail.value.replace(/\D/g,'').slice(0,6)});},
  toggleAgreement(){this.setData({agreed:!this.data.agreed});},
  ensureConsent(){if(this.data.agreed)return true;failToast(new Error('请确认同意账号用于课程服务'));return false;},
  cancelLogin(){this._loginId++;if(this._cancelWechat){const cancel=this._cancelWechat;this._cancelWechat=null;cancel();}},
  loginActive(loginId){return !this._disposed&&!this._completed&&loginId===this._loginId;},
  beginLogin(){if(this._disposed||this._completed||this.data.busy||!this.ensureConsent())return;const loginId=++this._loginId;this.setData({busy:true,error:''});return loginId;},
  finishLogin(promise,loginId){return promise.catch(e=>{if(this.loginActive(loginId))this.setData({error:e.message||'登录未完成，请重试'});}).finally(()=>{if(this.loginActive(loginId))this.setData({busy:false});});},
  sendCode(){
    if(this._disposed||this._completed||this.data.sending||this.data.countdown)return;
    if(!/^1[3-9]\d{9}$/.test(this.data.phone)){failToast(new Error('请输入正确的 11 位手机号'));return;}
    if(!this.ensureConsent())return;
    this.setData({sending:true,error:'',demoCode:''});
    const smsId=++this._smsId,phone=this.data.phone;
    return request('/auth/sms/send',{method:'POST',data:{phone}}).then(result=>{
      if(this._disposed||this._completed||smsId!==this._smsId||phone!==this.data.phone)return;
      this.setData({demoCode:result.devCode||'',countdown:result.retryAfter||60});
      wx.showToast({title:result.devCode?'演示验证码已生成':'验证码已发送',icon:'none'});
      clearInterval(this._timer);this._timer=setInterval(()=>{if(this._disposed)return;const next=Math.max(0,this.data.countdown-1);this.setData({countdown:next});if(!next)clearInterval(this._timer);},1000);
    }).catch(e=>{if(!this._disposed&&!this._completed&&smsId===this._smsId)this.setData({error:e.message});}).finally(()=>{if(!this._disposed&&!this._completed&&smsId===this._smsId)this.setData({sending:false});});
  },
  phoneLogin(){
    const loginId=this.beginLogin();if(!loginId)return;
    if(!/^1[3-9]\d{9}$/.test(this.data.phone)||!/^\d{6}$/.test(this.data.code)){this.setData({busy:false,error:'请填写正确的手机号与 6 位验证码'});return;}
    return this.finishLogin(request('/auth/phone',{method:'POST',data:{phone:this.data.phone,code:this.data.code}}).then(r=>this.complete(r,loginId)),loginId);
  },
  wechatLogin(){
    const loginId=this.beginLogin();if(!loginId)return;
    const credential=new Promise((resolve,reject)=>{
      let settled=false,timer;
      const finish=(error,code)=>{if(settled)return;settled=true;clearTimeout(timer);if(this._cancelWechat===cancel)this._cancelWechat=null;if(error)reject(error);else resolve(code);};
      const cancel=()=>finish(null,null);
      this._cancelWechat=cancel;
      timer=setTimeout(()=>finish(new Error('微信登录超时，请检查网络后重试')),10000);
      try{wx.login({timeout:10000,success:r=>{
        if(!this.loginActive(loginId)){cancel();return;}
        if(!r||typeof r.code!=='string'||!r.code||/\s/.test(r.code)){finish(new Error('未获取微信登录凭证，请重新授权'));return;}
        finish(null,r.code);
      },fail:e=>finish(new Error(e&&/timeout|超时/i.test(e.errMsg||'')?'微信登录超时，请检查网络后重试':'微信登录未完成，请重试或使用手机号登录'))});}
      catch(e){finish(new Error('微信登录未完成，请重试或使用手机号登录'));}
    });
    return this.finishLogin(credential.then(code=>{if(!code||!this.loginActive(loginId))return;return request('/auth/wechat',{method:'POST',data:{code}}).then(result=>this.complete(result,loginId));}),loginId);
  },
  demoLogin(){
    if(!this.data.config||!this.data.config.demoMode)return;
    const loginId=this.beginLogin();if(!loginId)return;
    return this.finishLogin(request('/auth/demo',{method:'POST'}).then(r=>this.complete(r,loginId)),loginId);
  },
  complete(result,loginId){
    if(!this.loginActive(loginId))return;
    if(!result||typeof result.token!=='string'||!result.token||/\s/.test(result.token)||!result.user||typeof result.user!=='object'||Array.isArray(result.user)||typeof result.user.id!=='string'||!result.user.id.trim())throw new Error('登录服务返回的信息不完整，请重试');
    getApp().setSession(result.token,result.user);
    this._completed=true;this.setData({busy:false});clearInterval(this._timer);
    wx.showToast({title:'登录成功',icon:'success'});
    const target=this._returnTo;
    const tabs=['/pages/discover/index','/pages/my-courses/index','/pages/profile/index'];
    if(tabs.indexOf(target)!==-1){wx.switchTab({url:target});return;}
    if(/^\/pages\/(course|checkout|learn|orders|materials)\/index(?:\?|$)/.test(target)){wx.redirectTo({url:target});return;}
    if(getCurrentPages().length>1)wx.navigateBack();else wx.switchTab({url:'/pages/my-courses/index'});
  }
});
