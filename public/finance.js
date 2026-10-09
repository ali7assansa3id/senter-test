// واجهات المرحلة الثانية: المالية
const PAGES = {};
const STAFFR = ['owner', 'manager', 'employee'], MGR = ['owner', 'manager'];
const def = (key, title, roles, fn) => { fn.title = title; fn.roles = roles; PAGES[key] = fn; };
const fmt = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const METH = { cash: 'نقدي', transfer: 'تحويل', other: 'أخرى' };
const PLAN = { monthly: 'شهري', per_session: 'بالحصة', course: 'كورس' };
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const opts = (arr, sel, lab) => arr.map(o => `<option value="${o.id}" ${o.id == sel ? 'selected' : ''}>${esc(lab(o))}</option>`).join('');
const tbl = (heads, rows) => `<table><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${heads.length}">لا توجد بيانات</td></tr>`}</table>`;
const V = id => document.getElementById(id).value;
const fld = (label, inner) => `<div><label>${label}</label>${inner}</div>`;
const badge = s => s == 'cancelled' ? '<span class="err">ملغي</span>' : '';
const isMgr = () => MGR.includes(me.role);
const range = { from: todayStr().slice(0, 8) + '01', to: todayStr() };
const rangeBar = (fn) => `<div class="card row"><div><label>من</label><input type="date" id="rf" value="${range.from}"></div><div><label>إلى</label><input type="date" id="rt" value="${range.to}"></div><button onclick="range.from=V('rf');range.to=V('rt');${fn}()">عرض</button></div>`;
function printHtml(title, body) {
  const w = window.open('', '_blank'); if (!w) return alert('اسمح بالنوافذ المنبثقة للطباعة');
  w.document.write(`<html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Tahoma,Arial;padding:24px}table{width:100%;border-collapse:collapse;margin-top:10px}td,th{border:1px solid #888;padding:6px;text-align:right}th{background:#eee}h2,h3{text-align:center}.t{font-weight:bold;background:#f5f5f5}</style></head><body>${body}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}
async function cancelWith(path, reload) { const reason = prompt('سبب الإلغاء (إلزامي):'); if (!reason) return; try { await api(path, 'POST', { reason }); reload(); } catch (e) { alert(e.message); } }

// ---------- الخزائن ----------
def('treasuries', 'الخزائن', STAFFR, async () => {
  const [ts, brs] = await Promise.all([api('treasuries'), api('branches')]); const own = me.role == 'owner';
  main.innerHTML = `<div class="bar"><h2>الخزائن</h2>${own ? `<button onclick="tForm()">+ خزينة</button>` : ''}</div><div id="fm"></div>` +
    tbl(['الخزينة', 'الفرع', 'الرصيد', 'الحالة', ''], ts.map(t => [esc(t.name), esc(brs.find(b => b.id == t.branch_id)?.name || 'مركزية'), `<b>${fmt(t.balance)}</b> ج.م`, t.active ? 'نشطة' : 'معطّلة',
      own ? `<button class="s" onclick="tForm(${ja(t)})">تعديل</button>` : '']));
  window.tForm = (t = {}) => { fm.innerHTML = `<div class="card"><div class="row">${fld('الاسم', `<input id="tn" value="${esc(t.name || '')}">`)}
    ${fld('الفرع', `<select id="tb"><option value="">مركزية</option>${opts(brs, t.branch_id, b => b.name)}</select>`)}${fld('الرصيد الافتتاحي', `<input id="to" type="number" step="0.01" value="${t.opening_balance ?? 0}">`)}
    ${t.id ? fld('الحالة', `<select id="ta"><option value="1" ${t.active ? 'selected' : ''}>نشطة</option><option value="0" ${t.active ? '' : 'selected'}>معطّلة</option></select>`) : ''}</div><div class="err" id="fe"></div>
    <button onclick="tSave(${t.id || 0})">حفظ</button> <button class="s" onclick="fm.innerHTML=''">إلغاء</button></div>`; };
  window.tSave = async id => { const b = { name: V('tn'), branch_id: V('tb') ? +V('tb') : null, opening_balance: +V('to') }; if (id) b.active = +V('ta');
    try { await api(id ? 'treasuries/' + id : 'treasuries', id ? 'PUT' : 'POST', b); PAGES.treasuries(); } catch (e) { fe.textContent = e.message; } };
});

// ---------- الاشتراكات ----------
def('subscriptions', 'الاشتراكات', STAFFR, async () => {
  const f = window._sf || (window._sf = { period: todayStr().slice(0, 7), status: 'active' });
  const subs = await api(`subscriptions?period=${f.period}${f.status ? '&status=' + f.status : ''}`);
  main.innerHTML = `<div class="bar"><h2>الاشتراكات</h2><button onclick="sForm()">+ اشتراك</button></div><div id="fm"></div>
  <div class="card row"><div><label>الشهر</label><input type="month" id="sp" value="${f.period}"></div><div><label>الحالة</label><select id="ss2"><option value="">الكل</option><option value="active" ${f.status == 'active' ? 'selected' : ''}>نشط</option><option value="cancelled" ${f.status == 'cancelled' ? 'selected' : ''}>ملغي</option></select></div>
  <button onclick="_sf.period=V('sp');_sf.status=V('ss2');PAGES.subscriptions()">عرض</button></div>` +
    tbl(['الطالب', 'المجموعة', 'النظام', 'الصافي', 'المدفوع', 'المتبقي', ''], subs.map(s => [esc(s.student_name), esc(s.group_name), PLAN[s.plan_type] + ' ' + (s.plan_type == 'course' ? s.start_date + ' → ' + s.end_date : s.plan_type == 'per_session' ? s.sessions_count + ' حصص' : s.period), fmt(s.net), fmt(s.paid), `<b>${fmt(s.remaining)}</b> ${badge(s.status)}`,
      s.status == 'active' ? `<button class="s" onclick="renewSub(${s.id},'${s.plan_type}')">تجديد</button> ${s.remaining > 0 ? `<button onclick="goPay(${s.id})">تحصيل</button> ` : ''}${isMgr() && !s.paid ? `<button class="d" onclick="cancelWith('subscriptions/${s.id}/cancel',PAGES.subscriptions)">إلغاء</button>` : ''}` : '']));
  window.goPay = id => { window._paySub = id; go('payments'); };
  window.sForm = async () => { const sts = await api('students'); fm.innerHTML = `<div class="card"><div class="row">${fld('الطالب', `<select id="sst" onchange="loadG()"><option value="">—</option>${opts(sts, 0, s => s.name)}</select>`)}
    ${fld('المجموعة', '<select id="sg"></select>')}${fld('النظام', `<select id="sk" onchange="skCh()">${Object.entries(PLAN).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`)}
    <div id="sk_m">${fld('الشهر', `<input type="month" id="spp" value="${f.period}">`)}${fld('القيمة', '<input id="sa" type="number" step="0.01">')}</div>
    <div id="sk_p" style="display:none">${fld('عدد الحصص', '<input id="sc" type="number" min="1">')}${fld('سعر الحصة', '<input id="su" type="number" step="0.01">')}</div>
    <div id="sk_c" style="display:none">${fld('بداية الكورس', '<input id="sd1" type="date">')}${fld('نهاية الكورس', '<input id="sd2" type="date">')}${fld('سعر الكورس', '<input id="sca" type="number" step="0.01">')}</div>${fld('الخصم', '<input id="sd" type="number" step="0.01" value="0">')}</div>
    <div class="err" id="fe"></div><button onclick="sSave()">حفظ</button> <button class="s" onclick="fm.innerHTML=''">إلغاء</button></div>`; };
  window.skCh = () => { sk_m.style.display = V('sk') == 'monthly' ? '' : 'none'; sk_p.style.display = V('sk') == 'per_session' ? '' : 'none'; sk_c.style.display = V('sk') == 'course' ? '' : 'none'; };
  window.renewSub = async (id, plan) => { try { let b = {};
    if (plan == 'course') { const a = prompt('بداية الكورس الجديد (YYYY-MM-DD)'), z = a && prompt('نهاية الكورس الجديد (YYYY-MM-DD)'); if (!z) return; b = { start_date: a, end_date: z }; }
    else if (!confirm(plan == 'monthly' ? 'تجديد للشهر التالي بنفس القيمة؟' : 'شراء باقة حصص جديدة بنفس العدد والقيمة؟')) return;
    await api(`subscriptions/${id}/renew`, 'POST', b); PAGES.subscriptions(); } catch (e) { alert(e.message); } };
  window.loadG = async () => { const g = V('sst') ? await api('student-groups?student_id=' + V('sst')) : []; sg.innerHTML = opts(g, 0, x => x.name); };
  window.sSave = async () => { try { const k = V('sk'), b = { student_id: +V('sst'), group_id: +V('sg'), plan_type: k, discount: +V('sd') || 0 };
    if (k == 'monthly') Object.assign(b, { period: V('spp'), amount: +V('sa') }); else if (k == 'per_session') Object.assign(b, { sessions_count: +V('sc'), unit_price: +V('su') }); else Object.assign(b, { start_date: V('sd1'), end_date: V('sd2'), amount: +V('sca') });
    await api('subscriptions', 'POST', b); PAGES.subscriptions(); } catch (e) { fe.textContent = e.message; } };
});

// ---------- التحصيل ----------
def('payments', 'التحصيل والإيصالات', STAFFR, async () => {
  const [ps, subs, ts] = await Promise.all([api(`payments?from=${range.from}&to=${range.to}`), api('subscriptions?status=active'), api('treasuries')]);
  const open = subs.filter(s => s.remaining > 0), pre = window._paySub; window._paySub = null;
  main.innerHTML = `<div class="bar"><h2>التحصيل والإيصالات</h2><button onclick="pForm()">+ تحصيل جديد</button></div><div id="fm"></div>${rangeBar('PAGES.payments')}` +
    tbl(['إيصال', 'التاريخ', 'الطالب', 'المجموعة', 'الشهر', 'الطريقة', 'الخزينة', 'المبلغ', ''], ps.map(p => ['#' + p.receipt_no, p.paid_at, esc(p.student_name), esc(p.group_name), p.period, METH[p.method], esc(p.treasury_name), fmt(p.amount) + ' ' + badge(p.status),
      `<button class="s" onclick="receipt(${p.id})">إيصال</button> ${isMgr() && p.status == 'valid' ? `<button class="s" onclick="refundPay(${p.id},${p.amount})">استرداد</button> <button class="d" onclick="cancelWith('payments/${p.id}/cancel',PAGES.payments)">إلغاء</button>` : ''}`]));
  window.pForm = (sid = 0) => { fm.innerHTML = `<div class="card"><div class="row">${fld('الاشتراك', `<select id="pq" onchange="pq_()">${opts(open, sid, s => `${s.student_name} — ${s.group_name} — ${s.period} (متبقي ${fmt(s.remaining)})`)}</select>`)}
    ${fld('الخزينة', `<select id="pt">${opts(ts.filter(t => t.active), 0, t => t.name)}</select>`)}${fld('المبلغ', '<input id="pa" type="number" step="0.01">')}
    ${fld('الطريقة', `<select id="pm">${Object.entries(METH).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`)}${fld('ملاحظة', '<input id="pn">')}</div>
    <div class="err" id="fe"></div><button onclick="pSave()">تحصيل وإصدار إيصال</button> <button class="s" onclick="fm.innerHTML=''">إلغاء</button></div>`; pq_(); };
  window.refundPay = async (id, max) => { const a = prompt(`مبلغ الاسترداد (حتى ${fmt(max)})`), why = a && prompt('سبب الاسترداد (إلزامي):'); if (!why) return;
    try { await api(`payments/${id}/refund`, 'POST', { amount: +a, reason: why }); PAGES.payments(); } catch (e) { alert(e.message); } };
  window.pq_ = () => { const s = open.find(x => x.id == V('pq')); if (s) pa.value = s.remaining; };
  window.pSave = async () => { try { const p = await api('payments', 'POST', { subscription_id: +V('pq'), treasury_id: +V('pt'), amount: +V('pa'), method: V('pm'), note: V('pn') }); await PAGES.payments(); receipt(p.id); } catch (e) { fe.textContent = e.message; } };
  window.receipt = async id => { const p = await api('payments/' + id);
    printHtml('إيصال #' + p.receipt_no, `<h2>${esc(p.tenant_name)}</h2><h3>إيصال استلام نقدية رقم ${p.receipt_no} ${p.status == 'cancelled' ? '(ملغي)' : ''}</h3>
    <table><tr><th>التاريخ</th><td>${p.paid_at}</td><th>الفرع</th><td>${esc(p.branch_name || 'المركز')}</td></tr><tr><th>الطالب</th><td>${esc(p.student_name)}</td><th>المجموعة</th><td>${esc(p.group_name)}</td></tr>
    <tr><th>عن شهر</th><td>${p.period}</td><th>طريقة الدفع</th><td>${METH[p.method]}</td></tr><tr class="t"><th>المبلغ المدفوع</th><td colspan="3">${fmt(p.amount)} جنيه مصري</td></tr>
    <tr><th>صافي الاشتراك</th><td>${fmt(p.sub_net)}</td><th>المتبقي بعد الدفع</th><td>${fmt(p.sub_remaining)}</td></tr><tr><th>الخزينة</th><td>${esc(p.treasury_name)}</td><th>المستلم</th><td>${esc(p.created_by_name || '')}</td></tr></table>
    ${p.note ? `<p>ملاحظة: ${esc(p.note)}</p>` : ''}${p.status == 'cancelled' ? `<p>سبب الإلغاء: ${esc(p.cancel_reason)}</p>` : ''}`); };
  if (pre) pForm(pre);
});

// ---------- المصروفات ----------
def('expenses', 'المصروفات', MGR, async () => {
  const [es, ts] = await Promise.all([api(`expenses?from=${range.from}&to=${range.to}`), api('treasuries')]);
  main.innerHTML = `<div class="bar"><h2>المصروفات</h2><button onclick="eForm()">+ مصروف</button></div><div id="fm"></div>${rangeBar('PAGES.expenses')}` +
    tbl(['التاريخ', 'البند', 'الوصف', 'الخزينة', 'المبلغ', ''], es.map(e => [e.expense_date, esc(e.category), esc(e.description || ''), esc(e.treasury_name), fmt(e.amount) + ' ' + badge(e.status),
      e.status == 'valid' ? `<button class="d" onclick="cancelWith('expenses/${e.id}/cancel',PAGES.expenses)">إلغاء</button>` : '']));
  window.eForm = () => { fm.innerHTML = `<div class="card"><div class="row">${fld('الخزينة', `<select id="et">${opts(ts.filter(t => t.active), 0, t => `${t.name} (${fmt(t.balance)})`)}</select>`)}
    ${fld('البند', `<input id="ec" list="cats"><datalist id="cats"><option>إيجار</option><option>كهرباء ومياه</option><option>رواتب موظفين</option><option>صيانة</option><option>تسويق</option><option>مستلزمات</option><option>أخرى</option></datalist>`)}
    ${fld('المبلغ', '<input id="ea" type="number" step="0.01">')}${fld('التاريخ', `<input id="ed" type="date" value="${todayStr()}">`)}${fld('الوصف', '<input id="edd">')}</div>
    <div class="err" id="fe"></div><button onclick="eSave()">حفظ</button> <button class="s" onclick="fm.innerHTML=''">إلغاء</button></div>`; };
  window.eSave = async () => { try { await api('expenses', 'POST', { treasury_id: +V('et'), category: V('ec'), amount: +V('ea'), expense_date: V('ed'), description: V('edd') }); PAGES.expenses(); } catch (e) { fe.textContent = e.message; } };
});

// ---------- مستحقات المدرسين ----------
def('dues', 'مستحقات المدرسين', [...MGR, 'teacher'], async () => {
  const per = window._dp || (window._dp = todayStr().slice(0, 7)), mgr = isMgr();
  const [ds, po, ts] = await Promise.all([api('teacher-dues?period=' + per), api('teacher-payouts?period=' + per), mgr ? api('treasuries') : []]);
  main.innerHTML = `<h2>${mgr ? 'مستحقات المدرسين' : 'مستحقاتي'}</h2><div id="fm"></div><div class="card row"><div><label>الشهر</label><input type="month" id="dp" value="${per}"></div><button onclick="_dp=V('dp');PAGES.dues()">عرض</button></div>` +
    tbl(['المدرس', 'النظام', 'المحصّل من طلابه', 'المستحق', 'المصروف', 'المتبقي', ''], ds.map(d => [esc(d.name), d.pay_type == 'percentage' ? `نسبة ${d.pay_value}%` : d.pay_type == 'fixed' ? `ثابت ${fmt(d.pay_value)}` : 'غير محدد',
      fmt(d.collected), fmt(d.due), fmt(d.paid), `<b>${fmt(d.remaining)}</b>`, mgr && d.remaining > 0 ? `<button onclick="poForm(${d.teacher_id},${d.remaining})">صرف</button>` : ''])) +
    `<h3>سجل الصرف</h3>` + tbl(['المدرس', 'المبلغ', 'الخزينة', 'ملاحظة', ''], po.map(x => [esc(x.teacher_name), fmt(x.amount) + ' ' + badge(x.status), esc(x.treasury_name), esc(x.note || ''),
      mgr && x.status == 'valid' ? `<button class="d" onclick="cancelWith('teacher-payouts/${x.id}/cancel',PAGES.dues)">إلغاء</button>` : '']));
  window.poForm = (tid, rem) => { fm.innerHTML = `<div class="card"><div class="row">${fld('الخزينة', `<select id="xt">${opts(ts.filter(t => t.active), 0, t => `${t.name} (${fmt(t.balance)})`)}</select>`)}${fld('المبلغ', `<input id="xa" type="number" step="0.01" value="${rem}">`)}${fld('ملاحظة', '<input id="xn">')}</div>
    <div class="err" id="fe"></div><button onclick="poSave(${tid})">تأكيد الصرف</button> <button class="s" onclick="fm.innerHTML=''">إلغاء</button></div>`; window.scrollTo(0, 0); };
  window.poSave = async tid => { try { await api('teacher-payouts', 'POST', { teacher_id: tid, period: per, treasury_id: +V('xt'), amount: +V('xa'), note: V('xn') }); PAGES.dues(); } catch (e) { fe.textContent = e.message; } };
});

// ---------- التقارير ----------
const REPS = { summary: 'الملخص المالي', revenue: 'الإيرادات', expenses: 'المصروفات', debts: 'الديون', collection: 'التحصيل الشهري', 'teacher-dues': 'مستحقات المدرسين' };
def('reports', 'التقارير المالية', MGR, async () => {
  const brs = me.role == 'owner' ? await api('branches') : [];
  main.innerHTML = `<h2>التقارير المالية</h2><div class="card row"><div><label>التقرير</label><select id="rk">${Object.entries(REPS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
  <div><label>من</label><input type="date" id="rf" value="${range.from}"></div><div><label>إلى</label><input type="date" id="rt" value="${range.to}"></div>
  ${brs.length ? `<div><label>الفرع</label><select id="rb"><option value="">كل الفروع</option>${opts(brs, 0, b => b.name)}</select></div>` : ''}
  <button onclick="runRep()">عرض</button><button class="s" onclick="xlsxRep()">Excel</button><button class="s" onclick="pdfRep()">PDF / طباعة</button></div><div id="rep"></div><div class="err" id="re"></div>`;
  const qs = () => `from=${V('rf')}&to=${V('rt')}${document.getElementById('rb') && V('rb') ? '&branch_id=' + V('rb') : ''}`;
  const cellv = (r, c) => c.type == 'money' ? fmt(r[c.key]) : esc(r[c.key] ?? '');
  const html = j => `<h3>${esc(j.title)}</h3><p>من ${j.from} إلى ${j.to}</p>` + (j.summary.length ? `<table>${j.summary.map(s => `<tr><th>${esc(s.label)}</th><td>${fmt(s.value)}</td></tr>`).join('')}</table>` : '') +
    `<table><tr>${j.columns.map(c => `<th>${c.label}</th>`).join('')}</tr>${j.rows.map(r => `<tr>${j.columns.map(c => `<td>${cellv(r, c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${j.columns.length}">لا توجد بيانات</td></tr>`}
    ${j.totals ? `<tr class="t">${j.columns.map((c, i) => `<td><b>${i == 0 ? 'الإجمالي' : j.totals[c.key] != null ? fmt(j.totals[c.key]) : ''}</b></td>`).join('')}</tr>` : ''}</table>`;
  window.runRep = async () => { re.textContent = ''; try { window._rep = await api(`reports/${V('rk')}?${qs()}`); rep.innerHTML = html(_rep); } catch (e) { re.textContent = e.message; } };
  window.pdfRep = async () => { if (!window._rep) await runRep(); if (window._rep) printHtml(_rep.title, html(_rep)); };
  window.xlsxRep = async () => { try { const r = await fetch(`/api/reports/${V('rk')}?${qs()}&format=xlsx`, { headers: { Authorization: 'Bearer ' + tok } });
    if (!r.ok) throw new Error((await r.json()).error); const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = V('rk') + '.xlsx'; a.click(); } catch (e) { re.textContent = e.message; } };
  runRep();
});
