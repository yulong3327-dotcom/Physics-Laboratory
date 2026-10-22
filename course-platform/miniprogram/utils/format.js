function duration(seconds) {
  const n = Math.max(0, Math.round(Number(seconds) || 0));
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
}
function size(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'; }
function course(item) {
  return Object.assign({}, item, {teacherInitial: (item.teacher || '知').slice(-2), hours: Math.max(1, Math.round((item.duration || 0) / 60)), priceText: Number(item.price || 0).toFixed(2).replace(/\.00$/, ''), progressPercent: Number(item.progressPercent || 0)});
}
function lesson(item, index, progresses, completed) {
  return Object.assign({}, item, {number: String(index + 1).padStart(2, '0'), durationText: duration(item.duration), completed: (completed || []).indexOf(item.id) !== -1, progress: (progresses || {})[item.id] || 0});
}
function material(item) { return Object.assign({}, item, {sizeText: size(item.size), extension: (item.fileName || item.name || '').split('.').pop().toUpperCase()}); }
module.exports = {duration, size, course, lesson, material};
