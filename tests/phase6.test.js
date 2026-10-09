// المرحلة 6: الذكاء الاصطناعي، التحليلات، الإدارة المركزية، وبنود الإغلاق (TRUSTED_PROXIES، رؤوس الأمان)
process.env.DB_FILE = ':memory:'; process.env.SECRET = 'test';
process.env.SUPER_ADMIN_PHONE = '01111111111'; process.env.SUPER_ADMIN_PASSWORD = 'superpass1';
process.env.TRUSTED_PROXIES = '127.0.0.1,::1,::ffff:127.0.0.1';
const assert = require('assert'), http = require('http');
const { handle, ai } = require('../src/server');
const { db } = require('../src/db');

// عميل وهمي: لا اتصال بالشبكة. يُعيد JSON للأسئلة، ونصاً لبقية الميزات، ويسجل ما أُرسل إليه.
const sent = [];
let questionsReply = [];
ai.setClient(async ({ system, user }) => {
  sent.push({ system, user });
  if (system.includes('JSON')) return { text: '```json\n' + JSON.stringify(questionsReply) + '\n```', tokens: 30 };
  if (system.includes('نسب')) return { text: 'خطة: راجع الكسور أولاً.', tokens: 30 };
  return { text: 'ملخص: نقاط أساسية.', tokens: 30 };
});

const srv = http.createServer(handle).listen(0, async () => {
  const base = 'http://localhost:' + srv.address().port + '/api/';
  const call = async (m, p, b, t, extra = {}) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...extra }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})), h: r.headers }; };
  const upload = async (t, kind, id, name, buf) => (await fetch(`${base}uploads/${kind}/${id}`, { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'x-filename': encodeURIComponent(name), 'Content-Type': 'application/octet-stream' }, body: buf })).status;
  const ok = (name, c) => console.log((c ? '✔ ' : '✘ ') + name) || assert(c, name);
  const login = async (phone, password, xff) => (await call('POST', 'login', { phone, password }, null, xff ? { 'X-Forwarded-For': xff } : {}));
  try {
    const O = (await login('01000000000', 'admin123')).j.token;
    const o = (m, p, b) => call(m, p, b, O);

    // ---- الباقات والحصص: الذكاء لباقة ai فقط ----
    ok('باقة أساسية: الذكاء مرفوض (403)', (await o('POST', 'ai/questions', { subject: 'علوم', count: 1 })).s === 403);
    ok('حالة الذكاء تُظهر عدم التفعيل للباقة', (await o('GET', 'ai/status')).j.allowed === false);

    // ---- مشرف المنصة: لا يرى بيانات الطلاب ----
    const SA = (await login('01111111111', 'superpass1')).j.token; const sa = (m, p, b) => call(m, p, b, SA);
    ok('مشرف المنصة يدخل', !!SA && (await sa('GET', 'me')).j.role === 'super_admin');
    ok('مشرف المنصة لا يرى الطلاب', (await sa('GET', 'students')).s === 403);
    ok('مشرف المنصة لا يرى الدرجات/الامتحانات', (await sa('GET', 'exams')).s === 403);
    ok('مشرف المنصة لا يستخدم الذكاء', (await sa('POST', 'ai/questions', { subject: 'x', count: 1 })).s === 403);
    ok('المالك لا يصل للإدارة المركزية', (await o('GET', 'admin/stats')).s === 403);
    ok('إحصاءات المنصة بلا تفاصيل طلاب', typeof (await sa('GET', 'admin/stats')).j.students === 'number' && !('name' in (await sa('GET', 'admin/stats')).j));

    // تفعيل باقة الذكاء للسنتر التجريبي (id=1) وحصة صغيرة لاختبار الحد
    ok('تفعيل باقة الذكاء وتعيين الحصة', (await sa('PUT', 'admin/centers/1', { plan: 'ai', ai_monthly_quota: 100 })).j.plan === 'ai');
    ok('الباقة صارت مفعّلة', (await o('GET', 'ai/status')).j.allowed === true && (await o('GET', 'ai/status')).j.configured === true);
    ok('باقة غير معروفة تُرفض', (await sa('PUT', 'admin/centers/1', { plan: 'enterprise' })).s === 400);

    // ---- بيانات التجربة ----
    const tu = (await o('POST', 'users', { name: 'أ. سامي', phone: '01022223333', role: 'teacher', password: 'teach1234' })).j;
    const t1 = (await o('POST', 'teachers', { name: 'أ. سامي', subject: 'علوم', user_id: tu.id })).j;
    const tu2 = (await o('POST', 'users', { name: 'أ. ليلى', phone: '01033334444', role: 'teacher', password: 'teach1234' })).j;
    const t2 = (await o('POST', 'teachers', { name: 'أ. ليلى', subject: 'تاريخ', user_id: tu2.id })).j;
    const T1 = (await login('01022223333', 'teach1234')).j.token, T2 = (await login('01033334444', 'teach1234')).j.token;
    const g = (await o('POST', 'groups', { name: 'علوم ثالثة', teacher_id: t1.id, subject: 'علوم', grade: 'ثالثة', capacity: 5 })).j;
    const st = (await o('POST', 'students', { name: 'طالب سري', phone: '01299999999', parent_phone: '01288888888' })).j;
    await o('POST', `groups/${g.id}/students`, { student_id: st.id });
    const q1 = (await o('POST', 'question-bank', { subject: 'علوم', grade: 'ثالثة', type: 'mcq', text: 'ما وحدة قياس الطول؟', options: ['المتر', 'الكيلو'], answer: 0, points: 1 })).j;
    const q2 = (await o('POST', 'question-bank', { subject: 'علوم', grade: 'ثالثة', type: 'true_false', text: 'الماء يغلي عند 50 درجة.', answer: false, points: 1 })).j;
    const past = new Date(Date.now() - 36e5).toISOString(), future = new Date(Date.now() + 36e5).toISOString();
    const ex = (await o('POST', 'exams', { group_id: g.id, title: 'اختبار القياس', kind: 'exam', start_at: past, end_at: future, duration_min: 30, questions: [{ question_id: q1.id }, { question_id: q2.id }] })).j;
    await o('POST', `exams/${ex.id}/publish`);
    // محاولات مصححة مباشرة (تجهيز بيانات): سؤال 1 صحيح دائماً، سؤال 2 خاطئ دائماً
    const eqs = db.prepare('SELECT id, points FROM exam_questions WHERE exam_id=:e ORDER BY position, id').all({ e: ex.id });
    for (let n = 1; n <= 3; n++) db.prepare(`INSERT INTO exam_attempts(tenant_id,exam_id,student_id,attempt_no,status,started_at,submitted_at,answers,grades,total_score,max_score)
      VALUES (1,:e,:s,:n,'graded',datetime('now'),datetime('now'),'{}',:g,1,2)`).run({ e: ex.id, s: st.id, n, g: JSON.stringify({ [eqs[0].id]: { points: 1, auto: true }, [eqs[1].id]: { points: 0, auto: true } }) });

    // ---- تحليل النتائج: بلا أي بيانات طلاب في الرسالة للنموذج ----
    ok('مدرس غير مالك للمجموعة لا يحلّل (403)', (await call('POST', 'ai/analyze', { exam_id: ex.id }, T2)).s === 403);
    const an = await call('POST', 'ai/analyze', { exam_id: ex.id }, O);
    ok('تحليل: نقاط الضعف تحدد السؤال الخاطئ', an.s === 200 && an.j.weak_questions.length === 1 && an.j.weak_questions[0].rate === 0);
    ok('تحليل: مخرج يحمل علامة المراجعة البشرية', an.j.needs_human_review === true && an.j.review_plan.includes('خطة'));
    const lastPrompt = sent[sent.length - 1].user;
    ok('الخصوصية: اسم الطالب ورقمه لا يُرسلان للنموذج', !lastPrompt.includes('طالب سري') && !lastPrompt.includes('01299999999') && !lastPrompt.includes('01288888888'));
    ok('المدرس المالك يحلّل مجموعته', (await call('POST', 'ai/analyze', { exam_id: ex.id }, T1)).s === 200); // 30+30 = 60 توكن

    // ---- توليد الأسئلة كمسودات غير مفعّلة ----
    questionsReply = [
      { type: 'mcq', text: 'ما وحدة قياس الكتلة؟', options: ['الجرام', 'المتر'], answer: 0, points: 1, explanation: 'الجرام وحدة الكتلة' },
      { type: 'mcq', text: 'سؤال بإجابة خارج النطاق', options: ['أ', 'ب'], answer: 9, points: 1 },
      { type: 'true_false', text: 'الشمس نجم.', answer: true, points: 1 },
      { type: 'short', text: 'عاصمة مصر؟', answer: ['القاهرة', 'القاهره'], points: 2 },
      { type: 'multi', text: 'اختر الحيوانات الثديية', options: ['القط', 'الضفدع', 'الحوت'], answer: [0, 2], points: 2 },
    ];
    const gen = await o('POST', 'ai/questions', { subject: 'علوم', grade: 'ثالثة', topic: 'القياس', count: 5, types: ['mcq', 'true_false', 'short', 'multi'] });
    ok('توليد: تُحفظ الصالحة فقط كمسودات (4 من 5)', gen.s === 201 && gen.j.saved === 4 && gen.j.needs_human_review === true);
    ok('المسودات لا تظهر في بنك الأسئلة', (await o('GET', 'question-bank')).j.length === 2);
    const drafts = (await o('GET', 'ai/drafts')).j;
    ok('المسودات تظهر للمراجعة وتحمل علامتها', drafts.length === 4 && drafts.every(d => d.needs_human_review));
    ok('مدرس آخر لا يرى مسودات غيره', (await call('GET', 'ai/drafts', null, T2)).j.length === 0);
    ok('اعتماد مسودة يفعّلها في البنك', (await o('POST', `ai/drafts/${drafts[0].id}/approve`)).s === 200 && (await o('GET', 'question-bank')).j.length === 3);
    ok('رفض مسودة يخفيها', (await o('POST', `ai/drafts/${drafts[1].id}/discard`)).s === 200 && (await o('GET', 'ai/drafts')).j.length === 2);

    // ---- الحد الشهري: 60 + 30 = 90 ثم الاستدعاء التالي يُسمح (120) ثم يُرفض ----
    ok('الاستدعاء قبل بلوغ الحد يعمل', (await o('POST', 'ai/questions', { subject: 'علوم', count: 1, types: ['true_false'] })).s === 201);
    ok('تجاوز الحد الشهري يُرفض (429)', (await o('POST', 'ai/questions', { subject: 'علوم', count: 1 })).s === 429);

    // ---- تلخيص ملف نصي ----
    ok('إنشاء مذكرة مرتبطة بالمجموعة', (await call('POST', 'materials', { title: 'مذكرة القياس', subject: 'علوم', grade: 'ثالثة', access: 'group', group_id: g.id }, O)).s === 201);
    const mat = (await o('GET', 'materials')).j[0];
    ok('رفع ملف نصي', (await upload(O, 'material', mat.id, 'notes.txt', Buffer.from('الكتلة قياس المادة والمتر قياس الطول.'))) === 200);
    await sa('PUT', 'admin/centers/1', { ai_monthly_quota: 100000 });
    const sm = await o('POST', 'ai/summarize', { material_id: mat.id });
    ok('تلخيص: يعيد ملخصاً بعلامة المراجعة', sm.s === 200 && sm.j.summary.includes('ملخص') && sm.j.needs_human_review === true);
    ok('المعلم غير المالك لا يلخّص مذكرة مجموعة لا يملكها', (await call('POST', 'ai/summarize', { material_id: mat.id }, T2)).s === 403);

    // ---- الإيقاف: المستخدمون لا يدخلون ولا تعمل توكناتهم ----
    ok('إيقاف السنتر', (await sa('PUT', 'admin/centers/1', { active: 0 })).j.active === 0);
    ok('المالك الموقوف لا يدخل', (await login('01000000000', 'admin123')).s === 401);
    ok('التوكن القديم للمالك لا يعمل بعد الإيقاف', (await o('GET', 'me')).s === 401);
    ok('مشرف المنصة يعمل رغم إيقاف السنتر', (await sa('GET', 'admin/stats')).s === 200);
    ok('إعادة التفعيل', (await sa('PUT', 'admin/centers/1', { active: 1 })).j.active === 1 && (await login('01000000000', 'admin123')).s === 200);

    // ---- إنشاء سنتر ثانٍ وعزله ----
    const bad1 = await sa('POST', 'admin/centers', { name: 'مركز ب', owner_name: 'مالك ب', owner_phone: '0105', owner_password: 'ownerpass1', plan: 'basic' });
    ok('رقم هاتف مالك غير صالح يُرفض', bad1.s === 400);
    const nb = await sa('POST', 'admin/centers', { name: 'مركز ب', owner_name: 'مالك ب', owner_phone: '01055556666', owner_password: 'ownerpass1', plan: 'basic' });
    ok('إنشاء سنتر ومالكه', nb.s === 201 && nb.j.id > 1);
    const OB = (await login('01055556666', 'ownerpass1')).j.token;
    ok('مالك السنتر الجديد لا يرى طلاب السنتر الأول', ((await call('GET', 'students', null, OB)).j).length === 0);
    ok('مالك السنتر الجديد لا يتجاوز إلى الإدارة', (await call('GET', 'admin/centers', null, OB)).s === 403);
    ok('كلمة مرور المالك القصيرة تُرفض', (await sa('POST', 'admin/centers', { name: 'ج', owner_name: 'جج', owner_phone: '01099998888', owner_password: '123', plan: 'basic' })).s === 400);

    // ---- السجل والمراجعة ----
    const audit = (await sa('GET', 'admin/audit?limit=50')).j;
    ok('سجل النشاط يسجل التعديلات والإيقاف والإنشاء', ['center.update', 'center.suspend', 'center.enable', 'center.create'].every(a => audit.some(x => x.action === a)));
    ok('المالك لا يقرأ سجل النشاط', (await o('GET', 'admin/audit')).s === 403);

    // ---- التحليلات حسب الدور ----
    const dash = await o('GET', 'analytics/dashboard?from=2000-01-01&to=2100-01-01');
    ok('لوحة المالك: مؤشرات مالية وحضور وامتلاء', dash.s === 200 && dash.j.kind === 'management' && 'revenue_net' in dash.j.kpis && dash.j.groups.some(x => x.enrolled === 1 && x.fill_pct === 20));
    const xl = await fetch(base + 'analytics/dashboard?from=2000-01-01&to=2100-01-01&format=xlsx', { headers: { Authorization: 'Bearer ' + O } });
    ok('تصدير اللوحة Excel', xl.status === 200 && xl.headers.get('content-type').includes('spreadsheetml'));
    const td = await call('GET', 'analytics/dashboard?from=2000-01-01&to=2100-01-01', null, T1);
    ok('لوحة المدرس: مجموعاته فقط', td.j.kind === 'teacher' && td.j.groups.length === 1 && td.j.exams[0].attempts === 3);
    ok('لوحة المدرس 2 بلا مجموعات', (await call('GET', 'analytics/dashboard', null, T2)).j.groups.length === 0);
    ok('لوحة مشرف المنصة مرفوضة', (await sa('GET', 'analytics/dashboard')).s === 403);
    ok('مالك السنتر الثاني يرى لوحة فارغة لا بيانات الأول', (await call('GET', 'analytics/dashboard?from=2000-01-01&to=2100-01-01', null, OB)).j.kpis.active_groups === 0);

    // ---- بنود الإغلاق: X-Forwarded-For خلف وكيل موثوق، ورؤوس الأمان ----
    for (let i = 0; i < 5; i++) await login('01000000000', 'wrong', '9.9.9.9');
    ok('الوكيل الموثوق: المعدل يُطبّق على العميل الحقيقي (9.9.9.9)', (await login('01000000000', 'wrong', '9.9.9.9')).s === 429);
    ok('عميل آخر خلف نفس الوكيل لا يتأثر (8.8.8.8)', (await login('01000000000', 'wrong', '8.8.8.8')).s === 401);
    const home = await fetch(base.replace('/api/', '/'));
    ok('رؤوس الأمان موجودة', home.headers.get('x-frame-options') === 'DENY' && home.headers.get('x-content-type-options') === 'nosniff' && /default-src 'self'/.test(home.headers.get('content-security-policy')));

    // ---- نقطة الإشعارات: بلا مزوّد لا شيء يُرسل، ومع مزوّد تُستدعى الرسالة ----
    const nf = require('../src/notify');
    ok('بلا مزوّد: لا إرسال خارجي', (await nf.notify('sms', '01000000000', 'x')).sent === false);
    const got = []; nf.setChannel('sms', async (to, msg) => { got.push([to, msg]); });
    ok('مع مزوّد: تُستدعى الرسالة', (await nf.notify('sms', '01012345678', 'مرحبا')).sent === true && got[0][0] === '01012345678');
    nf.setChannel('sms', async () => { throw new Error('secret-provider-detail'); });
    ok('فشل المزوّد لا يوقف العملية ولا يسرب التفاصيل', JSON.stringify(await nf.notify('sms', 'x', 'y')) === JSON.stringify({ sent: false, channel: 'sms', reason: 'provider_error' }));

    console.log('\nكل اختبارات المرحلة السادسة نجحت');
  } catch (e) { console.error('فشل:', e.message); process.exitCode = 1; }
  finally { srv.close(); }
});
