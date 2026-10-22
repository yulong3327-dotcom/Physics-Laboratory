const {request}=require('../../utils/api');
Component({
  properties:{visible:{type:Boolean,value:false},user:{type:Object,value:null}},
  observers:{'visible,user':function(visible,user){user=user||{};if(visible&&(!this._wasVisible||this._shownUserId!==user.id)){this._shownUserId=user.id;this.setData({phone:user.contactPhone||'',wechatId:user.wechatId||'',saving:false,error:''});}this._wasVisible=visible;}},
  data:{phone:'',wechatId:'',saving:false,error:''},
  lifetimes:{attached(){this._disposed=false;},detached(){this._disposed=true;}},
  methods:{
    stop(){},
    inputPhone(e){this.setData({phone:e.detail.value.replace(/\D/g,'').slice(0,11)});},
    inputWechat(e){this.setData({wechatId:e.detail.value});},
    skip(){if(!this.data.saving)this.triggerEvent('close');},
    save(){
      if(this.data.saving)return;
      const contactPhone=this.data.phone.trim(),wechatId=this.data.wechatId.trim();
      if(!/^1[3-9]\d{9}$/.test(contactPhone)){this.setData({error:'请输入正确的 11 位联系手机号'});return;}
      if(!/^[a-zA-Z][a-zA-Z0-9_-]{5,19}$/.test(wechatId)){this.setData({error:'微信号须为 6 到 20 位，以字母开头，仅含字母、数字、下划线或减号'});return;}
      const app=getApp(),token=app.globalData.token,userId=app.globalData.user&&app.globalData.user.id;
      if(!token||!userId){this.setData({error:'请重新微信登录后填写'});return;}
      this.setData({saving:true,error:''});
      const active=()=>!this._disposed&&app.globalData.token===token&&app.globalData.user&&app.globalData.user.id===userId;
      return request('/me/contact',{method:'PATCH',data:{contactPhone,wechatId}}).then(user=>{
        if(!active())return;
        if(!user||user.id!==userId)throw new Error('联系信息保存结果异常，请刷新后重试');
        app.setUser(user);this.triggerEvent('saved',{user});
      }).catch(e=>{if(active())this.setData({error:e.message});}).finally(()=>{if(active())this.setData({saving:false});});
    }
  }
});
