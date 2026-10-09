process.env.DB_FILE = ':memory:'; process.env.SECRET = 'test';
const assert = require('assert'), http = require('http');
const { handle } = require('../src/server');
const srv = http.createServer(handle).listen(0, async () => {
  const base = 'http://localhost:' + srv.address().port + '/api/';
  const call = async (m, p, b, t) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const ok = (name, c) => console.log((c ? '✔ ' : '✘ ') + name) || assert(c, name);
  try {
    const O = (await call('POST', 'login', { phone: '01000000000', password: 'admin123' })).j.token;
    const o = (m, p, b) => call(m, p, b, O);
    const tch = (await o('POST', 'teachers', { name: 'أ. منى', subject: 'علوم', listed: 1, bio: 'خبرة 10 سنوات' })).j;
    const tch2 = (await o('POST', 'teachers', { name: 'أ. خفي', subject: 'تاريخ' })).j;
    const g = (await o('POST', 'groups', { name: 'علوم ثالثة', teacher_id: tch.id, subject: 'علوم', grade: 'ثالثة ثانوي', capacity: 3, bookable: 1, price: 300 })).j;
    const gHidden = (await o('POST', 'groups', { name: 'مجموعة خفية', teacher_id: tch2.id, capacity: 5 })).j;
    await o('POST', 'schedules', { group_id: g.id, weekday: 6, start_time: '16:00', end_time: '18:00' });
    const ex = (await o('POST', 'students', { name: 'طالب سري', phone: '01299999999', parent_phone: '01288888888' })).j;
    await o('POST', `groups/${g.id}/students`, { student_id: ex.id });
    ok('رفض سعر سالب', (await o('PUT', 'groups/' + g.id, { price: -5 })).s === 400);

    // ---- السطح العام ----
    ok('الدليل فارغ قبل التفعيل', (await call('GET', 'public/centers')).j.length === 0);
    ok('لا ظهور بلا منطقة', (await o('PUT', 'directory-settings', { listed: 1 })).s === 400);
    ok('تفعيل الظهور', (await o('PUT', 'directory-settings', { listed: 1, area: 'مدينة نصر', city: 'القاهرة', description: 'سنتر متميز', contact_phone: '0223456789' })).s === 200);
    const list = (await call('GET', 'public/centers?area=نصر&subject=علوم&grade=ثالثة')).j;
    ok('بحث بالمنطقة والمادة والمرحلة', list.length === 1);
    ok('بحث لا يطابق', (await call('GET', 'public/centers?subject=فيزياء')).j.length === 0);
    const cp = (await call('GET', 'public/centers/' + list[0].id)).j;
    ok('صفحة السنتر: مدرس مدرج فقط', cp.teachers.length === 1 && cp.teachers[0].name === 'أ. منى');
    ok('صفحة السنتر: مجموعة قابلة للحجز فقط', cp.groups.length === 1 && cp.groups[0].price === 300 && cp.groups[0].seats_free === 2 && cp.groups[0].schedule.length === 1);
    const raw = JSON.stringify(cp) + JSON.stringify((await call('GET', 'public/teachers')).j);
    ok('لا بيانات طلاب ولا حقول داخلية', !raw.includes('طالب سري') && !raw.includes('01299999999') && !raw.includes('01288888888') && !raw.includes('tenant_id') && !raw.includes('capacity') && !raw.includes('pay_value') && !raw.includes('أ. خفي'));
    ok('مدرس غير مدرج 404', (await call('GET', 'public/teachers/' + tch2.id)).s === 404);
    ok('صفحة مدرس', (await call('GET', 'public/teachers/' + tch.id)).j.groups.length === 1);
    ok('مسار عام مجهول 404', (await call('GET', 'public/students')).s === 404);
    ok('المسارات الداخلية تتطلب دخولاً', (await call('GET', 'bookings')).s === 401);

    ok('صفحة الدليل العام تُقدَّم', (await fetch(base.replace('/api/', '/directory.html'))).status === 200);

    // ---- الحجز وقوائم الانتظار ----
    const bk = (n, ph) => call('POST', 'public/bookings', { group_id: g.id, name: n, phone: ph });
    const b1 = (await bk('أحمد', '01111111111')).j, b2 = (await bk('سارة', '01122222222')).j;
    ok('أول حجز معلّق', b1.status === 'pending' && b1.code);
    ok('ثاني حجز معلّق', b2.status === 'pending');
    const b3 = (await bk('كريم', '01133333333')).j, b4 = (await bk('هدى', '01144444444')).j;
    ok('المقاعد ممتلئة → قائمة انتظار (1)', b3.status === 'waitlist' && b3.waitlist_position === 1);
    ok('قائمة انتظار (2)', b4.status === 'waitlist' && b4.waitlist_position === 2);
    ok('حجز مكرر يُرفض', (await bk('أحمد', '01111111111')).s === 400);
    ok('طالب مسجل أصلاً يُرفض', (await bk('س', '01299999999')).s === 400);
    ok('هاتف غير صالح', (await bk('x', '123')).s === 400);
    ok('honeypot', (await call('POST', 'public/bookings', { group_id: g.id, name: 'روبوت', phone: '01155555555', website: 'x' })).s === 400);
    ok('مجموعة غير قابلة للحجز', (await call('POST', 'public/bookings', { group_id: gHidden.id, name: 'x', phone: '01166666666' })).s === 400);
    ok('متابعة الحالة بالكود', (await call('GET', 'public/bookings/' + b3.code)).j.waitlist_position === 1);
    ok('الاستجابة بلا بيانات شخصية', !JSON.stringify((await call('GET', 'public/bookings/' + b3.code)).j).includes('01133333333'));

    const all = (await o('GET', 'bookings')).j;
    ok('الموظف يرى 4 طلبات', all.length === 4);
    const id = c => all.find(x => x.code === c.code).id;
    ok('تأكيد الأول بالدور في الانتظار فقط', (await o('POST', `bookings/${id(b4)}/confirm`)).s === 400);
    ok('تأكيد حجز معلّق ينشئ طالباً ويسجله', (await o('POST', `bookings/${id(b1)}/confirm`)).j.status === 'confirmed');
    ok('الطالب صار في المجموعة', (await o('GET', `groups/${g.id}/students`)).j.length === 2);
    ok('رفض الطلب يحرر المقعد ويرقّي المنتظر', (await o('POST', `bookings/${id(b2)}/reject`, { reason: 'مكتمل' })).j.status === 'rejected');
    ok('الأول بالانتظار صار معلّقاً', (await call('GET', 'public/bookings/' + b3.code)).j.status === 'pending');
    ok('الثاني صار الأول بالدور', (await call('GET', 'public/bookings/' + b4.code)).j.waitlist_position === 1);
    ok('إلغاء عام بالكود', (await call('POST', `public/bookings/${b3.code}/cancel`)).j.status === 'cancelled');
    ok('الإلغاء رقّى التالي', (await call('GET', 'public/bookings/' + b4.code)).j.status === 'pending');
    const st = (await o('GET', 'students')).j;
    await o('DELETE', `groups/${g.id}/students/${st.find(s => s.name === 'أحمد').id}`);
    const seats = (await o('GET', 'seats')).j.find(x => x.id === g.id);
    ok('عدّاد المقاعد', seats.enrolled === 1 && seats.pending === 1 && seats.waitlist === 0 && seats.free === 1);
    ok('حجز يدوي من الموظف', (await o('POST', 'bookings', { group_id: g.id, name: 'يدوي', phone: '01177777777' })).s === 201);

    // ---- الاستفسارات ----
    ok('استفسار عام', (await call('POST', 'public/inquiries', { center_id: list[0].id, teacher_id: tch.id, name: 'ولي أمر', phone: '01188888888', message: 'ما المواعيد؟' })).s === 201);
    ok('استفسار لمدرس غير مدرج', (await call('POST', 'public/inquiries', { center_id: list[0].id, teacher_id: tch2.id, name: 'x', phone: '01188888888', message: 'x' })).s === 400);
    const inq = (await o('GET', 'inquiries?status=new')).j;
    ok('الموظف يرى الاستفسار', inq.length === 1 && inq[0].teacher_name === 'أ. منى');
    ok('معالجة الاستفسار', (await o('POST', `inquiries/${inq[0].id}/handle`, { note: 'تم الرد' })).j.status === 'handled');
    let lim = 0; for (let i = 0; i < 11; i++) lim = (await call('POST', 'public/inquiries', { center_id: list[0].id, name: 'x', phone: '01188888888', message: 'x' })).s;
    ok('تحديد معدل الطلبات 429', lim === 429);

    // ---- التقييمات ----
    const S = (await o('GET', 'students')).j.find(s => s.name === 'طالب سري');
    await o('POST', 'student-accounts', { student_id: S.id, phone: '01400000001', password: 'secret1' });
    const T = (await call('POST', 'login', { phone: '01400000001', password: 'secret1' })).j.token;
    ok('تقييم مدرس', (await call('POST', 'reviews', { target: 'teacher', teacher_id: tch.id, rating: 5, comment: 'ممتاز' }, T)).s === 201);
    ok('لا تقييم مكرر', (await call('POST', 'reviews', { target: 'teacher', teacher_id: tch.id, rating: 4 }, T)).s === 400);
    ok('لا تقييم لمدرس لم يدرّسه', (await call('POST', 'reviews', { target: 'teacher', teacher_id: tch2.id, rating: 4 }, T)).s === 400);
    ok('تقييم خارج 1-5', (await call('POST', 'reviews', { target: 'center', rating: 9 }, T)).s === 400);
    ok('تقييم السنتر', (await call('POST', 'reviews', { target: 'center', rating: 4, comment: 'جيد' }, T)).s === 201);
    ok('غير منشور لا يظهر', (await call('GET', 'public/teachers/' + tch.id)).j.reviews.length === 0);
    ok('الطالب لا ينشر', (await call('POST', 'reviews/1/publish', {}, T)).s === 403);
    const rv = (await o('GET', 'reviews?status=pending')).j;
    ok('الإدارة ترى المعلّق', rv.length === 2);
    for (const r of rv) await o('POST', `reviews/${r.id}/publish`);
    const tp = (await call('GET', 'public/teachers/' + tch.id)).j;
    ok('منشور ومجهول الهوية + متوسط', tp.reviews.length === 1 && tp.rating_avg === 5 && !JSON.stringify(tp.reviews).includes('طالب سري'));
    ok('إخفاء تقييم', (await o('POST', `reviews/${rv[0].id}/hide`)).j.status === 'hidden');
    ok('طالب لم يُسجَّل لا يقيّم السنتر', (await (async () => { const n = (await o('POST', 'students', { name: 'غريب', phone: '01300000001' })).j; await o('POST', 'student-accounts', { student_id: n.id, phone: '01400000002', password: 'secret1' }); const t2 = (await call('POST', 'login', { phone: '01400000002', password: 'secret1' })).j.token; return call('POST', 'reviews', { target: 'center', rating: 3 }, t2); })()).s === 400);

    // ---- الاشتراكات المتقدمة والاسترداد ----
    const tr = (await o('POST', 'treasuries', { name: 'خزينة', opening_balance: 0 })).j;
    const sub = (await o('POST', 'subscriptions', { student_id: S.id, group_id: g.id, period: '2026-10', amount: 300 })).j;
    ok('اشتراك شهري', sub.plan_type === 'monthly');
    ok('اشتراك شهري مكرر يُرفض', (await o('POST', 'subscriptions', { student_id: S.id, group_id: g.id, period: '2026-10', amount: 300 })).s === 400);
    const ps = (await o('POST', 'subscriptions', { student_id: S.id, group_id: g.id, plan_type: 'per_session', sessions_count: 4, unit_price: 50 })).j;
    ok('اشتراك بالحصة: القيمة = السعر × العدد', ps.amount === 200 && ps.sessions_count === 4 && ps.sessions_used === 0);
    ok('بالحصة يتطلب عدداً', (await o('POST', 'subscriptions', { student_id: S.id, group_id: g.id, plan_type: 'per_session', unit_price: 50 })).s === 400);
    const cs = (await o('POST', 'subscriptions', { student_id: S.id, group_id: g.id, plan_type: 'course', start_date: '2026-10-01', end_date: '2026-12-31', amount: 800 })).j;
    ok('اشتراك كورس', cs.plan_type === 'course' && cs.period === '2026-10');
    ok('كورس بتواريخ خاطئة', (await o('POST', 'subscriptions', { student_id: S.id, group_id: g.id, plan_type: 'course', start_date: '2026-12-31', end_date: '2026-10-01', amount: 800 })).s === 400);
    const rn = (await o('POST', `subscriptions/${sub.id}/renew`, {})).j;
    ok('تجديد شهري → الشهر التالي', rn.period === '2026-11' && rn.renewed_from === sub.id);
    ok('تجديد مكرر يُرفض', (await o('POST', `subscriptions/${sub.id}/renew`, {})).s === 400);
    ok('تجديد كورس يتطلب تواريخ', (await o('POST', `subscriptions/${cs.id}/renew`, {})).s === 400);
    const pay = (await o('POST', 'payments', { subscription_id: sub.id, treasury_id: tr.id, amount: 300 })).j;
    ok('استرداد بلا سبب يُرفض', (await o('POST', `payments/${pay.id}/refund`, { amount: 100 })).s === 400);
    ok('استرداد أكبر من المدفوع يُرفض', (await o('POST', `payments/${pay.id}/refund`, { amount: 400, reason: 'خطأ' })).s === 400);
    const rf = await o('POST', `payments/${pay.id}/refund`, { amount: 100, reason: 'انسحاب جزئي' });
    ok('استرداد جزئي', rf.s === 201);
    ok('الخزينة والمتبقي بعد الاسترداد', (await o('GET', 'treasuries')).j[0].balance === 200 && (await o('GET', 'subscriptions/' + sub.id)).j.paid === 200);
    ok('استرداد الباقي', (await o('POST', `payments/${pay.id}/refund`, { amount: 200, reason: 'انسحاب' })).s === 201);
    ok('استرداد زائد يُرفض', (await o('POST', `payments/${pay.id}/refund`, { amount: 1, reason: 'زيادة' })).s === 400);
    ok('لا إلغاء إيصال عليه استرداد', (await o('POST', `payments/${pay.id}/cancel`, { reason: 'تجربة' })).s === 400);
    ok('الاشتراك بعد الاسترداد الكامل قابل للإلغاء', (await o('POST', `subscriptions/${sub.id}/cancel`)).j.status === 'cancelled');
    ok('قائمة الاستردادات', (await o('GET', 'refunds')).j.length === 2);
    const sum = (await o('GET', 'reports/summary?from=2020-01-01&to=2030-01-01')).j;
    ok('الإيراد في التقرير = المحصّل − المسترد = 0', sum.summary.find(x => x.label === 'إجمالي الإيرادات').value === 0);
    ok('الموظف لا يسترد', await (async () => { await o('POST', 'users', { name: 'موظف', phone: '01011111111', role: 'employee', password: 'secret1' }); const E = (await call('POST', 'login', { phone: '01011111111', password: 'secret1' })).j.token; const p2 = (await o('POST', 'payments', { subscription_id: ps.id, treasury_id: tr.id, amount: 50 })).j; return (await call('POST', `payments/${p2.id}/refund`, { amount: 10, reason: 'تجربة' }, E)).s === 403; })());
    console.log('\nكل اختبارات المرحلة الخامسة نجحت');
  } catch (e) { console.error(e); process.exitCode = 1; } finally { srv.close(); }
});
