// المرحلة 6: لوحة الإدارة المركزية (FR-160–163) — مشرف المنصة فقط، بلا بيانات طلاب أو مالية للسناتر
const PLAN_LABEL = { basic: 'أساسية', pro: 'احترافية', ai: 'الذكاء' };
window.admSave = async id => {
  try { await api(`admin/centers/${id}`, 'PUT', { plan: V('pl_' + id), ai_monthly_quota: Number(V('q_' + id)), active: document.getElementById('a_' + id).checked ? 1 : 0 });
    admLoad(); } catch (e) { alert(e.message); }
};
window.admCreate = async () => {
  try { await api('admin/centers', 'POST', { name: V('cn'), owner_name: V('con'), owner_phone: V('cph'), owner_password: V('cpw'), plan: V('cpl'), ai_monthly_quota: Number(V('cq')) });
    document.getElementById('cmsg').className = 'ok'; document.getElementById('cmsg').textContent = 'تم إنشاء السنتر ومالكه'; admLoad(); }
  catch (e) { document.getElementById('cmsg').className = 'err'; document.getElementById('cmsg').textContent = e.message; }
};
async function admLoad() {
  const box = document.getElementById('admOut'); if (!box) return;
  const [st, cs, au] = await Promise.all([api('admin/stats'), api('admin/centers'), api('admin/audit?limit=50')]);
  box.innerHTML = `<div class="row" style="flex-wrap:wrap">${[['السناتر', st.centers], ['نشطة', st.active_centers], ['موقوفة', st.suspended_centers], ['الطلاب', st.students], ['المجموعات', st.groups], ['توكنات الذكاء هذا الشهر', st.ai_tokens_this_month]]
    .map(([l, v]) => `<div class="card" style="flex:1;min-width:140px;margin:0"><div style="color:#555;font-size:13px">${l}</div><div style="font-size:22px;font-weight:bold">${Number(v).toLocaleString('en-US')}</div></div>`).join('')}</div>
    <div class="card"><h3>السناتر</h3><table><tr><th>الاسم</th><th>المالك</th><th>الباقة</th><th>حصة الذكاء (توكن/شهر)</th><th>نشط</th><th></th></tr>
    ${cs.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.owner_name || '—')}</td>
      <td><select id="pl_${c.id}">${Object.entries(PLAN_LABEL).map(([k, v]) => `<option value="${k}" ${k === c.plan ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input id="q_${c.id}" type="number" min="0" value="${c.ai_monthly_quota}"></td>
      <td><input id="a_${c.id}" type="checkbox" ${c.active ? 'checked' : ''} style="width:auto"></td>
      <td><button onclick="admSave(${c.id})">حفظ</button></td></tr>`).join('') || '<tr><td colspan="6">لا توجد سناتر</td></tr>'}</table></div>
    <div class="card"><h3>إنشاء سنتر جديد ومالكه</h3><div class="row">
      <div><label>اسم السنتر</label><input id="cn"></div><div><label>اسم المالك</label><input id="con"></div><div><label>هاتف المالك</label><input id="cph"></div>
      <div><label>كلمة مرور المالك (8+)</label><input id="cpw" type="password"></div>
      <div><label>الباقة</label><select id="cpl">${Object.entries(PLAN_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div><label>حصة الذكاء</label><input id="cq" type="number" min="0" value="200000"></div></div>
      <div style="margin-top:8px"><button onclick="admCreate()">إنشاء</button></div><div id="cmsg"></div></div>
    <div class="card"><h3>سجل النشاط (آخر 50)</h3>${tbl(['الوقت', 'المشرف', 'السنتر', 'الإجراء', 'التفاصيل'], au.map(a => [a.created_at, esc(a.actor_name || ''), esc(a.center_name || ''), esc(a.action), `<code style="font-size:11px">${esc(a.detail)}</code>`]))}</div>`;
}
def('admin', 'إدارة المنصة', ['super_admin'], async () => { main.innerHTML = `<h2>إدارة المنصة</h2><div id="admOut">جارٍ التحميل...</div>`; admLoad(); });
