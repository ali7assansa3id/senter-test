// المرحلة 6: التقارير المتقدمة ولوحات المؤشرات (FR-150–152)
// لوحة حسب الدور: مالك/مدير (مالية + حضور + امتلاء + طلبات + نمو)، مدرس (مجموعاته ونتائجه وحضوره)، موظف (مهام اليوم).
// كل الاستعلامات مقيّدة بالمستأجر (tenant_id) وبالفرع (BR-002) حيث ينطبق.
const xlsx = require('./xlsx');

// node:sqlite يرفض المفاتيح غير المستخدمة في الاستعلام: نمرّر فقط ما يذكره الاستعلام فعلاً
const keep = (sql, p) => Object.fromEntries(Object.entries(p || {}).filter(([k]) => new RegExp(':' + k + '(?![A-Za-z0-9_])').test(sql)));
module.exports = ({ db, one: rawOne, all: rawAll, HttpErr, bad, forbid, can, MGMT, STAFF, fin }) => {
  const one = (s, p) => rawOne(s, keep(s, p)), all = (s, p) => rawAll(s, keep(s, p));
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const r2 = n => Math.round(Number(n || 0) * 100) / 100;
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

  function scope(c, q) {
    const from = q.get('from') || today().slice(0, 8) + '01', to = q.get('to') || today();
    if (!DATE.test(from) || !DATE.test(to) || from > to) throw bad('نطاق التاريخ غير صالح');
    const mb = (c.user.role === 'owner' || !c.user.branch_id) ? (c.user.role === 'owner' && q.get('branch_id') ? Number(q.get('branch_id')) : null) : c.user.branch_id;
    return { t: c.t, f: from, to, b: mb };
  }

  function management(c, q) {
    can(c, MGMT);
    const s = scope(c, q), tc = q.get('teacher_id') ? Number(q.get('teacher_id')) : null;
    const P = { t: s.t, f: s.f, to: s.to, b: s.b, tc };
    const revenue = one(`SELECT COALESCE(SUM(p.amount),0) v FROM payments p WHERE p.tenant_id=:t AND p.status='valid' AND p.paid_at BETWEEN :f AND :to AND (:b IS NULL OR p.branch_id=:b)`, P).v;
    const refunds = one(`SELECT COALESCE(SUM(rf.amount),0) v FROM refunds rf WHERE rf.tenant_id=:t AND rf.refunded_at BETWEEN :f AND :to AND (:b IS NULL OR rf.branch_id=:b)`, P).v;
    const expenses = one(`SELECT COALESCE(SUM(e.amount),0) v FROM expenses e WHERE e.tenant_id=:t AND e.status='valid' AND e.expense_date BETWEEN :f AND :to AND (:b IS NULL OR e.branch_id=:b)`, P).v;
    const att = one(`SELECT SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) ok, SUM(CASE WHEN a.status='absent' THEN 1 ELSE 0 END) abs, COUNT(*) tot
      FROM attendance a JOIN sessions s ON s.id=a.session_id JOIN groups g ON g.id=s.group_id
      WHERE a.tenant_id=:t AND a.deleted_at IS NULL AND s.session_date BETWEEN :f AND :to AND (:b IS NULL OR g.branch_id=:b) AND (:tc IS NULL OR g.teacher_id=:tc)`, P);
    const groups = all(`SELECT g.id, g.name, g.capacity, t.name teacher,
        (SELECT COUNT(*) FROM group_students gs WHERE gs.group_id=g.id AND gs.deleted_at IS NULL) enrolled,
        (SELECT COUNT(*) FROM bookings bk WHERE bk.group_id=g.id AND bk.status='pending' AND bk.deleted_at IS NULL) pending,
        (SELECT COUNT(*) FROM bookings bk WHERE bk.group_id=g.id AND bk.status='waitlist' AND bk.deleted_at IS NULL) waitlist
      FROM groups g JOIN teachers t ON t.id=g.teacher_id
      WHERE g.tenant_id=:t AND g.deleted_at IS NULL AND g.active=1 AND (:b IS NULL OR g.branch_id=:b) AND (:tc IS NULL OR g.teacher_id=:tc) ORDER BY g.name LIMIT 300`, P)
      .map(g => ({ ...g, fill_pct: pct(g.enrolled, g.capacity) }));
    const growth = all(`SELECT substr(created_at,1,7) month, COUNT(*) n FROM students WHERE tenant_id=:t AND deleted_at IS NULL AND (:b IS NULL OR branch_id=:b)
      GROUP BY month ORDER BY month DESC LIMIT 12`, P).reverse();
    const bk = one(`SELECT SUM(CASE WHEN bk.status='pending' THEN 1 ELSE 0 END) pending, SUM(CASE WHEN bk.status='waitlist' THEN 1 ELSE 0 END) waitlist
      FROM bookings bk JOIN groups g ON g.id=bk.group_id WHERE bk.tenant_id=:t AND bk.deleted_at IS NULL AND (:b IS NULL OR g.branch_id=:b)`, P);
    const inquiries = one(`SELECT COUNT(*) n FROM inquiries WHERE tenant_id=:t AND deleted_at IS NULL AND status='new'`, P).n;
    // الملخص المالي الرسمي (المديون والتحصيل...) من وحدة المالية نفسها لضمان تطابق الأرقام
    const finance = fin.route(c, ['reports', 'summary'], 'GET', {}, new URL(`http://x/?from=${s.f}&to=${s.to}${s.b ? '&branch_id=' + s.b : ''}`)).j;
    return {
      kind: 'management', from: s.f, to: s.to,
      kpis: {
        revenue_net: r2(revenue - refunds), revenue: r2(revenue), refunds: r2(refunds), expenses: r2(expenses),
        attendance_rate: pct(att.ok || 0, att.tot), absences: att.abs || 0, sessions_records: att.tot || 0,
        active_groups: groups.length, avg_fill_pct: groups.length ? Math.round(groups.reduce((s2, g) => s2 + (g.fill_pct || 0), 0) / groups.length) : null,
        pending_bookings: bk.pending || 0, waitlist: bk.waitlist || 0, new_inquiries: inquiries,
      },
      groups, growth, finance_summary: finance.summary || [], finance_totals: finance.totals || {},
    };
  }

  function teacher(c, q) {
    can(c, ['teacher']);
    if (!c.tid || c.tid < 0) throw forbid();
    const s = scope(c, q), P = { t: s.t, f: s.f, to: s.to, tid: c.tid };
    const groups = all(`SELECT g.id, g.name, g.capacity,
        (SELECT COUNT(*) FROM group_students gs WHERE gs.group_id=g.id AND gs.deleted_at IS NULL) enrolled
      FROM groups g WHERE g.tenant_id=:t AND g.teacher_id=:tid AND g.deleted_at IS NULL ORDER BY g.name`, P).map(g => ({ ...g, fill_pct: pct(g.enrolled, g.capacity) }));
    const attendance = all(`SELECT g.id group_id, g.name, SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END) ok, COUNT(a.id) tot
      FROM groups g JOIN sessions s ON s.group_id=g.id AND s.deleted_at IS NULL AND s.session_date BETWEEN :f AND :to
      LEFT JOIN attendance a ON a.session_id=s.id AND a.deleted_at IS NULL
      WHERE g.tenant_id=:t AND g.teacher_id=:tid AND g.deleted_at IS NULL GROUP BY g.id ORDER BY g.name`, P)
      .map(x => ({ group_id: x.group_id, name: x.name, rate: pct(x.ok || 0, x.tot) }));
    const exams = all(`SELECT e.id, e.title, COUNT(a.id) attempts, AVG(a.total_score*100.0/NULLIF(a.max_score,0)) avg_pct
      FROM exams e JOIN groups g ON g.id=e.group_id LEFT JOIN exam_attempts a ON a.exam_id=e.id AND a.status='graded' AND a.deleted_at IS NULL
      WHERE e.tenant_id=:t AND g.teacher_id=:tid AND e.deleted_at IS NULL GROUP BY e.id ORDER BY e.id DESC LIMIT 50`, P)
      .map(x => ({ ...x, avg_pct: x.avg_pct == null ? null : Math.round(x.avg_pct) }));
    const total = arr => arr.length ? Math.round(arr.reduce((s2, x) => s2 + (x.rate || 0), 0) / arr.length) : null;
    return { kind: 'teacher', from: s.f, to: s.to, kpis: { groups: groups.length, students: groups.reduce((s2, g) => s2 + g.enrolled, 0), avg_attendance_pct: total(attendance), graded_exams: exams.filter(e => e.attempts).length }, groups, attendance, exams };
  }

  function employee(c) {
    can(c, ['employee']);
    const mb = c.user.branch_id || null, P = { t: c.t, d: today(), b: mb };
    const sessions = all(`SELECT s.id, s.start_time, s.end_time, g.name group_name, s.status FROM sessions s JOIN groups g ON g.id=s.group_id
      WHERE s.tenant_id=:t AND s.deleted_at IS NULL AND s.session_date=:d AND (:b IS NULL OR g.branch_id=:b) ORDER BY s.start_time`, P);
    const bk = one(`SELECT SUM(CASE WHEN bk.status='pending' THEN 1 ELSE 0 END) pending FROM bookings bk JOIN groups g ON g.id=bk.group_id WHERE bk.tenant_id=:t AND bk.deleted_at IS NULL AND (:b IS NULL OR g.branch_id=:b)`, P);
    const inq = one(`SELECT COUNT(*) n FROM inquiries WHERE tenant_id=:t AND deleted_at IS NULL AND status='new'`, P).n;
    return { kind: 'employee', date: P.d, kpis: { sessions_today: sessions.length, sessions_unmarked: sessions.filter(s => s.status !== 'done' && s.status !== 'cancelled').length, pending_bookings: bk.pending || 0, new_inquiries: inq }, sessions };
  }

  function route(c, [a, b], m, body, url) {
    if (a !== 'analytics' || m !== 'GET') return null;
    if (b === 'dashboard') {
      const q = url.searchParams;
      if (MGMT.includes(c.user.role)) {
        const j = management(c, q);
        if (q.get('format') === 'xlsx') return { s: 200, buf: toXlsx(j), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
        return { s: 200, j };
      }
      if (c.user.role === 'teacher') return { s: 200, j: teacher(c, q) };
      if (c.user.role === 'employee') return { s: 200, j: employee(c) };
      throw forbid();
    }
    return null;
  }
  function toXlsx(j) {
    const rows = [[{ v: 'لوحة المؤشرات', s: 'b' }], [`من ${j.from} إلى ${j.to}`], [],
      ...Object.entries(j.kpis).map(([k, v]) => [{ v: k, s: 'b' }, v == null ? '' : typeof v === 'number' ? { v, s: 'm' } : String(v)]), [],
      [{ v: 'المجموعة', s: 'b' }, { v: 'المدرس', s: 'b' }, { v: 'السعة', s: 'b' }, { v: 'المسجلون', s: 'b' }, { v: 'نسبة الامتلاء %', s: 'b' }, { v: 'معلّق', s: 'b' }, { v: 'انتظار', s: 'b' }],
      ...j.groups.map(g => [g.name, g.teacher, g.capacity, g.enrolled, g.fill_pct ?? '', g.pending, g.waitlist])];
    return xlsx.build({ name: 'dashboard', rows, widths: [30, 22, 12, 12, 16, 12, 12] });
  }
  return { route };
};
