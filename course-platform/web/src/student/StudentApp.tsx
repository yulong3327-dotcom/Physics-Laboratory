import { useEffect, useRef, useState, type FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Bell, BookOpen, Bookmark, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, FileText, Flame, GraduationCap, Grid2X2, Headphones, LayoutDashboard, Loader2, LockKeyhole, LogOut, Menu, MessageCircle, Play, PlayCircle, Search, ShieldCheck, ShoppingBag, Smartphone, Sparkles, Target, UserRound, Users, Video, X } from 'lucide-react';
import './student.css';
import { api, downloadFile, useSession } from '../shared/api';

type Lesson = { id: string; title: string; duration?: number | string; durationSeconds?: number; videoUrl?: string; resumeSeconds?: number; isFree?: boolean; free?: boolean; isPreview?: boolean; order?: number };
type Material = { id: string; title?: string; name?: string; originalName?: string; fileName?: string; size?: number; fileSize?: number; filename?: string; url?: string; fileUrl?: string };
type Course = { id: string; title: string; subtitle?: string; description?: string; subject?: string; grade?: string; teacher?: string; teacherName?: string; teacherTitle?: string; price: number; originalPrice?: number; cover?: string; coverUrl?: string; coverImage?: string; detailImages?: string[]; lessonCount?: number; students?: number; studentCount?: number; status?: string; lessons?: Lesson[]; materials?: Material[]; enrolled?: boolean; purchased?: boolean; progress?: number; progressPercent?: number; completedLessons?: number; color?: string; tags?: string[] };
type User = { id: string; nickname?: string; name?: string; phone?: string; avatarUrl?: string };
type Page = 'discover' | 'courses' | 'materials' | 'profile' | 'orders';
type Toast = { message: string; type?: 'error' | 'success' };
type AppConfig = { demoMode: boolean; wechatConfigured: boolean; paymentConfigured: boolean; paymentMode?: 'wechat' | 'wechat-virtual'; virtualPaymentConfigured?: boolean };

const subjects = ['全部课程', '数学', '英语', '物理', '语文', '化学'];
const palette = [ ['#f7ebdc', '#9a5c28'], ['#e0efec', '#36746a'], ['#eee9f9', '#766196'], ['#f3e4df', '#a56354'] ];
async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  let body = options.body;
  if (typeof body === 'string') body = JSON.parse(body);
  return api(path, { ...options, body });
}

function listOf<T>(data: any, key: string): T[] { return Array.isArray(data) ? data : data?.[key] || data?.data?.[key] || data?.data || []; }
function displayPrice(value: number) { const amount = Number(value ?? 0); return Number.isFinite(amount) ? amount.toFixed(2).replace(/\.?0+$/, '') : '0'; }
function teacherOf(course: Course) { return course.teacherName || course.teacher || '知课教研老师'; }
function durationOf(lesson: Lesson) { const duration = Number(lesson.durationSeconds ?? lesson.duration ?? 0); return duration ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : '待更新'; }
function subjectOf(course: Course) { if (course.subject) return course.subject; for (const s of subjects.slice(1)) if (course.title.includes(s)) return s; return '综合'; }
function coverIndex(course: Course) { const sub = subjectOf(course); return sub === '数学' ? 0 : sub === '英语' ? 1 : sub === '物理' ? 2 : 3; }

function CourseCover({ course, compact = false }: { course: Course; compact?: boolean }) {
  const index = coverIndex(course);
  const [background, color] = palette[index];
  const image = course.coverImage || course.coverUrl || course.cover;
  return <div className={`course-cover cover-${index} ${compact ? 'compact' : ''}`} style={{ background, color }}>
    {image ? <img className="course-cover-img" src={image} alt={course.title} /> : <>
      <span className="cover-subject">{course.grade || '高中'} · {subjectOf(course)}</span>
      <div className="cover-words">{index === 0 ? <>让思考<br />多一种解法</> : index === 1 ? <>Read more.<br />Go further.</> : index === 2 ? <>探索规律<br />理解世界</> : <>把知识<br />连成世界</>}</div>
      <div className="cover-art" aria-hidden="true">{index === 0 ? <><span className="math-circle" /><span className="math-triangle" /><span className="math-label">ƒ(x)</span></> : index === 1 ? <><span className="english-a">Aa</span><span className="english-line" /></> : index === 2 ? <><span className="atom atom-a" /><span className="atom atom-b" /><span className="atom atom-c" /><span className="atom-center" /></> : <><BookOpen size={84} strokeWidth={1.1} /><span className="chinese-character">知</span></>}</div>
      <span className="cover-brand">ZH I KE / KNOWLEDGE IS A JOURNEY</span>
    </>}
    <span className="cover-badge">精品录播</span>
  </div>;
}

function CourseDetailImage({ src, title, index }: { src: string; title: string; index: number }) {
  const [failed, setFailed] = useState(false);
  return <figure className="course-detail-image">{failed ? <div className="course-detail-image-error" role="status"><CircleHelp size={24} aria-hidden="true" /><p>第 {index + 1} 张课程介绍图片加载失败</p><button type="button" onClick={() => setFailed(false)}>重新加载</button></div> : <img src={src} alt={`${title}：课程介绍第 ${index + 1} 张`} loading="lazy" decoding="async" onError={() => setFailed(true)} />}</figure>;
}

function CourseDetailImages({ course }: { course: Course }) {
  const images = Array.isArray(course.detailImages) ? course.detailImages.filter(src => typeof src === 'string' && src.trim()) : [];
  if (!images.length) return null;
  return <div className="course-detail-images" role="group" aria-label={`${course.title}课程介绍图片`}>{images.map((src, index) => <CourseDetailImage key={`${src}-${index}`} src={src} title={course.title} index={index} />)}</div>;
}

function TeacherAvatar({ name, size = 'small' }: { name: string; size?: 'small' | 'large' }) { return <span className={`teacher-avatar ${size}`}><UserRound size={size === 'large' ? 24 : 17} strokeWidth={1.6} /><span>{name.slice(-1)}</span></span>; }

function MiniProgramPurchaseGuide({ course, onClose }: { course: Course; onClose: () => void }) {
  return <div className="mini-purchase-guide"><div className="mini-purchase-heading"><Smartphone size={25} /><div><b>玉龙化学AI优课</b><span>微信小程序</span></div></div><ol><li>打开微信，下拉进入「小程序」。</li><li>搜索「玉龙化学AI优课」，使用微信登录。</li><li>找到「{course.title}」，在小程序内完成购买。</li></ol><p>购买后，同一学习账号仍可在网页端「我的课程」继续学习和下载讲义。</p><button type="button" className="button primary" onClick={onClose}>我知道了 <CheckCircle2 size={17} /></button></div>;
}

export default function StudentApp() {
  const [page, setPage] = useState<Page>('discover');
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const { user, token, login: sessionLogin, logout: sessionLogout } = useSession();
  const [config, setConfig] = useState<AppConfig>({ demoMode: false, wechatConfigured: false, paymentConfigured: false });
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configLoadFailed, setConfigLoadFailed] = useState(false);
  const virtualCheckout = !config.demoMode && config.paymentMode === 'wechat-virtual';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [subject, setSubject] = useState('全部课程');
  const [query, setQuery] = useState('');
  const [grade, setGrade] = useState('全部年级');
  const [selected, setSelected] = useState<Course | null>(null);
  const [detailTab, setDetailTab] = useState<'intro' | 'lessons' | 'materials'>('lessons');
  const [loginOpen, setLoginOpen] = useState(false);
  const [checkout, setCheckout] = useState<Course | null>(null);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [paymentCodeUrl, setPaymentCodeUrl] = useState('');
  const [paymentState, setPaymentState] = useState<'idle' | 'creating' | 'waiting' | 'cancelled' | 'error'>('idle');
  const [paymentError, setPaymentError] = useState('');
  const checkoutRun = useRef(0);
  const [player, setPlayer] = useState<{ course: Course; lesson: Lesson } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [mobileNav, setMobileNav] = useState(false);

  const tell = (message: string, type: Toast['type'] = 'success') => setToast({ message, type });
  const loadCourses = async () => {
    setLoading(true); setError('');
    try { setCourses(listOf<Course>(await request('/courses'), 'courses')); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };
  const loadAccount = async () => {
    if (!token) { setEnrollments([]); setOrders([]); return; }
    const results = await Promise.allSettled([request('/my/courses'), request('/my/orders')]);
    if (results[0].status === 'fulfilled') setEnrollments(listOf<any>(results[0].value, 'courses')); else if (results[0].reason.status === 401) sessionLogout();
    if (results[1].status === 'fulfilled') setOrders(listOf<any>(results[1].value, 'orders')); else if (results[1].reason.status === 401) sessionLogout();
  };
  useEffect(() => { void loadCourses(); request<AppConfig>('/config').then(result => { setConfig(result); setConfigLoaded(true); }).catch(() => setConfigLoadFailed(true)); }, []);
  useEffect(() => { void loadAccount(); }, [token]);
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(null), 3800); return () => window.clearTimeout(timeout); }, [toast]);
  useEffect(() => {
    if (!checkout || config.demoMode || virtualCheckout || paymentState !== 'waiting' || !pendingOrderId) return;
    let active = true;
    let checking = false;
    let handled = false;
    const run = checkoutRun.current;
    const poll = async () => {
      if (checking || handled) return;
      checking = true;
      try {
        const result = await request(`/orders/${pendingOrderId}`);
        const order = result.order || result.data?.order || result.data || result;
        if (!active) return;
        if (order.status === 'paid' || order.status === 'completed') {
          handled = true;
          await finishPaidCheckout(checkout, run);
        } else if (order.status === 'cancelled') {
          handled = true;
          setPaymentState('cancelled');
          setPaymentError('该订单已关闭，请重新生成二维码。');
        } else {
          setPaymentError('');
        }
      } catch {
        if (active) setPaymentError('暂时无法查询支付状态，系统会继续重试。');
      } finally {
        checking = false;
      }
    };
    const interval = window.setInterval(() => { void poll(); }, 2000);
    void poll();
    return () => { active = false; window.clearInterval(interval); };
  }, [checkout, config.demoMode, virtualCheckout, paymentState, pendingOrderId]);
  const mine: Course[] = [...enrollments.map(item => ({ ...courses.find(c => c.id === (item.courseId || item.id)), ...item, id: item.courseId || item.id })), ...courses.filter(course => (course.enrolled || course.purchased) && !enrollments.some(item => (item.courseId || item.id) === course.id))];
  const isOwned = (course: Course) => mine.some(item => item.id === course.id);
  const filtered = courses.filter(course => (subject === '全部课程' || subjectOf(course) === subject) && (!query || `${course.title} ${teacherOf(course)} ${course.description}`.toLowerCase().includes(query.toLowerCase())) && (grade === '全部年级' || (course.grade || course.title).includes(grade)));
  const go = (next: Page) => { setPage(next); setSelected(null); setPlayer(null); setMobileNav(false); setQuery(''); };
  const openCourse = async (course: Course) => {
    setSelected(course); setDetailTab('lessons'); window.scrollTo({ top: 0, behavior: 'smooth' });
    try { const data = await request(`/courses/${course.id}`); const detail = data.course || data.data?.course || data; setSelected({ ...course, ...detail }); }
    catch (e) { tell((e as Error).message, 'error'); }
  };
  const closeCheckout = () => {
    checkoutRun.current += 1;
    setCheckout(null);
    setPaymentCodeUrl('');
    setPaymentState('idle');
    setPaymentError('');
    setBusy(false);
  };
  const beginCheckout = (course: Course, orderId: string | null = null) => {
    checkoutRun.current += 1;
    setPendingOrderId(orderId);
    setPaymentCodeUrl('');
    setPaymentState('idle');
    setPaymentError('');
    setBusy(false);
    setCheckout(course);
  };
  const finishPaidCheckout = async (course: Course, run: number) => {
    if (run !== checkoutRun.current) return;
    await loadAccount();
    if (run !== checkoutRun.current) return;
    closeCheckout();
    tell('选课成功！现在可以开始学习了');
    setPage('courses');
    setSelected(null);
  };
  const startCheckoutPayment = async () => {
    if (!checkout || !configLoaded || virtualCheckout) return;
    const course = checkout;
    const run = checkoutRun.current;
    setBusy(true);
    setPaymentState('creating');
    setPaymentError('');
    try {
      let order: any = null;
      if (pendingOrderId) {
        const current = await request(`/orders/${pendingOrderId}`);
        order = current.order || current.data?.order || current.data || current;
        if (run !== checkoutRun.current) return;
        if (order.status === 'paid' || order.status === 'completed') {
          await finishPaidCheckout(course, run);
          return;
        }
        if (order.status === 'cancelled') order = null;
      }
      if (!order) {
        order = await request('/orders', { method: 'POST', body: JSON.stringify({ courseId: course.id }) });
        if (run !== checkoutRun.current) return;
        setPendingOrderId(order.id);
      }
      if (config.demoMode) {
        const payment = await request(`/orders/${order.id}/pay`, { method: 'POST', body: JSON.stringify({}) });
        if (run !== checkoutRun.current) return;
        if (payment.demo) await request(`/orders/${order.id}/demo-pay`, { method: 'POST', body: JSON.stringify({}) });
        else if (payment.order?.status !== 'paid' && payment.order?.status !== 'completed') throw new Error('订单尚未完成支付，请稍后查看');
        await finishPaidCheckout(course, run);
        return;
      }
      const payment = await request(`/orders/${order.id}/native-pay`, { method: 'POST', body: JSON.stringify({}) });
      if (run !== checkoutRun.current) return;
      const paidOrder = payment.order || payment.data?.order;
      if (payment.cancelled) {
        setPaymentCodeUrl('');
        setPaymentState('cancelled');
        setPaymentError('原二维码已过期，可以重新生成。');
        return;
      }
      if (payment.paid || paidOrder?.status === 'paid' || paidOrder?.status === 'completed') {
        await finishPaidCheckout(course, run);
        return;
      }
      if (!payment.codeUrl) throw new Error('微信支付暂未返回二维码，请稍后重试');
      setPaymentCodeUrl(payment.codeUrl);
      setPaymentState('waiting');
    } catch (e) {
      if (run === checkoutRun.current) {
        setPaymentState('error');
        setPaymentError((e as Error).message);
      }
    } finally {
      if (run === checkoutRun.current) setBusy(false);
    }
  };
  const checkPaymentNow = async () => {
    if (!pendingOrderId || !checkout) return;
    const run = checkoutRun.current;
    setBusy(true);
    try {
      const result = await request(`/orders/${pendingOrderId}`);
      const order = result.order || result.data?.order || result.data || result;
      if (run !== checkoutRun.current) return;
      if (order.status === 'paid' || order.status === 'completed') await finishPaidCheckout(checkout, run);
      else if (order.status === 'cancelled') { setPaymentState('cancelled'); setPaymentError('该订单已关闭，请重新生成二维码。'); }
      else tell('暂未查询到支付结果，请完成扫码后稍等片刻。');
    } catch (e) { if (run === checkoutRun.current) setPaymentError((e as Error).message); }
    finally { if (run === checkoutRun.current) setBusy(false); }
  };
  const cancelPendingPayment = async () => {
    if (!pendingOrderId || !checkout || busy) return;
    const run = checkoutRun.current;
    setBusy(true);
    setPaymentError('');
    try {
      const result = await request(`/orders/${pendingOrderId}/cancel`, { method: 'POST', body: JSON.stringify({}) });
      const order = result.order || result.data?.order;
      if (result.paid || order?.status === 'paid') { await finishPaidCheckout(checkout, run); return; }
      if (run !== checkoutRun.current) return;
      setPaymentCodeUrl('');
      setPaymentState('cancelled');
      setPaymentError('订单已关闭，可以重新生成二维码。');
    } catch (e) {
      if (run === checkoutRun.current) setPaymentError((e as Error).message);
    } finally { if (run === checkoutRun.current) setBusy(false); }
  };
  const buy = (course: Course) => { if (virtualCheckout) { beginCheckout(course); return; } if (!user) { setLoginOpen(true); return; } beginCheckout(course); };
  const playLesson = async (course: Course, lesson: Lesson) => {
    if (!isOwned(course) && !lesson.isPreview && !lesson.isFree && !lesson.free) { buy(course); return; }
    try { const data = await request(`/lessons/${lesson.id}/play`); setPlayer({ course, lesson: { ...lesson, videoUrl: data.url, resumeSeconds: Number(data.progress) || 0 } }); }
    catch (e) { tell((e as Error).message, 'error'); }
  };
  const download = async (course: Course, material: Material) => {
    if (!user) { setLoginOpen(true); return; }
    if (!isOwned(course)) { buy(course); return; }
    try { await downloadFile(material.id, material.fileName || material.originalName || material.name || material.title || '课程讲义'); tell('讲义下载已开始'); }
    catch (e) { tell((e as Error).message, 'error'); }
  };
  const completeLesson = async () => {
    if (!player || !user || !isOwned(player.course)) return;
    try { await request(`/lessons/${player.lesson.id}/progress`, { method: 'POST', body: JSON.stringify({ seconds: Number(player.lesson.duration) || 0, completed: true }) }); tell('本节学习已完成，继续保持！'); await loadAccount(); }
    catch (e) { tell((e as Error).message, 'error'); }
  };
  const logout = async () => { try { await request('/auth/logout', { method: 'POST', body: JSON.stringify({}) }); } catch {} finally { sessionLogout(); setEnrollments([]); setOrders([]); setCourses(items => items.map(course => ({ ...course, enrolled: false, purchased: false }))); go('discover'); void loadCourses(); tell('已退出登录'); } };

  return <div className="student-app">
    <aside className={`student-sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); go('discover'); }}><span className="brand-symbol"><BookOpen size={24} strokeWidth={2.1} /></span><span>知课<span className="brand-english">ZH I KE</span></span></a>
      <div className="sidebar-caption">学有所获，每天进步一点</div>
      <nav className="student-nav">
        {([{ id: 'discover', icon: LayoutDashboard, title: '发现好课', en: 'Discover' }, { id: 'courses', icon: PlayCircle, title: '我的课程', en: 'My courses' }, { id: 'materials', icon: FileText, title: '学习资料', en: 'Materials' }, { id: 'profile', icon: UserRound, title: '个人中心', en: 'My account' }] as const).map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => go(item.id)}><item.icon size={20} strokeWidth={1.7} /><span>{item.title}</span>{page === item.id && <i />}</button>)}
      </nav>
      <div className="sidebar-study"><div className="sidebar-study-art"><GraduationCap size={33} strokeWidth={1.3} /><Sparkles size={13} /></div><strong>好课程，陪你向前</strong><p>从一个小目标开始，<br />积累每一次成长。</p><button onClick={() => go('courses')}>开启今日学习 <ArrowRight size={14} /></button></div>
      <div className="sidebar-bottom"><button onClick={() => tell('如需帮助，请联系课程管理员')}><Headphones size={18} /> 帮助与反馈</button><a href="/admin"><Grid2X2 size={16} /> 进入管理后台 <ArrowRight size={14} /></a><span>知课 · 让学习自然发生</span></div>
    </aside>
    {mobileNav && <div className="sidebar-backdrop" onClick={() => setMobileNav(false)} />}
    <div className="student-body">
      <header className="student-header"><div className="header-left"><button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="打开导航"><Menu size={22} /></button><span className="header-context">学习空间 <ChevronRight size={14} /> <b>{selected ? '课程详情' : page === 'discover' ? '发现好课' : page === 'courses' ? '我的课程' : page === 'materials' ? '学习资料' : page === 'orders' ? '我的订单' : '个人中心'}</b></span></div><div className="header-actions"><label className="header-search"><Search size={17} /><input placeholder="搜索课程、老师" value={query} onChange={e => { setQuery(e.target.value); if (selected) setSelected(null); if (page !== 'discover') setPage('discover'); }} /><span>⌘ K</span></label><button className="icon-button notification-button" aria-label="消息通知" onClick={() => tell('你已读完全部消息')}><Bell size={19} /><i /></button><span className="header-divider" /><button className="account-button" onClick={() => user ? go('profile') : setLoginOpen(true)}><span className="account-avatar"><UserRound size={18} /></span><span>{user?.nickname || user?.name || '登录 / 注册'}</span><ChevronDown size={13} /></button></div></header>
      <main className="student-main">
        {player ? <div className="player-page"><button className="back-link" onClick={() => setPlayer(null)}><ArrowLeft size={17} />返回课程</button><div className="page-heading"><div><p className="eyebrow">LEARNING IN PROGRESS</p><h1>{player.course.title}</h1></div><span className="subtle-label"><ShieldCheck size={15} /> 专属学习空间</span></div><div className="player-layout"><div><div className="video-shell">{player.lesson.videoUrl ? <LearningVideo key={player.lesson.id} lesson={player.lesson} owned={Boolean(user && isOwned(player.course))} onComplete={completeLesson} /> : <div className="video-empty"><PlayCircle size={62} strokeWidth={1.1} /><h3>{player.lesson.title}</h3><p>该课时的视频正在准备中，请稍后再来学习。</p></div>}</div><div className="player-lesson-info"><div><span className="eyebrow">正在学习</span><h2>{player.lesson.title}</h2></div><button className="button primary small" onClick={completeLesson}><CheckCircle2 size={17} /> 标记学完</button></div><>{config.demoMode && <div className="demo-video-note"><CircleHelp size={14} />演示视频，课程内容可由管理员上传。</div>}</><div className="learning-tip"><Sparkles size={19} /><div><b>专注当下，每一课都有收获</b><p>建议准备好纸笔，跟随老师的思路，及时记录你的理解。</p></div></div></div><aside className="player-playlist"><div className="panel-title"><h3>课程目录</h3><span>{player.course.lessons?.length || 0} 课时</span></div>{player.course.lessons?.map((lesson, i) => <button className={`playlist-item ${lesson.id === player.lesson.id ? 'active' : ''}`} key={lesson.id} onClick={() => playLesson(player.course, lesson)}><span>{lesson.id === player.lesson.id ? <Play size={15} fill="currentColor" /> : String(i + 1).padStart(2, '0')}</span><div><b>{lesson.title}</b><small>{durationOf(lesson)}</small></div></button>)}</aside></div></div> : selected ? <div className="detail-page"><button className="back-link" onClick={() => setSelected(null)}><ArrowLeft size={17} />返回{page === 'courses' ? '我的课程' : '课程列表'}</button><div className="course-detail-hero"><CourseCover course={selected} /><div className="detail-heading"><div className="tag-row"><span className="subject-tag">{selected.grade || '高中'} · {subjectOf(selected)}</span><span className="outline-tag">系统提升</span></div><h1>{selected.title}</h1><p>{selected.subtitle || '从理解到掌握，让每一次学习都有清晰的方向。'}</p><div className="detail-teacher"><TeacherAvatar name={teacherOf(selected)} size="large" /><div><b>{teacherOf(selected)}</b><span>{selected.teacherTitle || '知课学科主讲老师'}</span></div></div><div className="detail-meta"><span><Video size={15} /> {selected.lessons?.length || selected.lessonCount || 0} 个课时</span><span><Users size={15} /> {selected.studentCount ?? selected.students ?? 0} 人已加入</span><span><ShieldCheck size={15} /> 随时回看</span></div></div></div><div className="detail-body"><section className="detail-content"><div className="detail-tabs">{([{ id: 'intro', label: '课程介绍' }, { id: 'lessons', label: '课程目录' }, { id: 'materials', label: '课程资料' }] as const).map(tab => <button key={tab.id} className={detailTab === tab.id ? 'active' : ''} onClick={() => setDetailTab(tab.id)}>{tab.label}{tab.id === 'lessons' && <span>{selected.lessons?.length || 0}</span>}</button>)}</div>{detailTab === 'intro' ? <div className="course-intro"><h3>让知识真正成为你的能力</h3><p>{selected.description || '围绕学科核心知识，梳理重点、突破难点。通过系统讲解与典型例题，帮助你建立完整的知识体系，找到适合自己的学习方法。'}</p><CourseDetailImages key={selected.id} course={selected} /><div className="intro-features"><div><Target size={23} /><b>明确学习目标</b><p>循序渐进，抓住核心知识</p></div><div><BookOpen size={23} /><b>配套精选讲义</b><p>课堂笔记，课后巩固</p></div><div><PlayCircle size={23} /><b>灵活安排学习</b><p>随时回放，掌握自己的节奏</p></div></div><h3>适合谁学</h3><p>希望系统梳理知识、提升学习能力的{selected.grade || '高中'}同学。</p></div> : detailTab === 'lessons' ? <div className="lesson-list"><div className="lesson-intro"><Bookmark size={17} /><div><strong>课前准备</strong><p>准备好笔记本与课程讲义，开始新的收获。</p></div><ChevronRight size={18} /></div>{selected.lessons?.length ? selected.lessons.map((lesson, index) => <button className="lesson-item" key={lesson.id} onClick={() => playLesson(selected, lesson)}><span className="lesson-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{lesson.title}</strong><span><PlayCircle size={13} /> 视频 · {durationOf(lesson)}{(lesson.isPreview || lesson.isFree || lesson.free) && <i>免费试看</i>}</span></div>{isOwned(selected) || lesson.isPreview || lesson.isFree || lesson.free ? <PlayCircle size={21} /> : <LockKeyhole size={18} />}</button>) : <EmptyState icon={Video} title="课程内容正在准备中" description="老师正在认真打磨课程，敬请期待。" />}</div> : <div className="material-list">{selected.materials?.length ? selected.materials.map(material => <MaterialRow key={material.id} material={material} onDownload={() => download(selected, material)} />) : <EmptyState icon={FileText} title="暂无课程资料" description="老师上传讲义后，你可以在这里查看和下载。" />}</div>}</section><aside className="purchase-card"><div className="purchase-top"><span>{isOwned(selected) ? '已加入学习计划' : '把好课加入你的学习计划'}</span>{isOwned(selected) ? <h2><CheckCircle2 size={24} /> 已解锁课程</h2> : <><div className="purchase-price"><small>¥</small>{displayPrice(selected.price)}{!!selected.originalPrice && <del>¥{displayPrice(selected.originalPrice)}</del>}</div><p>一次购买，在有效期内反复学习</p></>}</div><div className="purchase-benefits"><span><Check size={16} /> 完整课程，随时回放</span><span><Check size={16} /> 配套讲义，便捷下载</span><span><Check size={16} /> 学习进度，自动保存</span></div><button className="button primary" onClick={() => { if (isOwned(selected)) { const lesson = selected.lessons?.[0]; if (lesson) playLesson(selected, lesson); else tell('课程内容正在准备中'); } else buy(selected); }}>{isOwned(selected) ? <><Play size={16} fill="currentColor" /> 开始学习</> : <>立即选课 <ArrowRight size={17} /></>}</button><div className="secure-note"><ShieldCheck size={13} /> 安全支付 · 专属学习权益</div></aside></div></div> : <>
          {page === 'discover' && <>
            <div className="welcome-heading"><div><p className="eyebrow">A LITTLE PROGRESS, EVERY DAY</p><h1>发现好课<span>，遇见更好的自己</span></h1></div><span className="today-note"><CalendarDays size={16} /> 今天也要有所收获</span></div>
            <label className="mobile-course-search"><Search size={17} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索感兴趣的课程或老师" />{query && <button aria-label="清空搜索" onClick={() => setQuery('')}><X size={15} /></button>}</label>
            <section className="discovery-hero"><div className="hero-copy"><span className="hero-kicker"><span /> KNOWLEDGE OPENS POSSIBILITIES</span><h2>把每一次进步，<br />变成更好的自己<span>。</span></h2><p>好老师 · 好课程 · 好方法<br className="mobile-only" /> 让成长，看得见。</p><button onClick={() => document.getElementById('course-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>探索精选课程 <ArrowRight size={17} /></button></div><div className="hero-illustration" aria-hidden="true"><div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><span className="hero-dot dot-one" /><span className="hero-dot dot-two" /><div className="floating-formula formula-one">a² + b² = c²</div><div className="floating-formula formula-two">f (x)</div><div className="illustration-book book-back"><span /></div><div className="illustration-book book-front"><span className="book-logo"><BookOpen size={26} strokeWidth={1.4} /></span><span className="book-overline">THE WAY TO</span><b>A better<br />you.</b><span className="book-bottom">学习，从好奇开始。<br /><i /></span></div><div className="hero-sparkle"><Sparkles size={36} strokeWidth={1.3} /></div><div className="hero-small-card"><span><Check size={15} /></span><div><b>每一步，都算数</b><small>Keep learning. Keep growing.</small></div></div></div></section>
            <div className="discovery-features"><span><span className="feature-icon"><GraduationCap size={20} /></span><b>优选师资</b><small>专业讲解，深入浅出</small></span><span><span className="feature-icon"><Video size={19} /></span><b>随时学习</b><small>灵活安排，反复回看</small></span><span><span className="feature-icon"><FileText size={19} /></span><b>配套讲义</b><small>重点梳理，学练结合</small></span><span><span className="feature-icon"><Target size={19} /></span><b>循序成长</b><small>记录进步，学有所获</small></span></div>
            <div className="discovery-grid"><section id="course-section" className="course-section"><div className="section-heading"><div><h2>精选课程 <span>为每一份好奇，找到方向</span></h2></div><select className="grade-select" value={grade} onChange={e => setGrade(e.target.value)}><option>全部年级</option><option>高一</option><option>高二</option><option>高三</option></select></div><div className="subject-tabs">{subjects.map(item => <button key={item} className={subject === item ? 'active' : ''} onClick={() => setSubject(item)}>{item}</button>)}</div>{error ? <div className="load-error"><CircleHelp size={27} /><b>课程加载失败</b><p>{error}</p><button className="button secondary small" onClick={loadCourses}>重新加载</button></div> : loading ? <div className="course-grid">{[1, 2, 3].map(i => <div className="skeleton-card" key={i}><div /><span /><span /><span /></div>)}</div> : filtered.length ? <div className="course-grid">{filtered.map(course => <CourseCard key={course.id} course={course} owned={isOwned(course)} onClick={() => openCourse(course)} />)}</div> : <EmptyState icon={Search} title="没有找到相关课程" description="试试其他关键词、科目或年级。" />}</section><aside className="discovery-aside"><div className="study-plan-card"><div className="panel-title"><h3>我的学习</h3><span className="tiny-orange-dot" /></div><p className="study-plan-greeting">{user ? `${user.nickname || user.name || '同学'}，今天也一起进步吧` : '从今天开始，积累你的进步'}</p><div className="study-stat-row"><div><b>{mine.length.toString().padStart(2, '0')}</b><span>在学课程</span></div><div><b>{enrollments.reduce((n, e) => n + ((Array.isArray(e.completedLessons) ? e.completedLessons.length : e.completedLessons) || e.completedCount || 0), 0).toString().padStart(2, '0')}</b><span>已学课时</span></div><span className="stat-ring"><BookOpen size={21} strokeWidth={1.4} /></span></div><button className="study-action" onClick={() => user ? go('courses') : setLoginOpen(true)}>{user ? '继续我的学习' : '登录，开启学习之旅'}<ArrowRight size={16} /></button></div><div className="learning-quote"><span className="quote-mark">“</span><p>学习不是填满水桶，<br />而是点燃火焰。</p><span className="quote-line" /><small>保持好奇，持续生长</small><span className="quote-plant"><svg viewBox="0 0 70 75" fill="none"><path d="M36 72V26M36 50C10 49 11 31 11 31c20-1 25 19 25 19Zm1-12C61 37 63 16 63 16 44 16 37 38 37 38Zm-1-9C17 24 22 8 22 8c17 6 14 21 14 21Z" stroke="currentColor" strokeWidth="1.5" /></svg></span></div><button className="wechat-card" onClick={() => tell('可在微信开发者工具中打开本项目的小程序端')}><span><Smartphone size={23} strokeWidth={1.5} /></span><div><b>微信小程序，随时随地学</b><small>把学习装进口袋</small></div><ChevronRight size={16} /></button></aside></div>
          </>}
          {page === 'courses' && <><div className="page-heading"><div><p className="eyebrow">YOUR LEARNING JOURNEY</p><h1>我的课程<span>每一份努力，都在靠近目标</span></h1></div><button className="button secondary small" onClick={() => go('discover')}>探索更多课程 <ArrowRight size={15} /></button></div><div className="my-course-summary"><div><span className="summary-icon orange"><BookOpen size={23} /></span><div><b>{mine.length}</b><p>已加入课程</p></div></div><div><span className="summary-icon green"><CheckCircle2 size={23} /></span><div><b>{enrollments.reduce((n, e) => n + ((Array.isArray(e.completedLessons) ? e.completedLessons.length : e.completedLessons) || e.completedCount || 0), 0)}</b><p>已完成课时</p></div></div><div><span className="summary-icon purple"><Flame size={23} /></span><div><b>{mine.length ? '持续积累' : '即刻开始'}</b><p>让进步成为习惯</p></div></div></div><div className="section-heading my-courses-heading"><h2>全部课程 <span>{mine.length} 门</span></h2><span className="subtle-label">最近加入 <ChevronDown size={14} /></span></div>{!user ? <EmptyState icon={LockKeyhole} title="登录后，查看你的专属课程" description="你的课程、学习进度与配套讲义都在这里。" action="登录 / 注册" onAction={() => setLoginOpen(true)} /> : mine.length ? <div className="enrolled-grid">{mine.map(course => <div className="enrolled-card" key={course.id}><div onClick={() => openCourse(course)}><CourseCover course={course} compact /></div><div className="enrolled-info"><span className="subject-tag">{course.grade || '高中'} · {subjectOf(course)}</span><h3 onClick={() => openCourse(course)}>{course.title}</h3><div className="teacher-line"><TeacherAvatar name={teacherOf(course)} /><span>{teacherOf(course)}</span><i />{course.lessonCount || course.lessons?.length || 0} 课时</div><div className="progress-caption"><span>学习进度</span><b>{Number(enrollments.find(e => (e.courseId || e.id) === course.id)?.progressPercent || course.progressPercent || 0)}%</b></div><div className="progress-track"><span style={{ width: `${Number(enrollments.find(e => (e.courseId || e.id) === course.id)?.progressPercent || course.progressPercent || 0)}%` }} /></div><button className="continue-button" onClick={() => openCourse(course)}><Play size={13} fill="currentColor" /> 继续学习 <ArrowRight size={15} /></button></div></div>)}</div> : <EmptyState icon={BookOpen} title="你的学习旅程，从一门好课开始" description="挑选一门感兴趣的课程，向目标迈出第一步。" action="去发现好课" onAction={() => go('discover')} />}</>}
          {page === 'materials' && <><div className="page-heading"><div><p className="eyebrow">KEEP YOUR KNOWLEDGE CLOSE</p><h1>学习资料<span>好好整理，每一份新知</span></h1></div><span className="subtle-label"><FileText size={16} /> 课程配套讲义</span></div><div className="materials-banner"><div className="materials-banner-icon"><FileText size={34} strokeWidth={1.2} /></div><div><h3>你的随身知识库</h3><p>在课程详情的「课程资料」中，下载老师为你准备的讲义与练习。</p></div></div>{!user ? <EmptyState icon={LockKeyhole} title="登录后查看课程资料" description="已购课程的配套资料，随时查看与下载。" action="登录 / 注册" onAction={() => setLoginOpen(true)} /> : mine.length ? <div className="material-course-list">{mine.map(course => <button className="material-course-card" key={course.id} onClick={async () => { await openCourse(course); setDetailTab('materials'); }}><span className="material-file-icon"><BookOpen size={25} strokeWidth={1.4} /></span><div><strong>{course.title}</strong><span>{teacherOf(course)} · 课程配套讲义与练习</span></div><span className="material-view">查看资料 <ChevronRight size={16} /></span></button>)}</div> : <EmptyState icon={FileText} title="还没有学习资料" description="选购课程后，你可以在这里查看配套资料。" action="去发现好课" onAction={() => go('discover')} />}</>}
          {page === 'orders' && <><button className="back-link" onClick={() => go('profile')}><ArrowLeft size={17} />返回个人中心</button><div className="page-heading"><div><p className="eyebrow">INVEST IN YOUR GROWTH</p><h1>我的订单<span>记录每一次，为成长的投入</span></h1></div><span className="subtle-label">共 {orders.length} 笔订单</span></div>{!user ? <EmptyState icon={LockKeyhole} title="登录后查看订单" description="课程购买记录与订单状态都在这里。" action="登录 / 注册" onAction={() => setLoginOpen(true)} /> : orders.length ? <div className="student-orders">{orders.map(order => <article className="student-order" key={order.id}><div className="student-order-top"><span>订单号 {order.id}</span><time>{new Date(order.createdAt).toLocaleDateString('zh-CN')}</time><b className={order.status === 'paid' ? 'paid' : ''}>{order.status === 'paid' ? '已支付' : order.status === 'cancelled' ? '已取消' : '待支付'}</b></div><div className="student-order-body"><span className="summary-icon orange"><BookOpen size={24} /></span><div><h3>{order.courseTitle || courses.find(c => c.id === order.courseId)?.title || '课程订单'}</h3><p>{order.status === 'paid' ? '课程已加入「我的课程」，随时开启学习' : '完成支付后即可解锁课程与配套资料'}</p></div><strong>¥{displayPrice(order.amount)}</strong><button className="button secondary small" onClick={() => { const course = courses.find(c => c.id === order.courseId); if (course) { if (order.status === 'paid') openCourse(course); else beginCheckout(course, order.id); } }}>{order.status === 'paid' ? '查看课程' : '继续支付'}<ChevronRight size={14} /></button></div></article>)}</div> : <EmptyState icon={ShoppingBag} title="还没有订单记录" description="选一门好课，开始新的学习计划。" action="去发现好课" onAction={() => go('discover')} />}</>}
          {page === 'profile' && <><div className="page-heading"><div><p className="eyebrow">A SPACE JUST FOR YOU</p><h1>个人中心<span>认真学习，也好好照顾自己</span></h1></div></div>{!user ? <EmptyState icon={UserRound} title="欢迎来到知课" description="登录后，开始属于你的学习旅程。" action="登录 / 注册" onAction={() => setLoginOpen(true)} /> : <div className="profile-layout"><div className="profile-card"><div className="profile-avatar"><UserRound size={40} strokeWidth={1.3} /></div><h2>{user.nickname || user.name || '知课同学'}</h2><p>{user.phone ? `${user.phone.slice(0, 3)} **** ${user.phone.slice(-4)}` : '微信用户'}</p><span className="profile-tag"><GraduationCap size={13} /> 终身学习者</span><button className="button secondary small" onClick={logout}><LogOut size={15} />退出登录</button></div><div className="profile-details"><div className="profile-info-panel"><h3>学习账户</h3><div><span>我的课程</span><button onClick={() => go('courses')}>{mine.length} 门课程 <ChevronRight size={16} /></button></div><div><span>我的订单</span><button onClick={() => go('orders')}>{orders.length} 笔订单 <ChevronRight size={16} /></button></div><div><span>课程讲义</span><button onClick={() => go('materials')}>查看全部资料 <ChevronRight size={16} /></button></div><div><span>登录方式</span><b>{user.phone ? '手机号 / 微信认证' : '微信认证'}</b></div></div><div className="profile-info-panel"><h3>服务与支持</h3><div><span>学习帮助</span><button onClick={() => tell('购买课程后，可在「我的课程」学习，在课程详情下载讲义。')}>查看学习指引 <ChevronRight size={16} /></button></div><div><span>联系课程管理员</span><button onClick={() => tell('请联系为你提供小程序的课程管理员')}><MessageCircle size={16} /> 联系客服</button></div><div><span>关于知课</span><b>让学习自然发生</b></div></div></div></div>}</>}
        </>}
        <footer className="student-footer"><span>知课 ZHIKE</span><i /> 好好学习，每天向前一点 <span className="footer-right">用好课程，连接更好的你。</span></footer>
      </main>
    </div>
    <nav className="mobile-bottom-nav">{([{ id: 'discover', icon: LayoutDashboard, label: '发现' }, { id: 'courses', icon: PlayCircle, label: '我的课程' }, { id: 'materials', icon: FileText, label: '资料' }, { id: 'profile', icon: UserRound, label: '我的' }] as const).map(item => <button className={page === item.id ? 'active' : ''} key={item.id} onClick={() => go(item.id)}><item.icon size={22} strokeWidth={1.7} />{item.label}</button>)}</nav>
    {loginOpen && <LoginDialog demoMode={config.demoMode} onClose={() => setLoginOpen(false)} onLogin={async (data: any) => { sessionLogin(data.token || data.accessToken || data.data?.token, data.user || data.data?.user); setLoginOpen(false); await loadAccount(); tell('登录成功，欢迎来到知课'); }} />}
    {checkout && <div className="modal-overlay" onClick={closeCheckout}><section className="checkout-dialog" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="关闭" onClick={closeCheckout}><X size={21} /></button><span className="dialog-icon"><ShoppingBag size={27} strokeWidth={1.5} /></span><h2>{virtualCheckout ? '请在微信小程序购买' : '确认你的学习计划'}</h2><p className="dialog-subtitle">{virtualCheckout ? '在微信中搜索「玉龙化学AI优课」' : '每一份投入，都是为更好的自己'}</p><div className="checkout-course"><CourseCover course={checkout} compact /><div><strong>{checkout.title}</strong><span>{teacherOf(checkout)}</span></div></div><div className="order-row"><span>课程金额</span><b>¥{displayPrice(checkout.price)}</b></div><div className="order-total"><span>实付金额</span><strong><small>¥</small>{displayPrice(checkout.price)}</strong></div>{virtualCheckout ? <MiniProgramPurchaseGuide course={checkout} onClose={closeCheckout} /> : <><div className="payment-method"><span className="wechat-payment"><MessageCircle size={21} fill="currentColor" /></span><div><b>{config.demoMode ? '演示支付' : '微信支付'}</b><span>{config.demoMode ? '本地演示流程，不会产生真实扣款' : '使用微信扫一扫完成付款'}</span></div><CheckCircle2 size={20} /></div>{!config.demoMode && paymentCodeUrl && paymentState === 'waiting' && <div className="native-payment"><div className="native-payment-qr"><QRCodeSVG value={paymentCodeUrl} size={208} level="M" includeMargin title="微信支付二维码" /></div><strong>使用微信扫一扫支付</strong><span>支付成功后会自动解锁课程</span>{paymentError && <p className="native-payment-note">{paymentError}</p>}<button className="button secondary small" disabled={busy} onClick={checkPaymentNow}>{busy ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}我已完成支付</button><button className="native-payment-cancel" disabled={busy} onClick={cancelPendingPayment}><X size={14} />关闭订单并重新生成</button></div>}{paymentError && paymentState !== 'waiting' && <div className="native-payment-error" role="alert">{paymentError}</div>}<button disabled={busy || !configLoaded || (!config.demoMode && paymentState === 'waiting')} className="button primary" onClick={startCheckoutPayment}>{!configLoaded ? <>{configLoadFailed ? '支付方式暂不可用，请刷新页面' : '正在读取支付方式'}</> : busy ? <><Loader2 className="spin" size={18} /> {paymentState === 'creating' ? '正在创建订单' : '正在查询支付'}</> : config.demoMode ? <>演示购买 ¥{displayPrice(checkout.price)}<ArrowRight size={17} /></> : paymentState === 'waiting' ? <>等待微信支付 <Clock3 size={17} /></> : paymentState === 'cancelled' ? <>重新生成二维码 <ArrowRight size={17} /></> : paymentState === 'error' ? <>重试微信支付 <ArrowRight size={17} /></> : <>生成微信支付二维码 <ArrowRight size={17} /></>}</button><div className="secure-note"><ShieldCheck size={13} /> 课程购买成功后，将自动加入「我的课程」</div></>}</section></div>}
    {toast && <div className={`student-toast ${toast.type === 'error' ? 'error' : ''}`}>{toast.type === 'error' ? <CircleHelp size={18} /> : <CheckCircle2 size={18} />}{toast.message}</div>}
  </div>;
}

function LearningVideo({ lesson, owned, onComplete }: { lesson: Lesson; owned: boolean; onComplete: () => Promise<void> }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const seconds = useRef(lesson.resumeSeconds || 0);
  const lastSaved = useRef(lesson.resumeSeconds || 0);
  const completed = useRef(false);
  const save = (isCompleted = false) => {
    if (!owned || seconds.current < 1) return;
    lastSaved.current = seconds.current;
    void request(`/lessons/${lesson.id}/progress`, { method: 'POST', body: JSON.stringify({ seconds: Math.floor(seconds.current), completed: isCompleted || completed.current }), keepalive: true }).catch(() => {});
  };
  useEffect(() => { const handleExit = () => save(); window.addEventListener('pagehide', handleExit); return () => { save(); window.removeEventListener('pagehide', handleExit); }; }, [lesson.id, owned]);
  return <video ref={video} key={lesson.id} controls autoPlay controlsList="nodownload" src={lesson.videoUrl} onLoadedMetadata={e => { const resume = lesson.resumeSeconds || 0; if (resume > 0 && resume < e.currentTarget.duration - 1) e.currentTarget.currentTime = resume; }} onTimeUpdate={e => { seconds.current = e.currentTarget.currentTime; if (owned && Math.abs(seconds.current - lastSaved.current) >= 15) save(); }} onPause={() => save()} onEnded={() => { completed.current = true; if (owned) void onComplete(); }} />;
}

function CourseCard({ course, owned, onClick }: { course: Course; owned: boolean; onClick: () => void }) { return <article className="course-card" onClick={onClick} tabIndex={0} role="button" onKeyDown={e => { if (e.key === 'Enter') onClick(); }}><CourseCover course={course} /><div className="course-card-body"><div className="course-card-tags"><span>{course.grade || '高中'}</span><i /><span>{course.lessonCount || course.lessons?.length || 0} 课时</span><span className="card-students">{course.studentCount ?? course.students ?? 0} 人在学</span></div><h3>{course.title}</h3><p className="course-card-description">{course.subtitle || course.description || '建立知识体系，找到适合自己的学习方法'}</p><div className="course-teacher"><TeacherAvatar name={teacherOf(course)} /><span>{teacherOf(course)}</span><span className="teacher-label">主讲老师</span></div><div className="course-card-bottom"><div className="course-price">{owned ? <span className="owned-label">已加入学习</span> : <><small>¥</small>{displayPrice(course.price)}{!!course.originalPrice && <del>¥{displayPrice(course.originalPrice)}</del>}</>}</div><button tabIndex={-1} aria-label={`查看${course.title}`}><ArrowUpRightIcon /></button></div></div></article>; }
function ArrowUpRightIcon() { return <svg width="17" height="17" viewBox="0 0 20 20" fill="none"><path d="M5 15 15 5M5 5h10v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function EmptyState({ icon: Icon, title, description, action, onAction }: { icon: any; title: string; description: string; action?: string; onAction?: () => void }) { return <div className="empty-state"><span><Icon size={32} strokeWidth={1.3} /></span><h3>{title}</h3><p>{description}</p>{action && <button className="button primary small" onClick={onAction}>{action} <ArrowRight size={16} /></button>}</div>; }
function MaterialRow({ material, onDownload }: { material: Material; onDownload: () => void }) { const name = material.title || material.name || material.fileName || material.originalName || '课程讲义'; const filename = material.fileName || material.originalName || name; const bytes = material.size || material.fileSize || 0; const fileSize = bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${bytes} B`; return <div className="material-row"><span className="material-file-icon"><FileText size={24} strokeWidth={1.5} /></span><div><strong>{name}</strong><span>{filename.includes('.') ? filename.split('.').pop()?.toUpperCase() : '资料'} · {material.size || material.fileSize ? fileSize : '配套学习资料'}</span></div><button onClick={onDownload}><ArrowDownToLine size={17} /> 下载</button></div>; }

function LoginDialog({ onClose, onLogin, demoMode }: { onClose: () => void; onLogin: (data: any) => Promise<void>; demoMode: boolean }) {
  const [mode, setMode] = useState<'phone' | 'wechat'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [devCode, setDevCode] = useState('');
  const [agreed, setAgreed] = useState(true);
  useEffect(() => { if (!countdown) return; const timeout = window.setTimeout(() => setCountdown(countdown - 1), 1000); return () => window.clearTimeout(timeout); }, [countdown]);
  const sendCode = async () => { if (!/^1\d{10}$/.test(phone)) { setError('请输入正确的 11 位手机号'); return; } setSending(true); setError(''); try { const data = await request('/auth/sms/send', { method: 'POST', body: JSON.stringify({ phone }) }); setDevCode(data.code || data.devCode || ''); setCountdown(60); } catch (e) { setError((e as Error).message); } finally { setSending(false); } };
  const submit = async (e: FormEvent) => { e.preventDefault(); if (!agreed) { setError('请先同意用户协议与隐私政策'); return; } setError(''); setBusy(true); try { if (mode === 'wechat') { if (!demoMode) throw new Error('微信认证需要在微信小程序中完成，请使用手机号登录'); const data = await request('/auth/demo', { method: 'POST', body: JSON.stringify({ nickname: nickname || '知课同学' }) }); await onLogin(data); } else { if (!/^1\d{10}$/.test(phone)) throw new Error('请输入正确的 11 位手机号'); if (!code) throw new Error('请输入短信验证码'); const data = await request('/auth/phone', { method: 'POST', body: JSON.stringify({ phone, code, nickname: nickname || undefined }) }); await onLogin(data); } } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <div className="modal-overlay" onClick={onClose}><section className="login-dialog" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="关闭" onClick={onClose}><X size={21} /></button><span className="dialog-icon"><BookOpen size={28} strokeWidth={1.7} /></span><h2>欢迎来到知课</h2><p className="dialog-subtitle">好好学习，每天向前一点</p><div className="login-tabs"><button className={mode === 'phone' ? 'active' : ''} onClick={() => { setMode('phone'); setError(''); }}>手机号登录</button><button className={mode === 'wechat' ? 'active' : ''} onClick={() => { setMode('wechat'); setError(''); }}>微信认证</button></div><form onSubmit={submit}>{mode === 'phone' ? <><label className="form-label">手机号码<div className="phone-input"><span>+86 <ChevronDown size={12} /></span><input type="tel" maxLength={11} value={phone} placeholder="请输入手机号码" onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} /></div></label><label className="form-label">短信验证码<div className="code-input"><input inputMode="numeric" maxLength={6} value={code} placeholder="请输入验证码" onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /><button type="button" disabled={sending || countdown > 0} onClick={sendCode}>{sending ? '发送中' : countdown ? `${countdown}s 后重发` : '获取验证码'}</button></div></label>{devCode && <div className="dev-code">本地演示验证码：<b>{devCode}</b></div>}</> : <div className="wechat-login-panel"><span><MessageCircle size={43} strokeWidth={1.4} /></span><h3>使用微信身份开启学习</h3><p>{demoMode ? '当前为本地演示，可体验登录与学习流程。' : '在微信小程序中，可通过微信授权快速登录。'}</p><label className="form-label">学习昵称<input value={nickname} placeholder="请输入你的昵称" onChange={e => setNickname(e.target.value)} /></label></div>}{error && <div className="form-error"><CircleHelp size={14} />{error}</div>}<button className="button primary" disabled={busy} type="submit">{busy ? <Loader2 className="spin" size={18} /> : mode === 'phone' ? '登录 / 注册' : demoMode ? '演示登录 · 不进行微信授权' : '微信认证登录'}{!busy && <ArrowRight size={17} />}</button><label className="agreement"><input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} /><span>我已阅读并同意 <button type="button" onClick={() => setError('用户协议：课程仅供购买者个人学习，请勿转售或传播课程内容。')}>《用户协议》</button>与<button type="button" onClick={() => setError('隐私政策：手机号与微信身份仅用于登录、选课和保存学习进度。')}>《隐私政策》</button></span></label></form><div className="login-bottom"><ShieldCheck size={13} /> 我们会保护好你的个人信息</div></section></div>;
}
