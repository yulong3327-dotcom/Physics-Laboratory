const {request,downloadMaterial,failToast}=require('../../utils/api');
const format=require('../../utils/format');
Page({
  data:{course:null,materials:[],loading:true,error:'',downloading:''},
  onLoad(options){this._courseId=options.courseId;this.load();},
  onShow(){if(this._loaded)this.load();},
  onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh());},
  load(){this.setData({loading:true,error:''});return request('/courses/'+encodeURIComponent(this._courseId)).then(course=>{this._loaded=true;this.setData({course,materials:course.materials.map(format.material),loading:false});}).catch(e=>this.setData({loading:false,error:e.message}));},
  download(e){if(this.data.downloading)return;const item=this.data.materials.find(m=>m.id===e.currentTarget.dataset.id);if(!item)return;this.setData({downloading:item.id});downloadMaterial(item).catch(failToast).finally(()=>this.setData({downloading:''}));},
  buy(){wx.navigateTo({url:'/pages/checkout/index?courseId='+this._courseId});}
});
