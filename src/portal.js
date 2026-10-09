// المرحلة الثالثة: حساب الطالب، حساب ولي الأمر، الإشعارات داخل التطبيق
// BR-005 (القُصّر — افتراض): الطلاب يُعاملون كقُصّر؛ الحسابات يُنشئها الموظفون فقط؛ كل حساب يرى بياناته/أبنائه المرتبطين فقط؛
// لا تُعرض هواتف أو ملاحظات أو بيانات أي طالب آخر؛ تعطيل الحساب أو فك الربط يقطع الوصول فوراً.
module.exports = ({ db, one, all, HttpErr, bad, forbid, can, MGMT, STAFF, hashPassword }) => {
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const PHONE = /^01\d{9}$/, DATE = /^\d{4}-\d{2}-\d{2}$/, TYPES = ['absence', 'late', 'change'], REL = ['father', 'mother', 'guardian'];
  const nf = () => new HttpErr(404, 'غير موجود');
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  // ---------- إنشاء الحسابات ----------
  function validateAccount(c, body, uid) {
    if (!PHONE.test(String(body.phone || ''))) throw bad('رقم الهاتف يجب أن يكون رقماً مصرياً من 11 رقماً');
    if (String(body.password || '').length < 6) throw bad('كلمة المرور 6 أحرف على الأقل');
    if (one('SELECT id FROM users WHERE tenant_id=:t AND phone=:p AND deleted_at IS NULL AND id<>:i', { t: c.t, p: body.phone, i: uid || 0 })) throw bad('رقم الهاتف مسجل بالفعل');
  }
  const addUser = (c, name, role, body) => db.prepare('INSERT INTO users(tenant_id,name,phone,password_hash,role) VALUES (:t,:n,:p,:h,:r)')
    .run({ t: c.t, n: name, p: body.phone, h: hashPassword(String(body.password)), r: role }).lastInsertRowid;
  const student = (c, id) => { const s = one('SELECT * FROM students WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: Number(id), t: c.t }); if (!s) throw bad('الطالب غير موجود'); return s; };

  function studentAccounts(c, m, sid, act, body) {
    can(c, STAFF);
    if (m === 'GET') return { s: 200, j: all(`SELECT s.id, s.name, s.grade, u.id user_id, u.phone account_phone, u.active account_active,
      (SELECT COUNT(*) FROM parent_students ps JOIN users p ON p.id=ps.parent_id WHERE ps.student_id=s.id AND ps.deleted_at IS NULL AND p.active=1) parents
      FROM students s LEFT JOIN users u ON u.id=s.user_id AND u.deleted_at IS NULL WHERE s.tenant_id=:t AND s.deleted_at IS NULL ORDER BY s.name`, { t: c.t }) };
    if (m === 'POST' && !sid) {
      const st = student(c, body.student_id);
      if (st.user_id && one('SELECT id FROM users WHERE id=:i AND deleted_at IS NULL', { i: st.user_id })) throw bad('للطالب حساب بالفعل');
      validateAccount(c, body);
      const uid = tx(() => { const u = addUser(c, st.name, 'student', body); db.prepare('UPDATE students SET user_id=:u WHERE id=:i AND tenant_id=:t').run({ u, i: st.id, t: c.t }); return u; });
      return { s: 201, j: { user_id: uid, student_id: st.id } };
    }
    can(c, MGMT);
    const st = student(c, sid), u = st.user_id && one('SELECT * FROM users WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: st.user_id, t: c.t });
    if (!u) throw bad('لا يوجد حساب لهذا الطالب');
    if (m === 'POST' && act === 'reset') { if (String(body.password || '').length < 6) throw bad('كلمة المرور 6 أحرف على الأقل'); db.prepare(`UPDATE users SET password_hash=:h, updated_at=datetime('now') WHERE id=:i`).run({ h: hashPassword(String(body.password)), i: u.id }); return { s: 200, j: { ok: true } }; }
    if (m === 'POST' && (act === 'disable' || act === 'enable')) { db.prepare(`UPDATE users SET active=:a, updated_at=datetime('now') WHERE id=:i`).run({ a: act === 'enable' ? 1 : 0, i: u.id }); return { s: 200, j: { ok: true } }; }
    throw new HttpErr(405, 'طريقة غير مدعومة');
  }

  const kids = (c, pid) => all(`SELECT s.id, s.name, s.grade, ps.relation FROM parent_students ps JOIN students s ON s.id=ps.student_id WHERE ps.parent_id=:p AND ps.tenant_id=:t AND ps.deleted_at IS NULL AND s.deleted_at IS NULL ORDER BY s.name`, { p: pid, t: c.t });
  const parentUser = (c, id) => { const u = one(`SELECT id,name,phone,active FROM users WHERE id=:i AND tenant_id=:t AND role='parent' AND deleted_at IS NULL`, { i: id, t: c.t }); if (!u) throw nf(); return u; };
  function link(c, pid, sid, relation) {
    if (!REL.includes(relation || 'guardian')) throw bad('صلة القرابة غير صالحة');
    const st = student(c, sid);
    if (one('SELECT id FROM parent_students WHERE parent_id=:p AND student_id=:s AND deleted_at IS NULL', { p: pid, s: st.id })) throw bad('الطالب مرتبط بولي الأمر بالفعل');
    db.prepare('INSERT INTO parent_students(tenant_id,parent_id,student_id,relation) VALUES (:t,:p,:s,:r)').run({ t: c.t, p: pid, s: st.id, r: relation || 'guardian' });
  }
  function parents(c, m, id, act, sid, body) {
    can(c, STAFF);
    if (m === 'GET') return { s: 200, j: all(`SELECT id,name,phone,active FROM users WHERE tenant_id=:t AND role='parent' AND deleted_at IS NULL ORDER BY name`, { t: c.t }).map(p => ({ ...p, children: kids(c, p.id) })) };
    if (m === 'POST' && !id) {
      const name = String(body.name || '').trim(); if (!name) throw bad('اسم ولي الأمر مطلوب');
      validateAccount(c, body);
      const ids = Array.isArray(body.student_ids) ? body.student_ids : []; ids.forEach(i => student(c, i));
      if (!REL.includes(body.relation || 'guardian')) throw bad('صلة القرابة غير صالحة');
      const pid = tx(() => { const p = addUser(c, name, 'parent', body); ids.forEach(i => link(c, p, i, body.relation)); return p; });
      return { s: 201, j: { ...parentUser(c, pid), children: kids(c, pid) } };
    }
    const p = parentUser(c, id);
    if (m === 'POST' && act === 'students') { link(c, id, body.student_id, body.relation); return { s: 201, j: { ...p, children: kids(c, id) } }; }
    if (m === 'DELETE' && act === 'students') {
      const r = db.prepare(`UPDATE parent_students SET deleted_at=datetime('now') WHERE parent_id=:p AND student_id=:s AND tenant_id=:t AND deleted_at IS NULL`).run({ p: id, s: Number(sid), t: c.t });
      if (!r.changes) throw nf(); return { s: 200, j: { ok: true } };
    }
    if (m === 'PUT') {
      can(c, MGMT); const sets = [], pr = { i: id, t: c.t };
      if (body.name) { sets.push('name=:n'); pr.n = String(body.name).trim(); }
      if ('active' in body) { sets.push('active=:a'); pr.a = body.active ? 1 : 0; }
      if (body.password) { if (String(body.password).length < 6) throw bad('كلمة المرور 6 أحرف على الأقل'); sets.push('password_hash=:h'); pr.h = hashPassword(String(body.password)); }
      if (!sets.length) throw bad('لا توجد بيانات للتحديث');
      db.prepare(`UPDATE users SET ${sets.join(',')}, updated_at=datetime('now') WHERE id=:i AND tenant_id=:t`).run(pr);
      return { s: 200, j: { ...parentUser(c, id), children: kids(c, id) } };
    }
    throw new HttpErr(405, 'طريقة غير مدعومة');
  }

  // ---------- بوابة الطالب وولي الأمر ----------
  function myStudent(c) { return one('SELECT id,name,grade FROM students WHERE user_id=:u AND tenant_id=:t AND deleted_at IS NULL', { u: c.user.id, t: c.t }); }
  function canSee(c, sid) { // نطاق الوصول (BR-005)
    if (c.user.role === 'student') { const me = myStudent(c); return !!me && me.id === sid; }
    if (c.user.role === 'parent') return !!one(`SELECT ps.id FROM parent_students ps JOIN students s ON s.id=ps.student_id WHERE ps.parent_id=:p AND ps.student_id=:s AND ps.tenant_id=:t AND ps.deleted_at IS NULL AND s.deleted_at IS NULL`, { p: c.user.id, s: sid, t: c.t });
    return false;
  }
  function scope(c, q) {
    if (!['student', 'parent'].includes(c.user.role)) throw forbid();
    let sid = Number(q.get('student_id')) || null;
    if (c.user.role === 'student') { const me = myStudent(c); if (!me) throw forbid(); if (sid && sid !== me.id) throw forbid(); return me.id; }
    if (!sid) throw bad('student_id مطلوب'); if (!canSee(c, sid)) throw forbid(); return sid;
  }
  const SUBSEL = `s.id, s.period, s.amount, s.discount, s.status, ROUND(s.amount-s.discount,2) net, g.name group_name,
    (COALESCE((SELECT SUM(amount) FROM payments p WHERE p.subscription_id=s.id AND p.status='valid'),0)-COALESCE((SELECT SUM(amount) FROM refunds rf WHERE rf.subscription_id=s.id AND rf.status='valid'),0)) paid`;
  function portal(c, what, m, q, id) {
    if (m !== 'GET') throw new HttpErr(405, 'طريقة غير مدعومة');
    if (!['student', 'parent'].includes(c.user.role)) throw forbid();
    if (what === 'children') return { s: 200, j: c.user.role === 'student' ? (myStudent(c) ? [myStudent(c)] : []) : kids(c, c.user.id).map(({ id, name, grade }) => ({ id, name, grade })) };
    if (what === 'receipts') {
      const p = one(`SELECT p.id,p.receipt_no,p.paid_at,p.amount,p.method,p.status,p.cancel_reason,p.student_id,p.note, st.name student_name, g.name group_name, s.period, br.name branch_name, ten.name tenant_name,
        ROUND(s.amount-s.discount,2) sub_net FROM payments p JOIN students st ON st.id=p.student_id JOIN subscriptions s ON s.id=p.subscription_id JOIN groups g ON g.id=s.group_id
        JOIN tenants ten ON ten.id=p.tenant_id LEFT JOIN branches br ON br.id=p.branch_id WHERE p.id=:i AND p.tenant_id=:t`, { i: id, t: c.t });
      if (!p || !canSee(c, p.student_id)) throw nf(); return { s: 200, j: p };
    }
    const sid = scope(c, q), P = { s: sid, t: c.t };
    if (what === 'schedule') {
      const weekly = all(`SELECT g.id group_id, g.name group_name, g.subject, te.name teacher_name, sc.weekday, sc.start_time, sc.end_time, r.name room_name
        FROM group_students gs JOIN groups g ON g.id=gs.group_id JOIN teachers te ON te.id=g.teacher_id JOIN schedules sc ON sc.group_id=g.id AND sc.deleted_at IS NULL LEFT JOIN rooms r ON r.id=sc.room_id
        WHERE gs.student_id=:s AND gs.tenant_id=:t AND gs.deleted_at IS NULL AND g.deleted_at IS NULL ORDER BY sc.weekday, sc.start_time`, P);
      const to = new Date(today() + 'T12:00:00Z'); to.setUTCDate(to.getUTCDate() + 14);
      const upcoming = all(`SELECT se.id, se.session_date, se.start_time, se.end_time, se.status, g.name group_name, r.name room_name FROM sessions se JOIN groups g ON g.id=se.group_id
        LEFT JOIN rooms r ON r.id=se.room_id WHERE se.tenant_id=:t AND se.deleted_at IS NULL AND se.session_date BETWEEN :f AND :to
        AND se.group_id IN (SELECT group_id FROM group_students WHERE student_id=:s AND tenant_id=:t AND deleted_at IS NULL) ORDER BY se.session_date, se.start_time`, { ...P, f: today(), to: to.toISOString().slice(0, 10) });
      return { s: 200, j: { weekly, upcoming } };
    }
    if (what === 'attendance') {
      const d = new Date(today() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 90);
      const from = q.get('from') || d.toISOString().slice(0, 10), to = q.get('to') || today();
      if (!DATE.test(from) || !DATE.test(to)) throw bad('صيغة التاريخ YYYY-MM-DD');
      const rows = all(`SELECT se.session_date, se.start_time, g.name group_name, a.status, a.note FROM attendance a JOIN sessions se ON se.id=a.session_id JOIN groups g ON g.id=se.group_id
        WHERE a.student_id=:s AND a.tenant_id=:t AND a.deleted_at IS NULL AND se.session_date BETWEEN :f AND :to ORDER BY se.session_date DESC, se.start_time DESC`, { ...P, f: from, to });
      const summary = { present: 0, absent: 0, late: 0, excused: 0 }; rows.forEach(r => summary[r.status]++);
      return { s: 200, j: { summary, rows } };
    }
    if (what === 'subscriptions') return { s: 200, j: all(`SELECT ${SUBSEL} FROM subscriptions s JOIN groups g ON g.id=s.group_id WHERE s.student_id=:s AND s.tenant_id=:t AND s.deleted_at IS NULL ORDER BY s.period DESC, s.id DESC`, P)
      .map(r => ({ ...r, paid: r2(r.paid), remaining: r2(r.net - r.paid) })) };
    if (what === 'payments') return { s: 200, j: all(`SELECT p.id, p.receipt_no, p.paid_at, p.amount, p.method, p.status, g.name group_name, s.period FROM payments p JOIN subscriptions s ON s.id=p.subscription_id JOIN groups g ON g.id=s.group_id
      WHERE p.student_id=:s AND p.tenant_id=:t ORDER BY p.receipt_no DESC LIMIT 500`, P) };
    throw nf();
  }

  // ---------- الإشعارات ----------
  const enabled = (uid, type) => { const r = one('SELECT enabled FROM notification_prefs WHERE user_id=:u AND type=:ty', { u: uid, ty: type }); return !r || r.enabled === 1; };
  function recipients(c, studentId) {
    const out = [], st = one('SELECT user_id FROM students WHERE id=:i AND tenant_id=:t', { i: studentId, t: c.t });
    if (st && st.user_id && one(`SELECT id FROM users WHERE id=:i AND active=1 AND deleted_at IS NULL AND tenant_id=:t`, { i: st.user_id, t: c.t })) out.push({ id: st.user_id, parent: false });
    for (const p of all(`SELECT ps.parent_id id FROM parent_students ps JOIN users u ON u.id=ps.parent_id WHERE ps.student_id=:s AND ps.tenant_id=:t AND ps.deleted_at IS NULL AND u.active=1 AND u.deleted_at IS NULL`, { s: studentId, t: c.t })) out.push({ id: p.id, parent: true });
    return out;
  }
  function notify(c, studentId, n) {
    const st = one('SELECT name FROM students WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: studentId, t: c.t }); if (!st) return 0; let count = 0;
    for (const r of recipients(c, studentId)) {
      if (!enabled(r.id, n.type)) continue;
      if (n.dedupe && one('SELECT id FROM notifications WHERE user_id=:u AND student_id=:s AND type=:ty AND ref_type=:rt AND ref_id=:ri', { u: r.id, s: studentId, ty: n.type, rt: n.ref_type, ri: n.ref_id })) continue;
      db.prepare('INSERT INTO notifications(tenant_id,user_id,student_id,type,title,body,ref_type,ref_id) VALUES (:t,:u,:s,:ty,:ti,:b,:rt,:ri)')
        .run({ t: c.t, u: r.id, s: studentId, ty: n.type, ti: n.title, b: n.body(r.parent, st.name), rt: n.ref_type, ri: n.ref_id }); count++;
    }
    return count;
  }
  const fmtS = se => `${se.session_date} الساعة ${se.start_time}`;
  function notifyAttendance(c, session, changed) { // FR-052: إشعار الغياب + التأخير
    const g = one('SELECT name FROM groups WHERE id=:i', { i: session.group_id });
    for (const r of changed) {
      if (r.status === 'absent') notify(c, r.student_id, { type: 'absence', title: 'غياب عن حصة', ref_type: 'session', ref_id: session.id, dedupe: true,
        body: (p, name) => p ? `تغيّب ${name} عن حصة ${g.name} بتاريخ ${fmtS(session)}` : `تم تسجيلك غائباً عن حصة ${g.name} بتاريخ ${fmtS(session)}` });
      else if (r.status === 'late') notify(c, r.student_id, { type: 'late', title: 'تأخر عن حصة', ref_type: 'session', ref_id: session.id, dedupe: true,
        body: (p, name) => p ? `تأخر ${name} عن حصة ${g.name} بتاريخ ${fmtS(session)}` : `تم تسجيلك متأخراً عن حصة ${g.name} بتاريخ ${fmtS(session)}` });
    }
  }
  function notifySessionChange(c, before, after) {
    if (!before || !after) return;
    const g = one('SELECT name FROM groups WHERE id=:i', { i: after.group_id });
    let title, text;
    if (after.status === 'cancelled' && before.status !== 'cancelled') { title = 'إلغاء حصة'; text = `تم إلغاء حصة ${g.name} المقررة ${fmtS(before)}`; }
    else if (after.status !== 'cancelled' && ['session_date', 'start_time', 'end_time', 'room_id'].some(k => before[k] !== after[k])) {
      const room = after.room_id ? (one('SELECT name FROM rooms WHERE id=:i', { i: after.room_id }) || {}).name : null;
      title = 'تعديل موعد حصة'; text = `تم تعديل حصة ${g.name} من ${fmtS(before)} إلى ${after.session_date} من ${after.start_time} إلى ${after.end_time}${room ? ' — ' + room : ''}`;
    } else return;
    for (const s of all('SELECT student_id FROM group_students WHERE group_id=:g AND tenant_id=:t AND deleted_at IS NULL', { g: after.group_id, t: c.t }))
      notify(c, s.student_id, { type: 'change', title, ref_type: 'session', ref_id: after.id, body: (p, name) => p ? `${text} (الطالب ${name})` : text });
  }
  function notifications(c, what, m, id, body, q) {
    const parentFilter = c.user.role === 'parent' ? ` AND (n.student_id IS NULL OR EXISTS (SELECT 1 FROM parent_students ps WHERE ps.parent_id=n.user_id AND ps.student_id=n.student_id AND ps.deleted_at IS NULL))` : '';
    const base = `n.user_id=:u AND n.tenant_id=:t${parentFilter}`, P = { u: c.user.id, t: c.t };
    if (what === 'notification-prefs') {
      if (m === 'GET') { const o = {}; TYPES.forEach(t => o[t] = enabled(c.user.id, t)); return { s: 200, j: o }; }
      if (m === 'PUT') {
        for (const t of TYPES) if (t in body) db.prepare('INSERT INTO notification_prefs(tenant_id,user_id,type,enabled) VALUES (:t,:u,:ty,:e) ON CONFLICT(user_id,type) DO UPDATE SET enabled=:e')
          .run({ t: c.t, u: c.user.id, ty: t, e: body[t] ? 1 : 0 });
        const o = {}; TYPES.forEach(t => o[t] = enabled(c.user.id, t)); return { s: 200, j: o };
      }
      throw new HttpErr(405, 'طريقة غير مدعومة');
    }
    if (m === 'GET' && !id && what === 'notifications' && q.get('count')) return { s: 200, j: { unread: one(`SELECT COUNT(*) n FROM notifications n WHERE ${base} AND n.read_at IS NULL`, P).n } };
    if (m === 'GET' && !id) return { s: 200, j: all(`SELECT n.id,n.type,n.title,n.body,n.student_id,n.read_at,n.created_at,st.name student_name FROM notifications n LEFT JOIN students st ON st.id=n.student_id
      WHERE ${base}${q.get('unread') ? ' AND n.read_at IS NULL' : ''} ORDER BY n.id DESC LIMIT ${Math.min(Number(q.get('limit')) || 50, 200)}`, P) };
    if (m === 'POST' && body.__all) { db.prepare(`UPDATE notifications SET read_at=datetime('now') WHERE user_id=:u AND tenant_id=:t AND read_at IS NULL`).run(P); return { s: 200, j: { ok: true } }; }
    if (m === 'POST' && id) {
      const r = db.prepare(`UPDATE notifications SET read_at=COALESCE(read_at,datetime('now')) WHERE id=:i AND user_id=:u AND tenant_id=:t`).run({ ...P, i: id });
      if (!r.changes) throw nf(); return { s: 200, j: { ok: true } };
    }
    throw new HttpErr(405, 'طريقة غير مدعومة');
  }

  function route(c, [a, b, d, e], m, body, url) {
    const id = b && /^\d+$/.test(b) ? Number(b) : null, q = url.searchParams;
    if (a === 'student-accounts') return studentAccounts(c, m, id, d, body);
    if (a === 'parents') return parents(c, m, id, d, e, body);
    if (a === 'portal') return portal(c, b, m, q, d ? Number(d) : null);
    if (a === 'notification-prefs') return notifications(c, a, m, null, body, q);
    if (a === 'notifications') {
      if (b === 'read-all' && m === 'POST') return notifications(c, a, m, null, { __all: true }, q);
      if (id && d === 'read') return notifications(c, a, 'POST', id, {}, q);
      return notifications(c, a, m, null, body, q);
    }
  }
  return { route, notifyAttendance, notifySessionChange, scope, myStudent, canSee };
};
