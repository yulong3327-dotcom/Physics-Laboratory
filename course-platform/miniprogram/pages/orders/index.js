const {request,requireLogin,failToast}=require('../../utils/api');
Page({
  data:{orders:[],visible:[],filter:'全部',filters:['全部','待支付','已支付'],loading:true,error:''},
  onShow(){this.load();},
  onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh());},
  load(){if(!requireLogin('/pages/orders/index'))return Promise.resolve();this.setData({loading:true,error:''});return request('/my/orders').then(orders=>{this.setData({orders:orders.map(o=>Object.assign({},o,{dateText:(o.createdAt||'').replace('T',' ').slice(0,16),amountText:Number(o.amount).toFixed(2),statusText:o.status==='paid'?'已支付':o.status==='pending'?'待支付':'已关闭'})),loading:false});this.applyFilter();}).catch(e=>this.setData({loading:false,error:e.message}));},
  chooseFilter(e){this.setData({filter:e.currentTarget.dataset.filter});this.applyFilter();},
  applyFilter(){this.setData({visible:this.data.orders.filter(o=>this.data.filter==='全部'||(this.data.filter==='已支付'?o.status==='paid':o.status==='pending'))});},
  openCourse(e){wx.navigateTo({url:'/pages/course/index?id='+e.currentTarget.dataset.id});},
  pay(e){wx.navigateTo({url:'/pages/checkout/index?courseId='+e.currentTarget.dataset.course+'&orderId='+e.currentTarget.dataset.id});},
  refresh(){this.load().then(()=>wx.showToast({title:'订单状态已刷新',icon:'none'}));},
  discover(){wx.switchTab({url:'/pages/discover/index'});},
  copy(e){wx.setClipboardData({data:e.currentTarget.dataset.id});}
});
