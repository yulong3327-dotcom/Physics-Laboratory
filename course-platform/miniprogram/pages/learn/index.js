const {request,absoluteUrl,failToast}=require('../../utils/api');
const format=require('../../utils/format');
Page({
  data:{course:null,lesson:null,lessons:[],loading:true,error:'',videoError:false,videoUrl:'',startTime:0,demoVideo:false,nextLesson:null,savedText:'',isPreview:false},
  onLoad(options){this._courseId=options.courseId;this._lessonId=options.lessonId;this._position=0;this._lastSaved=0;this._completed=false;this.load();},
  onHide(){this.saveProgress(false);},
  onUnload(){this.saveProgress(false);},
  load(){this.setData({loading:true,error:'',videoError:false});return request('/courses/'+encodeURIComponent(this._courseId)).then(course=>{
    this._canSave=course.enrolled;
    this.setData({course:format.course(course),lessons:course.lessons.map((l,i)=>format.lesson(l,i,course.progress,course.completedLessonIds))});
    return this.openLesson(this._lessonId);
  }).catch(e=>this.setData({loading:false,error:e.message}));},
  openLesson(id){
    this._lessonId=id;this._position=0;this._lastSaved=0;this._completed=false;
    return request('/lessons/'+encodeURIComponent(id)+'/play').then(lesson=>{
      if(!lesson.url)throw new Error('老师尚未上传本课时视频，请稍后再来');
      const index=this.data.lessons.findIndex(l=>l.id===id);this._position=Number(lesson.progress)||0;this._lastSaved=this._position;
      this.setData({lesson,videoUrl:absoluteUrl(lesson.url),startTime:this._position,demoVideo:!!lesson.demoVideo,isPreview:!this.data.course.enrolled,loading:false,error:'',videoError:false,savedText:this._canSave?'学习进度自动保存':'当前为课程试看',nextLesson:this.data.lessons[index+1]||null});
      wx.setNavigationBarTitle({title:lesson.title});
    });
  },
  chooseLesson(e){const id=e.currentTarget.dataset.id;if(id===this._lessonId)return;const target=this.data.lessons.find(l=>l.id===id);if(!target)return;if(!this.data.course.canWatch&&!target.isPreview){this.buy();return;}this.saveProgress(false);const video=wx.createVideoContext('lesson-video',this);video.pause();this.setData({loading:true,error:'',videoUrl:''});this.openLesson(id).catch(e=>this.setData({loading:false,error:e.message}));},
  timeUpdate(e){this._position=Number(e.detail.currentTime)||0;if(Math.abs(this._position-this._lastSaved)>=10)this.saveProgress(false);},
  pause(){this.saveProgress(false);},
  ended(){this._completed=true;this.saveProgress(true);this.setData({savedText:this._canSave?'本课时已学完 ✓':'本次试看已结束'});},
  saveProgress(completed){
    if(!this._canSave||!getApp().globalData.token||!this._lessonId||!this.data.lesson)return;
    const lessonId=this._lessonId,position=this._position;this._lastSaved=position;
    request('/lessons/'+encodeURIComponent(lessonId)+'/progress',{method:'POST',data:{seconds:position,completed:completed||this._completed}}).then(()=>{if(lessonId!==this._lessonId)return;this.setData({savedText:(completed||this._completed)?'本课时已学完 ✓':'学习进度已同步'});if(completed||this._completed)this.setData({lessons:this.data.lessons.map(l=>l.id===lessonId?Object.assign({},l,{completed:true}):l)});}).catch(()=>{if(lessonId===this._lessonId)this.setData({savedText:'进度暂未同步，暂停视频时将重试'});});
  },
  videoFailed(){this.setData({videoError:true});},
  retryVideo(){this.saveProgress(false);this.setData({videoUrl:'',loading:true});this.openLesson(this._lessonId).catch(e=>this.setData({loading:false,error:e.message}));},
  next(){if(this.data.nextLesson)this.chooseLesson({currentTarget:{dataset:{id:this.data.nextLesson.id}}});},
  materials(){wx.navigateTo({url:'/pages/materials/index?courseId='+this._courseId});},
  buy(){wx.navigateTo({url:'/pages/checkout/index?courseId='+this._courseId});}
});
