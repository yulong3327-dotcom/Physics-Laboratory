const {request,failToast,requireLogin,downloadMaterial}=require('../../utils/api');
const format=require('../../utils/format');
Page({
  data:{course:null,loading:true,error:'',tab:'lessons',lessons:[],materials:[],completed:0},
  onLoad(options){this._id=options.id;this.load();},
  onShow(){if(this._loaded)this.load();},
  onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh());},
  load(){if(!this._id){this.setData({loading:false,error:'缺少课程信息，请返回重新选择'});return Promise.resolve();}this.setData({error:''});return request('/courses/'+encodeURIComponent(this._id)).then(c=>{this.setData({course:format.course(c),lessons:c.lessons.map((l,i)=>format.lesson(l,i,c.progress,c.completedLessonIds)),materials:c.materials.map(format.material),completed:c.completedLessonIds.length,loading:false});this._loaded=true;wx.setNavigationBarTitle({title:c.title});}).catch(e=>this.setData({loading:false,error:e.message}));},
  switchTab(e){this.setData({tab:e.currentTarget.dataset.tab});},
  play(e){const lesson=this.data.lessons.find(l=>l.id===e.currentTarget.dataset.id);if(!lesson)return;if(!this.data.course.canWatch&&!lesson.isPreview){this.purchase();return;}wx.navigateTo({url:'/pages/learn/index?courseId='+this._id+'&lessonId='+lesson.id});},
  purchase(){if(!requireLogin('/pages/checkout/index?courseId='+this._id))return;wx.navigateTo({url:'/pages/checkout/index?courseId='+this._id});},
  action(){if(this.data.course.enrolled){const next=this.data.lessons.find(l=>!l.completed)||this.data.lessons[0];if(next)wx.navigateTo({url:'/pages/learn/index?courseId='+this._id+'&lessonId='+next.id});else failToast(new Error('老师正在准备课时内容，请稍后再来'));}else this.purchase();},
  download(e){const item=this.data.materials.find(m=>m.id===e.currentTarget.dataset.id);if(!item)return;downloadMaterial(item).catch(failToast);},
  materials(){this.setData({tab:'materials'});wx.pageScrollTo({selector:'#course-tabs',duration:250});},
  onShareAppMessage(){return{title:this.data.course?this.data.course.title:'知课 · 陪伴每一次进步',path:'/pages/course/index?id='+this._id};}
});
