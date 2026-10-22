Component({
  data: {selected: 0, items: [{path: '/pages/discover/index', text: '玉龙的课', icon: 'discover'}, {path: '/pages/my-courses/index', text: '我的课程', icon: 'courses'}, {path: '/pages/profile/index', text: '我的', icon: 'profile'}]},
  methods: {switchTab(event) { const index = Number(event.currentTarget.dataset.index); wx.switchTab({url: this.data.items[index].path}); }}
});
