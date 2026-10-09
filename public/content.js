// واجهات المرحلة الرابعة: الدروس، المذكرات، بنك الأسئلة، الامتحانات والواجبات
const CONTENTR = ['owner', 'manager', 'employee', 'teacher'], AUTHORS = ['owner', 'manager', 'teacher'];
const QTYPE = { mcq: 'اختيار من متعدد', multi: 'متعدد الإجابات', true_false: 'صح / خطأ', short: 'إجابة قصيرة', essay: 'مقالي' };
const fdt = i => i ? new Date(i).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' }) : '—';
const dtv = i => i ? new Date(i).toLocaleString('sv-SE', { timeZone: 'Africa/Cairo' }).slice(0, 16).replace(' ', 'T') : '';
const isoOrNull = id => V(id) || null;
const canWrite = () => AUTHORS.includes(me.role);
async function upl(kind, id, file) {
  const r = await fetch(`/api/uploads/${kind}/${id}`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'x-filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }, body: file });
  const j = await r.json(); if (!r.ok) throw new Error(j.error); return j;
}
async function openMedia(kind, id) { const w = window.open('', '_blank'); try { const t = await api(`media-token?kind=${kind}&id=${id}`); if (w) w.location = t.url; else location.href = t.url; } catch (e) { if (w) w.close(); alert(e.message); } }
const fmtAns = (q, a) => { if (a == null || a === '') return '<i>— لم يُجب —</i>'; const o = q.options || [];
  if (q.type == 'mcq') return esc(o[a] ?? a); if (q.type == 'multi') return (Array.isArray(a) ? a : []).map(i => esc(o[i] ?? i)).join('، '); if (q.type == 'true_false') return a ? 'صح' : 'خطأ'; return esc(a); };
const fileIn = id => document.getElementById(id)?.files?.[0];

// ================= الدروس (إدارة) =================
def('lessons', 'الدروس الإلكترونية', CONTENTR, async () => {
  const gs = await api('groups'), g = window._lg || ''; const ls = await api('lessons' + (g ? '?group_id=' + g : '')), w = canWrite();
  main.innerHTML = `<div class="bar"><h2>الدروس الإلكترونية</h2>${w ? '<button onclick="lForm()">+ درس</button>' : ''}</div><div id="fm"></div>
  <div class="card row"><div><label>المجموعة</label><select onchange="_lg=this.value;PAGES.lessons()"><option value="">الكل</option>${opts(gs, g, x => x.name)}</select></div></div>` +
    tbl(['المجموعة', 'العنوان', 'النوع', 'الموعد', 'المحتوى', 'النشر', ''], ls.map(l => [esc(l.group_name), esc(l.title), l.type == 'live' ? 'مباشر' : 'مسجّل', fdt(l.scheduled_at), l.has_file ? 'فيديو مرفوع' : l.url ? 'رابط خارجي' : '<span class="err">لا يوجد</span>',
      l.published ? 'منشور' : 'مسودة', `<button class="s" onclick="lProg(${l.id})">التقدم</button> ${w ? `<button class="s" onclick="lForm(${ja(l)})">تعديل</button> <button class="d" onclick="lDel(${l.id})">حذف</button>` : ''}`]));
  window.lForm = (l = {}) => { fm.innerHTML = `<div class="card"><div class="row">${l.id ? '' : fld('المجموعة', `<select id="lg">${opts(gs, 0, x => x.name)}</select>`)}${l.id ? '' : fld('النوع', `<select id="lt"><option value="recorded">مسجّل</option><option value="live">مباشر (رابط خارجي)</option></select>`)}
    ${fld('العنوان', `<input id="ltt" value="${esc(l.title || '')}">`)}${fld('الرابط (http/https)', `<input id="lu" value="${esc(l.url || '')}" placeholder="رابط Zoom / Meet / يوتيوب">`)}
    ${fld('الموعد (للمباشر)', `<input id="ls" type="datetime-local" value="${dtv(l.scheduled_at)}">`)}${fld('المدة (دقيقة)', `<input id="ld" type="number" value="${l.duration_min || ''}">`)}${fld('الوصف', `<input id="lde" value="${esc(l.description || '')}">`)}
    ${fld('فيديو (mp4/webm) — للمسجّل', '<input id="lf" type="file" accept="video/mp4,video/webm">')}${l.id ? fld('النشر', `<select id="lp"><option value="0" ${l.published ? '' : 'selected'}>مسودة</option><option value="1" ${l.published ? 'selected' : ''}>منشور</option></select>`) : ''}</div>
    <div class="err" id="fe"></div><button onclick="lSave(${l.id || 0})">حفظ</button> <button class="s" onclick="fm.innerHTML=''">إلغاء</button></div>`; };
  window.lSave = async id => { try { const b = { title: V('ltt'), url: V('lu') || null, scheduled_at: isoOrNull('ls'), duration_min: V('ld') || null, description: V('lde') };
    let r; if (id) { b.published = V('lp') == '1'; r = await api('lessons/' + id, 'PUT', b); } else { b.group_id = +V('lg'); b.type = V('lt'); r = await api('lessons', 'POST', b); }
    if (fileIn('lf')) await upl('lesson', id || r.id, fileIn('lf')); PAGES.lessons(); } catch (e) { fe.textContent = e.message; } };
  window.lDel = async id => { if (confirm('حذف الدرس؟')) { await api('lessons/' + id, 'DELETE'); PAGES.lessons(); } };
  window.lProg = async id => { const p = await api(`lessons/${id}/progress`); fm.innerHTML = `<div class="card"><h3>تقدم الطلاب</h3>${tbl(['الطالب', 'التقدم %', 'الحالة'], p.map(x => [esc(x.name), x.percent, x.completed ? 'أكمل' : '—']))}<button class="s" onclick="fm.innerHTML=''">إغلاق</button></div>`; scrollTo(0, 0); };
});

// ================= المذكرات (إدارة) =================
def('materials', 'المذكرات والمواد', CONTENTR, async () => {
  const [gs, ms] = await Promise.all([api('groups'), api('materials')]), w = canWrite(), sj = window._ms || '';
  const subs = [...new Set(ms.map(m => m.subject))];
  main.innerHTML = `<div class="bar"><h2>مكتبة المذكرات</h2>${w ? '<button onclick="mForm()">+ مذكرة</button>' : ''}</div><div id="fm"></div>
  <div class="card row"><div><label>المادة</label><select onchange="_ms=this.value;PAGES.materials()"><option value="">الكل</option>${subs.map(s => `<option ${s == sj ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div></div>` +
    tbl(['المادة', 'الصف', 'العنوان', 'المجموعة', 'الإتاحة', 'الملف', ''], ms.filter(m => !sj || m.subject == sj).map(m => [esc(m.subject), esc(m.grade || ''), esc(m.title), esc(m.group_name || '—'), m.access == 'free' ? 'مجانية للصف' : 'لمشتركي المجموعة',
      m.has_file ? `<button class="s" onclick="openMedia('material',${m.id})">فتح</button>` : '<span class="err">بلا ملف</span>', w ? `<button class="s" onclick="mForm(${ja(m)})">تعديل</button> <button class="d" onclick="mDel(${m.id})">حذف</button>` : '']));
  window.mForm = (m = {}) => { fm.innerHTML = `<div class="card"><div class="row">${fld('العنوان', `<input id="mt" value="${esc(m.title || '')}">`)}${fld('المادة', `<input id="msu" value="${esc(m.subject || '')}">`)}${fld('الصف', `<input id="mg" value="${esc(m.grade || '')}">`)}
    ${fld('المجموعة', `<select id="mgr"><option value="">—</option>${opts(gs, m.group_id, x => x.name)}</select>`)}${fld('الإتاحة', `<select id="ma"><option value="group" ${m.access == 'free' ? '' : 'selected'}>لمشتركي المجموعة</option><option value="free" ${m.access == 'free' ? 'selected' : ''}>مجانية لطلاب الصف</option></select>`)}
    ${fld('الوصف', `<input id="mde" value="${esc(m.description || '')}">`)}${fld('الملف (PDF/Word/PowerPoint/Excel/صورة) حتى 25MB', '<input id="mf" type="file">')}</div>
    <div class="err" id="fe"></div><button onclick="mSave(${m.id || 0})">حفظ</button> <button class="s" onclick="fm.innerHTML=''">إلغاء</button></div>`; };
  window.mSave = async id => { try { const b = { title: V('mt'), subject: V('msu'), grade: V('mg'), group_id: V('mgr') ? +V('mgr') : null, access: V('ma'), description: V('mde') };
    const r = await api(id ? 'materials/' + id : 'materials', id ? 'PUT' : 'POST', b); if (fileIn('mf')) await upl('material', id || r.id, fileIn('mf')); PAGES.materials(); } catch (e) { fe.textContent = e.message; } };
  window.mDel = async id => { if (confirm('حذف المذكرة؟')) { await api('materials/' + id, 'DELETE'); PAGES.materials(); } };
});

// ================= بنك الأسئلة =================
def('qbank', 'بنك الأسئلة', AUTHORS, async () => {
  const f = window._qf || (window._qf = { type: '', subject: '' }), qs = await api(`question-bank?type=${f.type}&subject=${encodeURIComponent(f.subject)}`);
  main.innerHTML = `<div class="bar"><h2>بنك الأسئلة</h2><button onclick="qForm()">+ سؤال</button></div><div id="fm"></div>
  <div class="card row"><div><label>النوع</label><select id="qft"><option value="">الكل</option>${Object.entries(QTYPE).map(([k, v]) => `<option value="${k}" ${k == f.type ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
  <div><label>المادة</label><input id="qfs" value="${esc(f.subject)}"></div><button onclick="_qf.type=V('qft');_qf.subject=V('qfs');PAGES.qbank()">تصفية</button></div>` +
    tbl(['المادة', 'الصف', 'النوع', 'السؤال', 'الدرجة', ''], qs.map(q => [esc(q.subject), esc(q.grade || ''), QTYPE[q.type], esc(q.text.slice(0, 90)), q.points, `<button class="s" onclick="qForm(${ja(q)})">تعديل</button> <button class="d" onclick="qDel(${q.id})">حذف</button>`]));
  const dyn = (t, q = {}) => t == 'mcq' || t == 'multi' ? `${fld('الاختيارات (سطر لكل اختيار)', `<textarea id="qo" rows="4">${esc((q.options || []).join('\n'))}</textarea>`)}${fld(t == 'mcq' ? 'رقم الإجابة الصحيحة (من 1)' : 'أرقام الإجابات الصحيحة (مثال: 1,3)', `<input id="qa" value="${t == 'mcq' ? (q.answer != null ? q.answer + 1 : '') : (q.answer || []).map(i => i + 1).join(',')}">`)}`
    : t == 'true_false' ? fld('الإجابة الصحيحة', `<select id="qa"><option value="true" ${q.answer === false ? '' : 'selected'}>صح</option><option value="false" ${q.answer === false ? 'selected' : ''}>خطأ</option></select>`)
    : t == 'short' ? fld('الإجابات المقبولة (سطر لكل إجابة)', `<textarea id="qa" rows="3">${esc((q.answer || []).join('\n'))}</textarea>`) : '<div>تُصحَّح الإجابة المقالية يدوياً.</div>';
  window.qType = () => { document.getElementById('qdyn').innerHTML = dyn(V('qt')); };
  window.qForm = (q = {}) => { fm.innerHTML = `<div class="card"><div class="row">${fld('النوع', `<select id="qt" onchange="qType()" ${q.id ? 'disabled' : ''}>${Object.entries(QTYPE).map(([k, v]) => `<option value="${k}" ${k == q.type ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
    ${fld('المادة', `<input id="qs" value="${esc(q.subject || '')}">`)}${fld('الصف', `<input id="qg" value="${esc(q.grade || '')}">`)}${fld('الدرجة', `<input id="qp" type="number" step="0.5" value="${q.points || 1}">`)}</div>
    ${fld('نص السؤال', `<textarea id="qx" rows="3">${esc(q.text || '')}</textarea>`)}<div class="row" id="qdyn">${dyn(q.type || 'mcq', q)}</div>${fld('شرح الإجابة (يظهر إن فُعّل عرض الإجابات)', `<input id="qe" value="${esc(q.explanation || '')}">`)}
    <div class="err" id="fe"></div><button onclick="qSave(${q.id || 0},'${q.type || ''}')">حفظ</button> <button class="s" onclick="fm.innerHTML=''">إلغاء</button></div>`; };
  window.qSave = async (id, ty) => { try { const t = ty || V('qt'), b = { type: t, subject: V('qs'), grade: V('qg'), points: +V('qp'), text: V('qx'), explanation: V('qe') };
    if (t == 'mcq' || t == 'multi') { b.options = V('qo').split('\n').map(x => x.trim()).filter(Boolean); b.answer = t == 'mcq' ? +V('qa') - 1 : V('qa').split(/[,،]/).map(x => +x.trim() - 1); }
    else if (t == 'true_false') b.answer = V('qa') == 'true'; else if (t == 'short') b.answer = V('qa').split('\n').map(x => x.trim()).filter(Boolean);
    await api(id ? 'question-bank/' + id : 'question-bank', id ? 'PUT' : 'POST', b); PAGES.qbank(); } catch (e) { fe.textContent = e.message; } };
  window.qDel = async id => { if (confirm('حذف السؤال؟ الامتحانات القائمة تحتفظ بنسختها.')) { await api('question-bank/' + id, 'DELETE'); PAGES.qbank(); } };
});

// ================= الامتحانات والواجبات (إدارة) =================
const ESTAT = { draft: 'مسودة', published: 'منشور', closed: 'مغلق' }, ASTATUS = { in_progress: 'جارية', submitted: 'بانتظار التصحيح', graded: 'مصحَّحة' };
def('exams', 'الامتحانات والواجبات', CONTENTR, async () => {
  const es = await api('exams'), w = canWrite();
  main.innerHTML = `<div class="bar"><h2>الامتحانات والواجبات</h2>${w ? '<button onclick="eNew()">+ امتحان / واجب</button>' : ''}</div><div id="fm"></div>` +
    tbl(['العنوان', 'النوع', 'المجموعة', 'الفترة', 'الأسئلة', 'المحاولات', 'الحالة', ''], es.map(e => [esc(e.title), e.kind == 'exam' ? 'امتحان' : 'واجب', esc(e.group_name), `${fdt(e.start_at)} ← ${fdt(e.end_at)}`, e.questions, e.attempts,
      ESTAT[e.status] + (e.results_released_at ? ' — النتائج معلنة' : ''), w ? `${e.status == 'draft' ? `<button onclick="eAct(${e.id},'publish')">نشر</button> <button class="s" onclick="eEdit(${e.id})">تعديل</button> ` : ''}${e.status == 'published' ? `<button class="s" onclick="eAct(${e.id},'close')">إغلاق</button> ` : ''}${e.status != 'draft' && !e.results_released_at ? `<button onclick="eAct(${e.id},'release')">إعلان النتائج</button> ` : ''}<button class="s" onclick="eAtt(${e.id})">المحاولات</button> <button class="s" onclick="eStats(${e.id})">إحصاءات</button>${e.attempts ? '' : ` <button class="d" onclick="eDel(${e.id})">حذف</button>`}` : '']));
  window.eAct = async (id, a) => { if (a == 'release' && !confirm('سيرى الطلاب وأولياء الأمور النتائج فور الإعلان. متابعة؟')) return; try { await api(`exams/${id}/${a}`, 'POST'); PAGES.exams(); } catch (e) { alert(e.message); } };
  window.eDel = async id => { if (confirm('حذف؟')) { await api('exams/' + id, 'DELETE'); PAGES.exams(); } };
  window.eNew = () => eBuild(null);
  window.eEdit = async id => eBuild(await api('exams/' + id));
  async function eBuild(e) {
    const [gs, qs] = await Promise.all([api('groups'), api('question-bank')]), sel = Object.fromEntries((e?.questions || []).map(q => [q.question_id, q.points]));
    fm.innerHTML = `<div class="card"><h3>${e ? 'تعديل' : 'إنشاء'} امتحان / واجب</h3><div class="row">${fld('المجموعة', `<select id="xg" ${e ? 'disabled' : ''}>${opts(gs, e?.group_id, x => x.name)}</select>`)}
    ${fld('النوع', `<select id="xk"><option value="exam" ${e?.kind == 'exam' ? 'selected' : ''}>امتحان</option><option value="assignment" ${e?.kind == 'assignment' ? 'selected' : ''}>واجب</option></select>`)}${fld('العنوان', `<input id="xt" value="${esc(e?.title || '')}">`)}
    ${fld('يبدأ', `<input id="xs" type="datetime-local" value="${dtv(e?.start_at)}">`)}${fld('ينتهي', `<input id="xe" type="datetime-local" value="${dtv(e?.end_at)}">`)}${fld('المدة (دقيقة)', `<input id="xd" type="number" value="${e?.duration_min || ''}">`)}
    ${fld('عدد المحاولات', `<input id="xa" type="number" value="${e?.attempts_allowed || 1}">`)}${fld('درجة النجاح %', `<input id="xp" type="number" value="${e?.pass_mark ?? ''}">`)}${fld('الدرجة العظمى (واجب بملف فقط)', `<input id="xm" type="number" value="${e?.max_points ?? ''}">`)}
    ${fld('إعلان النتائج', `<select id="xr"><option value="manual" ${e?.release_mode == 'immediate' ? '' : 'selected'}>يدوي بعد المراجعة</option><option value="immediate" ${e?.release_mode == 'immediate' ? 'selected' : ''}>فوري بعد التصحيح</option></select>`)}
    ${fld('خيارات', `<label><input type="checkbox" style="width:auto" id="xsh" ${e?.shuffle ? 'checked' : ''}> ترتيب عشوائي للأسئلة</label><label><input type="checkbox" style="width:auto" id="xsa" ${e?.show_answers ? 'checked' : ''}> إظهار الإجابات الصحيحة بعد الإعلان</label>`)}</div>
    ${fld('وصف / تعليمات', `<input id="xde" value="${esc(e?.description || '')}">`)}<h4>الأسئلة (من بنك الأسئلة)</h4><div style="max-height:260px;overflow:auto;background:#f7f9fc;padding:8px;border-radius:6px">
    ${qs.map(q => `<div class="row" style="align-items:center"><label style="flex:5;margin:0"><input type="checkbox" style="width:auto" class="xq" value="${q.id}" ${sel[q.id] != null ? 'checked' : ''}> [${QTYPE[q.type]}] ${esc(q.text.slice(0, 80))}</label><input class="xp_${q.id}" type="number" step="0.5" style="flex:1" value="${sel[q.id] ?? q.points}"></div>`).join('') || 'لا توجد أسئلة في البنك'}</div>
    <div class="err" id="fe"></div><button onclick="eSave(${e?.id || 0})">حفظ كمسودة</button> <button class="s" onclick="fm.innerHTML=''">إلغاء</button></div>`; scrollTo(0, 0);
    window.eSave = async id => { try { const b = { title: V('xt'), kind: V('xk'), start_at: isoOrNull('xs'), end_at: isoOrNull('xe'), duration_min: V('xd') || null, attempts_allowed: +V('xa') || 1, pass_mark: V('xp') || null, max_points: V('xm') || null,
      release_mode: V('xr'), shuffle: xsh.checked, show_answers: xsa.checked, description: V('xde'), questions: [...document.querySelectorAll('.xq:checked')].map(c => ({ question_id: +c.value, points: +document.querySelector('.xp_' + c.value).value })) };
      if (!id) b.group_id = +V('xg'); await api(id ? 'exams/' + id : 'exams', id ? 'PUT' : 'POST', b); PAGES.exams(); } catch (e) { fe.textContent = e.message; } };
  }
  window.eStats = async id => { const s = await api(`exams/${id}/stats`); fm.innerHTML = `<div class="card"><h3>إحصاءات</h3><div>طلاب مصحَّحون: <b>${s.graded_students}</b> | قيد التصحيح/جارٍ: <b>${s.in_progress_or_pending}</b> | المتوسط: <b>${s.average ?? '—'}</b> من ${s.max_score} | الأعلى: <b>${s.highest ?? '—'}</b> | الأدنى: <b>${s.lowest ?? '—'}</b> | نسبة النجاح: <b>${s.pass_rate ?? '—'}${s.pass_rate != null ? '%' : ''}</b></div>
    ${tbl(['السؤال', 'نسبة الإجابة الصحيحة %'], s.questions.map(q => [esc(q.text.slice(0, 80)), q.correct_rate ?? '—']))}<button class="s" onclick="fm.innerHTML=''">إغلاق</button></div>`; scrollTo(0, 0); };
  window.eAtt = async id => { const a = await api(`exams/${id}/attempts`); fm.innerHTML = `<div class="card"><h3>المحاولات</h3>${tbl(['الطالب', 'المحاولة', 'الحالة', 'الدرجة', ''], a.map(x => [esc(x.student_name), x.attempt_no, ASTATUS[x.status], x.total_score != null ? `${x.total_score} / ${x.max_score}` : '—', x.status == 'in_progress' ? '' : `<button onclick="aGrade(${x.id})">تصحيح / مراجعة</button>`]))}<button class="s" onclick="fm.innerHTML=''">إغلاق</button></div>`; scrollTo(0, 0); };
  window.aGrade = async id => { const a = await api('attempts/' + id), noq = !a.questions.length;
    fm.innerHTML = `<div class="card"><h3>${esc(a.student_name)} — ${esc(a.exam.title)} (محاولة ${a.attempt_no})</h3>${a.has_file ? `<p>ملف التسليم: <button class="s" onclick="openMedia('submission',${id})">${esc(a.file_name)}</button></p>` : ''}
    ${a.questions.map(q => `<div class="card" style="background:#f7f9fc"><b>[${QTYPE[q.type]}] ${esc(q.text)}</b> <small>(${q.points} درجة)</small><div>إجابة الطالب: ${fmtAns(q, q.student_answer)}</div>${q.type != 'essay' ? `<div style="color:#1e8449">الصحيح: ${fmtAns(q, q.answer)}</div>` : ''}
      <div class="row" style="margin-top:6px"><div><label>الدرجة</label><input type="number" step="0.5" min="0" max="${q.points}" class="gp" data-id="${q.id}" value="${q.grade ? q.grade.points : ''}"></div><div style="flex:3"><label>ملاحظة</label><input class="gf" data-id="${q.id}" value="${esc(q.grade?.feedback || '')}"></div></div></div>`).join('')}
    ${noq ? fld(`الدرجة (من ${a.exam.max_points})`, `<input id="gt" type="number" step="0.5" value="${a.total_score ?? ''}">`) : ''}${fld('تعليق عام', `<input id="gfb" value="${esc(a.feedback || '')}">`)}<div class="err" id="fe"></div>
    <button onclick="gSave(${id},${noq})">حفظ التصحيح</button> <button class="s" onclick="fm.innerHTML=''">إغلاق</button></div>`; scrollTo(0, 0); };
  window.gSave = async (id, noq) => { try { const grades = {}; document.querySelectorAll('.gp').forEach(i => { if (i.value !== '') grades[i.dataset.id] = { points: +i.value, feedback: document.querySelector(`.gf[data-id="${i.dataset.id}"]`).value }; });
    const r = await api(`attempts/${id}/grade`, 'PUT', { grades, feedback: V('gfb'), ...(noq ? { total_points: V('gt') === '' ? null : +V('gt') } : {}) }); alert(r.status == 'graded' ? `تم التصحيح: ${r.total_score} / ${r.max_score}` : 'تم الحفظ — ما زالت هناك أسئلة بلا درجة'); PAGES.exams(); } catch (e) { fe.textContent = e.message; } };
});

// ================= واجهات الطالب =================
const wm = () => `<div style="position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center;color:#fff;opacity:.18;font-size:22px;transform:rotate(-20deg);text-shadow:0 0 3px #000">${esc(me.name)} — ${me.id}</div>`;
def('s_lessons', 'دروسي', ['student'], async () => {
  const ls = await api('student/lessons');
  main.innerHTML = '<h2>الدروس الإلكترونية</h2><div id="fm"></div>' + (ls.map(l => `<div class="card" style="${l.locked ? 'opacity:.6' : ''}"><div class="bar"><div><b>${esc(l.title)}</b> <small>${esc(l.group_name)} — ${l.type == 'live' ? 'مباشر ' + fdt(l.scheduled_at) : 'مسجّل'}</small>${l.description ? `<div>${esc(l.description)}</div>` : ''}</div>
    <div>${l.locked ? '🔒 يلزم اشتراك نشط' : `<span>${l.completed ? '✔ مكتمل' : l.percent ? Math.round(l.percent) + '%' : ''}</span> <button onclick="playL(${l.id})">${l.type == 'live' ? 'دخول الدرس' : 'مشاهدة'}</button>`}</div></div></div>`).join('') || '<div class="card">لا توجد دروس</div>');
  window.playL = async id => { const l = (await api('student/lessons')).find(x => x.id == id), prog = (p, c) => api(`student/lessons/${id}/progress`, 'POST', { position: p, duration: l.duration_min ? l.duration_min * 60 : undefined, completed: c }).catch(() => { });
    if (l.type == 'live') { await prog(0, true); return window.open(l.url, '_blank'); }
    if (!l.has_file) { if (l.url) { window.open(l.url, '_blank'); fm.innerHTML = `<div class="card">بعد المشاهدة: <button onclick="api('student/lessons/${id}/progress','POST',{completed:true}).then(()=>PAGES.s_lessons())">تم إنهاء الدرس</button></div>`; } return; }
    const t = await api(`media-token?kind=lesson&id=${id}`);
    fm.innerHTML = `<div class="card"><h3>${esc(l.title)}</h3><div style="position:relative;display:inline-block;max-width:100%"><video id="vp" src="${t.url}" controls controlsList="nodownload noplaybackrate" disablePictureInPicture oncontextmenu="return false" style="max-width:100%;max-height:70vh;background:#000"></video>${wm()}</div><p><small>هذا المحتوى خاص بحسابك ومحمي.</small></p></div>`;
    const v = document.getElementById('vp'); let last = 0; v.addEventListener('loadedmetadata', () => { if (l.last_position && l.last_position < v.duration - 5) v.currentTime = l.last_position; });
    v.addEventListener('timeupdate', () => { if (Date.now() - last > 10000) { last = Date.now(); api(`student/lessons/${id}/progress`, 'POST', { position: v.currentTime, duration: v.duration }).catch(() => { }); } });
    v.addEventListener('pause', () => api(`student/lessons/${id}/progress`, 'POST', { position: v.currentTime, duration: v.duration }).catch(() => { }));
    v.addEventListener('ended', () => api(`student/lessons/${id}/progress`, 'POST', { position: v.duration, duration: v.duration, completed: true }).catch(() => { })); scrollTo(0, 0); };
});
def('s_materials', 'مذكراتي', ['student'], async () => {
  const ms = await api('student/materials');
  main.innerHTML = '<h2>المذكرات</h2>' + tbl(['المادة', 'العنوان', 'المجموعة', 'الحجم', ''], ms.map(m => [esc(m.subject), esc(m.title), esc(m.group_name || 'مجانية'), m.size ? Math.round(m.size / 1024) + ' ك.ب' : '', m.locked ? '🔒 يلزم اشتراك' : `<button onclick="openMedia('material',${m.id})">فتح</button>`]));
});
const stateAr = { upcoming: 'لم يبدأ', open: 'متاح', closed: 'مغلق' };
def('s_exams', 'الامتحانات والواجبات', ['student'], async () => {
  const es = await api('student/exams');
  main.innerHTML = '<h2>الامتحانات والواجبات</h2><div id="fm"></div>' + (es.map(e => `<div class="card"><div class="bar"><div><b>${esc(e.title)}</b> <small>(${e.kind == 'exam' ? 'امتحان' : 'واجب'} — ${esc(e.group_name)})</small>
    <div><small>${fdt(e.start_at)} ← ${fdt(e.end_at)}${e.duration_min ? ' | المدة ' + e.duration_min + ' دقيقة' : ''} | المحاولات ${e.used}/${e.attempts_allowed} | ${stateAr[e.state]}</small></div></div>
    <div>${e.locked ? '🔒 يلزم اشتراك نشط' : e.in_progress_id ? `<button onclick="takeExam(${e.id})">استئناف</button>` : e.state == 'open' && e.used < e.attempts_allowed ? `<button onclick="takeExam(${e.id})">ابدأ</button>` : ''}
    ${e.attempts.filter(a => a.status != 'in_progress').map(a => `<button class="s" onclick="viewAttempt(${a.id})">نتيجة المحاولة ${a.attempt_no}</button>`).join(' ')}</div></div></div>`).join('') || '<div class="card">لا توجد امتحانات</div>');
  window.takeExam = async id => { try { render(await api(`exams/${id}/start`, 'POST')); } catch (e) { alert(e.message); } };
  window.viewAttempt = async id => render(await api('attempts/' + id));
  function render(a) { clearInterval(window._ti1); clearInterval(window._ti2); if (a.status == 'in_progress') return take(a); result(a); }
  function result(a) { const r = a.result;
    main.innerHTML = `<div class="bar"><h2>${esc(a.title)}</h2><button class="s" onclick="PAGES.s_exams()">رجوع</button></div>` + (!r ? `<div class="card">${esc(a.message)}${a.has_file ? '<br>تم رفع ملف التسليم ✔' : ''}</div>` :
      `<div class="card"><h3>النتيجة: ${r.total} / ${r.max} ${r.percent != null ? `(${r.percent}%)` : ''} ${r.passed == null ? '' : r.passed ? '<span class="ok">— ناجح</span>' : '<span class="err">— لم يجتز</span>'}</h3>${r.feedback ? `<p>تعليق المدرس: ${esc(r.feedback)}</p>` : ''}</div>` +
      r.questions.map(q => `<div class="card"><b>${esc(q.text)}</b> <small>(${q.earned ?? '—'} / ${q.points})</small><div>إجابتك: ${fmtAns(q, q.your_answer)}</div>${'correct_answer' in q ? `<div style="color:#1e8449">الصحيح: ${fmtAns(q, q.correct_answer)}${q.explanation ? ' — ' + esc(q.explanation) : ''}</div>` : ''}${q.feedback ? `<div>ملاحظة: ${esc(q.feedback)}</div>` : ''}</div>`).join('')); }
  function take(a) {
    const inp = q => q.type == 'mcq' ? q.options.map((o, i) => `<label><input type="radio" style="width:auto" name="q${q.id}" value="${i}" ${a.answers[q.id] === i ? 'checked' : ''}> ${esc(o)}</label>`).join('')
      : q.type == 'multi' ? q.options.map((o, i) => `<label><input type="checkbox" style="width:auto" name="q${q.id}" value="${i}" ${(a.answers[q.id] || []).includes(i) ? 'checked' : ''}> ${esc(o)}</label>`).join('')
      : q.type == 'true_false' ? [['true', 'صح'], ['false', 'خطأ']].map(([v, l]) => `<label><input type="radio" style="width:auto" name="q${q.id}" value="${v}" ${String(a.answers[q.id]) === v ? 'checked' : ''}> ${l}</label>`).join('')
      : q.type == 'short' ? `<input id="q${q.id}" value="${esc(a.answers[q.id] || '')}">` : `<textarea id="q${q.id}" rows="5">${esc(a.answers[q.id] || '')}</textarea>`;
    main.innerHTML = `<div class="bar"><h2>${esc(a.title)}</h2>${a.deadline_at ? '<div class="card" style="margin:0"><b id="tm">--:--</b></div>' : ''}</div>${a.description ? `<div class="card">${esc(a.description)}</div>` : ''}` +
      a.questions.map((q, i) => `<div class="card"><b>${i + 1}. ${esc(q.text)}</b> <small>(${q.points} درجة)</small><div style="display:grid;gap:6px;margin-top:6px">${inp(q)}</div></div>`).join('') +
      (a.kind == 'assignment' ? `<div class="card"><label>ملف التسليم (PDF/Word/صورة) حتى 15MB ${a.has_file ? '— مرفوع: ' + esc(a.file_name) : ''}</label><input id="sf" type="file"><button class="s" style="margin-top:6px" onclick="sUp(${a.id})">رفع الملف</button></div>` : '') +
      `<div class="err" id="fe"></div><button onclick="sSubmit(${a.id})">تسليم</button> <span id="sv" class="ok"></span>`;
    const collect = () => { const o = {}; a.questions.forEach(q => { if (q.type == 'mcq') { const c = document.querySelector(`input[name=q${q.id}]:checked`); if (c) o[q.id] = +c.value; } else if (q.type == 'multi') o[q.id] = [...document.querySelectorAll(`input[name=q${q.id}]:checked`)].map(c => +c.value);
      else if (q.type == 'true_false') { const c = document.querySelector(`input[name=q${q.id}]:checked`); if (c) o[q.id] = c.value == 'true'; } else o[q.id] = document.getElementById('q' + q.id).value; }); return o; };
    const save = () => api(`attempts/${a.id}/answers`, 'PUT', { answers: collect() }).then(() => { const s = document.getElementById('sv'); if (s) s.textContent = 'تم الحفظ تلقائياً'; }).catch(() => { });
    const submit = async () => { clearInterval(window._ti1); clearInterval(window._ti2); try { render(await api(`attempts/${a.id}/submit`, 'POST', { answers: collect() })); } catch (e) { const f = document.getElementById('fe'); if (f) f.textContent = e.message; } };
    window.sSubmit = id => { if (confirm('تأكيد التسليم؟ لا يمكن التعديل بعده.')) submit(); };
    window.sUp = async id => { try { if (!fileIn('sf')) return alert('اختر ملفاً'); await upl('submission', id, fileIn('sf')); alert('تم رفع الملف'); } catch (e) { fe.textContent = e.message; } };
    window._ti1 = setInterval(save, 20000);
    if (a.deadline_at) { const tick = () => { const ms = Date.parse(a.deadline_at) - Date.now(); const t = document.getElementById('tm'); if (!t) return clearInterval(window._ti2); if (ms <= 0) { t.textContent = 'انتهى الوقت'; clearInterval(window._ti2); return submit(); }
      const s = Math.floor(ms / 1000), d = Math.floor(s / 86400); t.textContent = d ? `متبقي ${d} يوم` : `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; if (ms < 300000) t.style.color = '#c0392b'; };
      tick(); window._ti2 = setInterval(tick, 1000); }
    scrollTo(0, 0);
  }
});
