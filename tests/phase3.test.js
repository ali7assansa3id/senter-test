process.env.DB_FILE = ':memory:'; process.env.SECRET = 'test';
const assert = require('assert'), http = require('http');
const { handle } = require('../src/server'); const { db, hashPassword } = require('../src/db');
const srv = http.createServer(handle).listen(0, async () => {
  const base = 'http://localhost:' + srv.address().port + '/api/';
  const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined }); const txt = await r.text(); return { s: r.status, j: JSON.parse(txt), raw: txt }; };
  const login = async (phone, password) => (await (await fetch(base + 'login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password }) })).json()).token;
  const ok = (n, c) => { console.log((c ? '✔ ' : '✘ ') + n); assert(c, n); };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  try {
    const O = await login('01000000000', 'admin123'), o = (m, p, b) => call(O, m, p, b);
    const tch = (await o('POST', 'teachers', { name: 'أ. أحمد', pay_type: 'percentage', pay_value: 50 })).j;
    const g = (await o('POST', 'groups', { name: 'ثالثة ثانوي', teacher_id: tch.id })).j;
    const A = (await o('POST', 'students', { name: 'علي', phone: '01500000001', parent_phone: '01600000001', notes: 'ملاحظة سرية' })).j;
    const B = (await o('POST', 'students', { name: 'منى', parent_phone: '01600000002' })).j, C = (await o('POST', 'students', { name: 'كريم' })).j;
    for (const s of [A, B, C]) await o('POST', `groups/${g.id}/students`, { student_id: s.id });
    const sess = []; for (const [st, en] of [['08:00', '09:00'], ['10:00', '11:00'], ['12:00', '13:00'], ['14:00', '15:00']]) sess.push((await o('POST', 'sessions', { group_id: g.id, session_date: today, start_time: st, end_time: en })).j);

    // ----- الحسابات -----
    ok('هاتف غير صالح يُرفض', (await o('POST', 'student-accounts', { student_id: A.id, phone: '123', password: 'secret1' })).s === 400);
    ok('إنشاء حساب طالب', (await o('POST', 'student-accounts', { student_id: A.id, phone: '01444444441', password: 'secret1' })).s === 201);
    ok('لا حسابين لنفس الطالب', (await o('POST', 'student-accounts', { student_id: A.id, phone: '01444444442', password: 'secret1' })).s === 400);
    ok('هاتف مكرر يُرفض', (await o('POST', 'student-accounts', { student_id: B.id, phone: '01444444441', password: 'secret1' })).s === 400);
    ok('إنشاء حساب طالب 2', (await o('POST', 'student-accounts', { student_id: B.id, phone: '01444444442', password: 'secret1' })).s === 201);
    const p1 = (await o('POST', 'parents', { name: 'والد علي ومنى', phone: '01777777771', password: 'secret1', relation: 'father', student_ids: [A.id, B.id] })).j;
    const p2 = (await o('POST', 'parents', { name: 'والد كريم', phone: '01777777772', password: 'secret1', student_ids: [C.id] })).j;
    ok('ولي أمر مرتبط بأكثر من طالب', p1.children.length === 2);
    ok('رفض ربط مكرر', (await o('POST', `parents/${p1.id}/students`, { student_id: A.id })).s === 400);
    const S = await login('01444444441', 'secret1'), S2 = await login('01444444442', 'secret1'), P1 = await login('01777777771', 'secret1'), P2 = await login('01777777772', 'secret1');
    ok('دخول الطالب وولي الأمر', S && P1 && P2);
    ok('الأدوار الجديدة لا تُنشأ من users العامة', (await o('POST', 'users', { name: 'x', phone: '01888888888', role: 'student', password: 'secret1' })).s === 400);

    // ----- العزل (BR-005) -----
    ok('الطالب يرى نفسه فقط', (await call(S, 'GET', 'portal/children')).j.length === 1);
    ok('ولي الأمر يرى ابنيه', (await call(P1, 'GET', 'portal/children')).j.length === 2);
    ok('الطالب لا يرى بيانات طالب آخر', (await call(S, 'GET', `portal/schedule?student_id=${B.id}`)).s === 403);
    ok('ولي الأمر لا يرى ابن غيره', (await call(P1, 'GET', `portal/attendance?student_id=${C.id}`)).s === 403 && (await call(P2, 'GET', `portal/schedule?student_id=${A.id}`)).s === 403);
    ok('ولي الأمر يحتاج student_id', (await call(P1, 'GET', 'portal/schedule')).s === 400);
    for (const p of ['students', 'groups', 'users', 'teachers', 'sessions', 'payments', 'subscriptions', 'treasuries', 'expenses', 'reports/revenue', 'teacher-dues', 'parents', 'student-accounts', `sessions/${sess[0].id}/attendance`])
      for (const [n, t] of [['طالب', S], ['ولي أمر', P1]]) if ((await call(t, 'GET', p)).s !== 403) ok(`${n} محجوب عن /${p}`, false);
    ok('الطالب والولي محجوبان عن كل شاشات الموظفين', true);
    ok('الطالب لا يسجّل حضوراً', (await call(S, 'PUT', `sessions/${sess[0].id}/attendance`, { records: [{ student_id: A.id, status: 'present' }] })).s === 403);
    const sch = (await call(S, 'GET', 'portal/schedule')).j; ok('جدول الطالب يتضمن حصة اليوم', sch.upcoming.length === 4);
    ok('لا تسريب لهواتف/ملاحظات', !/parent_phone|ملاحظة سرية|01600000001|01500000001/.test((await call(P1, 'GET', `portal/schedule?student_id=${A.id}`)).raw + (await call(S, 'GET', 'portal/children')).raw));

    // ----- الإشعارات -----
    ok('تسجيل غياب علي وتأخر منى', (await o('PUT', `sessions/${sess[0].id}/attendance`, { records: [{ student_id: A.id, status: 'absent' }, { student_id: B.id, status: 'late' }, { student_id: C.id, status: 'present' }] })).s === 200);
    const nS = (await call(S, 'GET', 'notifications')).j, nP1 = (await call(P1, 'GET', 'notifications')).j, nP2 = (await call(P2, 'GET', 'notifications')).j;
    ok('الطالب: إشعار غياب فقط', nS.length === 1 && nS[0].type === 'absence');
    ok('ولي الأمر 1: غياب علي + تأخر منى', nP1.length === 2 && nP1.some(n => n.type === 'absence' && n.student_name === 'علي') && nP1.some(n => n.type === 'late'));
    ok('ولي أمر كريم لا يستلم شيئاً (الحاضر)', nP2.length === 0);
    ok('إشعار الطالب لا يذكر طالباً آخر', !/منى|كريم/.test(JSON.stringify(nS)));
    await o('PUT', `sessions/${sess[0].id}/attendance`, { records: [{ student_id: A.id, status: 'absent' }, { student_id: B.id, status: 'late' }] });
    ok('إعادة الحفظ لا تكرر الإشعار', (await call(P1, 'GET', 'notifications')).j.length === 2);
    ok('عدّاد غير المقروء', (await call(P1, 'GET', 'notifications?count=1')).j.unread === 2);
    ok('تعليم إشعار كمقروء', (await call(P1, 'POST', `notifications/${nP1[0].id}/read`)).s === 200 && (await call(P1, 'GET', 'notifications?count=1')).j.unread === 1);
    ok('لا يقرأ إشعار غيره', (await call(P2, 'POST', `notifications/${nP1[0].id}/read`)).s === 404);
    ok('تعليم الكل كمقروء', (await call(P1, 'POST', 'notifications/read-all')).s === 200 && (await call(P1, 'GET', 'notifications?count=1')).j.unread === 0);
    // تفضيلات
    ok('تعطيل إشعارات التأخر', (await call(P1, 'PUT', 'notification-prefs', { late: false })).j.late === false);
    await o('PUT', `sessions/${sess[1].id}/attendance`, { records: [{ student_id: A.id, status: 'late' }, { student_id: B.id, status: 'late' }] });
    const afterPref = (await call(P1, 'GET', 'notifications')).j;
    ok('التفضيل يمنع إشعار التأخر لولي الأمر', afterPref.length === 2);
    ok('الطالب يستلم تأخره (تفضيله مفعّل)', (await call(S, 'GET', 'notifications')).j.some(n => n.type === 'late'));
    await call(P1, 'PUT', 'notification-prefs', { late: true });
    // تغييرات الحصص
    await o('PUT', `sessions/${sess[2].id}`, { status: 'cancelled' });
    ok('إلغاء حصة ينبّه الطالب وولي الأمر وولي كريم', (await call(S, 'GET', 'notifications')).j.some(n => n.title === 'إلغاء حصة') && (await call(P1, 'GET', 'notifications')).j.some(n => n.title === 'إلغاء حصة') && (await call(P2, 'GET', 'notifications')).j.some(n => n.title === 'إلغاء حصة'));
    await o('PUT', `sessions/${sess[3].id}`, { start_time: '16:00', end_time: '17:00' });
    ok('تعديل موعد حصة ينبّه', (await call(P2, 'GET', 'notifications')).j.some(n => n.title === 'تعديل موعد حصة' && n.body.includes('16:00')));

    // ----- المالية للطالب وولي الأمر -----
    const tr = (await o('POST', 'treasuries', { name: 'خزينة', opening_balance: 0 })).j;
    const sub = (await o('POST', 'subscriptions', { student_id: A.id, group_id: g.id, period: today.slice(0, 7), amount: 400, discount: 100 })).j;
    const pay = (await o('POST', 'payments', { subscription_id: sub.id, treasury_id: tr.id, amount: 120 })).j;
    const subs = (await call(S, 'GET', 'portal/subscriptions')).j;
    ok('الطالب يرى اشتراكه والمتبقي', subs.length === 1 && subs[0].net === 300 && subs[0].remaining === 180);
    ok('ولي الأمر يرى المدفوعات', (await call(P1, 'GET', `portal/payments?student_id=${A.id}`)).j.length === 1);
    ok('إيصال متاح للطالب وولي أمره', (await call(S, 'GET', `portal/receipts/${pay.id}`)).s === 200 && (await call(P1, 'GET', `portal/receipts/${pay.id}`)).s === 200);
    ok('إيصال محجوب عن ولي أمر آخر', (await call(P2, 'GET', `portal/receipts/${pay.id}`)).s === 404 && (await call(S2, 'GET', `portal/receipts/${pay.id}`)).s === 404);
    ok('لا تسريب لبيانات داخلية في الإيصال', !/treasury|created_by/.test((await call(S, 'GET', `portal/receipts/${pay.id}`)).raw));
    ok('الحضور وملخصه', (await call(P1, 'GET', `portal/attendance?student_id=${A.id}`)).j.summary.absent === 1);

    // ----- فك الربط والتعطيل -----
    ok('فك ربط علي من ولي أمره', (await o('DELETE', `parents/${p1.id}/students/${A.id}`)).s === 200);
    ok('انقطع وصول الولي لبيانات علي', (await call(P1, 'GET', `portal/attendance?student_id=${A.id}`)).s === 403 && (await call(P1, 'GET', 'portal/children')).j.length === 1);
    ok('إشعارات علي تختفي من الولي', !(await call(P1, 'GET', 'notifications')).j.some(n => n.student_name === 'علي'));
    await o('POST', `student-accounts/${A.id}/disable`);
    ok('تعطيل حساب الطالب يمنع الدخول والتوكن القديم', (await login('01444444441', 'secret1')) === undefined && (await call(S, 'GET', 'portal/children')).s === 401);
    await o('POST', `student-accounts/${A.id}/enable`); ok('إعادة التفعيل', !!(await login('01444444441', 'secret1')));
    await o('PUT', `parents/${p2.id}`, { active: false });
    ok('تعطيل ولي الأمر', (await call(P2, 'GET', 'portal/children')).s === 401);
    ok('إعادة تعيين كلمة المرور', (await o('POST', `student-accounts/${B.id}/reset`, { password: 'newpass1' })).s === 200 && !!(await login('01444444442', 'newpass1')));

    // ----- عزل السناتر -----
    const t2 = Number(db.prepare('INSERT INTO tenants(name) VALUES (?)').run('سنتر آخر').lastInsertRowid);
    db.prepare('INSERT INTO users(tenant_id,name,phone,password_hash,role) VALUES (?,?,?,?,?)').run(t2, 'مالك 2', '01999999999', hashPassword('pass123'), 'owner');
    const O2 = await login('01999999999', 'pass123');
    ok('سنتر آخر لا يرى الحسابات ولا الأولياء', (await call(O2, 'GET', 'student-accounts')).j.length === 0 && (await call(O2, 'GET', 'parents')).j.length === 0);
    ok('سنتر آخر لا يربط طالبنا', (await call(O2, 'POST', 'parents', { name: 'x', phone: '01888888881', password: 'secret1', student_ids: [A.id] })).s === 400);
    console.log('\nكل اختبارات المرحلة الثالثة نجحت');
  } catch (e) { console.error('FAIL:', e.message); process.exitCode = 1; }
  srv.close();
});
