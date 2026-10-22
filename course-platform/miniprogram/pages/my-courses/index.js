const {request, failToast} = require('../../utils/api');
const format = require('../../utils/format');
Page({
  data:{courses:[],courseTitles:[],visible:[],loggedIn:false,loading:false,error:'',subject:'科目',type:'类型',grade:'年级',status:'课程状态',subjects:['科目'],types:['类型'],grades:['年级'],statuses:['课程状态','学习中','已完成'],total:0,completed:0},
  onShow(){if(this.getTabBar())this.getTabBar().setData({selected:1});this.load();},
  onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh());},
  load(){
    const loggedIn=Boolean(getApp().globalData.token);this.setData({loggedIn});if(!loggedIn)return Promise.resolve();
    this.setData({loading:true,error:''});
    return request('/my/courses').then(rows=>{
      const courses=rows.map(format.course);this.setData({courses,courseTitles:courses.map(c=>c.title),total:courses.length,completed:courses.filter(c=>c.progressPercent>=100).length,subjects:['科目'].concat(Array.from(new Set(courses.map(c=>c.subject)))),types:['类型'].concat(Array.from(new Set(courses.map(c=>c.type)))),grades:['年级'].concat(Array.from(new Set(courses.map(c=>c.grade)))),loading:false});this.filter();
    }).catch(error=>this.setData({loading:false,loggedIn:Boolean(getApp().globalData.token),error:error.message}));
  },
  choose(e){const field=e.currentTarget.dataset.field;const values=this.data[field==='status'?'statuses':field==='subject'?'subjects':field==='type'?'types':'grades'];this.setData({[field]:values[Number(e.detail.value)]});this.filter();},
  filter(){this.setData({visible:this.data.courses.filter(c=>(this.data.subject==='科目'||c.subject===this.data.subject)&&(this.data.type==='类型'||c.type===this.data.type)&&(this.data.grade==='年级'||c.grade===this.data.grade)&&(this.data.status==='课程状态'||(this.data.status==='已完成'?c.progressPercent>=100:c.progressPercent<100)))});},
  login(){wx.navigateTo({url:'/pages/login/index?returnTo='+encodeURIComponent('/pages/my-courses/index')});},
  discover(){wx.switchTab({url:'/pages/discover/index'});},
  materials(){if(!this.data.courses.length)failToast(new Error('选课后可查看配套讲义'));},
  chooseMaterials(e){const course=this.data.courses[Number(e.detail.value)];if(course)wx.navigateTo({url:'/pages/materials/index?courseId='+course.id});}
});
