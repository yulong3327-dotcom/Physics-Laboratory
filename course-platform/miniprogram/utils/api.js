function absoluteUrl(path) {
  if (/^https?:\/\//.test(path || '')) return path;
  return getApp().globalData.apiBaseUrl.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path);
}
function request(path, options) {
  const settings = options || {};
  return new Promise((resolve, reject) => {
    const token = getApp().globalData.token;
    wx.request({
      url: absoluteUrl('/api' + path),
      method: settings.method || 'GET',
      data: settings.data,
      timeout: 18000,
      header: Object.assign({'Content-Type': 'application/json'}, token ? {Authorization: 'Bearer ' + token} : {}, settings.header || {}),
      success(response) {
        const body = response.data;
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body);
        } else {
          if (response.statusCode === 401) getApp().clearSession();
          const error = new Error(body && (body.message || body.error) || '请求失败，请稍后重试');
          error.status = response.statusCode;
          reject(error);
        }
      },
      fail() { reject(new Error('暂时无法连接服务，请检查网络与服务地址')); }
    });
  });
}
function config(refresh) {
  const app = getApp();
  if (app.globalData.config && !refresh) return Promise.resolve(app.globalData.config);
  return request('/config').then(value => { app.globalData.config = value; return value; });
}
function failToast(error) {
  wx.showToast({title: error.message || '操作失败，请稍后重试', icon: 'none', duration: 3200});
}
function requireLogin(returnTo) {
  if (getApp().globalData.token) return true;
  wx.navigateTo({url: '/pages/login/index?returnTo=' + encodeURIComponent(returnTo || '')});
  return false;
}
function downloadMaterial(item) {
  if (!requireLogin('/pages/materials/index?courseId=' + item.courseId)) return Promise.resolve();
  wx.showLoading({title: '下载讲义中', mask: true});
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: absoluteUrl('/api/materials/' + encodeURIComponent(item.id) + '/download'),
      header: {Authorization: 'Bearer ' + getApp().globalData.token},
      timeout: 60000,
      success(response) {
        wx.hideLoading();
        if (response.statusCode !== 200) { reject(new Error(response.statusCode === 403 ? '选课或购买后可下载讲义' : response.statusCode === 401 ? '登录已过期，请重新登录' : '讲义下载失败，请稍后重试')); return; }
        const extension = (item.fileName || item.name || '').split('.').pop().toLowerCase();
        if (['pdf','doc','docx','xls','xlsx','ppt','pptx'].indexOf(extension) !== -1) {
          wx.openDocument({filePath: response.tempFilePath, fileType: extension, showMenu: true, success: resolve, fail() { reject(new Error('文件已下载，当前设备无法打开该文档格式')); }});
        } else if ((extension === 'txt' || extension === 'md') && Number(item.size || 0) <= 2 * 1024 * 1024) {
          wx.getFileSystemManager().readFile({filePath:response.tempFilePath,encoding:'utf8',success(file){
            getApp().globalData.documentPreview = {name:item.name,text:file.data};
            wx.navigateTo({url:'/pages/document/index',success:resolve,fail(){reject(new Error('讲义已下载，但预览页面打开失败'));}});
          },fail(){reject(new Error('讲义已下载，但文本读取失败'));}});
        } else {
          wx.saveFile({tempFilePath: response.tempFilePath, success(saved) { wx.showModal({title:'资料已保存', content:'已保存到小程序文件空间，当前设备可能不支持预览该格式。', showCancel:false}); resolve(saved); }, fail() { reject(new Error('文件保存失败，请清理空间后重试')); }});
        }
      },
      fail() { wx.hideLoading(); reject(new Error('下载中断，请检查网络后重试')); }
    });
  });
}
function linkWechat(phoneCode) {
  if (!phoneCode) return Promise.reject(new Error('未获得手机号授权，请重试'));
  return new Promise((resolve, reject) => wx.login({
    success(result) {
      if (!result.code) { reject(new Error('未获取微信登录凭证')); return; }
      request('/me/wechat', {method:'POST', data:{code:result.code, phoneCode}})
        .then(user => { getApp().setUser(user); resolve(user); }).catch(reject);
    },
    fail() { reject(new Error('微信授权未完成，请重试')); }
  }));
}
module.exports = {request, config, failToast, requireLogin, absoluteUrl, downloadMaterial, linkWechat};
