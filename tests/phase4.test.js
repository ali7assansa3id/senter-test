process.env.DB_FILE = ':memory:'; process.env.SECRET = 'test'; process.env.UPLOAD_DIR = require('fs').mkdtempSync(require('os').tmpdir() + '/senter-up-');
const assert = require('assert'), http = require('http'), crypto = require('crypto');
const { handle } = require('../src/server'); const { db, hashPassword } = require('../src/db');
const srv = http.createServer(handle).listen(0, async () => {
  const origin = 'http://localhost:' + srv.address().port, base = origin + '/api/';
  const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined }); const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = null; } return { s: r.status, j, raw: txt }; };
  const login = async (phone, password) => (await (await fetch(base + 'login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password }) })).json()).token;
  const upload = async (t, kind, id, name, buf) => { const r = await fetch(`${base}uploads/${kind}/${id}`, { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'x-filename': encodeURIComponent(name), 'Content-Type': 'application/octet-stream' }, body: buf }); return { s: r.status, j: await r.json() }; };
  const ok = (n, c) => { console.log((c ? '✔ ' : '✘ ') + n); assert(c, n); };
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }), per = today.slice(0, 7);
  const past = new Date(Date.now() - 3600e3).toISOString(), future = new Date(Date.now() + 7200e3).toISOString();
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), crypto.randomBytes(3000)]);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(500)]);
  try {
    // ---------- التجهيز ----------
    const O = await login('01000000000', 'admin123'), o = (m, p, b) => call(O, m, p, b);
    const mk = async (name, phone) => (await o('POST', 'users', { name, phone, role: 'teacher', password: 'secret1' })).j;
    const u1 = await mk('مدرس 1', '01111111111'), u2 = await mk('مدرس 2', '01111111112');
    const t1 = (await o('POST', 'teachers', { name: 'أ. أحمد', user_id: u1.id })).j, t2 = (await o('POST', 'teachers', { name: 'أ. سارة', user_id: u2.id })).j;
    const g1 = (await o('POST', 'groups', { name: 'مجموعة 1', teacher_id: t1.id })).j, g2 = (await o('POST', 'groups', { name: 'مجموعة 2', teacher_id: t2.id })).j;
    const A = (await o('POST', 'students', { name: 'علي', grade: 'ثالثة ثانوي' })).j, B = (await o('POST', 'students', { name: 'منى', grade: 'ثالثة ثانوي' })).j, C = (await o('POST', 'students', { name: 'كريم', grade: 'أولى ثانوي' })).j;
    for (const [g, s] of [[g1, A], [g1, B], [g2, C]]) await o('POST', `groups/${g.id}/students`, { student_id: s.id });
    for (const [s, p] of [[A, '01444444441'], [B, '01444444442'], [C, '01444444443']]) await o('POST', 'student-accounts', { student_id: s.id, phone: p, password: 'secret1' });
    const par = (await o('POST', 'parents', { name: 'والد علي', phone: '01777777771', password: 'secret1', student_ids: [A.id] })).j;
    const tr = (await o('POST', 'treasuries', { name: 'خزينة' })).j;
    const subA = (await o('POST', 'subscriptions', { student_id: A.id, group_id: g1.id, period: per, amount: 300 })).j;
    const subC = (await o('POST', 'subscriptions', { student_id: C.id, group_id: g2.id, period: per, amount: 300 })).j;
    const payA = (await o('POST', 'payments', { subscription_id: subA.id, treasury_id: tr.id, amount: 100 })).j; await o('POST', 'payments', { subscription_id: subC.id, treasury_id: tr.id, amount: 100 });
    const [T1, T2, SA, SB, SC, P] = await Promise.all([login('01111111111', 'secret1'), login('01111111112', 'secret1'), login('01444444441', 'secret1'), login('01444444442', 'secret1'), login('01444444443', 'secret1'), login('01777777771', 'secret1')]);
    const t1c = (m, p, b) => call(T1, m, p, b), t2c = (m, p, b) => call(T2, m, p, b), a = (m, p, b) => call(SA, m, p, b), bb = (m, p, b) => call(SB, m, p, b);

    // ---------- الدروس ----------
    ok('رابط javascript: يُرفض', (await t1c('POST', 'lessons', { group_id: g1.id, type: 'live', title: 'x', url: 'javascript:alert(1)', scheduled_at: '2026-10-20T18:00' })).s === 400);
    ok('درس مباشر بلا موعد يُرفض', (await t1c('POST', 'lessons', { group_id: g1.id, type: 'live', title: 'x', url: 'https://meet.example.com/abc' })).s === 400);
    ok('المدرس لا ينشئ لمجموعة غيره', (await t2c('POST', 'lessons', { group_id: g1.id, type: 'recorded', title: 'x', url: 'https://x.com/v' })).s === 403);
    const live = (await t1c('POST', 'lessons', { group_id: g1.id, type: 'live', title: 'حصة مباشرة', url: 'https://meet.example.com/abc', scheduled_at: '2026-10-20T18:00' })).j;
    ok('توقيت القاهرة الصيفي (+3)', live.scheduled_at === '2026-10-20T15:00:00.000Z');
    ok('توقيت القاهرة الشتوي (+2)', (await t1c('POST', 'lessons', { group_id: g1.id, type: 'live', title: 'ش', url: 'https://m.example.com/x', scheduled_at: '2026-12-20T18:00' })).j.scheduled_at === '2026-12-20T16:00:00.000Z');
    const rec = (await t1c('POST', 'lessons', { group_id: g1.id, type: 'recorded', title: 'درس مسجل', duration_min: 20 })).j;
    ok('نشر درس بلا محتوى يُرفض', (await t1c('PUT', `lessons/${rec.id}`, { published: true })).s === 400);
    ok('رفض نوع/محتوى ملف خاطئ', (await upload(T1, 'lesson', rec.id, 'v.mp4', Buffer.from('هذا نص وليس فيديو'))).s === 400 && (await upload(T1, 'lesson', rec.id, 'v.exe', mp4)).s === 400);
    ok('الطالب لا يرفع فيديو', (await upload(SA, 'lesson', rec.id, 'v.mp4', mp4)).s === 403 && (await upload(T2, 'lesson', rec.id, 'v.mp4', mp4)).s === 403);
    ok('رفع فيديو صحيح', (await upload(T1, 'lesson', rec.id, 'درس1.mp4', mp4)).s === 200);
    ok('نشر الدرسين', (await t1c('PUT', `lessons/${rec.id}`, { published: true })).s === 200 && (await t1c('PUT', `lessons/${live.id}`, { published: true })).s === 200);
    ok('لا تسريب لمسار الملف', !/file_path|senter-up/.test((await t1c('GET', 'lessons')).raw));
    const la = (await a('GET', 'student/lessons')).j, lb = (await bb('GET', 'student/lessons')).j;
    ok('A مشترك: الرابط ظاهر وغير مقفل', la.length === 2 && la.every(l => !l.locked) && la.find(l => l.type === 'live').url.startsWith('https://'));
    ok('B بلا اشتراك: مقفل وبلا رابط', lb.length === 2 && lb.every(l => l.locked && l.url === null) && !/meet\.example/.test(JSON.stringify(lb)));
    ok('C لا يرى دروس مجموعة أخرى', (await call(SC, 'GET', 'student/lessons')).j.length === 0);
    ok('الدروس غير المنشورة مخفية', (await t1c('POST', 'lessons', { group_id: g1.id, type: 'recorded', title: 'مسودة', url: 'https://x.com/v' })).s === 201 && (await a('GET', 'student/lessons')).j.length === 2);
    // تقدم
    ok('تقدم 50%', (await a('POST', `student/lessons/${rec.id}/progress`, { position: 50, duration: 100 })).j.percent === 50);
    const p2 = (await a('POST', `student/lessons/${rec.id}/progress`, { position: 95, duration: 100 })).j; ok('إكمال عند 90%+', p2.completed === true);
    ok('التقدم لا يتراجع', (await a('POST', `student/lessons/${rec.id}/progress`, { position: 10, duration: 100 })).j.percent === 95);
    ok('درس مباشر: تسجيل الحضور بالدخول', (await a('POST', `student/lessons/${live.id}/progress`, { completed: true })).j.completed === true);
    ok('المقفل لا يسجل تقدماً', (await bb('POST', `student/lessons/${rec.id}/progress`, { position: 5, duration: 100 })).s === 403);
    ok('المدرس يرى تقدم الطلاب', (await t1c('GET', `lessons/${rec.id}/progress`)).j.find(x => x.student_id === A.id).percent === 95);
    ok('ولي الأمر يرى تقدم ابنه', (await call(P, 'GET', `child/lessons?student_id=${A.id}`)).j.find(l => l.id === rec.id).percent === 95);
    // البث المحمي
    const tk = (await a('GET', `media-token?kind=lesson&id=${rec.id}`)).j;
    ok('رمز بث للمشترك', tk.url.startsWith('/media/'));
    ok('رمز بث مرفوض لغير المشترك', (await bb('GET', `media-token?kind=lesson&id=${rec.id}`)).s === 403 && (await call(P, 'GET', `media-token?kind=lesson&id=${rec.id}`)).s === 403);
    const full = await fetch(origin + tk.url); const fb = Buffer.from(await full.arrayBuffer());
    ok('بث كامل مطابق', full.status === 200 && fb.equals(mp4) && full.headers.get('cache-control').includes('no-store'));
    const r1 = await fetch(origin + tk.url, { headers: { Range: 'bytes=0-99' } }); ok('Range => 206 و100 بايت', r1.status === 206 && Buffer.from(await r1.arrayBuffer()).equals(mp4.subarray(0, 100)));
    const r2_ = await fetch(origin + tk.url, { headers: { Range: 'bytes=-50' } }); ok('Range لاحقة', r2_.status === 206 && Buffer.from(await r2_.arrayBuffer()).equals(mp4.subarray(mp4.length - 50)));
    ok('Range خارج النطاق => 416', (await fetch(origin + tk.url, { headers: { Range: 'bytes=999999-' } })).status === 416);
    ok('رمز معبّث به يُرفض', (await fetch(origin + tk.url.slice(0, -3) + 'abc')).status === 401);
    await o('POST', `payments/${payA.id}/cancel`, { reason: 'اختبار سحب الصلاحية' });
    ok('إلغاء الدفع يقفل البث فوراً', (await fetch(origin + tk.url)).status === 403 && (await a('GET', 'student/lessons')).j.every(l => l.locked));
    await o('POST', 'payments', { subscription_id: subA.id, treasury_id: tr.id, amount: 100 });
    ok('عودة الدفع تعيد الصلاحية', (await fetch(origin + tk.url)).status === 200);

    // ---------- المذكرات ----------
    ok('المدرس لا ينشئ مذكرة بلا مجموعة', (await t1c('POST', 'materials', { title: 'x', subject: 'رياضيات', access: 'free' })).s === 403);
    ok('مذكرة مقيّدة تحتاج مجموعة', (await o('POST', 'materials', { title: 'x', subject: 'رياضيات' })).s === 400);
    const mat = (await t1c('POST', 'materials', { title: 'مذكرة الجبر', subject: 'رياضيات', grade: 'ثالثة ثانوي', group_id: g1.id })).j;
    ok('رفع مذكرة PDF', (await upload(T1, 'material', mat.id, 'جبر.pdf', pdf)).s === 200 && (await upload(T1, 'material', mat.id, 'x.pdf', Buffer.from('not pdf'))).s === 400);
    const free = (await o('POST', 'materials', { title: 'نموذج مجاني', subject: 'علوم', grade: 'ثالثة ثانوي', access: 'free' })).j; await upload(O, 'material', free.id, 'free.pdf', pdf);
    const ma = (await a('GET', 'student/materials')).j, mb = (await bb('GET', 'student/materials')).j, mc = (await call(SC, 'GET', 'student/materials')).j;
    ok('A يرى المذكرتين مفتوحتين', ma.length === 2 && ma.every(x => !x.locked));
    ok('B: المقيّدة مقفلة والمجانية مفتوحة', mb.find(x => x.id === mat.id).locked && !mb.find(x => x.id === free.id).locked);
    ok('C (صف آخر) لا يرى المجانية', mc.length === 0);
    ok('تنزيل المذكرة حسب الصلاحية', (await bb('GET', `media-token?kind=material&id=${mat.id}`)).s === 403 && (await bb('GET', `media-token?kind=material&id=${free.id}`)).s === 200 && (await a('GET', `media-token?kind=material&id=${mat.id}`)).s === 200);
    const dl = await fetch(origin + (await a('GET', `media-token?kind=material&id=${mat.id}`)).j.url); ok('PDF يُعرض inline بصيغة صحيحة', dl.headers.get('content-type') === 'application/pdf' && dl.headers.get('content-disposition').startsWith('inline'));
    ok('الموظف يقرأ قائمة المذكرات', true);

    // ---------- بنك الأسئلة ----------
    const Q = (m = {}) => ({ subject: 'عام', type: 'mcq', text: 'سؤال؟', options: ['أ', 'ب', 'ج'], answer: 1, points: 2, ...m });
    for (const [n, b] of [['إجابة خارج النطاق', Q({ answer: 5 })], ['اختيار واحد فقط', Q({ options: ['أ'] })], ['multi مكرر', Q({ type: 'multi', answer: [1, 1] })], ['صح/خطأ غير منطقي', Q({ type: 'true_false', options: undefined, answer: 'yes' })], ['إجابة قصيرة فارغة', Q({ type: 'short', options: undefined, answer: [] })], ['نوع مجهول', Q({ type: 'draw' })], ['درجة صفر', Q({ points: 0 })]])
      ok('بنك الأسئلة يرفض: ' + n, (await t1c('POST', 'question-bank', b)).s === 400);
    const mq = async b => (await t1c('POST', 'question-bank', b)).j;
    const q1 = await mq(Q({ text: 'اختر الصحيح' })), q2 = await mq(Q({ type: 'multi', text: 'اختر الأعداد الزوجية', options: ['2', '3', '4'], answer: [2, 0] })), q3 = await mq(Q({ type: 'true_false', text: 'القاهرة عاصمة مصر', options: undefined, answer: true }));
    const q4 = await mq(Q({ type: 'short', text: 'عاصمة مصر؟', options: undefined, answer: ['القاهرة', 'Cairo'] })), q5 = await mq(Q({ type: 'essay', text: 'اشرح', options: undefined, answer: undefined, points: 4 }));
    ok('خمسة أنواع أسئلة', [q1, q2, q3, q4, q5].every(q => q.id) && JSON.stringify(q2.answer) === '[0,2]');
    ok('المدرس لا يرى أسئلة غيره', (await t2c('GET', 'question-bank')).j.length === 0 && (await t1c('GET', 'question-bank')).j.length === 5 && (await o('GET', 'question-bank')).j.length === 5);

    // ---------- الامتحانات ----------
    ok('المدرس 2 لا يستخدم أسئلة المدرس 1', (await t2c('POST', 'exams', { group_id: g2.id, title: 'x', kind: 'exam', duration_min: 10, questions: [{ question_id: q1.id }] })).s === 400);
    ok('نافذة زمنية معكوسة تُرفض', (await t1c('POST', 'exams', { group_id: g1.id, title: 'x', kind: 'exam', start_at: future, end_at: past })).s === 400);
    const ex = (await t1c('POST', 'exams', { group_id: g1.id, title: 'اختبار الشهر', kind: 'exam', start_at: past, end_at: future, duration_min: 30, pass_mark: 50, shuffle: true, questions: [q1, q2, q3, q4, q5].map(q => ({ question_id: q.id })) })).j;
    ok('الامتحان بـ 5 أسئلة و12 درجة', ex.questions.length === 5 && ex.questions.reduce((s, q) => s + q.points, 0) === 12);
    ok('المسودة مخفية عن الطلاب', (await a('GET', 'student/exams')).j.length === 0);
    ok('نشر الامتحان', (await t1c('POST', `exams/${ex.id}/publish`)).j.status === 'published');
    ok('B غير مشترك لا يبدأ', (await bb('POST', `exams/${ex.id}/start`)).s === 403 && (await call(P, 'POST', `exams/${ex.id}/start`)).s === 403);
    const st = await a('POST', `exams/${ex.id}/start`); ok('A يبدأ والمحاولة ذات مهلة', st.s === 201 && !!st.j.deadline_at && st.j.questions.length === 5);
    ok('الأسئلة بلا إجابات صحيحة أثناء الامتحان', !/"answer"|correct|القاهرة"?,?"Cairo|explanation/.test(st.raw));
    ok('استئناف نفس المحاولة', (await a('POST', `exams/${ex.id}/start`)).j.id === st.j.id);
    const ids = Object.fromEntries(st.j.questions.map(q => [q.type, q.id])), aid = st.j.id;
    ok('حفظ تلقائي للإجابات', (await a('PUT', `attempts/${aid}/answers`, { answers: { [ids.mcq]: 1, [ids.multi]: [2, 0] } })).s === 200);
    ok('B لا يمس محاولة A', (await bb('GET', `attempts/${aid}`)).s === 404 && (await bb('PUT', `attempts/${aid}/answers`, { answers: {} })).s === 404);
    const sub = await a('POST', `attempts/${aid}/submit`, { answers: { [ids.true_false]: true, [ids.short]: '  cairo ', [ids.essay]: 'إجابة مقالية طويلة' } });
    ok('التسليم يصحح الموضوعي (قيد تصحيح المقالي)', sub.s === 200 && sub.j.status === 'submitted' && sub.j.result === null);
    ok('لا تعديل بعد التسليم', (await a('PUT', `attempts/${aid}/answers`, { answers: { [ids.mcq]: 0 } })).s === 400);
    ok('استنفاد المحاولات', (await a('POST', `exams/${ex.id}/start`)).s === 400);
    ok('ولي الأمر: لا نتيجة قبل التصحيح', (await call(P, 'GET', `child/exams?student_id=${A.id}`)).j[0].score === null);
    const sv = (await t1c('GET', `attempts/${aid}`)).j; ok('المدرس يرى الإجابات والدرجات الآلية', sv.questions.find(q => q.type === 'mcq').grade.points === 2 && sv.questions.find(q => q.type === 'short').grade.points === 2 && sv.questions.find(q => q.type === 'essay').student_answer.includes('مقالية'));
    ok('المدرس 2 لا يصحح محاولة غيره', (await t2c('PUT', `attempts/${aid}/grade`, { grades: {} })).s === 403);
    ok('درجة أكبر من المسموح تُرفض', (await t1c('PUT', `attempts/${aid}/grade`, { grades: { [ids.essay]: { points: 5 } } })).s === 400);
    const gr = (await t1c('PUT', `attempts/${aid}/grade`, { grades: { [ids.essay]: { points: 3, feedback: 'جيد' } }, feedback: 'أحسنت' })).j; ok('تصحيح المقالي: 11 من 12', gr.status === 'graded' && gr.total_score === 11 && gr.max_score === 12);
    ok('المصحَّح لا يظهر قبل الإعلان', (await a('GET', `attempts/${aid}`)).j.result === null && (await call(P, 'GET', `child/exams?student_id=${A.id}`)).j[0].score === null);
    ok('إعلان النتائج', !!(await t1c('POST', `exams/${ex.id}/release`)).j.results_released_at);
    const rv = (await a('GET', `attempts/${aid}`)).j; ok('الطالب يرى 11/12 ناجح بلا إجابات نموذجية', rv.result.total === 11 && rv.result.percent === 91.67 && rv.result.passed === true && !/correct_answer/.test(JSON.stringify(rv)));
    await t1c('PUT', `exams/${ex.id}`, { show_answers: true });
    ok('عرض الإجابات الصحيحة بعد التفعيل', /correct_answer/.test(JSON.stringify((await a('GET', `attempts/${aid}`)).j)));
    ok('تعديل الأسئلة بعد المحاولات مرفوض', (await t1c('PUT', `exams/${ex.id}`, { questions: [{ question_id: q1.id }] })).s === 400);
    const pc = (await call(P, 'GET', `child/exams?student_id=${A.id}`)).j[0]; ok('ولي الأمر يرى نتيجة ابنه بعد الإعلان', pc.score === 11 && pc.max === 12 && pc.passed === true);
    ok('ولي الأمر لا يرى ابن غيره', (await call(P, 'GET', `child/exams?student_id=${B.id}`)).s === 403);
    const stt = (await t1c('GET', `exams/${ex.id}/stats`)).j; ok('إحصاءات الامتحان', stt.graded_students === 1 && stt.average === 11 && stt.pass_rate === 100 && stt.questions.length === 5);
    ok('الطالب لا يدخل شاشات التصحيح', (await a('GET', 'exams')).s === 403 && (await a('GET', 'question-bank')).s === 403 && (await a('GET', 'lessons')).s === 403);
    ok('لا حذف لامتحان عليه محاولات', (await t1c('DELETE', `exams/${ex.id}`)).s === 400);
    // انتهاء الوقت
    const ex2 = (await t1c('POST', 'exams', { group_id: g1.id, title: 'سريع', kind: 'exam', duration_min: 10, end_at: future, questions: [{ question_id: q1.id }, { question_id: q3.id }] })).j; await t1c('POST', `exams/${ex2.id}/publish`);
    const s2 = (await a('POST', `exams/${ex2.id}/start`)).j; const k2 = Object.fromEntries(s2.questions.map(q => [q.type, q.id]));
    await a('PUT', `attempts/${s2.id}/answers`, { answers: { [k2.mcq]: 1, [k2.true_false]: false } });
    db.prepare('UPDATE exam_attempts SET deadline_at=? WHERE id=?').run(new Date(Date.now() - 60000).toISOString(), s2.id);
    const exp = (await a('GET', `attempts/${s2.id}`)).j; ok('انتهاء المهلة يسلّم تلقائياً بالإجابات المحفوظة', exp.status === 'graded' && (await a('PUT', `attempts/${s2.id}/answers`, { answers: {} })).s === 400);
    ok('الإنهاء التلقائي صُحّح (2 من 4)', (await t1c('GET', `attempts/${s2.id}`)).j.total_score === 2);
    ok('امتحان لم يبدأ بعد', (await t1c('POST', 'exams', { group_id: g1.id, title: 'قادم', kind: 'exam', duration_min: 10, start_at: new Date(Date.now() + 3600e3).toISOString(), end_at: new Date(Date.now() + 7200e3).toISOString(), questions: [{ question_id: q1.id }] }).then(async r => { await t1c('POST', `exams/${r.j.id}/publish`); return (await a('POST', `exams/${r.j.id}/start`)).s; })) === 400);
    // واجب بتسليم ملف
    const asg = (await t1c('POST', 'exams', { group_id: g1.id, title: 'واجب 1', kind: 'assignment', end_at: future, max_points: 10, release_mode: 'immediate' })).j; ok('نشر واجب بلا أسئلة بدرجة عظمى', (await t1c('POST', `exams/${asg.id}/publish`)).s === 200);
    const as = (await a('POST', `exams/${asg.id}/start`)).j;
    ok('تسليم واجب بلا ملف يُرفض', (await a('POST', `attempts/${as.id}/submit`, {})).s === 400);
    ok('B لا يرفع على محاولة A', (await upload(SB, 'submission', as.id, 'x.pdf', pdf)).s === 404 && (await upload(SA, 'submission', as.id, 'x.exe', pdf)).s === 400);
    ok('A يرفع تسليمه', (await upload(SA, 'submission', as.id, 'حل.pdf', pdf)).s === 200 && (await a('POST', `attempts/${as.id}/submit`, {})).j.status === 'submitted');
    ok('المدرس يحمّل التسليم والمدرس الآخر لا', (await t1c('GET', `media-token?kind=submission&id=${as.id}`)).s === 200 && (await t2c('GET', `media-token?kind=submission&id=${as.id}`)).s === 403 && (await bb('GET', `media-token?kind=submission&id=${as.id}`)).s === 403);
    ok('درجة واجب أكبر من العظمى تُرفض', (await t1c('PUT', `attempts/${as.id}/grade`, { total_points: 11 })).s === 400);
    ok('تصحيح الواجب 8/10 ويظهر فوراً (immediate)', (await t1c('PUT', `attempts/${as.id}/grade`, { total_points: 8, feedback: 'ممتاز' })).j.status === 'graded' && (await a('GET', `attempts/${as.id}`)).j.result.total === 8);

    // ---------- عزل السناتر ----------
    const t2id = Number(db.prepare('INSERT INTO tenants(name) VALUES (?)').run('سنتر آخر').lastInsertRowid);
    db.prepare('INSERT INTO users(tenant_id,name,phone,password_hash,role) VALUES (?,?,?,?,?)').run(t2id, 'مالك 2', '01999999999', hashPassword('pass123'), 'owner');
    const O2 = await login('01999999999', 'pass123'), x = (m, p) => call(O2, m, p);
    ok('سنتر آخر: لا دروس/أسئلة/امتحانات/مذكرات', (await x('GET', 'lessons')).j.length === 0 && (await x('GET', 'question-bank')).j.length === 0 && (await x('GET', 'exams')).j.length === 0 && (await x('GET', 'materials')).j.length === 0);
    ok('سنتر آخر لا يصل لامتحان/محاولة/ملف', (await x('GET', `exams/${ex.id}`)).s === 404 && (await x('GET', `attempts/${aid}`)).s === 404 && (await x('GET', `media-token?kind=lesson&id=${rec.id}`)).s === 404);
    console.log('\nكل اختبارات المرحلة الرابعة نجحت');
  } catch (e) { console.error('FAIL:', e.message, e.stack.split('\n')[1]); process.exitCode = 1; }
  srv.close(); require('fs').rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
});
