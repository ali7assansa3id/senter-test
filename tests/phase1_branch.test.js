process.env.DB_FILE = ':memory:'; process.env.SECRET = 'test';
const assert = require('assert'), http = require('http');
const { handle } = require('../src/server');
const srv = http.createServer(handle).listen(0, async () => {
  const base = 'http://localhost:' + srv.address().port + '/api/';
  const call = async (m, p, b, t) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const ok = (name, c) => console.log((c ? '✔ ' : '✘ ') + name) || assert(c, name);
  try {
    const O = (await call('POST', 'login', { phone: '01000000000', password: 'admin123' })).j.token;
    const b1 = (await call('POST', 'branches', { name: 'فرع 1' }, O)).j, b2 = (await call('POST', 'branches', { name: 'فرع 2' }, O)).j;
    await call('POST', 'users', { name: 'موظف 1', phone: '01011111111', role: 'employee', branch_id: b1.id, password: 'secret1' }, O);
    const E = (await call('POST', 'login', { phone: '01011111111', password: 'secret1' })).j.token;
    const tch = (await call('POST', 'teachers', { name: 'م', subject: 'x' }, O)).j;
    const g1 = (await call('POST', 'groups', { name: 'ج1', teacher_id: tch.id, branch_id: b1.id, capacity: 5 }, O)).j;
    const g2 = (await call('POST', 'groups', { name: 'ج2', teacher_id: tch.id, branch_id: b2.id, capacity: 5 }, O)).j;
    const s1 = (await call('POST', 'students', { name: 'طالب1', phone: '01211111111', branch_id: b1.id }, O)).j;
    const s2 = (await call('POST', 'students', { name: 'طالب2', phone: '01222222222', branch_id: b2.id }, O)).j;
    const sc2 = (await call('POST', 'schedules', { group_id: g2.id, weekday: 1, start_time: '10:00', end_time: '11:00' }, O)).j;
    const ss2 = (await call('POST', 'sessions', { group_id: g2.id, session_date: '2026-10-12', start_time: '10:00', end_time: '11:00' }, O)).j;

    ok('موظف الفرع 1 يرى طلاب فرعه فقط', (await call('GET', 'students', null, E)).j.map(x => x.id).join() === String(s1.id));
    ok('لا يرى مجموعات فرع 2', (await call('GET', 'groups', null, E)).j.every(x => x.id === g1.id));
    ok('لا يرى جداول فرع 2', (await call('GET', 'schedules', null, E)).j.length === 0);
    ok('لا يرى حصص فرع 2', (await call('GET', 'sessions', null, E)).j.length === 0);
    ok('GET طالب فرع 2 يُرفض 404', (await call('GET', 'students/' + s2.id, null, E)).s === 404);
    ok('تعديل طالب فرع 2 يُرفض', (await call('PUT', 'students/' + s2.id, { name: 'اختراق' }, E)).s === 404);
    ok('حذف طالب فرع 2 يُرفض', (await call('DELETE', 'students/' + s2.id, null, E)).s === 404);
    ok('نقل طالبه لفرع 2 يُرفض', (await call('PUT', 'students/' + s1.id, { branch_id: b2.id }, E)).s === 403);
    const ns = (await call('POST', 'students', { name: 'جديد', phone: '01233333333' }, E)).j;
    ok('طالب جديد يُنسب لفرعه تلقائياً', ns.branch_id === b1.id);
    ok('إنشاء طالب بفرع آخر يُرفض', (await call('POST', 'students', { name: 'x', phone: '01244444444', branch_id: b2.id }, E)).s === 403);
    ok('تسجيل في مجموعة فرع 2 يُرفض', (await call('POST', `groups/${g2.id}/students`, { student_id: s1.id }, E)).s === 403);
    ok('تسجيل طالب فرع 2 يُرفض', (await call('POST', `groups/${g1.id}/students`, { student_id: s2.id }, E)).s === 400);
    ok('حضور حصة فرع 2 يُرفض', (await call('GET', `sessions/${ss2.id}/attendance`, null, E)).s === 403);
    ok('إنشاء حصة في مجموعة فرع 2 يُرفض', (await call('POST', 'sessions', { group_id: g2.id, session_date: '2026-10-13', start_time: '10:00', end_time: '11:00' }, E)).s === 403);
    ok('تسجيل طالب فرعه في مجموعة فرعه يعمل', (await call('POST', `groups/${g1.id}/students`, { student_id: s1.id }, E)).s === 201);
    ok('المالك يرى الكل', (await call('GET', 'students', null, O)).j.length === 3);
    console.log('\nكل اختبارات عزل الفروع نجحت');
  } catch (e) { console.error(e); process.exitCode = 1; } finally { srv.close(); }
});
