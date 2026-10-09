// المرحلة 6: لوحات المؤشرات والتقارير المتقدمة (FR-150–152) — رسوم HTML/CSS خالصة بلا مكتبات
const DASH_ROLES = ['owner', 'manager', 'teacher', 'employee'];
const KP = { revenue_net: 'صافي الإيراد', revenue: 'المحصّل', refunds: 'المسترد', expenses: 'المصروفات', attendance_rate: 'نسبة الحضور %', absences: 'الغياب', active_groups: 'المجموعات النشطة', avg_fill_pct: 'متوسط الامتلاء %', pending_bookings: 'حجوزات معلّقة', waitlist: 'قائمة الانتظار', new_inquiries: 'استفسارات جديدة', groups: 'المجموعات', students: 'الطلاب', avg_attendance_pct: 'متوسط الحضور %', graded_exams: 'امتحانات مصححة', sessions_today: 'حصص اليوم', sessions_unmarked: 'حصص لم يُسجَّل حضورها' };
const tile = (k, v) => `<div class="card" style="flex:1;min-width:150px;margin:0"><div style="color:#555;font-size:13px">${KP[k] || k}</div><div style="font-size:22px;font-weight:bold">${v == null ? '—' : typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : esc(v)}</div></div>`;
const bar = (label, pct, extra = '') => `<div style="margin:6px 0"><div style="display:flex;justify-content:space-between"><span>${esc(label)}</span><span>${pct == null ? '—' : pct + '%'} ${extra}</span></div>
  <div style="background:#e5e9ef;border-radius:6px;height:10px"><div style="background:${(pct ?? 0) < 60 ? '#c0392b' : '#2e75b6'};height:10px;border-radius:6px;width:${Math.min(100, pct ?? 0)}%"></div></div></div>`;
function dashFilters(showBranch, showTeacher, branches, teachers) {
  return `<div class="card row"><div><label>من</label><input type="date" id="dfr" value="${new Date().toISOString().slice(0, 8)}01"></div>
    <div><label>إلى</label><input type="date" id="dto" value="${todayStr()}"></div>
    ${showBranch ? `<div><label>الفرع</label><select id="dbr"><option value="">كل الفروع</option>${opts(branches, '', o => o.name)}</select></div>` : ''}
    ${showTeacher ? `<div><label>المدرس</label><select id="dtc"><option value="">الكل</option>${opts(teachers, '', o => o.name)}</select></div>` : ''}
    <div style="flex:0"><button onclick="dashLoad()">تحديث</button></div></div>`;
}
const dashQS = () => { const p = new URLSearchParams(); const fr = document.getElementById('dfr'); if (fr) { p.set('from', fr.value); p.set('to', document.getElementById('dto').value); } const b = document.getElementById('dbr')?.value, t = document.getElementById('dtc')?.value; if (b) p.set('branch_id', b); if (t) p.set('teacher_id', t); return p.toString(); };
window.dashLoad = async () => {
  const out = document.getElementById('dashOut'); out.innerHTML = 'جارٍ التحميل...';
  try {
    const d = await api('analytics/dashboard?' + dashQS());
    if (d.kind === 'management') {
      const k = d.kpis;
      out.innerHTML = `<div class="row" style="flex-wrap:wrap">${['revenue_net', 'revenue', 'refunds', 'expenses', 'attendance_rate', 'avg_fill_pct', 'pending_bookings', 'waitlist', 'new_inquiries'].map(x => tile(x, k[x])).join('')}</div>
        <div class="row" style="align-items:flex-start;margin-top:12px"><div class="card"><h3>نمو الطلاب شهرياً</h3>${d.growth.map(g => bar(g.month, Math.min(100, g.n * 5), `(${g.n})`)).join('') || 'لا بيانات'}</div>
        <div class="card"><h3>الملخص المالي</h3>${tbl(['البند', 'القيمة'], d.finance_summary.map(s => [esc(s.label), fmt(s.value)]))}</div></div>
        <div class="card"><h3>امتلاء المجموعات</h3>${d.groups.map(g => bar(`${g.name} — ${g.teacher}`, g.fill_pct, `(${g.enrolled}/${g.capacity})`)).join('') || 'لا توجد مجموعات'}</div>
        <div class="row" style="margin-top:8px"><button class="s" onclick="dashXlsx()">تصدير Excel</button><button class="s" onclick="dashPrint()">طباعة / PDF</button></div>`;
      window._dash = d;
    } else if (d.kind === 'teacher') {
      const k = d.kpis;
      out.innerHTML = `<div class="row" style="flex-wrap:wrap">${['groups', 'students', 'avg_attendance_pct', 'graded_exams'].map(x => tile(x, k[x])).join('')}</div>
        <div class="card"><h3>نسبة الحضور لكل مجموعة</h3>${d.attendance.map(a => bar(a.name, a.rate)).join('') || 'لا توجد حصص في الفترة'}</div>
        <div class="card"><h3>نتائج الامتحانات</h3>${tbl(['الامتحان', 'المحاولات', 'متوسط الدرجات %'], d.exams.map(e => [esc(e.title), e.attempts, e.avg_pct ?? '—']))}</div>`;
    } else {
      const k = d.kpis;
      out.innerHTML = `<div class="row" style="flex-wrap:wrap">${['sessions_today', 'sessions_unmarked', 'pending_bookings', 'new_inquiries'].map(x => tile(x, k[x])).join('')}</div>
        <div class="card"><h3>حصص اليوم (${esc(d.date)})</h3>${tbl(['الوقت', 'المجموعة', 'الحالة'], d.sessions.map(s => [`${s.start_time} — ${s.end_time}`, esc(s.group_name), s.status == 'done' ? 'تم' : s.status == 'cancelled' ? 'ملغاة' : 'مجدولة']))}</div>`;
    }
  } catch (e) { out.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
};
window.dashXlsx = async () => { try { const r = await fetch('/api/analytics/dashboard?' + dashQS() + '&format=xlsx', { headers: { Authorization: 'Bearer ' + tok } });
  if (!r.ok) throw new Error((await r.json()).error); const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'dashboard.xlsx'; a.click(); } catch (e) { alert(e.message); } };
window.dashPrint = () => { if (!window._dash) return; const k = window._dash.kpis;
  printHtml('لوحة المؤشرات', `<h2>لوحة المؤشرات</h2><p>من ${window._dash.from} إلى ${window._dash.to}</p>${tbl(['المؤشر', 'القيمة'], Object.entries(k).map(([a, v]) => [KP[a] || a, v]))}`); };
def('dash', 'لوحة المؤشرات', DASH_ROLES, async () => {
  let branches = [], teachers = [];
  if (MGR.includes(me.role)) [branches, teachers] = await Promise.all([api('branches').catch(() => []), api('teachers').catch(() => [])]);
  main.innerHTML = `<h2>لوحة المؤشرات</h2>${me.role === 'employee' ? '' : dashFilters(me.role === 'owner', MGR.includes(me.role), branches, teachers)}<div id="dashOut"></div>`;
  dashLoad();
});
