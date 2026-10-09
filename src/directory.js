// المرحلة الخامسة: الدليل العام، الحجز، قوائم الانتظار، الاستفسارات، التقييمات
// السطح العام (/api/public/*) بلا تسجيل دخول: قائمة بيضاء صارمة للحقول، بلا أي بيانات طلاب (BR-005)، وتحديد معدل الطلبات.
const crypto = require('crypto');
const notify = require('./notify');
module.exports = ({ db, one, all, HttpErr, bad, forbid, can, MGMT, STAFF, portal }) => {
  const PHONE = /^01\d{9}$/;
  const myBranch = c => (c.user.role === 'owner' || !c.user.branch_id) ? null : c.user.branch_id;
  const nf = () => new HttpErr(404, 'غير موجود');
  const txt = (v, label, max, req = true) => { const s = v == null ? '' : String(v).trim(); if (req && !s) throw bad(`${label} مطلوب`); if (s.length > max) throw bad(`${label} طويل جداً`); return s || null; };
  const like = v => '%' + String(v).replace(/[%_\\]/g, '').trim() + '%';
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  // ---------- تحديد المعدل (في الذاكرة) ----------
  const hits = new Map();
  function limit(ip, key, max, winMs) {
    const k = key + '|' + ip, n = Date.now(), h = (hits.get(k) || []).filter(t => n - t < winMs);
    if (h.length >= max) throw new HttpErr(429, 'طلبات كثيرة، حاول لاحقاً');
    h.push(n); hits.set(k, h);
    if (hits.size > 5000) for (const [kk, v] of hits) if (n - v[v.length - 1] > 36e5) hits.delete(kk);
  }

  // ---------- المقاعد وقوائم الانتظار ----------
  const enrolledN = gid => one('SELECT COUNT(*) n FROM group_students WHERE group_id=:g AND deleted_at IS NULL', { g: gid }).n;
  const pendingN = (gid, except = 0) => one(`SELECT COUNT(*) n FROM bookings WHERE group_id=:g AND status='pending' AND deleted_at IS NULL AND id<>:x`, { g: gid, x: except }).n;
  const waitN = gid => one(`SELECT COUNT(*) n FROM bookings WHERE group_id=:g AND status='waitlist' AND deleted_at IS NULL`, { g: gid }).n;
  const freeSeats = (g, except = 0) => g.capacity - enrolledN(g.id) - pendingN(g.id, except);
  const position = b => b.status === 'waitlist' ? one(`SELECT COUNT(*) n FROM bookings WHERE group_id=:g AND status='waitlist' AND deleted_at IS NULL AND id<=:i`, { g: b.group_id, i: b.id }).n : null;
  function promote(tid, gid) { // عند تحرر مقعد: أول طلب بالانتظار يصبح «معلّق» (مقعد محجوز له)
    const g = one('SELECT * FROM groups WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: gid, t: tid }); if (!g) return 0;
    let n = 0;
    while (freeSeats(g) > 0) {
      const w = one(`SELECT id, phone, code FROM bookings WHERE group_id=:g AND status='waitlist' AND deleted_at IS NULL ORDER BY id LIMIT 1`, { g: gid }); if (!w) break;
      db.prepare(`UPDATE bookings SET status='pending', promoted_at=datetime('now'), updated_at=datetime('now') WHERE id=:i`).run({ i: w.id }); n++;
      notify.notify('sms', w.phone, `تحرر مقعد لطلبك (${w.code}). يرجى التواصل مع السنتر لتأكيد الحجز.`);
    }
    return n;
  }
  const seatFreed = (c, gid) => promote(c.t, gid);

  function createBooking(tid, g, d, source) {
    const name = txt(d.name, 'الاسم', 100), phone = String(d.phone || '').trim();
    if (!PHONE.test(phone)) throw bad('رقم الهاتف يجب أن يكون رقماً مصرياً من 11 رقماً');
    const parent_phone = d.parent_phone ? String(d.parent_phone).trim() : null; if (parent_phone && !PHONE.test(parent_phone)) throw bad('هاتف ولي الأمر غير صالح');
    const row = { parent_name: txt(d.parent_name, 'اسم ولي الأمر', 100, false), grade: txt(d.grade, 'الصف', 50, false), note: txt(d.note, 'الملاحظة', 300, false) };
    return tx(() => {
      if (one(`SELECT id FROM bookings WHERE group_id=:g AND phone=:p AND status IN ('pending','waitlist') AND deleted_at IS NULL`, { g: g.id, p: phone })) throw bad('لديك طلب حجز قائم لهذه المجموعة');
      if (one(`SELECT s.id FROM students s JOIN group_students gs ON gs.student_id=s.id AND gs.group_id=:g AND gs.deleted_at IS NULL WHERE s.tenant_id=:t AND s.phone=:p AND s.deleted_at IS NULL`, { g: g.id, t: tid, p: phone })) throw bad('الطالب مسجل بالفعل في هذه المجموعة');
      const status = freeSeats(g) > 0 ? 'pending' : 'waitlist', code = crypto.randomBytes(8).toString('hex');
      const r = db.prepare('INSERT INTO bookings(tenant_id,code,group_id,name,phone,parent_name,parent_phone,grade,note,source,status) VALUES (:t,:c,:g,:n,:p,:pn,:pp,:gr,:no,:s,:st)')
        .run({ t: tid, c: code, g: g.id, n: name, p: phone, pn: row.parent_name, pp: parent_phone, gr: row.grade, no: row.note, s: source, st: status });
      return one('SELECT * FROM bookings WHERE id=:i', { i: r.lastInsertRowid });
    });
  }

  // ---------- مسارات الموظفين ----------
  const BSEL = `b.*, g.name group_name, g.capacity, g.branch_id`;
  function bookingRow(c, id) {
    const b = one(`SELECT ${BSEL} FROM bookings b JOIN groups g ON g.id=b.group_id WHERE b.id=:i AND b.tenant_id=:t AND b.deleted_at IS NULL`, { i: id, t: c.t });
    const mb = myBranch(c); if (!b || (mb && b.branch_id !== mb)) throw nf(); return b;
  }
  function confirm(c, id) {
    const b = bookingRow(c, id); if (!['pending', 'waitlist'].includes(b.status)) throw bad('الطلب ليس قيد المعالجة');
    const g = one('SELECT * FROM groups WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: b.group_id, t: c.t });
    return tx(() => {
      if (b.status === 'waitlist') {
        const first = one(`SELECT id FROM bookings WHERE group_id=:g AND status='waitlist' AND deleted_at IS NULL ORDER BY id LIMIT 1`, { g: g.id });
        if (first.id !== b.id) throw bad('الطلب في قائمة الانتظار وليس الأول بالدور');
        if (freeSeats(g, b.id) <= 0) throw bad('لا توجد مقاعد متاحة');
      } else if (enrolledN(g.id) >= g.capacity) throw bad('المجموعة مكتملة العدد');
      let st = one('SELECT * FROM students WHERE tenant_id=:t AND phone=:p AND deleted_at IS NULL', { t: c.t, p: b.phone });
      const mb = myBranch(c);
      if (st) { if (!st.active) throw bad('حساب الطالب غير نشط'); if (mb && st.branch_id !== mb) throw bad('الطالب مسجل في فرع آخر'); }
      else {
        const r = db.prepare('INSERT INTO students(tenant_id,name,phone,parent_name,parent_phone,grade,branch_id) VALUES (:t,:n,:p,:pn,:pp,:gr,:b)')
          .run({ t: c.t, n: b.name, p: b.phone, pn: b.parent_name, pp: b.parent_phone, gr: b.grade, b: g.branch_id });
        st = { id: r.lastInsertRowid };
      }
      if (!one('SELECT id FROM group_students WHERE group_id=:g AND student_id=:s AND deleted_at IS NULL', { g: g.id, s: st.id }))
        db.prepare('INSERT INTO group_students(tenant_id,group_id,student_id) VALUES (:t,:g,:s)').run({ t: c.t, g: g.id, s: st.id });
      db.prepare(`UPDATE bookings SET status='confirmed', student_id=:s, decided_by=:u, updated_at=datetime('now') WHERE id=:i`).run({ s: st.id, u: c.user.id, i: b.id });
      notify.notify('sms', b.phone, `تم تأكيد حجزك (${b.code}). مرحباً بك في السنتر.`);
      return bookingRow(c, id);
    });
  }
  function bookings(c, m, id, act, body, q) {
    can(c, STAFF);
    if (m === 'GET' && !id) {
      let w = 'b.tenant_id=:t AND b.deleted_at IS NULL AND (:mb IS NULL OR g.branch_id=:mb)'; const p = { t: c.t, mb: myBranch(c) };
      for (const f of ['status', 'group_id']) if (q.get(f)) { w += ` AND b.${f}=:${f}`; p[f] = q.get(f); }
      return { s: 200, j: all(`SELECT ${BSEL} FROM bookings b JOIN groups g ON g.id=b.group_id WHERE ${w} ORDER BY b.id DESC LIMIT 1000`, p).map(b => ({ ...b, position: position(b) })) };
    }
    if (m === 'POST' && !id) {
      const g = one('SELECT * FROM groups WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL AND active=1', { i: Number(body.group_id), t: c.t }); if (!g) throw bad('المجموعة غير موجودة');
      const mb = myBranch(c); if (mb && g.branch_id !== mb) throw forbid();
      const b = createBooking(c.t, g, body, 'staff'); return { s: 201, j: { ...bookingRow(c, b.id), position: position(b) } };
    }
    if (m === 'GET') return { s: 200, j: { ...bookingRow(c, id), position: position(bookingRow(c, id)) } };
    if (m === 'POST' && act === 'confirm') return { s: 200, j: confirm(c, id) };
    if (m === 'POST' && act === 'reject') {
      const b = bookingRow(c, id); if (!['pending', 'waitlist'].includes(b.status)) throw bad('الطلب ليس قيد المعالجة');
      db.prepare(`UPDATE bookings SET status='rejected', reject_reason=:r, decided_by=:u, updated_at=datetime('now') WHERE id=:i`).run({ r: txt(body.reason, 'السبب', 200, false), u: c.user.id, i: id });
      notify.notify('sms', b.phone, `تعذّر قبول طلب الحجز (${b.code}). للاستفسار تواصل مع السنتر.`);
      promote(c.t, b.group_id); return { s: 200, j: bookingRow(c, id) };
    }
    throw new HttpErr(405, 'طريقة غير مدعومة');
  }
  function seats(c) {
    can(c, STAFF);
    return { s: 200, j: all(`SELECT g.id, g.name, g.capacity, g.bookable, g.price FROM groups g WHERE g.tenant_id=:t AND g.deleted_at IS NULL AND g.active=1 AND (:mb IS NULL OR g.branch_id=:mb) ORDER BY g.name`, { t: c.t, mb: myBranch(c) })
      .map(g => ({ ...g, enrolled: enrolledN(g.id), pending: pendingN(g.id), waitlist: waitN(g.id), free: Math.max(0, g.capacity - enrolledN(g.id) - pendingN(g.id)) })) };
  }
  function inquiries(c, m, id, act, body, q) {
    can(c, STAFF);
    if (m === 'GET') { let w = 'i.tenant_id=:t AND i.deleted_at IS NULL'; const p = { t: c.t }; if (q.get('status')) { w += ' AND i.status=:s'; p.s = q.get('status'); }
      return { s: 200, j: all(`SELECT i.*, t.name teacher_name FROM inquiries i LEFT JOIN teachers t ON t.id=i.teacher_id WHERE ${w} ORDER BY i.id DESC LIMIT 1000`, p) }; }
    if (m === 'POST' && act === 'handle') {
      const r = db.prepare(`UPDATE inquiries SET status='handled', handled_by=:u, handled_note=:n, updated_at=datetime('now') WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL`).run({ u: c.user.id, n: txt(body.note, 'الملاحظة', 300, false), i: id, t: c.t });
      if (!r.changes) throw nf(); return { s: 200, j: one('SELECT * FROM inquiries WHERE id=:i', { i: id }) };
    }
    throw new HttpErr(405, 'طريقة غير مدعومة');
  }

  // ---------- التقييمات: طالب/ولي أمر مسجّل فعلياً، تُنشر بعد مراجعة الإدارة، وتظهر مجهولة الهوية ----------
  function reviews(c, m, id, act, body, q) {
    const role = c.user.role;
    if (m === 'GET' && q.get('options') && ['student', 'parent'].includes(role)) { // الأبناء والمدرسون المتاح تقييمهم
      const kids = role === 'student' ? [portal.myStudent(c)].filter(Boolean) : all('SELECT st.id, st.name FROM parent_students ps JOIN students st ON st.id=ps.student_id WHERE ps.parent_id=:u AND ps.tenant_id=:t AND ps.deleted_at IS NULL AND st.deleted_at IS NULL', { u: c.user.id, t: c.t });
      return { s: 200, j: { students: kids.map(k => ({ id: k.id, name: k.name })), teachers: kids.flatMap(k => all(`SELECT DISTINCT te.id, te.name FROM group_students gs JOIN groups g ON g.id=gs.group_id JOIN teachers te ON te.id=g.teacher_id WHERE gs.student_id=:s AND gs.tenant_id=:t AND gs.deleted_at IS NULL AND g.deleted_at IS NULL`, { s: k.id, t: c.t }).map(x => ({ ...x, student_id: k.id }))) } };
    }
    if (m === 'GET') {
      if (['student', 'parent'].includes(role)) return { s: 200, j: all(`SELECT r.id,r.target,r.teacher_id,r.rating,r.comment,r.status,r.created_at,t.name teacher_name FROM reviews r LEFT JOIN teachers t ON t.id=r.teacher_id WHERE r.tenant_id=:t AND r.author_id=:u AND r.deleted_at IS NULL ORDER BY r.id DESC`, { t: c.t, u: c.user.id }) };
      can(c, MGMT); let w = 'r.tenant_id=:t AND r.deleted_at IS NULL'; const p = { t: c.t }; if (q.get('status')) { w += ' AND r.status=:s'; p.s = q.get('status'); }
      return { s: 200, j: all(`SELECT r.id,r.target,r.teacher_id,r.rating,r.comment,r.status,r.created_at,t.name teacher_name, st.name student_name FROM reviews r JOIN students st ON st.id=r.student_id LEFT JOIN teachers t ON t.id=r.teacher_id WHERE ${w} ORDER BY r.id DESC LIMIT 1000`, p) };
    }
    if (m === 'POST' && !id) {
      if (!['student', 'parent'].includes(role)) throw forbid();
      let sid;
      if (role === 'student') { const s = portal.myStudent(c); if (!s) throw forbid(); sid = s.id; }
      else { sid = Number(body.student_id); if (!one('SELECT 1 x FROM parent_students WHERE parent_id=:u AND student_id=:s AND tenant_id=:t AND deleted_at IS NULL', { u: c.user.id, s: sid, t: c.t })) throw forbid(); }
      const target = body.target; if (!['center', 'teacher'].includes(target)) throw bad('نوع التقييم غير صالح');
      const rating = Number(body.rating); if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw bad('التقييم من 1 إلى 5');
      const comment = txt(body.comment, 'التعليق', 500, false);
      let tid = null;
      if (target === 'teacher') {
        tid = Number(body.teacher_id);
        if (!one(`SELECT 1 x FROM group_students gs JOIN groups g ON g.id=gs.group_id WHERE gs.student_id=:s AND gs.tenant_id=:t AND gs.deleted_at IS NULL AND g.teacher_id=:tid AND g.deleted_at IS NULL`, { s: sid, t: c.t, tid })) throw bad('لا يمكن تقييم مدرس لم يدرّس هذا الطالب');
      } else if (!one('SELECT 1 x FROM group_students WHERE student_id=:s AND tenant_id=:t AND deleted_at IS NULL', { s: sid, t: c.t })) throw bad('التقييم متاح للطلاب المسجلين فقط');
      if (one('SELECT 1 x FROM reviews WHERE tenant_id=:t AND student_id=:s AND target=:g AND COALESCE(teacher_id,0)=:x AND deleted_at IS NULL', { t: c.t, s: sid, g: target, x: tid || 0 })) throw bad('قيّمت هذا مسبقاً');
      const r = db.prepare('INSERT INTO reviews(tenant_id,student_id,author_id,target,teacher_id,rating,comment) VALUES (:t,:s,:u,:g,:x,:r,:c)').run({ t: c.t, s: sid, u: c.user.id, g: target, x: tid, r: rating, c: comment });
      return { s: 201, j: one('SELECT id,target,teacher_id,rating,comment,status FROM reviews WHERE id=:i', { i: r.lastInsertRowid }) };
    }
    if (m === 'POST' && ['publish', 'hide'].includes(act)) {
      can(c, MGMT);
      const r = db.prepare(`UPDATE reviews SET status=:s, moderated_by=:u, updated_at=datetime('now') WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL`).run({ s: act === 'publish' ? 'published' : 'hidden', u: c.user.id, i: id, t: c.t });
      if (!r.changes) throw nf(); return { s: 200, j: one('SELECT id,status FROM reviews WHERE id=:i', { i: id }) };
    }
    throw new HttpErr(405, 'طريقة غير مدعومة');
  }

  function settings(c, m, body) {
    can(c, MGMT);
    if (m === 'GET') return { s: 200, j: one('SELECT id,name,listed,area,city,description,contact_phone FROM tenants WHERE id=:t', { t: c.t }) };
    if (m !== 'PUT') throw new HttpErr(405, 'طريقة غير مدعومة'); can(c, ['owner']);
    const cur = one('SELECT * FROM tenants WHERE id=:t', { t: c.t });
    const d = { listed: 'listed' in body ? (body.listed ? 1 : 0) : cur.listed, area: 'area' in body ? txt(body.area, 'المنطقة', 60, false) : cur.area, city: 'city' in body ? txt(body.city, 'المدينة', 60, false) : cur.city,
      description: 'description' in body ? txt(body.description, 'الوصف', 1000, false) : cur.description, contact_phone: 'contact_phone' in body ? txt(body.contact_phone, 'هاتف التواصل', 20, false) : cur.contact_phone };
    if (d.contact_phone && !/^[0-9+\- ]{6,20}$/.test(d.contact_phone)) throw bad('هاتف التواصل غير صالح');
    if (d.listed && !d.area) throw bad('حدد المنطقة قبل الظهور في الدليل');
    db.prepare('UPDATE tenants SET listed=:listed, area=:area, city=:city, description=:description, contact_phone=:contact_phone WHERE id=:t').run({ ...d, t: c.t });
    return { s: 200, j: one('SELECT id,name,listed,area,city,description,contact_phone FROM tenants WHERE id=:t', { t: c.t }) };
  }

  function route(c, [a, b, d], m, body, url) {
    const id = b && /^\d+$/.test(b) ? Number(b) : null, q = url.searchParams;
    if (a === 'bookings') return bookings(c, m, id, d, body, q);
    if (a === 'seats' && m === 'GET') return seats(c);
    if (a === 'inquiries') return inquiries(c, m, id, d, body, q);
    if (a === 'reviews') return reviews(c, m, id, d, body, q);
    if (a === 'directory-settings') return settings(c, m, body);
  }

  // ---------- السطح العام: قائمة بيضاء صارمة، لا بيانات طلاب إطلاقاً ----------
  const RATE_T = `(SELECT ROUND(AVG(rating),1) FROM reviews r WHERE r.tenant_id=t.id AND r.target='center' AND r.status='published' AND r.deleted_at IS NULL) rating_avg,
    (SELECT COUNT(*) FROM reviews r WHERE r.tenant_id=t.id AND r.target='center' AND r.status='published' AND r.deleted_at IS NULL) rating_count`;
  const RATE_TE = `(SELECT ROUND(AVG(rating),1) FROM reviews r WHERE r.teacher_id=te.id AND r.target='teacher' AND r.status='published' AND r.deleted_at IS NULL) rating_avg,
    (SELECT COUNT(*) FROM reviews r WHERE r.teacher_id=te.id AND r.target='teacher' AND r.status='published' AND r.deleted_at IS NULL) rating_count`;
  const pubReviews = (w, p) => all(`SELECT rating, comment, substr(created_at,1,10) date FROM reviews WHERE ${w} AND status='published' AND deleted_at IS NULL ORDER BY id DESC LIMIT 20`, p);
  const listedCenter = id => one('SELECT id,name,area,city,description,contact_phone FROM tenants WHERE id=:i AND listed=1', { i: id });
  function publicGroups(tid, teacherId = null) {
    return all(`SELECT g.id, g.name, g.subject, g.grade, g.capacity, g.price, CASE WHEN te.listed=1 THEN te.name END teacher_name FROM groups g JOIN teachers te ON te.id=g.teacher_id
      WHERE g.tenant_id=:t AND g.deleted_at IS NULL AND g.active=1 AND g.bookable=1 AND (:te IS NULL OR g.teacher_id=:te) ORDER BY g.name`, { t: tid, te: teacherId }).map(g => {
      const { capacity, ...o } = g;
      return { ...o, seats_free: Math.max(0, capacity - enrolledN(g.id) - pendingN(g.id)), schedule: all('SELECT weekday,start_time,end_time FROM schedules WHERE group_id=:g AND deleted_at IS NULL ORDER BY weekday,start_time', { g: g.id }) };
    });
  }
  function publicRoute([a, b, d], m, body, url, ip) {
    const q = url.searchParams;
    if (m === 'GET') limit(ip, 'r', 60, 6e4);
    if (m === 'GET' && a === 'centers' && !b) {
      let w = 't.listed=1'; const p = {};
      if (q.get('q')) { w += ' AND t.name LIKE :q'; p.q = like(q.get('q')); }
      if (q.get('area')) { w += ' AND (t.area LIKE :ar OR t.city LIKE :ar)'; p.ar = like(q.get('area')); }
      if (q.get('grade')) { w += ` AND EXISTS(SELECT 1 FROM groups g WHERE g.tenant_id=t.id AND g.deleted_at IS NULL AND g.active=1 AND g.bookable=1 AND g.grade LIKE :gr)`; p.gr = like(q.get('grade')); }
      if (q.get('subject')) { w += ` AND (EXISTS(SELECT 1 FROM groups g WHERE g.tenant_id=t.id AND g.deleted_at IS NULL AND g.active=1 AND g.bookable=1 AND g.subject LIKE :sb)
        OR EXISTS(SELECT 1 FROM teachers te WHERE te.tenant_id=t.id AND te.deleted_at IS NULL AND te.active=1 AND te.listed=1 AND te.subject LIKE :sb))`; p.sb = like(q.get('subject')); }
      return { s: 200, j: all(`SELECT t.id,t.name,t.area,t.city,t.description,${RATE_T} FROM tenants t WHERE ${w} ORDER BY t.name LIMIT 50`, p) };
    }
    if (m === 'GET' && a === 'centers' && /^\d+$/.test(b)) {
      const t = listedCenter(Number(b)); if (!t) throw nf();
      return { s: 200, j: {
        ...t, ...one(`SELECT ${RATE_T} FROM tenants t WHERE t.id=:i`, { i: t.id }),
        branches: all('SELECT name,address,phone FROM branches WHERE tenant_id=:t AND deleted_at IS NULL ORDER BY name', { t: t.id }),
        teachers: all(`SELECT te.id,te.name,te.subject,te.bio,${RATE_TE} FROM teachers te WHERE te.tenant_id=:t AND te.deleted_at IS NULL AND te.active=1 AND te.listed=1 ORDER BY te.name`, { t: t.id }),
        groups: publicGroups(t.id), reviews: pubReviews('tenant_id=:t AND target=:g', { t: t.id, g: 'center' }) } };
    }
    if (m === 'GET' && a === 'teachers' && !b) {
      let w = 'te.deleted_at IS NULL AND te.active=1 AND te.listed=1 AND t.listed=1'; const p = {};
      if (q.get('q')) { w += ' AND te.name LIKE :q'; p.q = like(q.get('q')); }
      if (q.get('subject')) { w += ' AND te.subject LIKE :sb'; p.sb = like(q.get('subject')); }
      if (q.get('area')) { w += ' AND (t.area LIKE :ar OR t.city LIKE :ar)'; p.ar = like(q.get('area')); }
      return { s: 200, j: all(`SELECT te.id,te.name,te.subject,te.bio,t.id center_id,t.name center_name,t.area,${RATE_TE} FROM teachers te JOIN tenants t ON t.id=te.tenant_id WHERE ${w} ORDER BY te.name LIMIT 50`, p) };
    }
    if (m === 'GET' && a === 'teachers' && /^\d+$/.test(b)) {
      const te = one(`SELECT te.id,te.name,te.subject,te.bio,te.tenant_id,${RATE_TE} FROM teachers te JOIN tenants t ON t.id=te.tenant_id WHERE te.id=:i AND te.deleted_at IS NULL AND te.active=1 AND te.listed=1 AND t.listed=1`, { i: Number(b) });
      if (!te) throw nf(); const { tenant_id, ...o } = te;
      return { s: 200, j: { ...o, center: listedCenter(tenant_id), groups: publicGroups(tenant_id, te.id),
        reviews: pubReviews('teacher_id=:i AND target=:g', { i: te.id, g: 'teacher' }) } };
    }
    if (m === 'GET' && a === 'bookings' && b) { // متابعة حالة الطلب بالكود فقط (بدون أي بيانات شخصية)
      const r = one(`SELECT b.id,b.group_id,b.status,g.name group_name,t.name center_name FROM bookings b JOIN groups g ON g.id=b.group_id JOIN tenants t ON t.id=b.tenant_id WHERE b.code=:c AND b.deleted_at IS NULL`, { c: String(b) });
      if (!r) throw nf(); return { s: 200, j: { status: r.status, group_name: r.group_name, center_name: r.center_name, waitlist_position: position(r) } };
    }
    if (m === 'POST' && a === 'bookings' && !b) {
      limit(ip, 'bk', 20, 6e5); if (body.website) throw bad('طلب غير صالح'); // honeypot ضد الروبوتات
      const g = one(`SELECT g.* FROM groups g JOIN tenants t ON t.id=g.tenant_id WHERE g.id=:i AND g.deleted_at IS NULL AND g.active=1 AND g.bookable=1 AND t.listed=1`, { i: Number(body.group_id) });
      if (!g) throw bad('المجموعة غير متاحة للحجز');
      const r = createBooking(g.tenant_id, g, body, 'public');
      return { s: 201, j: { code: r.code, status: r.status, waitlist_position: position(r) } };
    }
    if (m === 'POST' && a === 'bookings' && b && d === 'cancel') {
      limit(ip, 'bc', 10, 6e5);
      const r = one(`SELECT * FROM bookings WHERE code=:c AND deleted_at IS NULL`, { c: String(b) }); if (!r) throw nf();
      if (!['pending', 'waitlist'].includes(r.status)) throw bad('لا يمكن إلغاء هذا الطلب');
      db.prepare(`UPDATE bookings SET status='cancelled', updated_at=datetime('now') WHERE id=:i`).run({ i: r.id }); promote(r.tenant_id, r.group_id);
      return { s: 200, j: { status: 'cancelled' } };
    }
    if (m === 'POST' && a === 'inquiries' && !b) {
      limit(ip, 'iq', 10, 6e5); if (body.website) throw bad('طلب غير صالح');
      const t = listedCenter(Number(body.center_id)); if (!t) throw bad('السنتر غير متاح');
      const phone = String(body.phone || '').trim(); if (!PHONE.test(phone)) throw bad('رقم الهاتف يجب أن يكون رقماً مصرياً من 11 رقماً');
      let tid = null; if (body.teacher_id) { tid = Number(body.teacher_id); if (!one('SELECT 1 x FROM teachers WHERE id=:i AND tenant_id=:t AND listed=1 AND active=1 AND deleted_at IS NULL', { i: tid, t: t.id })) throw bad('المدرس غير متاح'); }
      db.prepare('INSERT INTO inquiries(tenant_id,teacher_id,name,phone,message) VALUES (:t,:te,:n,:p,:m)').run({ t: t.id, te: tid, n: txt(body.name, 'الاسم', 100), p: phone, m: txt(body.message, 'الرسالة', 500) });
      return { s: 201, j: { ok: true } };
    }
    throw nf();
  }
  return { route, publicRoute, seatFreed };
};
