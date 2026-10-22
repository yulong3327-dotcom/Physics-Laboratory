App({
  globalData: {
    apiBaseUrl: 'https://course.yulongchemistry.cn',
    user: null,
    token: '',
    config: null
  },
  onLaunch() {
    this.globalData.token = wx.getStorageSync('zhike_token') || '';
    this.globalData.user = wx.getStorageSync('zhike_user') || null;
  },
  setSession(token, user) {
    this.globalData.token = token;
    this.globalData.user = user;
    wx.setStorageSync('zhike_token', token);
    wx.setStorageSync('zhike_user', user);
  },
  setUser(user) {
    this.globalData.user = user;
    wx.setStorageSync('zhike_user', user);
  },
  clearSession() {
    this.globalData.token = '';
    this.globalData.user = null;
    wx.removeStorageSync('zhike_token');
    wx.removeStorageSync('zhike_user');
  }
});
