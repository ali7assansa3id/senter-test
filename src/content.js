// المرحلة الرابعة: الدروس الإلكترونية، المذكرات، بنك الأسئلة، الامتحانات والواجبات
// ربط المحتوى بالاشتراكات (افتراض): الوصول لمحتوى مجموعة يتطلب تسجيل الطالب فيها + اشتراك نشط للشهر الحالي عليه دفعة صحيحة واحدة على الأقل.
// حماية المحتوى: لا مسارات ملفات مباشرة؛ روابط موقّعة قصيرة العمر تُعاد فحص صلاحيتها عند كل بث، وتدعم Range.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
module.exports = ({ db, one, all, HttpErr, bad, forbid, can, MGMT, SECRET, portal, ctxFor, dir }) => {
  const UP = dir || path.join(__dirname, '..', 'uploads'); fs.mkdirSync(UP, { recursive: true });
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const now = () => new Date().toISOString(), nf = () => new HttpErr(404, 'غير موجود');
  const J = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };
  const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const MANAGE = ['owner', 'manager', 'teacher'], READ = ['owner', 'manager', 'employee', 'teacher'], GRACE = 15000;

  // ---------- أدوات الوقت (القاهرة) ----------
  const offMs = u => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(u).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - u; };
  function toUtc(v, label) {
    if (v == null || v === '') return null; v = String(v);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) { const g = Date.parse(v + ':00Z'); let t = g - offMs(g); t = g - offMs(t); return new Date(t).toISOString(); }
    const t = Date.parse(v); if (!/(Z|[+-]\d\d:?\d\d)$/.test(v) || Number.isNaN(t)) throw bad(`${label} غير صالح`); return new Date(t).toISOString();
  }

  // ---------- الصلاحيات ----------
  const group = (c, id) => { const g = one('SELECT * FROM groups WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: Number(id), t: c.t }); if (!g) throw bad('المجموعة غير موجودة'); return g; };
  const mayManage = (c, gid) => { if (MGMT.includes(c.user.role)) return true; if (c.user.role !== 'teacher' || !gid) return false; const g = one('SELECT teacher_id FROM groups WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: gid, t: c.t }); return !!g && g.teacher_id === c.tid; };
  const needManage = (c, gid) => { if (!mayManage(c, gid)) throw forbid(); };
  const teacherScope = c => c.user.role === 'teacher' ? ' AND group_id IN (SELECT id FROM groups WHERE teacher_id=:tid AND tenant_id=:t AND deleted_at IS NULL)' : '';
  const sp = c => ({ t: c.t, ...(c.user.role === 'teacher' ? { tid: c.tid } : {}) });
  const studentId = c => { if (c.user.role !== 'student') throw forbid(); const s = portal.myStudent(c); if (!s) throw forbid(); return s.id; };
  const entitled = (c, sid) => new Set(all(`SELECT gs.group_id FROM group_students gs WHERE gs.student_id=:s AND gs.tenant_id=:t AND gs.deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM subscriptions su WHERE su.student_id=gs.student_id AND su.group_id=gs.group_id AND su.status='active' AND su.deleted_at IS NULL
    AND ((su.plan_type='monthly' AND su.period=:p) OR (su.plan_type='course' AND :d BETWEEN su.start_date AND su.end_date)
      OR (su.plan_type='per_session' AND su.sessions_count > (SELECT COUNT(*) FROM attendance a JOIN sessions se ON se.id=a.session_id WHERE a.student_id=su.student_id AND se.group_id=su.group_id AND a.status IN ('present','late') AND a.deleted_at IS NULL AND date(a.created_at)>=date(su.created_at))))
    AND (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.subscription_id=su.id AND p.status='valid')-(SELECT COALESCE(SUM(amount),0) FROM refunds rf WHERE rf.subscription_id=su.id AND rf.status='valid')>0)`, { s: sid, t: c.t, p: today().slice(0, 7), d: today() }).map(r => r.group_id));
  const enrolled = (c, sid) => all('SELECT group_id FROM group_students WHERE student_id=:s AND tenant_id=:t AND deleted_at IS NULL', { s: sid, t: c.t }).map(r => r.group_id);
  const url = v => { try { const u = new URL(String(v)); if (!['http:', 'https:'].includes(u.protocol)) throw 0; return u.toString(); } catch { throw bad('الرابط غير صالح (http/https فقط)'); } };
  const strip = r => { const { file_path, ...o } = r; return { ...o, has_file: !!file_path }; };
  const text = (v, label, max = 200, req = true) => { const s = v == null ? '' : String(v).trim(); if (req && !s) throw bad(`${label} مطلوب`); if (s.length > max) throw bad(`${label} طويل جداً`); return s || null; };

  // ---------- الدروس ----------
  const lessonReady = l => l.type === 'live' ? !!(l.url && l.scheduled_at) : !!(l.url || l.file_path);
  function lessons(c, m, id, act, body, q) {
    if (m === 'GET' && !id) { can(c, READ); let w = 'l.tenant_id=:t AND l.deleted_at IS NULL'; const p = sp(c);
      if (c.user.role === 'teacher') w += ' AND l.group_id IN (SELECT id FROM groups WHERE teacher_id=:tid AND tenant_id=:t AND deleted_at IS NULL)';
      if (q.get('group_id')) { w += ' AND l.group_id=:g'; p.g = q.get('group_id'); }
      return { s: 200, j: all(`SELECT l.*, g.name group_name FROM lessons l JOIN groups g ON g.id=l.group_id WHERE ${w} ORDER BY l.group_id, l.position, l.id`, p).map(strip) }; }
    can(c, MANAGE);
    if (m === 'POST' && !id) {
      const g = group(c, body.group_id); needManage(c, g.id);
      if (!['live', 'recorded'].includes(body.type)) throw bad('نوع الدرس: live أو recorded');
      const d = { title: text(body.title, 'العنوان'), description: text(body.description, 'الوصف', 2000, false), url: body.url ? url(body.url) : null, scheduled_at: toUtc(body.scheduled_at, 'موعد الدرس'),
        duration_min: body.duration_min ? Math.round(Number(body.duration_min)) : null, position: Math.round(Number(body.position) || 0) };
      if (body.type === 'live' && (!d.url || !d.scheduled_at)) throw bad('الدرس المباشر يتطلب رابطاً وموعداً');
      if (d.duration_min != null && !(d.duration_min > 0)) throw bad('المدة غير صالحة');
      const r = db.prepare('INSERT INTO lessons(tenant_id,group_id,title,description,type,url,scheduled_at,duration_min,position,created_by) VALUES (:t,:g,:ti,:de,:ty,:u,:s,:d,:p,:cb)')
        .run({ t: c.t, g: g.id, ti: d.title, de: d.description, ty: body.type, u: d.url, s: d.scheduled_at, d: d.duration_min, p: d.position, cb: c.user.id });
      return { s: 201, j: strip(one('SELECT * FROM lessons WHERE id=:i', { i: r.lastInsertRowid })) };
    }
    const l = one('SELECT * FROM lessons WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: id, t: c.t }); if (!l) throw nf(); needManage(c, l.group_id);
    if (m === 'GET' && act === 'progress') return { s: 200, j: all(`SELECT st.id student_id, st.name, COALESCE(p.percent,0) percent, COALESCE(p.completed,0) completed, p.updated_at FROM group_students gs JOIN students st ON st.id=gs.student_id
      LEFT JOIN lesson_progress p ON p.lesson_id=:l AND p.student_id=st.id WHERE gs.group_id=:g AND gs.tenant_id=:t AND gs.deleted_at IS NULL AND st.deleted_at IS NULL ORDER BY st.name`, { l: id, g: l.group_id, t: c.t }) };
    if (m === 'PUT') {
      const n = { ...l };
      for (const k of ['title', 'description', 'position', 'duration_min']) if (k in body) n[k] = body[k];
      if ('title' in body) n.title = text(body.title, 'العنوان'); if ('url' in body) n.url = body.url ? url(body.url) : null;
      if ('scheduled_at' in body) n.scheduled_at = toUtc(body.scheduled_at, 'موعد الدرس'); if ('published' in body) n.published = body.published ? 1 : 0;
      if (n.published && !lessonReady(n)) throw bad('أكمل بيانات الدرس (الرابط/الفيديو/الموعد) قبل النشر');
      db.prepare(`UPDATE lessons SET title=:title, description=:description, url=:url, scheduled_at=:scheduled_at, duration_min=:duration_min, position=:position, published=:published, updated_at=datetime('now') WHERE id=:id AND tenant_id=:t`)
        .run({ title: n.title, description: n.description, url: n.url, scheduled_at: n.scheduled_at, duration_min: n.duration_min, position: n.position, published: n.published, id, t: c.t });
      return { s: 200, j: strip(one('SELECT * FROM lessons WHERE id=:i', { i: id })) };
    }
    if (m === 'DELETE') { db.prepare(`UPDATE lessons SET deleted_at=datetime('now'), published=0 WHERE id=:i AND tenant_id=:t`).run({ i: id, t: c.t }); return { s: 200, j: { ok: true } }; }
    throw new HttpErr(405, 'طريقة غير مدعومة');
  }

  // ---------- المذكرات ----------
  function materials(c, m, id, body, q) {
    if (m === 'GET' && !id) { can(c, READ); let w = 'x.tenant_id=:t AND x.deleted_at IS NULL'; const p = sp(c);
      if (c.user.role === 'teacher') w += ' AND x.group_id IN (SELECT id FROM groups WHERE teacher_id=:tid AND tenant_id=:t AND deleted_at IS NULL)';
      for (const f of ['subject', 'grade', 'group_id']) if (q.get(f)) { w += ` AND x.${f}=:${f}`; p[f] = q.get(f); }
      return { s: 200, j: all(`SELECT x.*, g.name group_name FROM materials x LEFT JOIN groups g ON g.id=x.group_id WHERE ${w} ORDER BY x.subject, x.grade, x.id DESC`, p).map(strip) }; }
    can(c, MANAGE);
    const check = b => { const access = b.access || 'group'; if (!['group', 'free'].includes(access)) throw bad('الإتاحة: group أو free');
      const gid = b.group_id ? group(c, b.group_id).id : null; if (access === 'group' && !gid) throw bad('حدد المجموعة لمذكرة مقيّدة بالمجموعة');
      if (!gid && !MGMT.includes(c.user.role)) throw forbid(); if (gid) needManage(c, gid); return { access, gid }; };
    if (m === 'POST' && !id) {
      const { access, gid } = check(body);
      const r = db.prepare('INSERT INTO materials(tenant_id,group_id,title,subject,grade,description,access,created_by) VALUES (:t,:g,:ti,:s,:gr,:d,:a,:cb)')
        .run({ t: c.t, g: gid, ti: text(body.title, 'العنوان'), s: text(body.subject, 'المادة', 100), gr: text(body.grade, 'الصف', 100, false), d: text(body.description, 'الوصف', 2000, false), a: access, cb: c.user.id });
      return { s: 201, j: strip(one('SELECT * FROM materials WHERE id=:i', { i: r.lastInsertRowid })) };
    }
    const x = one('SELECT * FROM materials WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: id, t: c.t }); if (!x) throw nf(); if (x.group_id) needManage(c, x.group_id); else if (!MGMT.includes(c.user.role)) throw forbid();
    if (m === 'PUT') {
      const n = { ...x, ...Object.fromEntries(['title', 'subject', 'grade', 'description', 'access', 'group_id', 'published'].filter(k => k in body).map(k => [k, body[k]])) };
      const { access, gid } = check(n);
      db.prepare(`UPDATE materials SET title=:ti, subject=:s, grade=:gr, description=:d, access=:a, group_id=:g, published=:p, updated_at=datetime('now') WHERE id=:id AND tenant_id=:t`)
        .run({ ti: text(n.title, 'العنوان'), s: text(n.subject, 'المادة', 100), gr: text(n.grade, 'الصف', 100, false), d: text(n.description, 'الوصف', 2000, false), a: access, g: gid, p: n.published ? 1 : 0, id, t: c.t });
      return { s: 200, j: strip(one('SELECT * FROM materials WHERE id=:i', { i: id })) };
    }
    if (m === 'DELETE') { db.prepare(`UPDATE materials SET deleted_at=datetime('now') WHERE id=:i AND tenant_id=:t`).run({ i: id, t: c.t }); return { s: 200, j: { ok: true } }; }
    throw new HttpErr(405, 'طريقة غير مدعومة');
  }

  // ---------- بنك الأسئلة ----------
  const QT = ['mcq', 'multi', 'true_false', 'short', 'essay'];
  function qCheck(b) {
    if (!QT.includes(b.type)) throw bad('نوع السؤال غير مدعوم');
    const o = { text: text(b.text, 'نص السؤال', 3000), points: Number(b.points ?? 1), options: null, answer: null };
    if (!(o.points > 0 && o.points <= 100)) throw bad('الدرجة يجب أن تكون بين 0 و100');
    if (b.type === 'mcq' || b.type === 'multi') {
      if (!Array.isArray(b.options) || b.options.length < 2 || b.options.length > 8 || b.options.some(x => !String(x).trim())) throw bad('الاختيارات من 2 إلى 8 ولا تكون فارغة');
      o.options = b.options.map(x => String(x).trim()); const n = o.options.length;
      if (b.type === 'mcq') { if (!Number.isInteger(b.answer) || b.answer < 0 || b.answer >= n) throw bad('الإجابة الصحيحة غير صالحة'); o.answer = b.answer; }
      else { if (!Array.isArray(b.answer) || !b.answer.length || b.answer.some(i => !Number.isInteger(i) || i < 0 || i >= n) || new Set(b.answer).size !== b.answer.length) throw bad('الإجابات الصحيحة غير صالحة'); o.answer = [...b.answer].sort((a, c2) => a - c2); }
    } else if (b.type === 'true_false') { if (typeof b.answer !== 'boolean') throw bad('الإجابة الصحيحة: true أو false'); o.answer = b.answer; }
    else if (b.type === 'short') { if (!Array.isArray(b.answer) || !b.answer.length || b.answer.length > 10 || b.answer.some(x => !String(x).trim())) throw bad('أدخل إجابة مقبولة واحدة على الأقل (حتى 10)'); o.answer = b.answer.map(x => String(x).trim()); }
    return o;
  }
  const qOut = r => ({ ...r, options: J(r.options, null), answer: J(r.answer, null) });
  function bank(c, m, id, body, q) {
    can(c, MANAGE); const mine = c.user.role === 'teacher';
    if (m === 'GET' && !id) { let w = 'tenant_id=:t AND deleted_at IS NULL AND active=1'; const p = { t: c.t }; if (mine) { w += ' AND created_by=:u'; p.u = c.user.id; }
      for (const f of ['subject', 'grade', 'type']) if (q.get(f)) { w += ` AND ${f}=:${f}`; p[f] = q.get(f); } if (q.get('search')) { w += ' AND text LIKE :s'; p.s = `%${q.get('search')}%`; }
      return { s: 200, j: all(`SELECT * FROM question_bank WHERE ${w} ORDER BY id DESC LIMIT 1000`, p).map(qOut) }; }
    if (m === 'POST' && !id) {
      const o = qCheck(body), r = db.prepare('INSERT INTO question_bank(tenant_id,subject,grade,type,text,options,answer,points,explanation,created_by) VALUES (:t,:s,:g,:ty,:x,:op,:an,:p,:e,:cb)')
        .run({ t: c.t, s: text(body.subject, 'المادة', 100), g: text(body.grade, 'الصف', 100, false), ty: body.type, x: o.text, op: o.options && JSON.stringify(o.options), an: o.answer == null ? null : JSON.stringify(o.answer), p: o.points, e: text(body.explanation, 'الشرح', 2000, false), cb: c.user.id });
      return { s: 201, j: qOut(one('SELECT * FROM question_bank WHERE id=:i', { i: r.lastInsertRowid })) };
    }
    const x = one('SELECT * FROM question_bank WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: id, t: c.t }); if (!x || (mine && x.created_by !== c.user.id)) throw nf();
    if (m === 'GET') return { s: 200, j: qOut(x) };
    if (m === 'PUT') {
      const n = { ...qOut(x), ...body, type: body.type || x.type }, o = qCheck(n);
      db.prepare(`UPDATE question_bank SET subject=:s, grade=:g, type=:ty, text=:x, options=:op, answer=:an, points=:p, explanation=:e, updated_at=datetime('now') WHERE id=:id AND tenant_id=:t`)
        .run({ s: text(n.subject, 'المادة', 100), g: text(n.grade, 'الصف', 100, false), ty: n.type, x: o.text, op: o.options && JSON.stringify(o.options), an: o.answer == null ? null : JSON.stringify(o.answer), p: o.points, e: text(n.explanation, 'الشرح', 2000, false), id, t: c.t });
      return { s: 200, j: qOut(one('SELECT * FROM question_bank WHERE id=:i', { i: id })) };
    }
    if (m === 'DELETE') { db.prepare(`UPDATE question_bank SET deleted_at=datetime('now') WHERE id=:i AND tenant_id=:t`).run({ i: id, t: c.t }); return { s: 200, j: { ok: true } }; } // الامتحانات القائمة تحتفظ بنسختها
    throw new HttpErr(405, 'طريقة غير مدعومة');
  }

  // ---------- التصحيح ----------
  const norm = s => String(s ?? '').normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim().toLowerCase();
  function isCorrect(eq, ans) {
    const key = J(eq.q_answer, null);
    if (eq.q_type === 'mcq') return Number.isInteger(ans) && ans === key;
    if (eq.q_type === 'multi') return Array.isArray(ans) && ans.length === key.length && [...new Set(ans)].sort((a, b) => a - b).every((v, i) => v === key[i]);
    if (eq.q_type === 'true_false') return typeof ans === 'boolean' && ans === key;
    if (eq.q_type === 'short') return ans != null && key.map(norm).includes(norm(ans));
    return null;
  }
  const eqsOf = eid => all('SELECT * FROM exam_questions WHERE exam_id=:e AND deleted_at IS NULL ORDER BY position, id', { e: eid });
  function finalize(a, e, answers) {
    const eqs = eqsOf(e.id), ans = answers || J(a.answers, {}), grades = J(a.grades, {});
    for (const eq of eqs) if (eq.q_type !== 'essay' && !(grades[eq.id] && grades[eq.id].manual)) grades[eq.id] = { points: isCorrect(eq, ans[eq.id]) ? eq.points : 0, auto: true };
    const total = r2(eqs.reduce((s, eq) => s + (grades[eq.id] ? grades[eq.id].points : 0), 0)), max = eqs.length ? r2(eqs.reduce((s, eq) => s + eq.points, 0)) : (e.max_points || 0);
    const pending = !eqs.length || eqs.some(eq => !grades[eq.id]);
    db.prepare(`UPDATE exam_attempts SET status=:st, submitted_at=COALESCE(submitted_at,:n), answers=:an, grades=:gr, total_score=:ts, max_score=:ms, updated_at=datetime('now') WHERE id=:i`)
      .run({ st: pending ? 'submitted' : 'graded', n: now(), an: JSON.stringify(ans), gr: JSON.stringify(grades), ts: pending ? null : total, ms: max, i: a.id });
  }
  function sweep(c, where, p) { // إنهاء المحاولات التي انتهى وقتها تلقائياً بإجاباتها المحفوظة
    for (const a of all(`SELECT a.* FROM exam_attempts a WHERE a.tenant_id=:t AND a.status='in_progress' AND a.deadline_at IS NOT NULL AND a.deadline_at<:lim ${where}`, { t: c.t, lim: new Date(Date.now() - GRACE).toISOString(), ...p }))
      finalize(a, one('SELECT * FROM exams WHERE id=:i', { i: a.exam_id }));
  }

  // ---------- الامتحانات (إدارة) ----------
  const examRow = (c, id) => { const e = one('SELECT e.*, g.name group_name FROM exams e JOIN groups g ON g.id=e.group_id WHERE e.id=:i AND e.tenant_id=:t AND e.deleted_at IS NULL', { i: id, t: c.t }); if (!e) throw nf(); return e; };
  const attCount = eid => one('SELECT COUNT(*) n FROM exam_attempts WHERE exam_id=:e AND deleted_at IS NULL', { e: eid }).n;
  const eqOut = eq => ({ id: eq.id, question_id: eq.question_id, type: eq.q_type, text: eq.q_text, options: J(eq.q_options, null), answer: J(eq.q_answer, null), explanation: eq.q_explanation, points: eq.points });
  function examFields(c, b, cur = {}) {
    const n = { ...cur, ...b }; if (!['exam', 'assignment'].includes(n.kind)) throw bad('النوع: exam أو assignment');
    const o = { title: text(n.title, 'العنوان'), description: text(n.description, 'الوصف', 3000, false), kind: n.kind, start_at: toUtc(n.start_at, 'وقت البدء'), end_at: toUtc(n.end_at, 'وقت الانتهاء'),
      duration_min: n.duration_min ? Math.round(Number(n.duration_min)) : null, attempts_allowed: Math.round(Number(n.attempts_allowed ?? 1)), shuffle: n.shuffle ? 1 : 0, release_mode: n.release_mode || 'manual',
      show_answers: n.show_answers ? 1 : 0, pass_mark: n.pass_mark == null || n.pass_mark === '' ? null : Number(n.pass_mark), max_points: n.max_points == null || n.max_points === '' ? null : Number(n.max_points) };
    if (o.start_at && o.end_at && o.end_at <= o.start_at) throw bad('وقت الانتهاء يجب أن يكون بعد البدء');
    if (o.duration_min != null && !(o.duration_min > 0 && o.duration_min <= 600)) throw bad('مدة الامتحان غير صالحة');
    if (!(o.attempts_allowed >= 1 && o.attempts_allowed <= 10)) throw bad('عدد المحاولات من 1 إلى 10');
    if (!['immediate', 'manual'].includes(o.release_mode)) throw bad('نمط إعلان النتائج: immediate أو manual');
    if (o.pass_mark != null && !(o.pass_mark >= 0 && o.pass_mark <= 100)) throw bad('درجة النجاح نسبة من 0 إلى 100');
    if (o.max_points != null && !(o.max_points > 0)) throw bad('الدرجة العظمى غير صالحة');
    return o;
  }
  function setQuestions(c, eid, list) {
    if (!Array.isArray(list)) throw bad('قائمة الأسئلة غير صالحة');
    db.prepare('DELETE FROM exam_questions WHERE exam_id=:e').run({ e: eid }); const seen = new Set();
    list.forEach((it, i) => {
      const q = one('SELECT * FROM question_bank WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL AND active=1', { i: Number(it.question_id), t: c.t });
      if (!q || (c.user.role === 'teacher' && q.created_by !== c.user.id)) throw bad('سؤال غير موجود في بنك الأسئلة');
      if (seen.has(q.id)) throw bad('سؤال مكرر في الامتحان'); seen.add(q.id);
      const pts = it.points == null ? q.points : Number(it.points); if (!(pts > 0 && pts <= 100)) throw bad('درجة السؤال غير صالحة');
      db.prepare('INSERT INTO exam_questions(tenant_id,exam_id,question_id,position,q_type,q_text,q_options,q_answer,q_explanation,points) VALUES (:t,:e,:q,:p,:ty,:x,:op,:an,:ex,:pt)')
        .run({ t: c.t, e: eid, q: q.id, p: i, ty: q.type, x: q.text, op: q.options, an: q.answer, ex: q.explanation, pt: pts });
    });
  }
  const examFull = (c, id) => { const e = examRow(c, id); return { ...e, questions: eqsOf(id).map(eqOut), attempts: attCount(id) }; };
  function exams(c, m, id, act, body, q) {
    if (m === 'GET' && !id) { can(c, READ); let w = 'e.tenant_id=:t AND e.deleted_at IS NULL'; const p = sp(c);
      if (c.user.role === 'teacher') w += ' AND e.group_id IN (SELECT id FROM groups WHERE teacher_id=:tid AND tenant_id=:t AND deleted_at IS NULL)';
      for (const f of ['group_id', 'kind', 'status']) if (q.get(f)) { w += ` AND e.${f}=:${f}`; p[f] = q.get(f); }
      return { s: 200, j: all(`SELECT e.*, g.name group_name, (SELECT COUNT(*) FROM exam_questions WHERE exam_id=e.id) questions, (SELECT COUNT(*) FROM exam_attempts WHERE exam_id=e.id) attempts FROM exams e JOIN groups g ON g.id=e.group_id WHERE ${w} ORDER BY e.id DESC LIMIT 500`, p) }; }
    can(c, MANAGE);
    if (m === 'POST' && !id) {
      const g = group(c, body.group_id); needManage(c, g.id); const o = examFields(c, body);
      const eid = tx(() => { const r = db.prepare('INSERT INTO exams(tenant_id,group_id,title,kind,description,start_at,end_at,duration_min,attempts_allowed,shuffle,release_mode,show_answers,pass_mark,max_points,created_by) VALUES (:t,:g,:title,:kind,:description,:start_at,:end_at,:duration_min,:attempts_allowed,:shuffle,:release_mode,:show_answers,:pass_mark,:max_points,:cb)')
        .run({ t: c.t, g: g.id, cb: c.user.id, ...o }); if (body.questions) setQuestions(c, r.lastInsertRowid, body.questions); return r.lastInsertRowid; });
      return { s: 201, j: examFull(c, eid) };
    }
    const e = examRow(c, id); needManage(c, e.group_id);
    if (m === 'GET' && !act) return { s: 200, j: examFull(c, id) };
    if (m === 'GET' && act === 'attempts') { sweep(c, 'AND a.exam_id=:e', { e: id });
      return { s: 200, j: all(`SELECT a.id, a.attempt_no, a.status, a.started_at, a.submitted_at, a.total_score, a.max_score, a.file_name IS NOT NULL has_file, st.id student_id, st.name student_name
        FROM exam_attempts a JOIN students st ON st.id=a.student_id WHERE a.exam_id=:e AND a.tenant_id=:t ORDER BY st.name, a.attempt_no`, { e: id, t: c.t }) }; }
    if (m === 'GET' && act === 'stats') { sweep(c, 'AND a.exam_id=:e', { e: id });
      const best = {}; for (const a of all(`SELECT * FROM exam_attempts WHERE exam_id=:e AND tenant_id=:t AND status='graded'`, { e: id, t: c.t })) if (!best[a.student_id] || a.total_score > best[a.student_id].total_score) best[a.student_id] = a;
      const rows = Object.values(best), eqs = eqsOf(id), max = rows[0]?.max_score || 0, scores = rows.map(a => a.total_score);
      const passed = e.pass_mark != null && max ? rows.filter(a => a.total_score / a.max_score * 100 >= e.pass_mark).length : null;
      return { s: 200, j: { graded_students: rows.length, in_progress_or_pending: one(`SELECT COUNT(DISTINCT student_id) n FROM exam_attempts WHERE exam_id=:e AND status<>'graded'`, { e: id }).n, max_score: max,
        average: rows.length ? r2(scores.reduce((a, b) => a + b, 0) / rows.length) : null, highest: scores.length ? Math.max(...scores) : null, lowest: scores.length ? Math.min(...scores) : null, passed, pass_rate: passed != null && rows.length ? r2(passed / rows.length * 100) : null,
        questions: eqs.map(eq => ({ id: eq.id, text: eq.q_text, correct_rate: rows.length ? r2(rows.filter(a => (J(a.grades, {})[eq.id] || {}).points >= eq.points).length / rows.length * 100) : null })) } }; }
    if (m === 'PUT') {
      const used = attCount(id); if (e.status === 'closed') throw bad('الامتحان مغلق');
      if (used) { // بعد وجود محاولات: تعديلات محدودة فقط
        const allowed = ['title', 'description', 'end_at', 'show_answers', 'release_mode', 'pass_mark']; if (Object.keys(body).some(k => !allowed.includes(k))) throw bad('لا يمكن تعديل الأسئلة أو الإعدادات الأساسية بعد بدء المحاولات');
      }
      const o = examFields(c, body, e);
      tx(() => { db.prepare(`UPDATE exams SET title=:title, description=:description, kind=:kind, start_at=:start_at, end_at=:end_at, duration_min=:duration_min, attempts_allowed=:attempts_allowed, shuffle=:shuffle, release_mode=:release_mode, show_answers=:show_answers, pass_mark=:pass_mark, max_points=:max_points, updated_at=datetime('now') WHERE id=:id AND tenant_id=:t`)
        .run({ ...o, id, t: c.t }); if (body.questions) { if (used) throw bad('لا يمكن تعديل الأسئلة بعد بدء المحاولات'); setQuestions(c, id, body.questions); } });
      return { s: 200, j: examFull(c, id) };
    }
    if (m === 'POST' && act === 'publish') {
      if (e.status !== 'draft') throw bad('الامتحان منشور أو مغلق بالفعل');
      const qs = eqsOf(id).length; if (!qs && !(e.kind === 'assignment' && e.max_points)) throw bad('أضف أسئلة (أو حدد الدرجة العظمى لواجب بتسليم ملف) قبل النشر');
      if (e.kind === 'exam' && !e.end_at && !e.duration_min) throw bad('حدد مدة أو وقت انتهاء للامتحان');
      db.prepare(`UPDATE exams SET status='published', updated_at=datetime('now') WHERE id=:i`).run({ i: id }); return { s: 200, j: examFull(c, id) };
    }
    if (m === 'POST' && act === 'close') { if (e.status !== 'published') throw bad('الامتحان غير منشور'); db.prepare(`UPDATE exams SET status='closed', updated_at=datetime('now') WHERE id=:i`).run({ i: id }); sweep(c, 'AND a.exam_id=:e', { e: id }); return { s: 200, j: examFull(c, id) }; }
    if (m === 'POST' && act === 'release') { if (e.status === 'draft') throw bad('انشر الامتحان أولاً'); db.prepare(`UPDATE exams SET results_released_at=:n, updated_at=datetime('now') WHERE id=:i`).run({ n: now(), i: id }); return { s: 200, j: examFull(c, id) }; }
    if (m === 'DELETE') { if (attCount(id)) throw bad('لا يمكن حذف امتحان عليه محاولات، أغلقه بدلاً من ذلك'); db.prepare(`UPDATE exams SET deleted_at=datetime('now') WHERE id=:i AND tenant_id=:t`).run({ i: id, t: c.t }); return { s: 200, j: { ok: true } }; }
    throw new HttpErr(405, 'طريقة غير مدعومة');
  }

  // ---------- المحاولات: تقديم الطالب ----------
  const released = (e, a) => !!e.results_released_at || (e.release_mode === 'immediate' && a.status === 'graded');
  function studentView(a, e) {
    const eqs = eqsOf(e.id), order = J(a.q_order, eqs.map(x => x.id)), by = Object.fromEntries(eqs.map(x => [x.id, x])), qs = order.map(i => by[i]).filter(Boolean);
    const base = { id: a.id, exam_id: e.id, title: e.title, kind: e.kind, description: e.description, status: a.status, started_at: a.started_at, deadline_at: a.deadline_at, submitted_at: a.submitted_at, has_file: !!a.file_name, file_name: a.file_name, answers: J(a.answers, {}) };
    if (a.status === 'in_progress') return { ...base, questions: qs.map(x => ({ id: x.id, type: x.q_type, text: x.q_text, options: J(x.q_options, null), points: x.points })) };
    if (!released(e, a)) return { ...base, result: null, message: a.status === 'submitted' ? 'تم التسليم وجارٍ التصحيح' : 'تم التصحيح وسيُعلن عن النتيجة لاحقاً' };
    const g = J(a.grades, {}), ans = J(a.answers, {});
    return { ...base, result: { total: a.total_score, max: a.max_score, percent: a.max_score ? r2(a.total_score / a.max_score * 100) : null, passed: e.pass_mark != null && a.max_score ? a.total_score / a.max_score * 100 >= e.pass_mark : null, feedback: a.feedback,
      questions: qs.map(x => ({ id: x.id, type: x.q_type, text: x.q_text, options: J(x.q_options, null), points: x.points, your_answer: ans[x.id] ?? null, earned: g[x.id] ? g[x.id].points : null, feedback: g[x.id]?.feedback || null,
        ...(e.show_answers ? { correct_answer: J(x.q_answer, null), explanation: x.q_explanation } : {}) })) } };
  }
  const myAttempt = (c, aid) => { const sid = studentId(c); const a = one('SELECT * FROM exam_attempts WHERE id=:i AND tenant_id=:t AND student_id=:s AND deleted_at IS NULL', { i: aid, t: c.t, s: sid }); if (!a) throw nf(); return { a, e: one('SELECT * FROM exams WHERE id=:i', { i: a.exam_id }), sid }; };
  function start(c, eid) {
    const sid = studentId(c), e = examRow(c, eid);
    if (e.status !== 'published') throw bad('الامتحان غير متاح');
    if (!entitled(c, sid).has(e.group_id)) throw new HttpErr(403, 'يلزم اشتراك نشط ومسدد جزئياً على الأقل في هذه المجموعة');
    const t = now(); if (e.start_at && t < e.start_at) throw bad('لم يبدأ الموعد بعد'); if (e.end_at && t > e.end_at) throw bad('انتهى الوقت المتاح');
    sweep(c, 'AND a.exam_id=:e AND a.student_id=:s', { e: eid, s: sid });
    const cur = one(`SELECT * FROM exam_attempts WHERE exam_id=:e AND student_id=:s AND status='in_progress'`, { e: eid, s: sid });
    if (cur) return { s: 200, j: studentView(cur, e) };
    const used = one('SELECT COUNT(*) n FROM exam_attempts WHERE exam_id=:e AND student_id=:s', { e: eid, s: sid }).n; if (used >= e.attempts_allowed) throw bad('استنفدت عدد المحاولات المسموحة');
    const eqs = eqsOf(eid); if (e.kind === 'exam' && !eqs.length) throw bad('الامتحان بلا أسئلة');
    let order = eqs.map(x => x.id); if (e.shuffle) for (let i = order.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    let dl = e.duration_min ? new Date(Date.now() + e.duration_min * 60000).toISOString() : null; if (e.end_at && (!dl || e.end_at < dl)) dl = e.end_at;
    const r = db.prepare('INSERT INTO exam_attempts(tenant_id,exam_id,student_id,attempt_no,started_at,deadline_at,q_order) VALUES (:t,:e,:s,:n,:st,:d,:o)').run({ t: c.t, e: eid, s: sid, n: used + 1, st: t, d: dl, o: JSON.stringify(order) });
    return { s: 201, j: studentView(one('SELECT * FROM exam_attempts WHERE id=:i', { i: r.lastInsertRowid }), e) };
  }
  function cleanAnswers(eid, answers) {
    if (answers == null || typeof answers !== 'object' || Array.isArray(answers)) throw bad('صيغة الإجابات غير صالحة');
    const ids = new Set(eqsOf(eid).map(x => String(x.id))), out = {};
    for (const [k, v] of Object.entries(answers)) { if (!ids.has(k)) continue; if (typeof v === 'string' && v.length > 5000) throw bad('إجابة طويلة جداً'); out[k] = v; } return out;
  }
  const open = (a, strict) => a.status === 'in_progress' && !(a.deadline_at && Date.now() > Date.parse(a.deadline_at) + GRACE);
  function attemptStudent(c, m, id, act, body) {
    let { a, e } = myAttempt(c, id);
    if (a.status === 'in_progress' && !open(a)) { finalize(a, e); a = one('SELECT * FROM exam_attempts WHERE id=:i', { i: id }); }
    if (m === 'GET') return { s: 200, j: studentView(a, e) };
    if (a.status !== 'in_progress') throw bad('تم تسليم هذه المحاولة');
    if (m === 'PUT' && act === 'answers') { const ans = { ...J(a.answers, {}), ...cleanAnswers(e.id, body.answers) }; db.prepare(`UPDATE exam_attempts SET answers=:a, updated_at=datetime('now') WHERE id=:i`).run({ a: JSON.stringify(ans), i: id }); return { s: 200, j: { ok: true, saved_at: now() } }; }
    if (m === 'POST' && act === 'submit') {
      const ans = body.answers ? { ...J(a.answers, {}), ...cleanAnswers(e.id, body.answers) } : J(a.answers, {});
      if (e.kind === 'assignment' && !eqsOf(e.id).length && !a.file_name) throw bad('ارفع ملف التسليم أولاً');
      finalize(a, e, ans); return { s: 200, j: studentView(one('SELECT * FROM exam_attempts WHERE id=:i', { i: id }), e) };
    }
    throw new HttpErr(405, 'طريقة غير مدعومة');
  }

  // ---------- المحاولات: التصحيح والمراجعة (مدرس/مدير) ----------
  function attemptStaff(c, m, id, act, body) {
    can(c, MANAGE); sweep(c, 'AND a.id=:i', { i: id });
    const a = one('SELECT * FROM exam_attempts WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: id, t: c.t }); if (!a) throw nf();
    const e = one('SELECT * FROM exams WHERE id=:i', { i: a.exam_id }); needManage(c, e.group_id); const eqs = eqsOf(e.id);
    if (m === 'GET') { const g = J(a.grades, {}), ans = J(a.answers, {}), st = one('SELECT name FROM students WHERE id=:i', { i: a.student_id });
      return { s: 200, j: { id: a.id, exam: { id: e.id, title: e.title, kind: e.kind, max_points: e.max_points }, student_name: st.name, attempt_no: a.attempt_no, status: a.status, submitted_at: a.submitted_at, total_score: a.total_score, max_score: a.max_score, feedback: a.feedback, has_file: !!a.file_path, file_name: a.file_name,
        questions: eqs.map(x => ({ ...eqOut(x), student_answer: ans[x.id] ?? null, grade: g[x.id] || null })) } }; }
    if (m === 'PUT' && act === 'grade') {
      if (a.status === 'in_progress') throw bad('المحاولة لم تُسلَّم بعد');
      const g = J(a.grades, {}), by = Object.fromEntries(eqs.map(x => [String(x.id), x]));
      for (const [k, v] of Object.entries(body.grades || {})) { const eq = by[k]; if (!eq) throw bad('سؤال غير موجود في الامتحان'); const p = Number(v.points); if (!(p >= 0 && p <= eq.points)) throw bad(`درجة السؤال يجب أن تكون بين 0 و${eq.points}`);
        g[k] = { points: r2(p), manual: true, feedback: v.feedback ? String(v.feedback).slice(0, 1000) : null }; }
      let total, max; const done = eqs.length ? eqs.every(x => g[x.id]) : body.total_points != null;
      if (eqs.length) { total = r2(eqs.reduce((s, x) => s + (g[x.id] ? g[x.id].points : 0), 0)); max = r2(eqs.reduce((s, x) => s + x.points, 0)); }
      else { max = e.max_points || 0; total = body.total_points == null ? null : Number(body.total_points); if (total != null && !(total >= 0 && total <= max)) throw bad(`الدرجة يجب أن تكون بين 0 و${max}`); }
      db.prepare(`UPDATE exam_attempts SET grades=:g, total_score=:ts, max_score=:ms, feedback=:f, status=:st, graded_by=:u, graded_at=:n, updated_at=datetime('now') WHERE id=:i`)
        .run({ g: JSON.stringify(g), ts: done ? total : null, ms: max, f: 'feedback' in body ? (body.feedback ? String(body.feedback).slice(0, 2000) : null) : a.feedback, st: done ? 'graded' : 'submitted', u: c.user.id, n: now(), i: id });
      return { s: 200, j: { ok: true, status: done ? 'graded' : 'submitted', total_score: done ? total : null, max_score: max } };
    }
    throw new HttpErr(405, 'طريقة غير مدعومة');
  }

  // ---------- واجهات الطالب (الدروس/المذكرات/الامتحانات) ----------
  function studentArea(c, what, m, id, act, body) {
    const sid = studentId(c), ent = entitled(c, sid), enr = enrolled(c, sid), P = { t: c.t }; const inList = enr.length ? enr.join(',') : '0';
    if (what === 'lessons') {
      if (m === 'GET' && !id) return { s: 200, j: all(`SELECT l.id, l.group_id, l.title, l.description, l.type, l.url, l.scheduled_at, l.duration_min, l.file_path IS NOT NULL has_file, g.name group_name, COALESCE(p.percent,0) percent, COALESCE(p.completed,0) completed, COALESCE(p.last_position,0) last_position
        FROM lessons l JOIN groups g ON g.id=l.group_id LEFT JOIN lesson_progress p ON p.lesson_id=l.id AND p.student_id=${sid} WHERE l.tenant_id=:t AND l.deleted_at IS NULL AND l.published=1 AND l.group_id IN (${inList}) ORDER BY l.group_id, l.position, l.id`, P)
        .map(l => { const lk = !ent.has(l.group_id); return { ...l, has_file: !!l.has_file, locked: lk, url: lk ? null : l.url, last_position: lk ? 0 : l.last_position }; }) };
      if (m === 'POST' && act === 'progress') {
        const l = one('SELECT * FROM lessons WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL AND published=1', { i: id, t: c.t }); if (!l || !enr.includes(l.group_id)) throw nf(); if (!ent.has(l.group_id)) throw new HttpErr(403, 'المحتوى مقفل: يلزم اشتراك نشط');
        const pos = Math.max(0, Number(body.position) || 0), dur = Number(body.duration) > 0 ? Number(body.duration) : null, old = one('SELECT * FROM lesson_progress WHERE lesson_id=:l AND student_id=:s', { l: id, s: sid });
        let pct = l.type === 'live' ? (body.completed ? 100 : 0) : (dur ? Math.min(100, pos / dur * 100) : (body.completed ? 100 : 0)); pct = r2(Math.max(pct, old ? old.percent : 0));
        const done = body.completed || pct >= 90 || (old && old.completed) ? 1 : 0;
        db.prepare(`INSERT INTO lesson_progress(tenant_id,lesson_id,student_id,last_position,duration,percent,completed) VALUES (:t,:l,:s,:p,:d,:pc,:c) ON CONFLICT(lesson_id,student_id) DO UPDATE SET last_position=:p, duration=COALESCE(:d,duration), percent=:pc, completed=:c, updated_at=datetime('now')`)
          .run({ t: c.t, l: id, s: sid, p: pos, d: dur, pc: pct, c: done });
        return { s: 200, j: { percent: pct, completed: !!done } };
      }
    }
    if (what === 'materials' && m === 'GET') { const me = portal.myStudent(c);
      return { s: 200, j: all(`SELECT x.id, x.title, x.subject, x.grade, x.description, x.access, x.group_id, g.name group_name, x.file_name, x.size FROM materials x LEFT JOIN groups g ON g.id=x.group_id
        WHERE x.tenant_id=:t AND x.deleted_at IS NULL AND x.published=1 AND x.file_path IS NOT NULL AND (x.group_id IN (${inList}) OR (x.access='free' AND (x.grade IS NULL OR x.grade=:gr))) ORDER BY x.subject, x.id DESC`, { ...P, gr: me.grade || '' })
        .map(x => ({ ...x, locked: !(x.access === 'free' || ent.has(x.group_id)) })) }; }
    if (what === 'exams' && m === 'GET') { sweep(c, 'AND a.student_id=:s', { s: sid }); const t = now();
      return { s: 200, j: all(`SELECT e.id, e.title, e.kind, e.description, e.group_id, g.name group_name, e.start_at, e.end_at, e.duration_min, e.attempts_allowed, e.status, e.results_released_at, e.release_mode,
        (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id=e.id AND a.student_id=${sid}) used, (SELECT id FROM exam_attempts a WHERE a.exam_id=e.id AND a.student_id=${sid} AND a.status='in_progress') in_progress_id
        FROM exams e JOIN groups g ON g.id=e.group_id WHERE e.tenant_id=:t AND e.deleted_at IS NULL AND e.status IN ('published','closed') AND e.group_id IN (${inList}) ORDER BY e.id DESC`, P)
        .map(e => ({ ...e, locked: !ent.has(e.group_id), state: e.status === 'closed' || (e.end_at && t > e.end_at) ? 'closed' : e.start_at && t < e.start_at ? 'upcoming' : 'open',
          attempts: all('SELECT id, attempt_no, status FROM exam_attempts WHERE exam_id=:e AND student_id=:s ORDER BY attempt_no', { e: e.id, s: sid }) })) }; }
    throw new HttpErr(405, 'طريقة غير مدعومة');
  }
  // نتائج/تقدّم الأبناء لولي الأمر (وللطالب نفسه): بعد إعلان النتائج فقط
  function child(c, what, q) {
    const sid = portal.scope(c, q);
    if (what === 'exams') return { s: 200, j: all(`SELECT a.id attempt_id, a.attempt_no, a.status, a.submitted_at, a.total_score, a.max_score, e.id exam_id, e.title, e.kind, e.pass_mark, e.results_released_at, e.release_mode, g.name group_name
      FROM exam_attempts a JOIN exams e ON e.id=a.exam_id JOIN groups g ON g.id=e.group_id WHERE a.student_id=:s AND a.tenant_id=:t AND a.status<>'in_progress' ORDER BY a.id DESC LIMIT 300`, { s: sid, t: c.t })
      .map(r => { const ok = !!r.results_released_at || (r.release_mode === 'immediate' && r.status === 'graded'); return { attempt_id: r.attempt_id, exam_id: r.exam_id, title: r.title, kind: r.kind, group_name: r.group_name, attempt_no: r.attempt_no, submitted_at: r.submitted_at,
        status: ok ? r.status : (r.status === 'submitted' ? 'قيد التصحيح' : 'بانتظار إعلان النتيجة'), score: ok && r.status === 'graded' ? r.total_score : null, max: ok && r.status === 'graded' ? r.max_score : null,
        passed: ok && r.status === 'graded' && r.pass_mark != null && r.max_score ? r.total_score / r.max_score * 100 >= r.pass_mark : null }; }) };
    if (what === 'lessons') return { s: 200, j: all(`SELECT l.id, l.title, l.type, g.name group_name, COALESCE(p.percent,0) percent, COALESCE(p.completed,0) completed FROM lessons l JOIN groups g ON g.id=l.group_id
      LEFT JOIN lesson_progress p ON p.lesson_id=l.id AND p.student_id=:s WHERE l.tenant_id=:t AND l.deleted_at IS NULL AND l.published=1 AND l.group_id IN (SELECT group_id FROM group_students WHERE student_id=:s AND tenant_id=:t AND deleted_at IS NULL) ORDER BY l.group_id, l.position, l.id`, { s: sid, t: c.t }) };
    throw nf();
  }

  // ---------- الملفات: رفع، رموز موقّعة، بث ----------
  const EXT = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', mp4: 'video/mp4', webm: 'video/webm', txt: 'text/plain; charset=utf-8', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  const KIND = { lesson: { ext: ['mp4', 'webm'], max: 150 << 20 }, material: { ext: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg', 'txt'], max: 25 << 20 }, submission: { ext: ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'txt'], max: 15 << 20 } };
  const magicOk = (ext, h) => { const hex = h.subarray(0, 8).toString('hex');
    return { pdf: () => h.subarray(0, 4).toString() === '%PDF', png: () => hex.startsWith('89504e47'), jpg: () => hex.startsWith('ffd8ff'), jpeg: () => hex.startsWith('ffd8ff'), mp4: () => h.subarray(4, 8).toString() === 'ftyp', webm: () => hex.startsWith('1a45dfa3'),
      docx: () => h.subarray(0, 2).toString() === 'PK', pptx: () => h.subarray(0, 2).toString() === 'PK', xlsx: () => h.subarray(0, 2).toString() === 'PK', doc: () => hex.startsWith('d0cf11e0'), ppt: () => hex.startsWith('d0cf11e0'), xls: () => hex.startsWith('d0cf11e0'),
      txt: () => h.length > 0 && !h.includes(0) }[ext](); };
  const rmFile = p => { if (p) fs.rm(path.join(UP, p), { force: true }, () => { }); };
  function upload(c, kind, id, req) {
    return new Promise((resolve, reject) => {
      let spec, row, apply;
      try {
        spec = KIND[kind]; if (!spec) throw nf();
        if (kind === 'lesson') { can(c, MANAGE); row = one('SELECT * FROM lessons WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: id, t: c.t }); if (!row) throw nf(); needManage(c, row.group_id); if (row.type !== 'recorded') throw bad('رفع الفيديو للدروس المسجلة فقط');
          apply = f => db.prepare(`UPDATE lessons SET file_path=:p, file_name=:n, mime=:m, size=:s, updated_at=datetime('now') WHERE id=:i AND tenant_id=:t`).run({ ...f, i: id, t: c.t }); }
        else if (kind === 'material') { can(c, MANAGE); row = one('SELECT * FROM materials WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: id, t: c.t }); if (!row) throw nf(); if (row.group_id) needManage(c, row.group_id); else if (!MGMT.includes(c.user.role)) throw forbid();
          apply = f => db.prepare(`UPDATE materials SET file_path=:p, file_name=:n, mime=:m, size=:s, updated_at=datetime('now') WHERE id=:i AND tenant_id=:t`).run({ ...f, i: id, t: c.t }); }
        else { const r = myAttempt(c, id); row = r.a; if (r.e.kind !== 'assignment') throw bad('رفع الملفات للواجبات فقط'); if (!open(row)) throw bad('انتهى وقت التسليم');
          apply = f => db.prepare(`UPDATE exam_attempts SET file_path=:p, file_name=:n, updated_at=datetime('now') WHERE id=:i AND tenant_id=:t`).run({ p: f.p, n: f.n, i: id, t: c.t }); }
      } catch (e) { req.resume(); return reject(e); }
      let name; try { name = decodeURIComponent(String(req.headers['x-filename'] || '')).replace(/[\\/\0]/g, '_').slice(0, 150); } catch { name = ''; }
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (!name || !spec.ext.includes(ext)) { req.resume(); return reject(bad(`نوع الملف غير مسموح (المسموح: ${spec.ext.join(', ')})`)); }
      const rel = path.join(String(c.t), crypto.randomBytes(16).toString('hex')), abs = path.join(UP, rel); fs.mkdirSync(path.dirname(abs), { recursive: true });
      const ws = fs.createWriteStream(abs); let size = 0, head = Buffer.alloc(0), checked = false, failed = false;
      const fail = e => { if (failed) return; failed = true; ws.destroy(); fs.rm(abs, { force: true }, () => { }); req.resume(); reject(e); };
      const flush = () => { if (!magicOk(ext, head)) return fail(bad('محتوى الملف لا يطابق نوعه')); checked = true; ws.write(head); };
      req.on('data', ch => { if (failed) return; size += ch.length; if (size > spec.max) return fail(new HttpErr(413, 'الملف أكبر من الحد المسموح'));
        if (!checked) { head = Buffer.concat([head, ch]); if (head.length >= 16) flush(); } else if (!ws.write(ch)) { req.pause(); ws.once('drain', () => req.resume()); } });
      req.on('end', () => { if (failed) return; if (!checked) { if (!head.length) return fail(bad('الملف فارغ')); flush(); if (failed) return; }
        ws.end(() => { try { const old = row.file_path; apply({ p: rel, n: name, m: EXT[ext], s: size }); rmFile(old); resolve({ s: 200, j: { ok: true, file_name: name, size } }); } catch (e) { fail(e); } }); });
      req.on('error', fail);
    });
  }
  const sign = p => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + crypto.createHmac('sha256', SECRET + ':media').update(b).digest('base64url'); };
  const verify = t => { const [b, s] = String(t || '').split('.'); if (!b || !s) return null; const x = crypto.createHmac('sha256', SECRET + ':media').update(b).digest('base64url');
    if (s.length !== x.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(x))) return null; const p = J(Buffer.from(b, 'base64url').toString(), null); return p && p.exp > Date.now() ? p : null; };
  function resolveMedia(c, kind, id) { // الفحص الفعلي للصلاحية (يُنفَّذ عند طلب الرمز وعند كل بث)
    const role = c.user.role;
    if (kind === 'lesson' || kind === 'material') {
      const x = one(`SELECT * FROM ${kind === 'lesson' ? 'lessons' : 'materials'} WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL`, { i: id, t: c.t }); if (!x || !x.file_path) throw nf();
      if (READ.includes(role)) { if (role === 'teacher') needManage(c, x.group_id); return x; }
      if (role !== 'student') throw forbid(); const sid = studentId(c); if (!x.published) throw nf();
      if (kind === 'material' && x.access === 'free') { const me = portal.myStudent(c); if (!x.grade || x.grade === me.grade) return x; }
      if (!x.group_id || !enrolled(c, sid).includes(x.group_id)) throw forbid();
      if (!entitled(c, sid).has(x.group_id)) throw new HttpErr(403, 'المحتوى مقفل: يلزم اشتراك نشط'); return x;
    }
    if (kind === 'submission') {
      const a = one('SELECT * FROM exam_attempts WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: id, t: c.t }); if (!a || !a.file_path) throw nf(); const e = one('SELECT group_id FROM exams WHERE id=:i', { i: a.exam_id });
      if (role === 'student') { if (studentId(c) !== a.student_id) throw forbid(); return a; } if (!MANAGE.includes(role)) throw forbid(); needManage(c, e.group_id); return a;
    }
    throw nf();
  }
  function mediaToken(c, q) { const kind = q.get('kind'), id = Number(q.get('id')), x = resolveMedia(c, kind, id);
    return { s: 200, j: { url: '/media/' + sign({ k: kind, i: id, u: c.user.id, exp: Date.now() + 10 * 60000 }), file_name: x.file_name, mime: EXT[(x.file_name.split('.').pop() || '').toLowerCase()] || null } }; }
  function media(req, res, token) {
    const err = e => { const s = e instanceof HttpErr ? e.status : 500; res.writeHead(s, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: e instanceof HttpErr ? e.message : 'خطأ داخلي' })); if (!(e instanceof HttpErr)) console.error(e); };
    try {
      const p = verify(token); if (!p) throw new HttpErr(401, 'الرابط منتهي أو غير صالح');
      const user = one('SELECT * FROM users WHERE id=:i AND deleted_at IS NULL AND active=1', { i: p.u }); if (!user) throw new HttpErr(401, 'الحساب غير متاح');
      const x = resolveMedia(ctxFor(user), p.k, p.i), file = path.join(UP, x.file_path); if (!file.startsWith(UP) || !fs.existsSync(file)) throw nf();
      const ext = (x.file_name.split('.').pop() || '').toLowerCase(), mime = EXT[ext] || 'application/octet-stream', size = fs.statSync(file).size, inline = ['pdf', 'png', 'jpg', 'jpeg', 'mp4', 'webm'].includes(ext);
      const h = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(x.file_name)}` };
      let start = 0, end = size - 1, code = 200; const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (rg && (rg[1] || rg[2])) { if (rg[1]) { start = Number(rg[1]); if (rg[2]) end = Math.min(Number(rg[2]), end); } else { start = Math.max(0, size - Number(rg[2])); }
        if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); } code = 206; h['Content-Range'] = `bytes ${start}-${end}/${size}`; }
      h['Content-Length'] = end - start + 1; res.writeHead(code, h); if (req.method === 'HEAD') return res.end(); fs.createReadStream(file, { start, end }).pipe(res);
    } catch (e) { err(e); }
  }

  function route(c, [a, b, d, e], m, body, url2) {
    const id = b && /^\d+$/.test(b) ? Number(b) : null, q = url2.searchParams;
    if (a === 'lessons') return lessons(c, m, id, d, body, q);
    if (a === 'materials') return materials(c, m, id, body, q);
    if (a === 'question-bank') return bank(c, m, id, body, q);
    if (a === 'exams') { if (id && d === 'start' && m === 'POST') return start(c, id); return exams(c, m, id, d, body, q); }
    if (a === 'attempts' && id) return c.user.role === 'student' ? attemptStudent(c, m, id, d, body) : attemptStaff(c, m, id, d, body);
    if (a === 'student') return studentArea(c, b, m, d && /^\d+$/.test(d) ? Number(d) : null, e, body);
    if (a === 'child' && m === 'GET') return child(c, b, q);
    if (a === 'media-token' && m === 'GET') return mediaToken(c, q);
  }
  return { route, upload, media };
};
