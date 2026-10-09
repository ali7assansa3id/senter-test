process.env.DB_FILE = ':memory:'; process.env.SECRET = 'test';
const assert = require('assert'), http = require('http');
const { handle } = require('../src/server');
const srv = http.createServer(handle).listen(0, async () => {
  const base = 'http://localhost:' + srv.address().port + '/api/';
  let tok; const call = async (m, p, b, t = tok) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; };
  const ok = (name, c) => console.log((c ? '✔ ' : '✘ ') + name) || assert(c, name);
  try {
    ok('دخول خاطئ يُرفض', (await call('POST', 'login', { phone: '01000000000', password: 'x' })).s === 401);
    tok = (await call('POST', 'login', { phone: '01000000000', password: 'admin123' })).j.token;
    ok('دخول صحيح', !!tok);
    ok('بدون توكن 401', (await call('GET', 'students', null, 'bad')).s === 401);
    const br = (await call('POST', 'branches', { name: 'فرع 1' })).j;
    const room = (await call('POST', 'rooms', { branch_id: br.id, name: 'قاعة 1', capacity: 2 })).j;
    const tu = (await call('POST', 'users', { name: 'أ. أحمد', phone: '01111111111', role: 'teacher', password: 'secret1' })).j;
    const tch = (await call('POST', 'teachers', { name: 'أ. أحمد', subject: 'رياضيات', user_id: tu.id })).j;
    const tch2 = (await call('POST', 'teachers', { name: 'أ. سارة', subject: 'علوم' })).j;
    const g = (await call('POST', 'groups', { name: 'ثالثة ثانوي', teacher_id: tch.id, capacity: 2 })).j;
    const g2 = (await call('POST', 'groups', { name: 'مجموعة سارة', teacher_id: tch2.id, capacity: 5 })).j;
    ok('إنشاء مجموعة', g.id && g2.id);
    const s = []; for (const n of ['علي', 'منى', 'كريم']) s.push((await call('POST', 'students', { name: n, phone: '0122' + (s.length + 1) + '000000' })).j);
    ok('رفض هاتف طالب مكرر', (await call('POST', 'students', { name: 'x', phone: s[0].phone })).s === 400);
    ok('تسجيل طالب 1', (await call('POST', `groups/${g.id}/students`, { student_id: s[0].id })).s === 201);
    ok('رفض تسجيل مكرر', (await call('POST', `groups/${g.id}/students`, { student_id: s[0].id })).s === 400);
    await call('POST', `groups/${g.id}/students`, { student_id: s[1].id });
    ok('رفض تجاوز السعة', (await call('POST', `groups/${g.id}/students`, { student_id: s[2].id })).s === 400);
    await call('POST', `groups/${g2.id}/students`, { student_id: s[2].id });
    ok('جدول صحيح', (await call('POST', 'schedules', { group_id: g.id, room_id: room.id, weekday: 6, start_time: '16:00', end_time: '18:00' })).s === 201);
    ok('تعارض قاعة', (await call('POST', 'schedules', { group_id: g2.id, room_id: room.id, weekday: 6, start_time: '17:00', end_time: '19:00' })).s === 400);
    ok('وقت نهاية قبل البداية', (await call('POST', 'schedules', { group_id: g.id, weekday: 1, start_time: '10:00', end_time: '09:00' })).s === 400);
    const gen = (await call('POST', `groups/${g.id}/generate-sessions`, { from: '2026-10-01', to: '2026-10-31' })).j;
    ok('توليد حصص (5 سبوت)', gen.created === 5);
    const sess = (await call('GET', `sessions?group_id=${g.id}`)).j;
    ok('تعارض حصة مكررة', (await call('POST', 'sessions', { group_id: g.id, room_id: room.id, session_date: sess[0].session_date, start_time: '17:00', end_time: '19:00' })).s === 400);
    const at = await call('PUT', `sessions/${sess[0].id}/attendance`, { records: [{ student_id: s[0].id, status: 'present' }, { student_id: s[1].id, status: 'absent', note: 'مرض' }] });
    ok('تسجيل حضور', at.s === 200 && at.j.students.find(x => x.student_id === s[1].id).status === 'absent');
    ok('رفض حضور لطالب غير مسجل', (await call('PUT', `sessions/${sess[0].id}/attendance`, { records: [{ student_id: s[2].id, status: 'present' }] })).s === 400);
    // مدرس
    const tt = (await call('POST', 'login', { phone: '01111111111', password: 'secret1' })).j.token;
    const tg = (await call('GET', 'groups', null, tt)).j;
    ok('المدرس يرى مجموعته فقط', tg.length === 1 && tg[0].id === g.id);
    ok('المدرس يرى طلاب مجموعته فقط', (await call('GET', 'students', null, tt)).j.length === 2);
    ok('المدرس لا يضيف طلاباً', (await call('POST', 'students', { name: 'z' }, tt)).s === 403);
    ok('المدرس لا يرى المستخدمين', (await call('GET', 'users', null, tt)).s === 403);
    ok('المدرس يسجّل حضور مجموعته', (await call('PUT', `sessions/${sess[1].id}/attendance`, { records: [{ student_id: s[0].id, status: 'late' }] }, tt)).s === 200);
    const other = (await call('POST', 'sessions', { group_id: g2.id, session_date: '2026-10-05', start_time: '10:00', end_time: '11:00' })).j;
    ok('المدرس لا يسجّل حضور مجموعة غيره', (await call('PUT', `sessions/${other.id}/attendance`, { records: [{ student_id: s[2].id, status: 'present' }] }, tt)).s === 403);
    // soft delete
    await call('DELETE', `students/${s[2].id}`);
    ok('حذف ناعم يخفي الطالب', (await call('GET', 'students')).j.length === 2);
    console.log('\nكل الاختبارات نجحت');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  srv.close();
});
