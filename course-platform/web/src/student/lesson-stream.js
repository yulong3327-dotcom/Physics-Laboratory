const isHls = playback => /mpegurl/i.test(playback.contentType || '') || /\.m3u8(?:[?#]|$)/i.test(playback.videoUrl || playback.url || '');
const expiry = value => typeof value === 'number' ? value : Date.parse(value);

function validateVod(playback, now) {
  if (playback.playbackProvider !== 'tencent-vod') return;
  const url = playback.videoUrl || playback.url || '';
  if (playback.playbackAuth !== 'signed-url' || !/^https:\/\//i.test(url) || !Number.isFinite(expiry(playback.expiresAt)) || expiry(playback.expiresAt) <= now()) {
    throw new Error('视频播放凭证无效，请重新获取课程');
  }
}

// Owns only the media transport and short-lived CDN credentials. Login tokens
// remain in authorize(), which calls our API; media requests carry no token.
export function createLessonStream({ video, playback, authorize, isActive, onError, loadHls = () => import('hls.js'), now = Date.now, timers = globalThis, autoplay = true, refreshOnStart = false }) {
  let disposed = false, generation = 0, hls, refreshTimer, refreshing, metadata;
  const current = () => !disposed && isActive();
  const clearTimer = () => { if (refreshTimer !== undefined) timers.clearTimeout(refreshTimer); refreshTimer = undefined; };
  const stopSource = () => {
    generation++;
    if (metadata) video.removeEventListener('loadedmetadata', metadata);
    metadata = undefined;
    if (hls) { hls.destroy(); hls = undefined; }
    video.pause(); video.removeAttribute('src'); video.load();
  };
  const schedule = retry => {
    clearTimer();
    if (!current() || playback.playbackProvider !== 'tencent-vod') return;
    const remaining = expiry(playback.expiresAt) - now();
    const delay = retry ?? Math.max(1000, remaining - Math.min(60000, remaining / 2));
    refreshTimer = timers.setTimeout(() => { refreshTimer = undefined; void refresh(); }, Math.min(delay, 2147483647));
  };
  const setSource = async (next, initial = false) => {
    validateVod(next, now);
    const run = ++generation;
    const position = initial ? Number(next.resumeSeconds) || 0 : Number(video.currentTime) || 0;
    const shouldPlay = initial ? autoplay : !video.paused && !video.ended;
    if (metadata) video.removeEventListener('loadedmetadata', metadata);
    if (hls) { hls.destroy(); hls = undefined; }
    video.pause();
    const url = next.videoUrl || next.url;
    if (!url) throw new Error('老师尚未上传本课时视频，请稍后再来');
    metadata = () => {
      if (!current() || run !== generation) return;
      video.removeEventListener('loadedmetadata', metadata);
      metadata = undefined;
      if (position > 0) video.currentTime = Number.isFinite(video.duration) ? Math.min(position, Math.max(0, video.duration - 0.1)) : position;
      if (shouldPlay) void video.play().catch(() => {});
    };
    video.addEventListener('loadedmetadata', metadata);
    video.crossOrigin = 'anonymous';
    if (isHls(next) && !video.canPlayType('application/vnd.apple.mpegurl')) {
      const module = await loadHls();
      if (!current() || run !== generation) return;
      const Hls = module.default || module;
      if (!Hls.isSupported()) throw new Error('当前浏览器不支持本课视频，请使用微信小程序观看');
      hls = new Hls({ xhrSetup(xhr) { xhr.withCredentials = false; } });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (current() && run === generation && data.fatal) onError(new Error('视频加载失败，请检查网络后重新获取视频'));
      });
      hls.attachMedia(video);
      hls.loadSource(url);
    } else {
      video.src = url;
      video.load();
    }
    playback = next;
    schedule();
  };
  const refresh = () => {
    if (!current()) return Promise.resolve();
    if (refreshing) return refreshing;
    refreshing = Promise.resolve().then(() => {
      if (current()) return authorize();
    }).then(next => {
      if (!next || !current()) return;
      if (next.playbackProvider !== 'tencent-vod') throw new Error('视频服务已变更，请重新打开课程');
      return setSource(next);
    }).catch(error => {
      if (!current()) return;
      if (error.status === 401 || error.status === 403 || expiry(playback.expiresAt) <= now()) {
        clearTimer(); stopSource();
        onError(error);
      } else {
        schedule(Math.max(1000, Math.min(10000, expiry(playback.expiresAt) - now())));
      }
    }).finally(() => { refreshing = undefined; });
    return refreshing;
  };
  const ready = Promise.resolve().then(async () => {
    if (!current()) return;
    // The playback endpoint returns server progress, while retry must keep the
    // latest local position (including an unsaved seek). Reauthorize local
    // signed media on manual retry too, rather than reusing an expired URL.
    const position = Number(playback.resumeSeconds) || 0;
    const next = refreshOnStart || (playback.playbackProvider === 'tencent-vod' && expiry(playback.expiresAt) <= now()) ? await authorize() : playback;
    if (current()) return setSource({ ...next, resumeSeconds: position }, true);
  }).catch(error => { if (current()) onError(error); });
  return {
    ready, refresh,
    destroy() {
      disposed = true; clearTimer(); stopSource();
    }
  };
}
