const {request, config} = require('../../utils/api');
const format = require('../../utils/format');
const brand = require('../../utils/brand');
Page({
  data: {brand, courses: [], subjects: ['全部'], grades: ['全部年级'], subject: '全部', grade: '全部年级', search: '', loading: true, error: '', demoMode: false},
  onLoad() { config().then(c => this.setData({demoMode:c.demoMode})).catch(() => {}); this.load(); },
  onShow() { if (this.getTabBar()) this.getTabBar().setData({selected: 0}); if (this._loaded) this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  load() {
    this.setData({loading: true, error: ''});
    const queries = [];
    if (this.data.subject !== '全部') queries.push('subject=' + encodeURIComponent(this.data.subject));
    if (this.data.grade !== '全部年级') queries.push('grade=' + encodeURIComponent(this.data.grade));
    if (this.data.search.trim()) queries.push('q=' + encodeURIComponent(this.data.search.trim()));
    return request('/courses' + (queries.length ? '?' + queries.join('&') : '')).then(items => {
      const update = {courses:items.map(format.course), loading:false};
      if (!queries.length) { update.subjects = ['全部'].concat(Array.from(new Set(items.map(i => i.subject)))); update.grades = ['全部年级'].concat(Array.from(new Set(items.map(i => i.grade)))); }
      this.setData(update); this._loaded = true;
    }).catch(error => this.setData({loading:false,error:error.message}));
  },
  searchInput(e) { this.setData({search:e.detail.value}); },
  search() { this.load(); },
  chooseSubject(e) { this.setData({subject:e.currentTarget.dataset.value}); this.load(); },
  chooseGrade(e) { this.setData({grade:this.data.grades[Number(e.detail.value)]});this.load(); },
  reset() { this.setData({subject:'全部',grade:'全部年级',search:''});this.load(); },
  explore() { wx.pageScrollTo({selector:'#course-list',duration:300}); },
  about() { wx.navigateTo({url:'/pages/about/index'}); },
  onShareAppMessage() { return {title:brand.name + ' · ' + brand.tagline,path:'/pages/discover/index'}; }
});
