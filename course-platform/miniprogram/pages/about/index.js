const brand = require('../../utils/brand');

Page({
  data: {brand, copying: false},
  copyBilibili() {
    if (this.data.copying) return;
    this.setData({copying: true});
    wx.setClipboardData({
      data: brand.bilibiliUrl,
      success: () => wx.showModal({
        title: 'B站主页链接已复制',
        content: '请在浏览器中粘贴打开，或在哔哩哔哩搜索 UID ' + brand.bilibiliUid + '，找到玉龙的主页。',
        showCancel: false,
        confirmText: '知道了'
      }),
      fail: () => wx.showToast({title: '复制未完成，请重试', icon: 'none'}),
      complete: () => this.setData({copying: false})
    });
  },
  courses() { wx.switchTab({url: '/pages/discover/index'}); },
  onShareAppMessage() { return {title: brand.name + ' · 认识玉龙老师', path: '/pages/about/index'}; }
});
