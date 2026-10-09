process.env.TZ = 'Africa/Cairo';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { db, hashPassword, verifyPassword, seed, ensurePlatform } = require('./db');
seed();
ensurePlatform();

// ---------- Auth ----------
const SECRET_FILE = path.join(__dirname, '..', '.secret');
const SECRET = process.env.SECRET || (fs.existsSync(SECRET_FILE) ? fs.readFileSync(SECRET_FILE, 'utf8')
  : (() => { const s = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 }); return s; })());
const b64 = b => Buffer.from(b).toString('base64url');
const sign = p => { const body = b64(JSON.stringify(p)); return body + '.' + crypto.createHmac('sha256', SECRET).update(body).digest('base64url'); };
function verifyToken(t) {
  const [body, sig] = (t || '').split('.');
  if (!body || !sig) return null;
  const exp = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp > Date.now() ? p : null;
}
const fails = new Map();

// عنوان العميل الحقيقي خلف وكيل عكسي موثوق فقط (TRUSTED_PROXIES=ip1,ip2). لا نثق بـ X-Forwarded-For من غير الوكلاء الموثوقين.
const TRUSTED = (process.env.TRUSTED_PROXIES || '').split(',').map(x => x.trim()).filter(Boolean);
function clientIp(req) {
  const peer = req.socket.remoteAddress || '?';
  if (!TRUSTED.includes(peer)) return peer;
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean);
  for (let i = xff.length - 1; i >= 0; i--) if (!TRUSTED.includes(xff[i])) return xff[i]; // أقرب عنوان غير موثوق
  return xff[0] || peer;
}
// المستخدم لا يدخل ولا تعمل توكناته إذا كان السنتر موقوفاً (مستأجر المنصة مستثنى)
const ACTIVE_USER = 'FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.deleted_at IS NULL AND u.active=1 AND (t.active=1 OR t.is_platform=1)';
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

// ---------- RBAC (مصفوفة الصلاحيات) ----------
const ALL = ['owner', 'manager', 'employee', 'teacher'], MGMT = ['owner', 'manager'], STAFF = ['owner', 'manager', 'employee'];
const RES = {
  branches:  { fields: ['name', 'address', 'phone'], req: ['name'], read: ALL, write: MGMT },
  rooms:     { fields: ['branch_id', 'name', 'capacity'], req: ['branch_id', 'name'], fk: { branch_id: 'branches' }, read: ALL, write: MGMT },
  users:     { fields: ['name', 'phone', 'role', 'branch_id', 'active'], req: ['name', 'phone', 'role'], fk: { branch_id: 'branches' }, read: MGMT, write: ['owner'], hide: ['password_hash'] },
  students:  { fields: ['name', 'phone', 'parent_name', 'parent_phone', 'grade', 'branch_id', 'notes', 'active'], req: ['name'], fk: { branch_id: 'branches' }, read: ALL, write: STAFF },
  teachers:  { fields: ['name', 'phone', 'subject', 'user_id', 'pay_type', 'pay_value', 'active', 'listed', 'bio'], req: ['name'], fk: { user_id: 'users' }, read: ALL, write: MGMT },
  groups:    { fields: ['name', 'teacher_id', 'branch_id', 'subject', 'grade', 'capacity', 'active', 'bookable', 'price'], req: ['name', 'teacher_id'], fk: { teacher_id: 'teachers', branch_id: 'branches' }, read: ALL, write: MGMT },
  schedules: { fields: ['group_id', 'room_id', 'weekday', 'start_time', 'end_time'], req: ['group_id', 'weekday', 'start_time', 'end_time'], fk: { group_id: 'groups', room_id: 'rooms' }, read: ALL, write: MGMT },
  sessions:  { fields: ['group_id', 'room_id', 'session_date', 'start_time', 'end_time', 'status'], req: ['group_id', 'session_date', 'start_time', 'end_time'], fk: { group_id: 'groups', room_id: 'rooms' }, read: ALL, write: STAFF },
};
const OWN_GROUPS = `(SELECT id FROM groups WHERE teacher_id=:tid AND tenant_id=:t AND deleted_at IS NULL)`;
const TEACHER_SCOPE = {
  groups: 'teacher_id=:tid', teachers: 'id=:tid',
  schedules: `group_id IN ${OWN_GROUPS}`, sessions: `group_id IN ${OWN_GROUPS}`,
  students: `id IN (SELECT student_id FROM group_students WHERE deleted_at IS NULL AND group_id IN ${OWN_GROUPS})`,
};

const myBranch = c => (c.user.role === 'owner' || !c.user.branch_id) ? null : c.user.branch_id; // عزل الفرع (BR-002)
const IN_MY_GROUPS = `group_id IN (SELECT id FROM groups WHERE branch_id=:mb AND tenant_id=:t AND deleted_at IS NULL)`;
const BRANCH_SCOPE = { branches: 'id=:mb', rooms: 'branch_id=:mb', students: 'branch_id=:mb', groups: 'branch_id=:mb', users: 'branch_id=:mb', schedules: IN_MY_GROUPS, sessions: IN_MY_GROUPS };

class HttpErr extends Error { constructor(s, m) { super(m); this.status = s; } }
const bad = m => new HttpErr(400, m), forbid = () => new HttpErr(403, 'غير مصرح لك بهذا الإجراء');
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/, DATE = /^\d{4}-\d{2}-\d{2}$/;
const one = (sql, p) => db.prepare(sql).get(p);
const all = (sql, p) => db.prepare(sql).all(p);
const overlap = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

function ctxFor(user) {
  const c = { user, t: user.tenant_id };
  if (user.role === 'teacher') { const tr = one('SELECT id FROM teachers WHERE user_id=:u AND tenant_id=:t AND deleted_at IS NULL', { u: user.id, t: user.tenant_id }); c.tid = tr ? tr.id : -1; }
  return c;
}
const can = (c, list) => { if (!list.includes(c.user.role)) throw forbid(); };

function checkFks(c, def, data) {
  for (const [f, tbl] of Object.entries(def.fk || {}))
    if (data[f] != null && data[f] !== '' && !one(`SELECT id FROM ${tbl} WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL`, { i: data[f], t: c.t }))
      throw bad(`قيمة غير صالحة للحقل ${f}`);
}
function teacherOfGroup(c, gid) {
  const g = one('SELECT * FROM groups WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: gid, t: c.t }); if (!g) throw bad('المجموعة غير موجودة');
  const mb = myBranch(c); if (mb && g.branch_id !== mb) throw forbid();
  return g;
}
function assertOwnGroup(c, gid) { const g = teacherOfGroup(c, gid); if (c.user.role === 'teacher' && g.teacher_id !== c.tid) throw forbid(); }

// قواعد العمل لكل مورد
function validate(c, name, data, id) {
  const ex = id ? one(`SELECT * FROM ${name} WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL`, { i: id, t: c.t }) : {};
  const m = { ...ex, ...data };
  if (name === 'students' || name === 'users') {
    if (m.phone && one(`SELECT id FROM ${name} WHERE tenant_id=:t AND phone=:p AND deleted_at IS NULL AND id<>:i`, { t: c.t, p: m.phone, i: id || 0 })) throw bad('رقم الهاتف مسجل بالفعل');
  }
  if (name === 'users') {
    if (!['owner', 'manager', 'employee', 'teacher'].includes(m.role)) throw bad('دور غير صالح');
    if (!/^01\d{9}$/.test(m.phone)) throw bad('رقم الهاتف يجب أن يكون رقماً مصرياً من 11 رقماً');
  }
  if (name === 'groups') {
    if (m.price != null && !(Number(m.price) >= 0)) throw bad('سعر المجموعة غير صالح');
    if (m.bookable != null && ![0, 1].includes(Number(m.bookable))) throw bad('قيمة bookable غير صالحة');
    if (m.capacity != null && !(Number.isInteger(Number(m.capacity)) && Number(m.capacity) >= 1)) throw bad('السعة غير صالحة');
  }
  if (name === 'teachers') {
    if (m.bio != null && String(m.bio).length > 600) throw bad('النبذة طويلة جداً');
    if (m.pay_type != null && !['percentage', 'fixed'].includes(m.pay_type)) throw bad('نظام محاسبة المدرس غير صالح');
    if (m.pay_value != null && !(Number(m.pay_value) >= 0 && (m.pay_type !== 'percentage' || Number(m.pay_value) <= 100))) throw bad('قيمة المحاسبة غير صالحة');
    if (m.pay_type && m.pay_value == null) throw bad('حدد قيمة المحاسبة');
  }
  if (name === 'rooms' || name === 'groups') if (m.capacity != null && !(Number(m.capacity) > 0)) throw bad('السعة يجب أن تكون رقماً موجباً');
  if (name === 'schedules' || name === 'sessions') {
    if (!TIME.test(m.start_time) || !TIME.test(m.end_time)) throw bad('صيغة الوقت HH:MM');
    if (m.start_time >= m.end_time) throw bad('وقت النهاية يجب أن يكون بعد البداية');
    const g = teacherOfGroup(c, m.group_id);
    if (name === 'schedules') {
      if (!(m.weekday >= 0 && m.weekday <= 6)) throw bad('اليوم غير صالح (0-6)');
      const rows = all(`SELECT s.*, g.teacher_id FROM schedules s JOIN groups g ON g.id=s.group_id WHERE s.tenant_id=:t AND s.deleted_at IS NULL AND g.deleted_at IS NULL AND s.weekday=:w AND s.id<>:i`, { t: c.t, w: m.weekday, i: id || 0 });
      for (const r of rows) if (overlap(m.start_time, m.end_time, r.start_time, r.end_time)) {
        if (m.room_id && r.room_id == m.room_id) throw bad('تعارض: القاعة محجوزة في هذا الوقت');
        if (r.teacher_id === g.teacher_id) throw bad('تعارض: المدرس لديه حصة في هذا الوقت');
      }
    } else {
      if (!DATE.test(m.session_date)) throw bad('صيغة التاريخ YYYY-MM-DD');
      const rows = all(`SELECT s.*, g.teacher_id FROM sessions s JOIN groups g ON g.id=s.group_id WHERE s.tenant_id=:t AND s.deleted_at IS NULL AND s.status<>'cancelled' AND s.session_date=:d AND s.id<>:i`, { t: c.t, d: m.session_date, i: id || 0 });
      if (m.status !== 'cancelled') for (const r of rows) if (overlap(m.start_time, m.end_time, r.start_time, r.end_time)) {
        if (m.room_id && r.room_id == m.room_id) throw bad('تعارض: القاعة محجوزة في هذا الوقت');
        if (r.teacher_id === g.teacher_id) throw bad('تعارض: المدرس لديه حصة في هذا الوقت');
      }
    }
  }
}

// ---------- CRUD عام ----------
function list(c, name, q) {
  const def = RES[name]; can(c, def.read);
  let where = 'tenant_id=:t AND deleted_at IS NULL'; const p = { t: c.t };
  if (c.user.role === 'teacher' && TEACHER_SCOPE[name]) { where += ' AND ' + TEACHER_SCOPE[name]; p.tid = c.tid; }
  const mb = myBranch(c); if (mb && BRANCH_SCOPE[name]) { where += ' AND ' + BRANCH_SCOPE[name]; p.mb = mb; }
  for (const f of [...def.fields, 'id']) if (q.has(f)) { where += ` AND ${f}=:q_${f}`; p['q_' + f] = q.get(f); }
  if (q.get('search') && def.fields.includes('name')) { where += ' AND name LIKE :s'; p.s = `%${q.get('search')}%`; }
  const cols = name === 'users' ? 'id,name,phone,role,branch_id,active,created_at' : '*';
  return all(`SELECT ${cols} FROM ${name} WHERE ${where} ORDER BY id DESC LIMIT 1000`, p);
}
function assertVisible(c, name, id) { if (!list(c, name, new URLSearchParams({ id })).length) throw new HttpErr(404, 'غير موجود'); }
function branchGuard(c, name, d) { // يُجبر الفرع على فرع المستخدم ويمنع الربط بمجموعات فرع آخر
  const mb = myBranch(c); if (!mb) return;
  if (name === 'branches') throw forbid();
  if (RES[name].fields.includes('branch_id')) { if (d.branch_id != null && Number(d.branch_id) !== mb) throw forbid(); if (!('branch_id' in d) || d.branch_id == null) d.branch_id = mb; }
  if ((name === 'schedules' || name === 'sessions') && d.group_id != null) teacherOfGroup(c, Number(d.group_id));
}
function pick(def, body) { const d = {}; for (const f of def.fields) if (f in body) d[f] = body[f] === '' ? null : body[f]; return d; }
function create(c, name, body) {
  const def = RES[name]; can(c, def.write);
  const d = pick(def, body);
  for (const r of def.req) if (d[r] == null || d[r] === '') throw bad(`الحقل ${r} مطلوب`);
  checkFks(c, def, d); branchGuard(c, name, d); validate(c, name, d, null);
  const cols = Object.keys(d);
  if (name === 'users') { if (!body.password || String(body.password).length < 6) throw bad('كلمة المرور 6 أحرف على الأقل'); cols.push('password_hash'); d.password_hash = hashPassword(String(body.password)); }
  const r = db.prepare(`INSERT INTO ${name}(tenant_id,${cols.join(',')}) VALUES (:t,${cols.map(x => ':' + x).join(',')})`).run({ t: c.t, ...d });
  return one(`SELECT * FROM ${name} WHERE id=:i`, { i: r.lastInsertRowid });
}
function update(c, name, id, body) {
  const def = RES[name]; can(c, def.write);
  if (!one(`SELECT id FROM ${name} WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL`, { i: id, t: c.t })) throw new HttpErr(404, 'غير موجود');
  assertVisible(c, name, id);
  const d = pick(def, body);
  const before = name === 'sessions' ? one('SELECT * FROM sessions WHERE id=:i', { i: id }) : null;
  checkFks(c, def, d); if (myBranch(c) && 'branch_id' in d && Number(d.branch_id) !== myBranch(c)) throw forbid(); branchGuard(c, name, d); validate(c, name, d, id);
  if (name === 'users' && body.password) { if (String(body.password).length < 6) throw bad('كلمة المرور 6 أحرف على الأقل'); d.password_hash = hashPassword(String(body.password)); }
  const cols = Object.keys(d); if (!cols.length) throw bad('لا توجد بيانات للتحديث');
  db.prepare(`UPDATE ${name} SET ${cols.map(x => `${x}=:${x}`).join(',')}, updated_at=datetime('now') WHERE id=:id AND tenant_id=:t`).run({ ...d, id, t: c.t });
  const after = one(`SELECT * FROM ${name} WHERE id=:i`, { i: id });
  if (name === 'sessions') portal.notifySessionChange(c, before, after);
  if (name === 'groups') dir.seatFreed(c, id);
  return after;
}
function remove(c, name, id) {
  can(c, RES[name].write);
  if (name === 'users' && id === c.user.id) throw bad('لا يمكنك حذف حسابك');
  assertVisible(c, name, id);
  const before = name === 'sessions' ? one('SELECT * FROM sessions WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: id, t: c.t }) : null;
  const r = db.prepare(`UPDATE ${name} SET deleted_at=datetime('now') WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL`).run({ i: id, t: c.t });
  if (!r.changes) throw new HttpErr(404, 'غير موجود');
  if (before) portal.notifySessionChange(c, before, { ...before, status: 'cancelled' });
  return { ok: true };
}

// ---------- عمليات خاصة ----------
function groupStudents(c, gid) {
  can(c, ALL); assertOwnGroup(c, gid); teacherOfGroup(c, gid);
  return all(`SELECT s.id,s.name,s.phone,s.grade FROM group_students gs JOIN students s ON s.id=gs.student_id WHERE gs.group_id=:g AND gs.tenant_id=:t AND gs.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.name`, { g: gid, t: c.t });
}
function enroll(c, gid, sid) {
  can(c, STAFF); const g = teacherOfGroup(c, gid);
  const s = one('SELECT * FROM students WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: sid, t: c.t });
  if (!s || (myBranch(c) && s.branch_id !== myBranch(c))) throw bad('الطالب غير موجود'); if (!s.active) throw bad('الطالب غير نشط');
  if (one('SELECT id FROM group_students WHERE group_id=:g AND student_id=:s AND deleted_at IS NULL', { g: gid, s: sid })) throw bad('الطالب مسجل بالمجموعة بالفعل');
  const n = one('SELECT COUNT(*) n FROM group_students WHERE group_id=:g AND deleted_at IS NULL', { g: gid }).n;
  if (n >= g.capacity) throw bad('المجموعة مكتملة العدد');
  db.prepare('INSERT INTO group_students(tenant_id,group_id,student_id) VALUES (:t,:g,:s)').run({ t: c.t, g: gid, s: sid });
  return { ok: true };
}
function unenroll(c, gid, sid) {
  can(c, STAFF); teacherOfGroup(c, gid);
  const r = db.prepare(`UPDATE group_students SET deleted_at=datetime('now') WHERE group_id=:g AND student_id=:s AND tenant_id=:t AND deleted_at IS NULL`).run({ g: gid, s: sid, t: c.t });
  if (!r.changes) throw new HttpErr(404, 'الطالب غير مسجل بالمجموعة'); dir.seatFreed(c, gid); return { ok: true };
}
function generate(c, gid, body) {
  can(c, MGMT); teacherOfGroup(c, gid);
  const { from, to } = body;
  if (!DATE.test(from) || !DATE.test(to) || from > to) throw bad('نطاق التاريخ غير صالح');
  if ((new Date(to) - new Date(from)) / 864e5 > 92) throw bad('الحد الأقصى 3 أشهر');
  const sch = all('SELECT * FROM schedules WHERE group_id=:g AND tenant_id=:t AND deleted_at IS NULL', { g: gid, t: c.t });
  const created = [], skipped = [];
  for (let d = new Date(from + 'T12:00:00Z'); d <= new Date(to + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    for (const s of sch.filter(x => x.weekday === d.getUTCDay())) {
      if (one('SELECT id FROM sessions WHERE group_id=:g AND session_date=:d AND start_time=:s AND deleted_at IS NULL', { g: gid, d: ds, s: s.start_time })) { skipped.push({ date: ds, reason: 'موجودة' }); continue; }
      try { created.push(create(c, 'sessions', { group_id: gid, room_id: s.room_id, session_date: ds, start_time: s.start_time, end_time: s.end_time }).id); }
      catch (e) { if (e instanceof HttpErr) skipped.push({ date: ds, reason: e.message }); else throw e; }
    }
  }
  return { created: created.length, skipped };
}
function getAttendance(c, sid) {
  can(c, ALL);
  const s = one('SELECT * FROM sessions WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: sid, t: c.t });
  if (!s) throw new HttpErr(404, 'الحصة غير موجودة'); assertOwnGroup(c, s.group_id);
  const rows = all(`SELECT st.id student_id, st.name, a.status, a.note FROM group_students gs JOIN students st ON st.id=gs.student_id
    LEFT JOIN attendance a ON a.session_id=:s AND a.student_id=st.id AND a.deleted_at IS NULL
    WHERE gs.group_id=:g AND gs.tenant_id=:t AND gs.deleted_at IS NULL AND st.deleted_at IS NULL ORDER BY st.name`, { s: sid, g: s.group_id, t: c.t });
  return { session: s, students: rows };
}
function putAttendance(c, sid, body) {
  can(c, ALL); // المدرس يسجّل لمجموعاته فقط
  const s = one('SELECT * FROM sessions WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: sid, t: c.t });
  if (!s) throw new HttpErr(404, 'الحصة غير موجودة'); assertOwnGroup(c, s.group_id);
  if (s.status === 'cancelled') throw bad('الحصة ملغاة');
  if (!Array.isArray(body.records) || !body.records.length) throw bad('لا توجد سجلات');
  const enrolled = new Set(all('SELECT student_id FROM group_students WHERE group_id=:g AND tenant_id=:t AND deleted_at IS NULL', { g: s.group_id, t: c.t }).map(r => r.student_id));
  const prev = Object.fromEntries(all('SELECT student_id, status FROM attendance WHERE session_id=:s AND deleted_at IS NULL', { s: sid }).map(r => [r.student_id, r.status]));
  const up = db.prepare(`INSERT INTO attendance(tenant_id,session_id,student_id,status,note,marked_by) VALUES (:t,:s,:st,:status,:note,:u)
    ON CONFLICT(session_id,student_id) DO UPDATE SET status=:status, note=:note, marked_by=:u, deleted_at=NULL, updated_at=datetime('now')`);
  db.exec('BEGIN');
  try {
    for (const r of body.records) {
      if (!enrolled.has(r.student_id)) throw bad('طالب غير مسجل في هذه المجموعة');
      if (!['present', 'absent', 'late', 'excused'].includes(r.status)) throw bad('حالة حضور غير صالحة');
      up.run({ t: c.t, s: sid, st: r.student_id, status: r.status, note: r.note || null, u: c.user.id });
    }
    db.prepare(`UPDATE sessions SET status='done' WHERE id=:i`).run({ i: sid });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  portal.notifyAttendance(c, s, body.records.filter(r => prev[r.student_id] !== r.status));
  return getAttendance(c, sid);
}

const ai = require('./ai')({ db, one, all, HttpErr, bad, forbid, can, MGMT, uploadDir: process.env.UPLOAD_DIR });
const admin = require('./admin')({ db, one, all, HttpErr, bad, can });
const portal = require('./portal')({ db, one, all, HttpErr, bad, forbid, can, MGMT, STAFF, hashPassword });
const content = require('./content')({ db, one, all, HttpErr, bad, forbid, can, MGMT, SECRET, portal, ctxFor, dir: process.env.UPLOAD_DIR });
const fin = require('./finance')({ db, one, all, HttpErr, bad, forbid, can, MGMT, STAFF, ALL });
const dir = require('./directory')({ db, one, all, HttpErr, bad, forbid, can, MGMT, STAFF, portal });
const analytics = require('./analytics')({ db, one, all, HttpErr, bad, forbid, can, MGMT, STAFF, fin });

// ---------- Router ----------
const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
function readBody(req) {
  return new Promise((res, rej) => {
    let b = ''; req.on('data', d => { b += d; if (b.length > 1e5) { rej(bad('الطلب كبير جداً')); req.destroy(); } });
    req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch { rej(bad('JSON غير صالح')); } });
  });
}
async function handle(req, res) {
  const url = new URL(req.url, 'http://x'), parts = url.pathname.split('/').filter(Boolean);
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Content-Security-Policy', CSP);
  const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
  if (parts[0] === 'media' && parts[1]) return content.media(req, res, parts[1]);
  if (parts[0] !== 'api') {
    const f = path.join(PUBLIC, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(PUBLIC) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); return res.end(fs.readFileSync(f));
  }
  try {
    const isUpload = parts[1] === 'uploads' && req.method === 'POST';
    const body = ['POST', 'PUT'].includes(req.method) && !isUpload ? await readBody(req) : {};
    if (parts[1] === 'public') { const r = dir.publicRoute(parts.slice(2), req.method, body, url, clientIp(req)); return send(r.s, r.j); }
    if (parts[1] === 'login' && req.method === 'POST') {
      const key = String(body.phone) + clientIp(req), f = fails.get(key) || { n: 0, until: 0 };
      if (f.n >= 5 && Date.now() < f.until) throw new HttpErr(429, 'محاولات كثيرة، حاول لاحقاً');
      const u = all(`SELECT u.* ${ACTIVE_USER} AND u.phone=:p`, { p: String(body.phone || '') }).find(x => verifyPassword(String(body.password || ''), x.password_hash));
      if (!u) { fails.set(key, { n: f.n + 1, until: Date.now() + 15 * 6e4 }); throw new HttpErr(401, 'بيانات الدخول غير صحيحة'); }
      fails.delete(key);
      return send(200, { token: sign({ uid: u.id, exp: Date.now() + 12 * 36e5 }), user: { id: u.id, name: u.name, role: u.role } });
    }
    const tok = verifyToken((req.headers.authorization || '').replace('Bearer ', ''));
    const user = tok && one(`SELECT u.* ${ACTIVE_USER} AND u.id=:i`, { i: tok.uid });
    if (!user) throw new HttpErr(401, 'يجب تسجيل الدخول');
    const c = ctxFor(user);
    if (isUpload) { const r = await content.upload(c, parts[2], Number(parts[3]), req); return send(r.s, r.j); }
    const [, a, b, d, e] = parts, id = b ? Number(b) : null, m = req.method;
    if (a === 'me') return send(200, { id: user.id, name: user.name, role: user.role, branch_id: user.branch_id });
    const fr = await (portal.route(c, parts.slice(1), m, body, url) || content.route(c, parts.slice(1), m, body, url) || fin.route(c, parts.slice(1), m, body, url) || dir.route(c, parts.slice(1), m, body, url) || ai.route(c, parts.slice(1), m, body, url) || analytics.route(c, parts.slice(1), m, body, url) || admin.route(c, parts.slice(1), m, body, url));
    if (fr) {
      if (fr.buf) { res.writeHead(fr.s, { 'Content-Type': fr.type, 'Content-Disposition': 'attachment; filename="report.xlsx"' }); return res.end(fr.buf); }
      return send(fr.s, fr.j);
    }
    if (a === 'groups' && d === 'students') {
      if (m === 'GET') return send(200, groupStudents(c, id));
      if (m === 'POST') return send(201, enroll(c, id, Number(body.student_id)));
      if (m === 'DELETE') return send(200, unenroll(c, id, Number(e)));
    }
    if (a === 'groups' && d === 'generate-sessions' && m === 'POST') return send(200, generate(c, id, body));
    if (a === 'sessions' && d === 'attendance') {
      if (m === 'GET') return send(200, getAttendance(c, id));
      if (m === 'PUT') return send(200, putAttendance(c, id, body));
    }
    if (a === 'attendance-report' && m === 'GET') { // ملخص حضور طالب
      can(c, ALL); const sid = Number(url.searchParams.get('student_id'));
      if (c.user.role === 'teacher' && !TEACHER_SCOPE.students) throw forbid();
      const ok = list(c, 'students', new URLSearchParams({ id: sid })).length; if (!ok) throw new HttpErr(404, 'غير موجود');
      return send(200, all(`SELECT a.status, COUNT(*) n FROM attendance a WHERE a.student_id=:s AND a.tenant_id=:t AND a.deleted_at IS NULL GROUP BY a.status`, { s: sid, t: c.t }));
    }
    if (!RES[a]) throw new HttpErr(404, 'المسار غير موجود');
    if (m === 'GET') return send(200, id ? (list(c, a, new URLSearchParams({ id }))[0] || (() => { throw new HttpErr(404, 'غير موجود'); })()) : list(c, a, url.searchParams));
    if (m === 'POST') return send(201, create(c, a, body));
    if (m === 'PUT' && id) return send(200, update(c, a, id, body));
    if (m === 'DELETE' && id) return send(200, remove(c, a, id));
    throw new HttpErr(405, 'طريقة غير مدعومة');
  } catch (e) {
    if (e instanceof HttpErr) return send(e.status, { error: e.message });
    console.error(e); send(500, { error: 'خطأ داخلي' });
  }
}
if (require.main === module) http.createServer(handle).listen(process.env.PORT || 3000, () => console.log('SENTER يعمل على http://localhost:' + (process.env.PORT || 3000)));
module.exports = { handle, ai, clientIp };
