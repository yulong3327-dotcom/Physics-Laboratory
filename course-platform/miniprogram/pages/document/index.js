Page({
  data:{name:'讲义预览',text:''},
  onLoad(){const preview=getApp().globalData.documentPreview;if(preview){this.setData(preview);wx.setNavigationBarTitle({title:preview.name||'讲义预览'});}},
  onUnload(){getApp().globalData.documentPreview=null;},
  copy(){wx.setClipboardData({data:this.data.text||''});}
});
