const {request,requireLogin,failToast}=require('../../utils/api');
const labels={pending:'待发货',shipped:'已发货',delivered:'已收货',cancelled:'已取消'};
Page({
  data:{shipments:[],eligibleOrders:[],addresses:[],addressLabels:[],loading:true,error:'',editing:false,editShipmentId:'',selectedOrder:null,addressIndex:-1,saving:false,formError:'',trackingId:'',trackingLoading:false,tracking:null,trackingError:'',receivingId:''},
  onLoad(options){this._disposed=false;this._loadId=0;this._trackingRequest=0;this._orderId=options.orderId||'';},
  onShow(){return this.load();},
  onUnload(){this._disposed=true;this._loadId++;this._trackingRequest++;},
  onPullDownRefresh(){return this.load().finally(()=>wx.stopPullDownRefresh());},
  current(token){return !this._disposed&&getApp().globalData.token===token;},
  load(){
    if(!requireLogin('/pages/shipments/index'+(this._orderId?'?orderId='+encodeURIComponent(this._orderId):''))){this.setData({loading:false});return Promise.resolve();}
    const token=getApp().globalData.token,id=++this._loadId;this.setData({loading:true,error:''});
    return Promise.all([request('/me/shipments'),request('/me/addresses'),request('/my/orders')]).then(([records,addresses,orders])=>{
      if(!this.current(token)||id!==this._loadId)return;
      const shipments=records.map(record=>Object.assign({},record,{statusText:labels[record.status]||record.status,dateText:(record.createdAt||'').replace('T',' ').slice(0,16)}));
      const requested=new Set(shipments.map(s=>s.orderId)),eligibleOrders=orders.filter(o=>o.status==='paid'&&o.shippingEnabled&&!requested.has(o.id));
      this.setData({shipments,addresses,addressLabels:addresses.map(a=>(a.isDefault?'[默认] ':'')+a.recipient+' '+a.phone+' '+a.province+a.city+a.district+' '+a.detail),eligibleOrders,loading:false});
      if(this._orderId){const order=eligibleOrders.find(o=>o.id===this._orderId);this._orderId='';if(order)this.beginEdit(order,null);}
    }).catch(e=>{if(this.current(token)&&id===this._loadId)this.setData({loading:false,error:e.message});});
  },
  beginEdit(order,shipment){const index=this.data.addresses.findIndex(a=>a.isDefault);this.setData({editing:true,editShipmentId:shipment?shipment.id:'',selectedOrder:order||{id:shipment.orderId,courseTitle:shipment.courseTitle},addressIndex:index>=0?index:this.data.addresses.length?0:-1,formError:''});},
  requestShipment(e){const order=this.data.eligibleOrders.find(o=>o.id===e.currentTarget.dataset.id);if(order)this.beginEdit(order,null);},
  changeAddress(e){const shipment=this.data.shipments.find(s=>s.id===e.currentTarget.dataset.id);if(shipment&&shipment.status==='pending')this.beginEdit(null,shipment);},
  selectAddress(e){this.setData({addressIndex:Number(e.detail.value)});},
  close(){if(!this.data.saving)this.setData({editing:false,formError:''});},
  stop(){},
  addresses(){this.setData({editing:false});wx.navigateTo({url:'/pages/addresses/index'});},
  orders(){wx.navigateTo({url:'/pages/orders/index'});},
  save(){
    if(this.data.saving)return;
    const address=this.data.addresses[this.data.addressIndex],order=this.data.selectedOrder,id=this.data.editShipmentId;
    if(!address||!order){this.setData({formError:'请先添加并选择收货地址'});return;}
    const token=getApp().globalData.token;this.setData({saving:true,formError:''});
    return request('/me/shipments'+(id?'/'+encodeURIComponent(id):''),{method:id?'PATCH':'POST',data:id?{addressId:address.id}:{orderId:order.id,addressId:address.id}}).then(()=>{
      if(!this.current(token))return;this.setData({editing:false});wx.showToast({title:id?'寄送地址已更新':'寄送申请已提交'});return this.load();
    }).catch(e=>{if(this.current(token))this.setData({formError:e.message});}).finally(()=>{if(this.current(token))this.setData({saving:false});});
  },
  copyTracking(e){const record=this.data.shipments.find(s=>s.id===e.currentTarget.dataset.id);if(record&&record.trackingNumber)wx.setClipboardData({data:record.trackingNumber});},
  tracking(e){
    const id=e.currentTarget.dataset.id,record=this.data.shipments.find(s=>s.id===id);if(!record||!record.trackingNumber)return;
    const token=getApp().globalData.token,sequence=++this._trackingRequest;this.setData({trackingId:id,trackingLoading:true,tracking:null,trackingError:''});
    return request('/me/shipments/'+encodeURIComponent(id)+'/tracking').then(result=>{if(this.current(token)&&sequence===this._trackingRequest)this.setData({tracking:result,trackingLoading:false});}).catch(e=>{if(this.current(token)&&sequence===this._trackingRequest)this.setData({trackingError:e.message,trackingLoading:false});});
  },
  closeTracking(){this._trackingRequest++;this.setData({trackingId:'',tracking:null,trackingLoading:false,trackingError:''});},
  receive(e){
    if(this.data.receivingId)return;
    const id=e.currentTarget.dataset.id,record=this.data.shipments.find(s=>s.id===id),token=getApp().globalData.token;if(!record||record.status!=='shipped')return;
    wx.showModal({title:'确认收到讲义',content:'请确认已经收到此课程的实物讲义。',success:r=>{
      if(!r.confirm||!this.current(token)||this.data.receivingId)return;this.setData({receivingId:id});
      request('/me/shipments/'+encodeURIComponent(id)+'/receive',{method:'POST'}).then(()=>{if(this.current(token)){wx.showToast({title:'已确认收货'});return this.load();}}).catch(e=>{if(this.current(token))failToast(e);}).finally(()=>{if(this.current(token))this.setData({receivingId:''});});
    }});
  }
});
