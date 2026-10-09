// واجهات المرحلة الثالثة: الطالب، ولي الأمر، الإشعارات، وإدارة الحسابات للموظفين
const KIDROLES = ['student', 'parent'];
const ASTAT = { present: 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'بعذر' };
const NTYPE = { absence: 'غياب', late: 'تأخر', change: 'تغييرات الحصص' };
const WDN = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

// ---------- لوحة الطالب / ولي الأمر ----------
def('portal', 'لوحتي', KIDROLES, async () => {
  const kids = await api('portal/children');
  if (!kids.length) { main.innerHTML = '<h2>لوحتي</h2><div class="card">لا توجد بيانات مرتبطة بحسابك. تواصل مع إدارة السنتر.</div>'; return; }
  const st = window._pt || (window._pt = { kid: kids[0].id, tab: 'schedule' }); if (!kids.some(k => k.id == st.kid)) st.kid = kids[0].id;
  const tabs = { schedule: 'الجدول', attendance: 'الحضور', subscriptions: 'الاشتراكات', payments: 'المدفوعات والإيصالات', exams: 'الامتحانات والنتائج', lessons: 'تقدم الدروس' };
  main.innerHTML = `<div class="bar"><h2>لوحتي</h2></div><div class="card row">${kids.length > 1 || me.role == 'parent' ? `<div><label>الطالب</label><select id="pk" onchange="_pt.kid=+V('pk');PAGES.portal()">${opts(kids, st.kid, k => k.name)}</select></div>` : `<div><b>${esc(kids[0].name)}</b></div>`}
    <div style="flex:3">${Object.entries(tabs).map(([k, v]) => `<button class="${k == st.tab ? '' : 's'}" onclick="_pt.tab='${k}';PAGES.portal()">${v}</button>`).join(' ')}</div></div><div id="pc"></div>`;
  const q = '?student_id=' + st.kid;
  if (st.tab == 'schedule') {
    const j = await api('portal/schedule' + q);
    pc.innerHTML = `<h3>الجدول الأسبوعي</h3>` + tbl(['اليوم', 'من', 'إلى', 'المجموعة', 'المادة', 'المدرس', 'القاعة'], j.weekly.map(w => [WDN[w.weekday], w.start_time, w.end_time, esc(w.group_name), esc(w.subject || ''), esc(w.teacher_name), esc(w.room_name || '')])) +
      `<h3>الحصص القادمة (14 يوماً)</h3>` + tbl(['التاريخ', 'من', 'إلى', 'المجموعة', 'القاعة', 'الحالة'], j.upcoming.map(s => [s.session_date, s.start_time, s.end_time, esc(s.group_name), esc(s.room_name || ''), s.status == 'cancelled' ? '<span class="err">ملغاة</span>' : s.status == 'done' ? 'تمت' : 'مجدولة']));
  } else if (st.tab == 'attendance') {
    const j = await api('portal/attendance' + q), s = j.summary;
    pc.innerHTML = `<div class="card">آخر 90 يوماً — حاضر: <b>${s.present}</b> | غائب: <b class="err">${s.absent}</b> | متأخر: <b>${s.late}</b> | بعذر: <b>${s.excused}</b></div>` +
      tbl(['التاريخ', 'الوقت', 'المجموعة', 'الحالة', 'ملاحظة'], j.rows.map(r => [r.session_date, r.start_time, esc(r.group_name), ASTAT[r.status], esc(r.note || '')]));
  } else if (st.tab == 'exams') {
    pc.innerHTML = tbl(['الامتحان', 'النوع', 'المجموعة', 'المحاولة', 'التسليم', 'النتيجة'], (await api('child/exams' + q)).map(e => [esc(e.title), e.kind == 'exam' ? 'امتحان' : 'واجب', esc(e.group_name), e.attempt_no, fdt(e.submitted_at),
      e.score != null ? `<b>${e.score} / ${e.max}</b> ${e.passed == null ? '' : e.passed ? '<span class="ok">ناجح</span>' : '<span class="err">لم يجتز</span>'}` : esc(e.status)]));
  } else if (st.tab == 'lessons') {
    pc.innerHTML = tbl(['الدرس', 'المجموعة', 'النوع', 'التقدم', ''], (await api('child/lessons' + q)).map(l => [esc(l.title), esc(l.group_name), l.type == 'live' ? 'مباشر' : 'مسجّل', Math.round(l.percent) + '%', l.completed ? '✔ مكتمل' : '']));
  } else if (st.tab == 'subscriptions') {
    pc.innerHTML = tbl(['الشهر', 'المجموعة', 'الصافي', 'المدفوع', 'المتبقي', 'الحالة'], (await api('portal/subscriptions' + q)).map(s => [s.period, esc(s.group_name), fmt(s.net), fmt(s.paid), `<b>${fmt(s.remaining)}</b>`, s.status == 'cancelled' ? 'ملغي' : s.remaining > 0 ? 'عليه متبقي' : 'مسدد']));
  } else {
    pc.innerHTML = tbl(['إيصال', 'التاريخ', 'المجموعة', 'الشهر', 'الطريقة', 'المبلغ', ''], (await api('portal/payments' + q)).map(p => ['#' + p.receipt_no, p.paid_at, esc(p.group_name), p.period, METH[p.method], fmt(p.amount) + ' ' + badge(p.status), `<button class="s" onclick="myReceipt(${p.id})">إيصال</button>`]));
  }
  window.myReceipt = async id => { const p = await api('portal/receipts/' + id);
    printHtml('إيصال #' + p.receipt_no, `<h2>${esc(p.tenant_name)}</h2><h3>إيصال رقم ${p.receipt_no} ${p.status == 'cancelled' ? '(ملغي)' : ''}</h3><table><tr><th>التاريخ</th><td>${p.paid_at}</td><th>الفرع</th><td>${esc(p.branch_name || 'المركز')}</td></tr>
    <tr><th>الطالب</th><td>${esc(p.student_name)}</td><th>المجموعة</th><td>${esc(p.group_name)}</td></tr><tr><th>عن شهر</th><td>${p.period}</td><th>طريقة الدفع</th><td>${METH[p.method]}</td></tr>
    <tr class="t"><th>المبلغ</th><td colspan="3">${fmt(p.amount)} جنيه مصري</td></tr></table>${p.status == 'cancelled' ? `<p>سبب الإلغاء: ${esc(p.cancel_reason)}</p>` : ''}`); };
});

// ---------- الإشعارات والتفضيلات ----------
def('notifs', 'الإشعارات', KIDROLES, async () => {
  const [ns, pr] = await Promise.all([api('notifications?limit=100'), api('notification-prefs')]);
  main.innerHTML = `<div class="bar"><h2>الإشعارات</h2><button class="s" onclick="readAll()">تعليم الكل كمقروء</button></div>
  <div class="card"><b>تفضيلات الإشعارات:</b> ${Object.entries(NTYPE).map(([k, v]) => `<label style="display:inline-block;margin:0 12px"><input type="checkbox" style="width:auto" ${pr[k] ? 'checked' : ''} onchange="setPref('${k}',this.checked)"> ${v}</label>`).join('')}</div>` +
    (ns.map(n => `<div class="card" style="${n.read_at ? 'opacity:.65' : 'border-right:4px solid #2e75b6'};cursor:pointer" onclick="readN(${n.id})"><b>${esc(n.title)}</b> <small>(${NTYPE[n.type]})</small>
      <div>${esc(n.body)}</div><small style="color:#777">${esc(n.created_at)} ${n.read_at ? '' : '— جديد'}</small></div>`).join('') || '<div class="card">لا توجد إشعارات</div>');
  window.readN = async id => { await api(`notifications/${id}/read`, 'POST'); PAGES.notifs(); badgeN(); };
  window.readAll = async () => { await api('notifications/read-all', 'POST'); PAGES.notifs(); badgeN(); };
  window.setPref = async (k, v) => { await api('notification-prefs', 'PUT', { [k]: v }); };
});
async function badgeN() { const el = document.getElementById('n_notifs'); if (!el) return; try { const { unread } = await api('notifications?count=1'); el.innerHTML = `الإشعارات${unread ? ` <span style="background:#c0392b;border-radius:10px;padding:1px 8px;font-size:12px">${unread}</span>` : ''}`; } catch { } }
window.afterNav = () => { badgeN(); if (!window._bt) window._bt = setInterval(badgeN, 60000); };

// ---------- إدارة الحسابات (للموظفين) ----------
def('accounts', 'حسابات الطلاب والأولياء', STAFFR, async () => {
  const [sa, ps] = await Promise.all([api('student-accounts'), api('parents')]), mgr = isMgr(), RL = { father: 'أب', mother: 'أم', guardian: 'وصي' };
  main.innerHTML = `<h2>حسابات الطلاب وأولياء الأمور</h2><div id="fm"></div>
  <h3>حسابات الطلاب</h3>` + tbl(['الطالب', 'الصف', 'هاتف الدخول', 'الحالة', 'أولياء الأمور', ''], sa.map(s => [esc(s.name), esc(s.grade || ''), s.account_phone || '—', s.user_id ? (s.account_active ? 'مفعّل' : '<span class="err">معطّل</span>') : 'لا يوجد حساب', s.parents,
    !s.user_id ? `<button onclick="saNew(${s.id})">إنشاء حساب</button>` : mgr ? `<button class="s" onclick="saReset(${s.id})">كلمة مرور جديدة</button> <button class="${s.account_active ? 'd' : ''}" onclick="saToggle(${s.id},${s.account_active ? 0 : 1})">${s.account_active ? 'تعطيل' : 'تفعيل'}</button>` : '']))
  + `<div class="bar" style="margin-top:20px"><h3>أولياء الأمور</h3><button onclick="pNew()">+ ولي أمر</button></div>` +
  tbl(['الاسم', 'الهاتف', 'الحالة', 'الأبناء', ''], ps.map(p => [esc(p.name), p.phone, p.active ? 'مفعّل' : '<span class="err">معطّل</span>',
    p.children.map(k => `${esc(k.name)} (${RL[k.relation]}) <a style="cursor:pointer;color:#c0392b" onclick="pUnlink(${p.id},${k.id})">✕</a>`).join('<br>'),
    `<button class="s" onclick="pLink(${p.id})">ربط طالب</button> ${mgr ? `<button class="s" onclick="pReset(${p.id})">كلمة مرور</button> <button class="${p.active ? 'd' : ''}" onclick="pToggle(${p.id},${p.active ? 0 : 1})">${p.active ? 'تعطيل' : 'تفعيل'}</button>` : ''}`]));
  const act = async fn => { try { await fn(); PAGES.accounts(); } catch (e) { alert(e.message); } };
  window.saNew = id => { const phone = prompt('رقم هاتف الدخول للطالب (11 رقماً):'); if (!phone) return; const password = prompt('كلمة المرور (6 أحرف على الأقل):'); if (!password) return; act(() => api('student-accounts', 'POST', { student_id: id, phone, password })); };
  window.saReset = id => { const password = prompt('كلمة المرور الجديدة:'); if (password) act(() => api(`student-accounts/${id}/reset`, 'POST', { password })); };
  window.saToggle = (id, on) => act(() => api(`student-accounts/${id}/${on ? 'enable' : 'disable'}`, 'POST'));
  window.pReset = id => { const password = prompt('كلمة المرور الجديدة:'); if (password) act(() => api('parents/' + id, 'PUT', { password })); };
  window.pToggle = (id, on) => act(() => api('parents/' + id, 'PUT', { active: !!on }));
  window.pUnlink = (p, s) => { if (confirm('فك ربط الطالب؟ سيفقد ولي الأمر الوصول لبياناته فوراً.')) act(() => api(`parents/${p}/students/${s}`, 'DELETE')); };
  const relSel = `<select id="pr"><option value="father">أب</option><option value="mother">أم</option><option value="guardian">وصي</option></select>`;
  window.pNew = () => { fm.innerHTML = `<div class="card"><div class="row">${fld('الاسم', '<input id="pn">')}${fld('هاتف الدخول', '<input id="pp">')}${fld('كلمة المرور', '<input id="pw" type="password">')}${fld('الصلة', relSel)}
    ${fld('الأبناء (اختر أكثر من طالب بـ Ctrl)', `<select id="ps" multiple size="5">${opts(sa, 0, s => s.name)}</select>`)}</div><div class="err" id="fe"></div>
    <button onclick="pSave()">حفظ</button> <button class="s" onclick="fm.innerHTML=''">إلغاء</button></div>`; window.scrollTo(0, 0); };
  window.pSave = async () => { try { await api('parents', 'POST', { name: V('pn'), phone: V('pp'), password: V('pw'), relation: V('pr'), student_ids: [...ps2()].map(Number) }); PAGES.accounts(); } catch (e) { fe.textContent = e.message; } };
  const ps2 = () => [...document.getElementById('ps').selectedOptions].map(o => o.value);
  window.pLink = id => { fm.innerHTML = `<div class="card"><div class="row">${fld('الطالب', `<select id="ls">${opts(sa, 0, s => s.name)}</select>`)}${fld('الصلة', relSel)}</div><div class="err" id="fe"></div>
    <button onclick="pLinkSave(${id})">ربط</button> <button class="s" onclick="fm.innerHTML=''">إلغاء</button></div>`; window.scrollTo(0, 0); };
  window.pLinkSave = async id => { try { await api(`parents/${id}/students`, 'POST', { student_id: +V('ls'), relation: V('pr') }); PAGES.accounts(); } catch (e) { fe.textContent = e.message; } };
});
