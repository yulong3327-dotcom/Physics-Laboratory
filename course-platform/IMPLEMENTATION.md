# 课程小程序实施约定

项目品牌：玉龙AI优课。以玉龙老师个人化学课堂为主线，使用奶油色背景、暖橙与墨绿文字、个人头像、圆角卡片及底部导航。个人公开主页为 https://space.bilibili.com/329076624 ，网页直接打开，小程序提供复制链接。不得编造个人履历、教学成果或尚未实现的 AI 功能。所有主要文案中文。

目录：server/ Node.js Express + node:sqlite；web/ React Vite；miniprogram/ 原生微信小程序。
后端负责人只编辑 server/；学生网页负责人只编辑 web/src/student/；小程序负责人只编辑 miniprogram/；主代理维护根目录、web 配置、shared、后台和验证。

## API 约定

所有请求 /api，JSON，错误 {message}。成功直接返回对象/数组。Authorization: Bearer token。
课程字段：id,title,subtitle,subject,grade,type,price(元),originalPrice,teacher,teacherTitle,teacherAvatar(可空),color,description,tags(array),status(published/draft),lessonCount,studentCount,duration。
课时：id,courseId,title,duration,videoUrl,isPreview,sort。
资料：id,courseId,name,size,mimeType,createdAt；GET /api/materials/:id/download 鉴权下载。
GET /api/health → {ok,mode:'demo'|'production'}
GET /api/config → {demoMode,wechatConfigured,smsConfigured,paymentConfigured}
POST /api/auth/demo → {token,user}；仅 demo，默认测试学生已有一门课。
POST /api/auth/sms/send {phone} → {message,devCode?}
POST /api/auth/phone {phone,code} → {token,user}
POST /api/auth/wechat {code,phoneCode?} → {token,user}，真微信凭据服务器交换
GET /api/me → user{id,nickname,phone,avatar}
PATCH /api/me {nickname} → user
POST /api/me/wechat {code,phoneCode} → user（需当前学生登录，验证同手机号后关联微信，user.wechatLinked 表示关联状态）
GET /api/courses?subject=&grade=&q= → course[]
GET /api/courses/:id → {...course,lessons:[],materials:[],enrolled:boolean,progress:{[lessonId]:seconds},completedLessonIds:[]}
GET /api/my/courses → course[] 附 progressPercent,completedLessons
GET /api/my/orders → order[]{id,courseId,courseTitle,amount,status,createdAt}
POST /api/orders {courseId} → order
POST /api/orders/:id/pay → {demo:true,order} 或 {paymentParams:{timeStamp,nonceStr,package,signType,paySign}}
POST /api/orders/:id/demo-pay → {order}；仅 demo，记订单支付并增加选课
GET /api/lessons/:id/play → {url,title,duration,progress} 校验预览或购买
POST /api/lessons/:id/progress {seconds,completed} → {ok:true}
GET /api/materials/:id/download → 文件（支持 Authorization header；小程序 wx.downloadFile）

后台：POST /api/admin/login {username,password} → {token,user}
GET /api/admin/stats → {revenue,students,courses,orders,recentOrders:[],...}
GET /api/admin/courses → course[]
POST /api/admin/courses course字段 → course
PUT /api/admin/courses/:id course字段 → course
DELETE /api/admin/courses/:id → {ok:true}（已售课程应保护/归档）
GET /api/admin/courses/:id → {...course,lessons,materials}
POST /api/admin/courses/:id/lessons {title,duration,videoUrl,isPreview,sort} → lesson
PUT /api/admin/lessons/:id 同上 → lesson
DELETE /api/admin/lessons/:id → {ok:true}
POST /api/admin/uploads multipart file → {url,name,size,mimeType}，支持视频，附件；可通过 /api/admin/courses/:id/materials 上传文件挂资料
POST /api/admin/courses/:id/materials multipart file → material
DELETE /api/admin/materials/:id → {ok:true}
GET /api/admin/orders → order[] 含 courseTitle,userName,phone
GET /api/admin/students → user[] 含 enrolledCount,createdAt

开发时 demoMode=true，模拟登录/支付界面须明确“演示”，不得伪装真实微信授权/短信/扣款。production 未配置能力返回明确错误，禁止模拟成功。媒体权限后端校验，视频上传不可直接公开。

## 网页组件约定

学生负责人输出 web/src/student/StudentApp.jsx 默认导出 StudentApp，CSS 自包含 student.css，使用 lucide-react 图标。可 import {api,downloadFile,useSession} from '../shared/api'（即 web/src/shared/api.js）。api(path,options) 返回解析后的 JSON，path 如 '/courses'（自动 /api），options.body 可对象或 FormData；useSession() 返回 {user,token,login(token,user),logout()}；downloadFile(id,name) 下载已鉴权附件。可直接 fetch('/api/...')。学生默认直接展示发现课程界面，点击个人登录；登录弹窗/搜索/科目过滤/课程详情/目录/购买/资料/学习播放器/我的课程/订单均接后端。桌面是精致的完整学习平台布局，移动自适应底部导航。左侧桌面白色窄导航，顶部问候/搜索，浅灰底，橙色大横幅，白色课程卡片。支持右上“管理后台”链接 /admin。不要更改 web/src/App.jsx。
