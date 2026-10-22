const {request,absoluteUrl,downloadVideo,removeTempVideo}=require('../../utils/api');
const format=require('../../utils/format');
Page({
  data:{course:null,lesson:null,lessons:[],loading:true,error:'',videoError:false,players:[],demoVideo:false,nextLesson:null,savedText:'',isPreview:false,downloading:false,downloadProgress:0},
  onLoad(options){
    this._courseId=options.courseId;this._lessonId=options.lessonId;
    this._requestId=0;this._sessionId=0;this._progress={};this._saveQueue=Promise.resolve();this._disposed=false;
    this._authToken=getApp().globalData.token||'';this._authVersion=0;
    this.load();
  },
  onShow(){if(!this._disposed&&(this._refreshOnShow||this._authToken!==(getApp().globalData.token||''))){this._refreshOnShow=false;return this.load();}},
  onHide(){this._refreshOnShow=true;this._requestId++;this.cancelDownload();this.stopPlayback();this.setData({players:[],downloading:false});},
  onUnload(){this.stopPlayback();this._disposed=true;this._requestId++;this.cancelDownload();},
  stopPlayback(){
    this.clearPlaybackRefresh();
    const playback=this._playback;
    if(!playback)return;
    this.saveProgress(false,playback);
    this._playback=null;
    wx.createVideoContext('lesson-video-'+playback.id,this).pause();
    if(playback.tempFilePath&&removeTempVideo)removeTempVideo(playback.tempFilePath);
  },
  cancelDownload(){const download=this._download;this._download=null;if(download)download.abort();},
  cancelLoading(){this._requestId++;this.cancelDownload();this.setData({loading:false,downloading:false,error:'视频加载已取消，可重新加载课程'});},
  authActive(token,version){return token===(getApp().globalData.token||'')&&token===this._authToken&&version===this._authVersion;},
  load(){
    const authToken=getApp().globalData.token||'';
    if(authToken!==this._authToken){
      this._authToken=authToken;this._authVersion++;this._canSave=false;
      this._progress={};this._saveQueue=Promise.resolve();
    }
    const authVersion=this._authVersion;
    this.cancelDownload();
    this.stopPlayback();
    const requestId=++this._requestId;
    this.setData({loading:true,error:'',videoError:false,players:[]});
    return request('/courses/'+encodeURIComponent(this._courseId)).then(course=>{
      if(this._disposed||requestId!==this._requestId||!this.authActive(authToken,authVersion))return;
      this._canSave=course.enrolled;
      this.setData({course:format.course(course),lessons:course.lessons.map((l,i)=>format.lesson(l,i,course.progress,course.completedLessonIds))});
      return this.openLesson(this._lessonId);
    }).catch(e=>{if(!this._disposed&&requestId===this._requestId&&this.authActive(authToken,authVersion))this.setData({loading:false,error:e.message});});
  },
  openLesson(id){
    if(this._authToken!==(getApp().globalData.token||'')){this._lessonId=id;return this.load();}
    const authToken=this._authToken,authVersion=this._authVersion;
    this.cancelDownload();
    this.stopPlayback();
    const requestId=++this._requestId;
    this._lessonId=id;
    this.setData({loading:true,error:'',players:[],lesson:null,videoError:false,downloading:false,downloadProgress:0});
    return request('/lessons/'+encodeURIComponent(id)+'/play').then(lesson=>{
      if(this._disposed||requestId!==this._requestId||!this.authActive(authToken,authVersion))return;
      const videoUrl=lesson.videoUrl||lesson.url;
      if(!videoUrl)throw new Error('老师尚未上传本课时视频，请稍后再来');
      // A VOD URL is a short-lived CDN credential. Stream it directly; never
      // download an entire cloud lesson or send our login token to the CDN.
      const isVod=lesson.playbackProvider==='tencent-vod';
      if(isVod)this.validateVodPlayback(lesson);
      const prepare=!isVod&&lesson.requiresAuthorizedDownload?this.prepareProtectedVideo(videoUrl,requestId,authToken,authVersion):Promise.resolve({url:absoluteUrl(videoUrl),tempFilePath:''});
      return prepare.then(video=>{
      if(!video)return;
      if(this._disposed||requestId!==this._requestId||!this.authActive(authToken,authVersion)){if(video.tempFilePath&&removeTempVideo)removeTempVideo(video.tempFilePath);return;}
      const index=this.data.lessons.findIndex(l=>l.id===id);
      // Keep the latest local position while a previous save is still in flight.
      const progress=this._progress[id]||(this._progress[id]={position:Number(lesson.progress)||0,completed:false,savedPosition:Number(lesson.progress)||0,lastSave:null});
      const playback={id:++this._sessionId,lessonId:id,progress,authToken,authVersion,tempFilePath:video.tempFilePath,isVod,playing:false,expiresAt:lesson.expiresAt};
      this._playback=playback;
      this.setData({lesson,players:[{id:playback.id,url:video.url,startTime:progress.position,title:lesson.title,autoplay:false}],demoVideo:!!lesson.demoVideo,isPreview:!this.data.course.enrolled,loading:false,downloading:false,error:'',videoError:false,savedText:this._canSave?'学习进度自动保存':'当前为课程试看',nextLesson:this.data.lessons[index+1]||null});
      this.schedulePlaybackRefresh(playback);
      wx.setNavigationBarTitle({title:lesson.title});
      });
    }).catch(e=>{if(!this._disposed&&requestId===this._requestId&&this.authActive(authToken,authVersion))this.setData({loading:false,downloading:false,error:e.message});});
  },
  prepareProtectedVideo(url,requestId,authToken,authVersion){
    this.setData({downloading:true,downloadProgress:0});
    const download=downloadVideo(url,{token:authToken,onProgress:value=>{
      if(!this._disposed&&requestId===this._requestId&&this.authActive(authToken,authVersion))this.setData({downloadProgress:Math.max(0,Math.min(100,Number(value.progress)||0))});
    }});
    this._download=download;
    return download.promise.then(path=>({url:path,tempFilePath:path})).finally(()=>{if(this._download===download)this._download=null;});
  },
  validateVodPlayback(lesson){
    if(lesson.playbackAuth!=='signed-url'||!/^https:\/\//i.test(lesson.videoUrl||lesson.url||'')||!Number.isFinite(this.playbackExpiry(lesson.expiresAt))||this.playbackExpiry(lesson.expiresAt)<=Date.now())throw new Error('视频播放凭证无效，请重新获取课程');
  },
  playbackExpiry(value){return typeof value==='number'?value:Date.parse(value);},
  clearPlaybackRefresh(){if(this._refreshTimer){clearTimeout(this._refreshTimer);this._refreshTimer=null;}},
  schedulePlaybackRefresh(playback,retryDelay){
    this.clearPlaybackRefresh();
    if(!playback||!playback.isVod||this._disposed||this._playback!==playback)return;
    const remaining=this.playbackExpiry(playback.expiresAt)-Date.now();
    const delay=retryDelay===undefined?Math.max(1000,remaining-Math.min(60000,remaining/2)):retryDelay;
    this._refreshTimer=setTimeout(()=>{this._refreshTimer=null;this.refreshPlayback(playback);},Math.min(delay,2147483647));
  },
  refreshPlayback(playback){
    if(this._disposed||this._playback!==playback||!this.authActive(playback.authToken,playback.authVersion))return Promise.resolve();
    if(playback.refreshing)return playback.refreshing;
    const requestId=this._requestId;
    const current=()=>!this._disposed&&this._playback===playback&&requestId===this._requestId&&this.authActive(playback.authToken,playback.authVersion);
    playback.refreshing=request('/lessons/'+encodeURIComponent(playback.lessonId)+'/play',{header:playback.authToken?{Authorization:'Bearer '+playback.authToken}:{}}).then(lesson=>{
      if(!current())return;
      if(lesson.playbackProvider!=='tencent-vod')throw new Error('视频服务已变更，请重新打开课程');
      this.validateVodPlayback(lesson);
      const refreshed=Object.assign({},playback,{id:++this._sessionId,expiresAt:lesson.expiresAt,refreshing:null});
      this._playback=refreshed;
      wx.createVideoContext('lesson-video-'+playback.id,this).pause();
      this.setData({lesson,players:[{id:refreshed.id,url:lesson.videoUrl||lesson.url,startTime:playback.progress.position,title:lesson.title,autoplay:!!playback.playing}],videoError:false});
      this.schedulePlaybackRefresh(refreshed);
    }).catch(error=>{
      if(this._disposed||this._playback!==playback||requestId!==this._requestId)return;
      if(!this.authActive(playback.authToken,playback.authVersion)||error.status===401||error.status===403){
        this.stopPlayback();this.setData({players:[],error:error.status===403?'当前账号暂无课程观看权限，请重新选课':'登录身份已变化，请重新打开课程'});return;
      }
      if(this.playbackExpiry(playback.expiresAt)<=Date.now()){
        playback.playing=false;wx.createVideoContext('lesson-video-'+playback.id,this).pause();this.setData({videoError:true});return;
      }
      this.schedulePlaybackRefresh(playback,Math.max(1000,Math.min(10000,this.playbackExpiry(playback.expiresAt)-Date.now())));
    }).finally(()=>{playback.refreshing=null;});
    return playback.refreshing;
  },
  chooseLesson(e){const id=e.currentTarget.dataset.id;if(id===this._lessonId)return;const target=this.data.lessons.find(l=>l.id===id);if(!target)return;if(!this.data.course.canWatch&&!target.isPreview){this.buy();return;}return this.openLesson(id);},
  eventPlayback(e){
    const playback=this._playback;
    return !this._disposed&&playback&&this.authActive(playback.authToken,playback.authVersion)&&e&&e.currentTarget&&String(e.currentTarget.dataset.session)===String(playback.id)?playback:null;
  },
  timeUpdate(e){
    const playback=this.eventPlayback(e);if(!playback)return;
    const position=Number(e.detail.currentTime);if(!Number.isFinite(position)||position<0)return;
    const progress=playback.progress;progress.position=position;
    const lastPosition=progress.lastSave&&progress.lastSave.status!=='failed'&&progress.lastSave.status!=='skipped'?progress.lastSave.position:progress.savedPosition;
    if(Math.abs(position-lastPosition)>=10)this.saveProgress(false,playback);
  },
  play(e){const playback=this.eventPlayback(e);if(playback)playback.playing=true;},
  pause(e){const playback=this.eventPlayback(e);if(playback){playback.playing=false;this.saveProgress(false,playback);}},
  ended(e){
    const playback=this.eventPlayback(e);if(!playback)return;
    playback.playing=false;
    playback.progress.completed=true;
    this.saveProgress(true,playback);
    this.setData({savedText:this._canSave?'本课时已学完，正在同步…':'本次试看已结束'});
  },
  saveProgress(completed,playback){
    playback=playback||this._playback;
    if(!this._canSave||!playback||!playback.authToken||!this.authActive(playback.authToken,playback.authVersion))return Promise.resolve();
    const authToken=playback.authToken,authVersion=playback.authVersion;
    const progress=playback.progress;
    progress.completed=!!(completed||progress.completed);
    const previous=progress.lastSave;
    if(previous&&previous.status!=='failed'&&previous.status!=='skipped'&&previous.position===progress.position&&previous.completed===progress.completed)return previous.promise;
    const snapshot={position:progress.position,completed:progress.completed,status:'queued'};
    progress.lastSave=snapshot;
    // Keep writes ordered within an account; a queued save must never adopt a new token.
    snapshot.promise=this._saveQueue.then(()=>{
      if(!this.authActive(authToken,authVersion)){snapshot.status='skipped';return;}
      return request('/lessons/'+encodeURIComponent(playback.lessonId)+'/progress',{method:'POST',header:{Authorization:'Bearer '+authToken},data:{seconds:snapshot.position,completed:snapshot.completed}}).then(()=>{
        if(!this.authActive(authToken,authVersion)){snapshot.status='skipped';return;}
        snapshot.status='saved';progress.savedPosition=snapshot.position;
        if(this._disposed)return;
        if(snapshot.completed)this.setData({lessons:this.data.lessons.map(l=>l.id===playback.lessonId?Object.assign({},l,{completed:true}):l)});
        if(this._playback===playback&&progress.lastSave===snapshot)this.setData({savedText:snapshot.completed?'本课时已学完 ✓':'学习进度已同步'});
      });
    }).catch(()=>{
      if(!this.authActive(authToken,authVersion)){snapshot.status='skipped';return;}
      snapshot.status='failed';
      if(!this._disposed&&this._playback===playback&&progress.lastSave===snapshot)this.setData({savedText:'进度暂未同步，暂停视频时将重试'});
    });
    this._saveQueue=snapshot.promise;
    return snapshot.promise;
  },
  videoFailed(e){if(this.eventPlayback(e))this.setData({videoError:true});},
  retryVideo(){return this.openLesson(this._lessonId);},
  next(){if(this.data.nextLesson)this.chooseLesson({currentTarget:{dataset:{id:this.data.nextLesson.id}}});},
  materials(){wx.navigateTo({url:'/pages/materials/index?courseId='+this._courseId});},
  buy(){wx.navigateTo({url:'/pages/checkout/index?courseId='+this._courseId});}
});
