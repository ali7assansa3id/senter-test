// المرحلة 6: شاشات الذكاء الاصطناعي (FR-170–172)
const AI_ROLE = ['owner', 'manager', 'teacher'];
const QT_LABEL = { mcq: 'اختيار من متعدد', multi: 'اختيارات متعددة', true_false: 'صح / خطأ', short: 'إجابة قصيرة', essay: 'مقالي' };
const AI_BADGE = '<span style="background:#fff3cd;color:#7a5d00;padding:2px 8px;border-radius:6px;font-size:12px">مولَّد بالذكاء الاصطناعي — يحتاج مراجعة بشرية</span>';
const aiMsg = (id, txt, ok) => { const el = document.getElementById(id); if (el) { el.className = ok ? 'ok' : 'err'; el.textContent = txt; } };
function aiDraftCard(q) {
  const ans = q.type === 'mcq' ? (q.options || [])[q.answer] : q.type === 'multi' ? (q.answer || []).map(i => (q.options || [])[i]).join('، ')
    : q.type === 'true_false' ? (q.answer ? 'صح' : 'خطأ') : q.type === 'short' ? (q.answer || []).join(' / ') : '—';
  return `<div class="card" id="dr_${q.id}"><div>${AI_BADGE} <b>${esc(QT_LABEL[q.type] || q.type)}</b> · ${q.points} درجة</div>
    <p style="font-size:16px">${esc(q.text)}</p>
    ${q.options ? `<ol>${q.options.map(o => `<li>${esc(o)}</li>`).join('')}</ol>` : ''}
    <div>الإجابة المقترحة: <b>${esc(ans)}</b></div>${q.explanation ? `<div style="color:#555">الشرح: ${esc(q.explanation)}</div>` : ''}
    <div style="margin-top:8px"><button onclick="aiApprove(${q.id})">اعتماد وإضافته للبنك</button> <button class="d" onclick="aiDiscard(${q.id})">رفض</button></div></div>`;
}
async function aiRefreshDrafts() {
  const box = document.getElementById('aiDrafts'); if (!box) return;
  const ds = await api('ai/drafts');
  box.innerHTML = ds.length ? ds.map(aiDraftCard).join('') : '<div class="card">لا توجد مسودات بانتظار المراجعة</div>';
}
window.aiApprove = async id => { try { await api(`ai/drafts/${id}/approve`, 'POST'); aiRefreshDrafts(); } catch (e) { alert(e.message); } };
window.aiDiscard = async id => { if (!confirm('رفض المسودة؟')) return; try { await api(`ai/drafts/${id}/discard`, 'POST'); aiRefreshDrafts(); } catch (e) { alert(e.message); } };
window.aiGen = async () => {
  const types = [...document.querySelectorAll('.aiT:checked')].map(x => x.value);
  aiMsg('aiGenMsg', 'جارٍ التوليد...', true);
  try {
    const r = await api('ai/questions', 'POST', { subject: V('aiSub'), grade: V('aiGr'), topic: V('aiTp'), count: Number(V('aiCnt')), types });
    aiMsg('aiGenMsg', `تم حفظ ${r.saved} مسودة من ${r.requested} — راجعها واعتمد ما يصلح`, true);
    aiRefreshDrafts(); aiStatus();
  } catch (e) { aiMsg('aiGenMsg', e.message, false); }
};
window.aiAnalyze = async () => {
  const out = document.getElementById('aiAnOut'); out.innerHTML = 'جارٍ التحليل...';
  try {
    const r = await api('ai/analyze', 'POST', { exam_id: Number(V('aiEx')) }); aiStatus();
    out.innerHTML = `<div>${AI_BADGE}</div><p>عدد المحاولات: ${r.attempts} · متوسط الإجابات الصحيحة: <b>${r.average_rate ?? '—'}%</b></p>
      <h4>أضعف الأسئلة</h4>${tbl(['السؤال', 'نسبة الصواب'], r.weak_questions.map(w => [esc(`س${w.n}: ${w.text}`), w.rate + '%'])) }
      <h4>خطة المراجعة المقترحة</h4><div class="card" style="white-space:pre-wrap">${esc(r.review_plan)}</div>`;
  } catch (e) { out.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
};
window.aiSummarize = async () => {
  const out = document.getElementById('aiSumOut'); out.innerHTML = 'جارٍ التلخيص...';
  try { const r = await api('ai/summarize', 'POST', { material_id: Number(V('aiMat')) }); aiStatus();
    out.innerHTML = `<div>${AI_BADGE}</div><div class="card" style="white-space:pre-wrap">${esc(r.summary)}</div>`;
  } catch (e) { out.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
};
async function aiStatus() {
  const box = document.getElementById('aiStatus'); if (!box) return;
  const s = await api('ai/status');
  const pct = s.quota ? Math.min(100, Math.round((s.used / s.quota) * 100)) : 100;
  box.innerHTML = `<div class="row"><div>الباقة: <b>${esc({ basic: 'أساسية', pro: 'احترافية', ai: 'الذكاء' }[s.plan] || s.plan)}</b></div>
    <div>الاستخدام الشهري: <b>${s.used.toLocaleString('en-US')}</b> / ${s.quota.toLocaleString('en-US')} توكن</div>
    <div>${s.configured ? 'الخدمة مُفعّلة' : '<span class="err">الخدمة غير مُفعّلة على الخادم</span>'}</div></div>
    <div style="background:#e5e9ef;border-radius:6px;height:10px;margin-top:8px"><div style="background:#2e75b6;height:10px;border-radius:6px;width:${pct}%"></div></div>
    ${s.allowed ? '' : '<div class="err" style="margin-top:8px">ميزات الذكاء الاصطناعي متاحة لباقة الذكاء فقط — تواصل مع إدارة المنصة للترقية.</div>'}`;
}
def('ai', 'الذكاء الاصطناعي', AI_ROLE, async () => {
  const [exams, mats] = await Promise.all([api('exams'), api('materials')]);
  main.innerHTML = `<h2>الذكاء الاصطناعي</h2>
  <div class="card"><h3>حالة الباقة والاستخدام</h3><div id="aiStatus">جارٍ التحميل...</div></div>
  <div class="card"><h3>مساعد إعداد الأسئلة</h3><p>تُحفظ الأسئلة مسودات غير مفعّلة حتى تراجعها وتعتمدها.</p>
    <div class="row"><div><label>المادة</label><input id="aiSub"></div><div><label>الصف</label><input id="aiGr"></div><div><label>الموضوع</label><input id="aiTp"></div>
    <div><label>العدد (1-10)</label><input id="aiCnt" type="number" value="5" min="1" max="10"></div></div>
    <div style="margin-top:8px">${Object.entries(QT_LABEL).map(([k, v]) => `<label style="display:inline-block;margin-left:12px"><input type="checkbox" class="aiT" value="${k}" ${k === 'mcq' ? 'checked' : ''} style="width:auto"> ${v}</label>`).join('')}</div>
    <div style="margin-top:8px"><button onclick="aiGen()">توليد مسودات</button></div><div id="aiGenMsg"></div></div>
  <div class="card"><h3>مسودات بانتظار المراجعة</h3><div id="aiDrafts"></div></div>
  <div class="card"><h3>تحليل نتائج امتحان</h3><div class="row"><div><label>الامتحان</label><select id="aiEx">${exams.map(e => `<option value="${e.id}">${esc(e.title)}</option>`).join('')}</select></div>
    <div style="flex:0"><button onclick="aiAnalyze()">تحليل</button></div></div><div id="aiAnOut" style="margin-top:10px"></div></div>
  <div class="card"><h3>ملخص ملف نصي (.txt / .md)</h3><div class="row"><div><label>المذكرة</label><select id="aiMat">${mats.filter(m => m.has_file).map(m => `<option value="${m.id}">${esc(m.title)}</option>`).join('')}</select></div>
    <div style="flex:0"><button onclick="aiSummarize()">تلخيص</button></div></div><div id="aiSumOut" style="margin-top:10px"></div></div>`;
  aiStatus(); aiRefreshDrafts();
});
