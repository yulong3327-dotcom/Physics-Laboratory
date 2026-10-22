const {request,requireLogin,failToast}=require('../../utils/api');
const empty=()=>({recipient:'',phone:'',province:'',city:'',district:'',detail:'',isDefault:false});
Page({
  data:{addresses:[],loading:true,error:'',editing:false,editingId:'',form:empty(),region:[],saving:false,formError:'',deletingId:''},
  onLoad(){this._disposed=false;this._loadId=0;},
  onShow(){return this.load();},
  onUnload(){this._disposed=true;this._loadId++;},
  onPullDownRefresh(){return this.load().finally(()=>wx.stopPullDownRefresh());},
  current(token){return !this._disposed&&getApp().globalData.token===token;},
  load(){
    if(!requireLogin('/pages/addresses/index')){this.setData({loading:false});return Promise.resolve();}
    const token=getApp().globalData.token,id=++this._loadId;this.setData({loading:true,error:''});
    return request('/me/addresses').then(addresses=>{if(this.current(token)&&id===this._loadId)this.setData({addresses,loading:false});}).catch(e=>{if(this.current(token)&&id===this._loadId)this.setData({loading:false,error:e.message});});
  },
  add(){if(this.data.saving||this.data.deletingId)return;this.setData({editing:true,editingId:'',form:empty(),region:[],formError:''});},
  edit(e){if(this.data.saving||this.data.deletingId)return;const address=this.data.addresses.find(a=>a.id===e.currentTarget.dataset.id);if(address)this.setData({editing:true,editingId:address.id,form:{recipient:address.recipient,phone:address.phone,province:address.province,city:address.city,district:address.district,detail:address.detail,isDefault:address.isDefault},region:[address.province,address.city,address.district],formError:''});},
  close(){if(!this.data.saving)this.setData({editing:false,formError:''});},
  stop(){},
  input(e){const key=e.currentTarget.dataset.field;if(['recipient','phone','detail'].indexOf(key)===-1)return;const value=key==='phone'?e.detail.value.replace(/\D/g,'').slice(0,11):e.detail.value;this.setData({form:Object.assign({},this.data.form,{[key]:value})});},
  region(e){const region=e.detail.value;this.setData({region,form:Object.assign({},this.data.form,{province:region[0],city:region[1],district:region[2]})});},
  toggleDefault(){this.setData({form:Object.assign({},this.data.form,{isDefault:!this.data.form.isDefault})});},
  save(){
    if(this.data.saving)return;
    const data=Object.assign({},this.data.form);Object.keys(data).forEach(k=>{if(typeof data[k]==='string')data[k]=data[k].trim();});
    if(!data.recipient||!data.province||!data.city||!data.district||!data.detail){this.setData({formError:'请完整填写收件人、所在地区和详细地址'});return;}
    if(!/^1[3-9]\d{9}$/.test(data.phone)){this.setData({formError:'请输入正确的 11 位收件手机号'});return;}
    const token=getApp().globalData.token,id=this.data.editingId;this.setData({saving:true,formError:''});
    return request('/me/addresses'+(id?'/'+encodeURIComponent(id):''),{method:id?'PATCH':'POST',data}).then(()=>{
      if(!this.current(token))return;this.setData({editing:false});wx.showToast({title:'地址已保存'});return this.load();
    }).catch(e=>{if(this.current(token))this.setData({formError:e.message});}).finally(()=>{if(this.current(token))this.setData({saving:false});});
  },
  remove(e){
    if(this.data.saving||this.data.deletingId)return;const id=e.currentTarget.dataset.id,token=getApp().globalData.token;
    wx.showModal({title:'删除收货地址',content:'删除后不会改变已经提交的讲义寄送地址。',success:r=>{if(!r.confirm||!this.current(token)||this.data.deletingId)return;this.setData({deletingId:id});request('/me/addresses/'+encodeURIComponent(id),{method:'DELETE'}).then(()=>{if(this.current(token))return this.load();}).catch(e=>{if(this.current(token))failToast(e);}).finally(()=>{if(this.current(token))this.setData({deletingId:''});});}});
  }
});
