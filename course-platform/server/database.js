import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function openDatabase(filename, uploadsDir, {seedDemoContent=true}={}) {
  mkdirSync(dirname(filename), { recursive: true });
  mkdirSync(uploadsDir, { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, phone TEXT UNIQUE, openid TEXT UNIQUE, name TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, userId TEXT, role TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS courses (id TEXT PRIMARY KEY, title TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, grade TEXT NOT NULL, type TEXT NOT NULL, price REAL NOT NULL, originalPrice REAL NOT NULL, teacher TEXT NOT NULL, teacherRole TEXT NOT NULL, teacherColor TEXT NOT NULL, description TEXT NOT NULL, coverTheme TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL, createdAt TEXT NOT NULL, coverImage TEXT NOT NULL DEFAULT '', detailImages TEXT NOT NULL DEFAULT '[]', productId TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS lessons (id TEXT PRIMARY KEY, courseId TEXT NOT NULL REFERENCES courses(id), title TEXT NOT NULL, duration INTEGER NOT NULL, preview INTEGER NOT NULL DEFAULT 0, videoUrl TEXT NOT NULL, sortOrder INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, storageName TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL, kind TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS vod_uploads (id TEXT PRIMARY KEY, subAppId INTEGER NOT NULL, sourceContext TEXT UNIQUE NOT NULL, fileId TEXT UNIQUE, name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'uploading', duration REAL NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0, format TEXT, sourceUrl TEXT NOT NULL DEFAULT '', taskId TEXT, error TEXT, createdAt TEXT NOT NULL, checkedAt INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, courseId TEXT NOT NULL REFERENCES courses(id), name TEXT NOT NULL, uploadId TEXT NOT NULL REFERENCES uploads(id));
    CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES users(id), courseId TEXT NOT NULL REFERENCES courses(id), amount INTEGER NOT NULL, status TEXT NOT NULL, transactionId TEXT UNIQUE, createdAt TEXT NOT NULL, paidAt TEXT, payChannel TEXT NOT NULL DEFAULT '', paymentCodeUrl TEXT, paymentCodeCreatedAt INTEGER);
    CREATE TABLE IF NOT EXISTS enrollments (userId TEXT NOT NULL REFERENCES users(id), courseId TEXT NOT NULL REFERENCES courses(id), createdAt TEXT NOT NULL, PRIMARY KEY (userId,courseId));
    CREATE TABLE IF NOT EXISTS progress (userId TEXT NOT NULL REFERENCES users(id), lessonId TEXT NOT NULL REFERENCES lessons(id), position REAL NOT NULL, duration REAL NOT NULL, completed INTEGER NOT NULL, updatedAt TEXT NOT NULL, PRIMARY KEY (userId,lessonId));
    CREATE TABLE IF NOT EXISTS sms_codes (phone TEXT PRIMARY KEY, hash TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL, sentAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS media_sessions (hash TEXT PRIMARY KEY, sessionHash TEXT NOT NULL REFERENCES sessions(hash) ON DELETE CASCADE, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS virtual_payments (id TEXT PRIMARY KEY, orderId TEXT NOT NULL REFERENCES orders(id), openid TEXT NOT NULL, productId TEXT NOT NULL, amount INTEGER NOT NULL, env INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', transactionId TEXT UNIQUE, createdAt TEXT NOT NULL, checkedAt INTEGER NOT NULL DEFAULT 0, deliveredAt TEXT, error TEXT, paidAt TEXT, refundedAt TEXT, duplicatePayment INTEGER NOT NULL DEFAULT 0, remainingAmount INTEGER, refundFinal INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS virtual_refunds (id TEXT PRIMARY KEY,attemptId TEXT NOT NULL REFERENCES virtual_payments(id),refundOrderId TEXT,wxRefundId TEXT,payWxOrderId TEXT,amount INTEGER,expectedAmount INTEGER,linkVerified INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'pending',createdAt TEXT NOT NULL,checkedAt INTEGER NOT NULL DEFAULT 0,error TEXT,UNIQUE(attemptId,refundOrderId),UNIQUE(attemptId,wxRefundId));
    CREATE INDEX IF NOT EXISTS idx_virtual_refunds_reconcile ON virtual_refunds(status,checkedAt);
    CREATE INDEX IF NOT EXISTS idx_virtual_payments_order ON virtual_payments(orderId);
    DROP INDEX IF EXISTS idx_virtual_payments_unique_order;
    CREATE INDEX IF NOT EXISTS idx_virtual_payments_reconcile ON virtual_payments(status,checkedAt);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(userId);
    CREATE INDEX IF NOT EXISTS idx_lessons_course ON lessons(courseId);
  `);
  const orderColumns=new Set(db.prepare('PRAGMA table_info(orders)').all().map(column=>column.name));
  if(!orderColumns.has('payChannel')) db.exec("ALTER TABLE orders ADD COLUMN payChannel TEXT NOT NULL DEFAULT ''");
  if(!orderColumns.has('paymentCodeUrl')) db.exec('ALTER TABLE orders ADD COLUMN paymentCodeUrl TEXT');
  if(!orderColumns.has('paymentCodeCreatedAt')) db.exec('ALTER TABLE orders ADD COLUMN paymentCodeCreatedAt INTEGER');
  const virtualColumns=new Set(db.prepare('PRAGMA table_info(virtual_payments)').all().map(column=>column.name));
  if(!virtualColumns.has('paidAt')) db.exec('ALTER TABLE virtual_payments ADD COLUMN paidAt TEXT');
  if(!virtualColumns.has('refundedAt')) db.exec('ALTER TABLE virtual_payments ADD COLUMN refundedAt TEXT');
  if(!virtualColumns.has('duplicatePayment')) db.exec('ALTER TABLE virtual_payments ADD COLUMN duplicatePayment INTEGER NOT NULL DEFAULT 0');
  if(!virtualColumns.has('remainingAmount')) db.exec('ALTER TABLE virtual_payments ADD COLUMN remainingAmount INTEGER');
  if(!virtualColumns.has('refundFinal')) db.exec('ALTER TABLE virtual_payments ADD COLUMN refundFinal INTEGER NOT NULL DEFAULT 0');
  const refundColumns=new Set(db.prepare('PRAGMA table_info(virtual_refunds)').all().map(column=>column.name));
  if(!refundColumns.has('payWxOrderId'))db.exec('ALTER TABLE virtual_refunds ADD COLUMN payWxOrderId TEXT');
  db.exec("UPDATE virtual_payments SET paidAt=COALESCE((SELECT paidAt FROM orders WHERE orders.id=virtual_payments.orderId),createdAt) WHERE paidAt IS NULL AND status IN ('paid','refunded')");
  const courseColumns=new Set(db.prepare('PRAGMA table_info(courses)').all().map(column=>column.name));
  if(!courseColumns.has('coverImage')) db.exec("ALTER TABLE courses ADD COLUMN coverImage TEXT NOT NULL DEFAULT ''");
  if(!courseColumns.has('detailImages')) db.exec("ALTER TABLE courses ADD COLUMN detailImages TEXT NOT NULL DEFAULT '[]'");
  if(!courseColumns.has('productId')) db.exec("ALTER TABLE courses ADD COLUMN productId TEXT NOT NULL DEFAULT ''");
  if (!db.prepare('SELECT id FROM courses LIMIT 1').get() && seedDemoContent) seed(db, uploadsDir);
  return db;
}

function seed(db, uploadsDir) {
  const now = new Date().toISOString();
  const courses = [
    ['course-experience', '升高二多科体验课DX', '把握关键知识，开启高二新学期', '综合', '高二', '体验课', 0, 99, '廖耀华', '#ff8a21', 'orange', ['暑期衔接', '多科体验'], ['【政】主体分析法巧记政治难点','【英】“快乐跳读”提升阅读效率','【数】平面向量速解技巧','【史】口诀大法梳理纲要主观题','【物】功能中的好用结论']],
    ['course-math', '高二数学 · 核心能力提升班', '从一道题到一类题，建立数学思维', '数学', '高二', '系统课', 299, 399, '吴天洋', '#6793ef', 'blue', ['重点突破', '配套讲义'], ['函数与导数的核心方法','平面向量的几何应用','数列综合题突破','圆锥曲线解题思路']],
    ['course-english', '高中英语 · 阅读进阶计划', '读懂文章逻辑，让阅读有方法', '英语', '高二', '专题课', 199, 299, '崔妍', '#9c80d7', 'purple', ['阅读提速', '词汇积累'], ['长难句拆解与语法复习','细节定位与同义替换','主旨大意题解题方法','推理判断与文章结构']],
    ['course-physics', '高二物理 · 电磁学精讲', '看见规律，理解每一道公式', '物理', '高二', '系统课', 269, 369, '张海鹏', '#4baaaa', 'teal', ['实验探究', '模型归纳'], ['电场与电势的理解','恒定电流与电路分析','磁场中的带电粒子','电磁感应综合应用']],
    ['course-senior', '高三难点专题课—9期', '归纳高频考点，稳步提升解题能力', '数学', '高三', '专题课', 399, 599, '张海鹏', '#e6a842', 'gold', ['高考专题', '重难点突破'], ['导数中的极值点问题','圆锥曲线定点定值','概率统计综合','立体几何证明与计算']],
    ['course-history', '高中历史 · 大单元知识梳理', '连起时间线，建立完整知识框架', '历史', '高三', '专题课', 159, 239, '黄佳敏', '#dd8e7d', 'rose', ['知识框架', '材料分析'], ['中国古代政治制度','近代社会转型','世界现代史线索','史料阅读与论证']],
  ];
  const insert = db.prepare('INSERT INTO courses(id,title,subtitle,subject,grade,type,price,originalPrice,teacher,teacherRole,teacherColor,description,coverTheme,tags,status,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const [id,title,subtitle,subject,grade,type,price,originalPrice,teacher,color,theme,tags,lessonTitles] of courses) {
    insert.run(id,title,subtitle,subject,grade,type,price,originalPrice,teacher,'主讲老师',color,`${subtitle}。课程围绕高中阶段的重点知识展开，结合例题讲解、课堂练习和课后讲义，帮助同学循序渐进地掌握知识。当前视频为公开演示素材，正式授课内容请由管理员上传。`,theme,JSON.stringify(tags),'published',now);
    lessonTitles.forEach((name,i) => db.prepare('INSERT INTO lessons VALUES(?,?,?,?,?,?,?)').run(`${id}-lesson-${i+1}`,id,name,1800+i*300,i===0?1:0,'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',i));
    const uploadId=randomUUID(), storageName=`${uploadId}.txt`;
    const content=`${title}\r\n学习讲义 · 演示资料\r\n\r\n一、学习目标\r\n1. 梳理本单元核心概念与知识关系。\r\n2. 理解例题中的条件、方法和结论。\r\n3. 完成课后复盘，记录仍需解决的问题。\r\n\r\n二、课堂笔记\r\n${lessonTitles.map((t,i)=>`${i+1}. ${t}\r\n知识要点：请结合视频记录关键结论。\r\n练习建议：独立分析条件，再检查解题过程。`).join('\r\n\r\n')}\r\n\r\n本文件为系统演示讲义，实际教学资料请由管理员上传。\r\n`;
    writeFileSync(join(uploadsDir,storageName),'\uFEFF'+content,'utf8');
    db.prepare('INSERT INTO uploads VALUES(?,?,?,?,?,?,?)').run(uploadId,storageName,`${title}-配套讲义.txt`,Buffer.byteLength('\uFEFF'+content),'text/plain','material',now);
    db.prepare('INSERT INTO materials VALUES(?,?,?,?)').run(`${id}-material`,id,'课程配套学习讲义',uploadId);
  }
}
