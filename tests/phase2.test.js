process.env.DB_FILE = ':memory:'; process.env.SECRET = 'test';
const assert = require('assert'), http = require('http'), fs = require('fs');
const { handle } = require('../src/server'); const { db, hashPassword } = require('../src/db');
const srv = http.createServer(handle).listen(0, async () => {
  const base = 'http://localhost:' + srv.address().port + '/api/';
  const call = async (t, m, p, b) => { const r = await fetch(base + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: b ? JSON.stringify(b) : undefined });
    const ct = r.headers.get('content-type'); return { s: r.status, j: ct.includes('json') ? await r.json() : null, buf: ct.includes('json') ? null : Buffer.from(await r.arrayBuffer()) }; };
  const login = async (phone, password) => (await (await fetch(base + 'login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password }) })).json()).token;
  const ok = (n, c) => { console.log((c ? '✔ ' : '✘ ') + n); assert(c, n); };
  try {
    const O = await login('01000000000', 'admin123'); const o = (m, p, b) => call(O, m, p, b);
    const b1 = (await o('POST', 'branches', { name: 'فرع 1' })).j, b2 = (await o('POST', 'branches', { name: 'فرع 2' })).j;
    const tu = (await o('POST', 'users', { name: 'مدرس', phone: '01111111111', role: 'teacher', password: 'secret1' })).j;
    const emp2 = (await o('POST', 'users', { name: 'موظف فرع 2', phone: '01222222222', role: 'employee', branch_id: b2.id, password: 'secret1' })).j;
    const emp1 = (await o('POST', 'users', { name: 'موظف فرع 1', phone: '01333333333', role: 'employee', branch_id: b1.id, password: 'secret1' })).j;
    ok('نظام محاسبة غير صالح يُرفض', (await o('POST', 'teachers', { name: 'x', pay_type: 'bad', pay_value: 5 })).s === 400);
    const tch = (await o('POST', 'teachers', { name: 'أ. أحمد', user_id: tu.id, pay_type: 'percentage', pay_value: 50 })).j;
    const tch2 = (await o('POST', 'teachers', { name: 'أ. سارة', pay_type: 'fixed', pay_value: 300 })).j;
    const g = (await o('POST', 'groups', { name: 'مجموعة 1', teacher_id: tch.id, branch_id: b1.id, capacity: 10 })).j;
    const g2 = (await o('POST', 'groups', { name: 'مجموعة 2', teacher_id: tch2.id, branch_id: b2.id })).j;
    const s1 = (await o('POST', 'students', { name: 'علي' })).j, s2 = (await o('POST', 'students', { name: 'منى' })).j;
    await o('POST', `groups/${g.id}/students`, { student_id: s1.id }); await o('POST', `groups/${g.id}/students`, { student_id: s2.id }); await o('POST', `groups/${g2.id}/students`, { student_id: s2.id });

    // الخزائن
    const E1 = await login('01333333333', 'secret1'), E2 = await login('01222222222', 'secret1'), T = await login('01111111111', 'secret1');
    ok('الموظف لا ينشئ خزينة', (await call(E1, 'POST', 'treasuries', { name: 'x' })).s === 403);
    const tr1 = (await o('POST', 'treasuries', { name: 'خزينة فرع 1', branch_id: b1.id, opening_balance: 1000 })).j;
    const tr2 = (await o('POST', 'treasuries', { name: 'خزينة فرع 2', branch_id: b2.id })).j;
    ok('رصيد افتتاحي', tr1.balance === 1000);

    // الاشتراكات
    ok('اشتراك لطالب غير مسجل بالمجموعة', (await o('POST', 'subscriptions', { student_id: s1.id, group_id: g2.id, period: '2026-10', amount: 100 })).s === 400);
    ok('خصم أكبر من القيمة', (await o('POST', 'subscriptions', { student_id: s1.id, group_id: g.id, period: '2026-10', amount: 100, discount: 100 })).s === 400);
    const sub = (await o('POST', 'subscriptions', { student_id: s1.id, group_id: g.id, period: '2026-10', amount: 300, discount: 50 })).j;
    ok('الصافي 250', sub.net === 250 && sub.remaining === 250);
    ok('اشتراك مكرر يُرفض', (await o('POST', 'subscriptions', { student_id: s1.id, group_id: g.id, period: '2026-10', amount: 300 })).s === 400);
    const sub2 = (await o('POST', 'subscriptions', { student_id: s2.id, group_id: g.id, period: '2026-10', amount: 200 })).j;

    // التحصيل والإيصالات
    const p1 = await call(E1, 'POST', 'payments', { subscription_id: sub.id, treasury_id: tr1.id, amount: 100, method: 'cash' });
    ok('تحصيل أول + رقم إيصال 1', p1.s === 201 && p1.j.receipt_no === 1 && p1.j.branch_id === b1.id);
    ok('رفض دفع أكبر من المتبقي', (await call(E1, 'POST', 'payments', { subscription_id: sub.id, treasury_id: tr1.id, amount: 200 })).s === 400);
    ok('رفض مبلغ سالب', (await call(E1, 'POST', 'payments', { subscription_id: sub.id, treasury_id: tr1.id, amount: -5 })).s === 400);
    ok('رفض تاريخ مستقبلي', (await call(E1, 'POST', 'payments', { subscription_id: sub.id, treasury_id: tr1.id, amount: 5, paid_at: '2099-01-01' })).s === 400);
    const p2 = (await call(E1, 'POST', 'payments', { subscription_id: sub.id, treasury_id: tr1.id, amount: 150, method: 'transfer' })).j;
    ok('أرقام الإيصالات متسلسلة', p2.receipt_no === 2 && p2.sub_remaining === 0);
    ok('رفض دفع بعد السداد الكامل', (await call(E1, 'POST', 'payments', { subscription_id: sub.id, treasury_id: tr1.id, amount: 1 })).s === 400);
    ok('الإيصال لا يُعدَّل (BR-004)', (await o('PUT', `payments/${p1.j.id}`, { amount: 1 })).s === 405);
    ok('الإيصال لا يُحذف (BR-004)', (await o('DELETE', `payments/${p1.j.id}`)).s === 405);
    ok('الموظف لا يلغي إيصالاً', (await call(E1, 'POST', `payments/${p1.j.id}/cancel`, { reason: 'خطأ في الإدخال' })).s === 403);
    ok('الإلغاء يتطلب سبباً', (await o('POST', `payments/${p1.j.id}/cancel`, {})).s === 400);
    ok('لا يُلغى اشتراك عليه مدفوعات', (await o('POST', `subscriptions/${sub.id}/cancel`)).s === 400);
    ok('رصيد الخزينة 1250', (await o('GET', 'treasuries')).j.find(t => t.id === tr1.id).balance === 1250);

    // عزل الفروع (BR-002)
    ok('موظف فرع 2 لا يرى خزينة فرع 1', (await call(E2, 'GET', 'treasuries')).j.every(t => t.branch_id === b2.id));
    ok('موظف فرع 2 لا يرى إيصالات فرع 1', (await call(E2, 'GET', 'payments')).j.length === 0);
    ok('موظف فرع 2 لا يفتح إيصال فرع 1', (await call(E2, 'GET', `payments/${p1.j.id}`)).s === 403);
    ok('موظف فرع 2 لا يحصّل على اشتراك فرع 1', (await call(E2, 'POST', 'payments', { subscription_id: sub.id, treasury_id: tr2.id, amount: 1 })).s === 403);
    ok('الخزينة من فرع مختلف تُرفض', (await o('POST', 'payments', { subscription_id: sub2.id, treasury_id: tr2.id, amount: 10 })).s === 400);
    // عزل السناتر
    const t2 = Number(db.prepare('INSERT INTO tenants(name) VALUES (?)').run('سنتر آخر').lastInsertRowid);
    db.prepare('INSERT INTO users(tenant_id,name,phone,password_hash,role) VALUES (?,?,?,?,?)').run(t2, 'مالك 2', '01999999999', hashPassword('pass123'), 'owner');
    const O2 = await login('01999999999', 'pass123');
    ok('سنتر آخر لا يرى خزائن/إيصالات/اشتراكات', (await call(O2, 'GET', 'treasuries')).j.length === 0 && (await call(O2, 'GET', 'payments')).j.length === 0 && (await call(O2, 'GET', 'subscriptions')).j.length === 0);
    ok('سنتر آخر لا يفتح إيصالنا', (await call(O2, 'GET', `payments/${p1.j.id}`)).s === 404);

    // المصروفات
    ok('الموظف لا يسجل مصروفاً', (await call(E1, 'POST', 'expenses', { treasury_id: tr1.id, category: 'إيجار', amount: 10 })).s === 403);
    ok('مصروف أكبر من الرصيد يُرفض', (await o('POST', 'expenses', { treasury_id: tr1.id, category: 'إيجار', amount: 5000 })).s === 400);
    const ex = (await o('POST', 'expenses', { treasury_id: tr1.id, category: 'إيجار', amount: 400, description: 'إيجار أكتوبر' })).j;
    ok('مصروف صحيح ينقص الرصيد', (await o('GET', 'treasuries')).j.find(t => t.id === tr1.id).balance === 850);
    ok('المصروف لا يُحذف', (await o('DELETE', `expenses/${ex.id}`)).s === 405);

    // مستحقات المدرسين: المحصّل 250 × 50% = 125
    const d = (await o('GET', 'teacher-dues?period=2026-10')).j.find(x => x.teacher_id === tch.id);
    ok('المستحق 125 (نسبة 50% من 250)', d.collected === 250 && d.due === 125 && d.remaining === 125);
    ok('نظام ثابت بلا مجموعات فعالة؟ (للمدرسة 1 مجموعة → 300)', (await o('GET', 'teacher-dues?period=2026-10')).j.find(x => x.teacher_id === tch2.id).due === 300);
    ok('صرف أكبر من المستحق يُرفض', (await o('POST', 'teacher-payouts', { teacher_id: tch.id, treasury_id: tr1.id, period: '2026-10', amount: 200 })).s === 400);
    const po = (await o('POST', 'teacher-payouts', { teacher_id: tch.id, treasury_id: tr1.id, period: '2026-10', amount: 100 })).j;
    ok('الصرف ينقص المتبقي والرصيد', (await o('GET', 'teacher-dues?period=2026-10')).j.find(x => x.teacher_id === tch.id).remaining === 25 && (await o('GET', 'treasuries')).j.find(t => t.id === tr1.id).balance === 750);
    ok('المدرس يرى مستحقاته فقط', (await call(T, 'GET', 'teacher-dues?period=2026-10')).j.length === 1);
    ok('المدرس لا يصرف', (await call(T, 'POST', 'teacher-payouts', { teacher_id: tch.id, treasury_id: tr1.id, period: '2026-10', amount: 1 })).s === 403);
    ok('المدرس لا يرى التقارير', (await call(T, 'GET', 'reports/revenue')).s === 403);
    ok('إلغاء الصرف يعيد المستحق', (await o('POST', `teacher-payouts/${po.id}/cancel`, { reason: 'صرف بالخطأ' })).s === 200 && (await o('GET', 'teacher-dues?period=2026-10')).j.find(x => x.teacher_id === tch.id).remaining === 125);

    // التقارير
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    const rev = (await o('GET', `reports/revenue?from=2020-01-01&to=${today}`)).j;
    ok('تقرير الإيرادات = 250', rev.rows.length === 2 && rev.totals.amount === 250);
    ok('تقرير المصروفات = 400', (await o('GET', `reports/expenses?from=2020-01-01&to=${today}`)).j.totals.amount === 400);
    const debts = (await o('GET', `reports/debts?to=2026-12-31`)).j;
    ok('تقرير الديون: منى مدينة بـ 200 فقط', debts.rows.length === 1 && debts.rows[0].student === 'منى' && debts.rows[0].remaining === 200);
    const col = (await o('GET', `reports/collection?from=2026-10-01&to=2026-10-31`)).j;
    ok('تقرير التحصيل: مستحق 450 محصّل 250', col.totals.due === 450 && col.totals.collected === 250);
    ok('ملخص مالي: الصافي', (await o('GET', `reports/summary?from=2020-01-01&to=${today}`)).j.summary.find(s => s.label === 'الصافي').value === -150);
    ok('الموظف لا يرى التقارير', (await call(E1, 'GET', 'reports/revenue')).s === 403);
    const x = await o('GET', `reports/revenue?from=2020-01-01&to=${today}&format=xlsx`);
    fs.writeFileSync('/tmp/revenue.xlsx', x.buf);
    ok('تصدير Excel صالح (ملف zip)', x.s === 200 && x.buf.slice(0, 2).toString() === 'PK');

    // إلغاء إيصال
    ok('إلغاء إيصال بسبب', (await o('POST', `payments/${p1.j.id}/cancel`, { reason: 'إدخال خاطئ' })).j.status === 'cancelled');
    ok('بعد الإلغاء يعود المتبقي', (await o('GET', `subscriptions/${sub.id}`)).j.remaining === 100);
    ok('لا تُلغى خزينة عليها حركات', (await o('DELETE', `treasuries/${tr1.id}`)).s === 400);
    console.log('\nكل اختبارات المرحلة الثانية نجحت');
  } catch (e) { console.error('FAIL:', e.message); process.exitCode = 1; }
  srv.close();
});
