const {request, config, failToast, requireLogin} = require('../../utils/api');
Page({
  data:{user:null,initial:'知',courseCount:0,orderCount:0,completedCount:0,demoMode:false,showContact:false},
  onShow(){if(this.getTabBar())this.getTabBar().setData({selected:2});this.load();},
  load(){
    const app=getApp();this.setData({user:app.globalData.user,initial:app.globalData.user?(app.globalData.user.nickname||'知').slice(0,1):'知',courseCount:0,orderCount:0,completedCount:0});
    config().then(c=>this.setData({demoMode:c.demoMode})).catch(()=>{});
    if(!app.globalData.token)return;
    request('/me').then(user=>{app.setUser(user);this.setData({user,initial:(user.nickname||'知').slice(0,1)});}).catch(e=>{this.setData({user:app.globalData.user});failToast(e);});
    request('/my/courses').then(c=>this.setData({courseCount:c.length,completedCount:c.filter(v=>v.progressPercent>=100).length})).catch(()=>{});
    request('/my/orders').then(o=>this.setData({orderCount:o.length})).catch(()=>{});
  },
  login(){wx.navigateTo({url:'/pages/login/index?returnTo='+encodeURIComponent('/pages/profile/index')});},
  identity(){if(this.data.user)this.editNickname();else this.login();},
  courses(){wx.switchTab({url:'/pages/my-courses/index'});},
  orders(){if(requireLogin('/pages/orders/index'))wx.navigateTo({url:'/pages/orders/index'});},
  contacts(){if(!this.data.user){this.login();return;}this.setData({showContact:true});},
  contactSaved(e){this.setData({user:e.detail.user,showContact:false});wx.showToast({title:'联系信息已保存'});},
  closeContact(){this.setData({showContact:false});},
  addresses(){if(requireLogin('/pages/addresses/index'))wx.navigateTo({url:'/pages/addresses/index'});},
  shipments(){if(requireLogin('/pages/shipments/index'))wx.navigateTo({url:'/pages/shipments/index'});},
  editNickname(){if(!this.data.user){this.login();return;}wx.showModal({title:'修改昵称',editable:true,placeholderText:this.data.user.nickname,success:r=>{if(r.confirm){const nickname=(r.content||'').trim();if(!nickname){failToast(new Error('昵称不能为空'));return;}request('/me',{method:'PATCH',data:{nickname}}).then(user=>{getApp().setUser(user);this.setData({user});wx.showToast({title:'昵称已更新'});}).catch(failToast);}}});},
  logout(){wx.showModal({title:'退出登录',content:'退出后可重新登录继续学习，课程与进度会保留。',success:r=>{if(r.confirm)request('/auth/logout',{method:'POST'}).catch(()=>{}).finally(()=>{getApp().clearSession();this.load();});}});},
  help(){wx.showModal({title:'学习帮助',content:'购买后可在「我的课程」进入学习；课时页面会记录学习进度。配套讲义可在课程详情下载，PDF 和 Office 文件可直接预览并从右上角菜单保存。支付后暂未开课时，可在订单页刷新状态。',showCancel:false});},
  about(){wx.showModal({title:'关于知课',content:'知课 ZHIKE，让优质课程陪伴每一次进步。自主选课、课程回看、配套讲义，在这里安心学习。',showCancel:false});}
});
