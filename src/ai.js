// المرحلة 6: الذكاء الاصطناعي (FR-170–172)
// - المزوّد: Anthropic Messages API عبر fetch من الخادم فقط. المفتاح من ANTHROPIC_API_KEY، والنموذج من ANTHROPIC_MODEL.
// - الاختبارات تحقن عميلاً وهمياً عبر setClient فلا يوجد أي اتصال بالشبكة.
// - كل مخرج يحمل needs_human_review:true ولا يُفعَّل تلقائياً: الأسئلة تُحفظ مسودات (active=0) حتى يعتمدها المدرس.
// - الخصوصية: لا تُرسل أسماء أو هواتف أي طالب إلى النموذج، بل إحصاءات مجمّعة لكل سؤال فقط.
// - الحصص: الميزة لباقة `ai` فقط، وحد شهري بالتوكنات (tenants.ai_monthly_quota) يُرفض عند تجاوزه (429).
const AI_ROLES = ['owner', 'manager', 'teacher'];
const MAX_SOURCE = 60000;            // أقصى عدد أحرف من ملف يُلخَّص
const MAX_FILE = 200 * 1024;        // أقصى حجم ملف نصي (بايت)
const TEXT_EXT = ['.txt', '.md'];   // الأنواع المدعومة للتلخيص: نص فقط
const QTYPES = ['mcq', 'multi', 'true_false', 'short', 'essay'];
const fs = require('fs'), path = require('path');

// node:sqlite يرفض المفاتيح غير المستخدمة في الاستعلام: نمرّر فقط ما يذكره الاستعلام فعلاً
const keep = (sql, p) => Object.fromEntries(Object.entries(p || {}).filter(([k]) => new RegExp(':' + k + '(?![A-Za-z0-9_])').test(sql)));
module.exports = ({ db, one: rawOne, all: rawAll, HttpErr, bad, forbid, can, MGMT, audit, uploadDir }) => {
  const UP = uploadDir || path.join(__dirname, '..', 'uploads');
  const one = (s, p) => rawOne(s, keep(s, p)), all = (s, p) => rawAll(s, keep(s, p));
  let client = null; // قابل للحقن: async ({system,user,maxTokens}) => {text, tokens}
  const setClient = fn => { client = fn; };
  const configured = () => !!client || !!process.env.ANTHROPIC_API_KEY;
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

  async function callModel(system, user, maxTokens = 1500) {
    if (client) return client({ system, user, maxTokens });
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new HttpErr(503, 'خدمة الذكاء الاصطناعي غير مُفعّلة على الخادم');
    let r;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
        signal: AbortSignal.timeout(60000),
      });
    } catch { throw new HttpErr(502, 'تعذّر الاتصال بخدمة الذكاء الاصطناعي'); }
    if (!r.ok) throw new HttpErr(502, 'تعذّر الاتصال بخدمة الذكاء الاصطناعي');
    const j = await r.json();
    return { text: (j.content || []).filter(b => b.type === 'text').map(b => b.text).join(''), tokens: (j.usage?.input_tokens || 0) + (j.usage?.output_tokens || 0) };
  }

  // ---------- الباقة والحصة ----------
  const tenantRow = c => one('SELECT id, plan, ai_monthly_quota FROM tenants WHERE id=:t', { t: c.t });
  function usedThisMonth(c) {
    return one(`SELECT COALESCE(SUM(tokens),0) n FROM ai_usage WHERE tenant_id=:t AND created_at >= :m`, { t: c.t, m: today().slice(0, 8) + '01' }).n;
  }
  function quotaState(c) {
    const tn = tenantRow(c), used = usedThisMonth(c), quota = tn.ai_monthly_quota;
    return { plan: tn.plan, allowed: tn.plan === 'ai', configured: configured(), quota, used, remaining: Math.max(0, quota - used), model_ready: configured() };
  }
  function gate(c) {
    can(c, AI_ROLES);
    const st = quotaState(c);
    if (st.plan !== 'ai') throw new HttpErr(403, 'ميزات الذكاء الاصطناعي متاحة لباقة الذكاء فقط');
    if (!st.configured) throw new HttpErr(503, 'خدمة الذكاء الاصطناعي غير مُفعّلة على الخادم');
    if (st.used >= st.quota) throw new HttpErr(429, 'تجاوزت الحد الشهري لاستخدام الذكاء الاصطناعي');
  }
  function record(c, feature, tokens) {
    db.prepare('INSERT INTO ai_usage(tenant_id,user_id,feature,tokens) VALUES (:t,:u,:f,:k)').run({ t: c.t, u: c.user.id, f: feature, k: Math.max(0, Math.round(tokens || 0)) });
  }
  function parseJson(text) {
    const m = String(text || '').match(/[\[{][\s\S]*[\]}]/);
    try { return JSON.parse(m ? m[0] : ''); } catch { throw new HttpErr(502, 'تعذّر قراءة مخرج النموذج، حاول مرة أخرى'); }
  }
  const clip = (s, n) => String(s ?? '').slice(0, n);
  const SAFE = v => (v == null ? '' : String(v).replace(/[\u0000-\u001f]/g, ' ').trim());

  // ---------- 1) مساعد إعداد الأسئلة (تُحفظ مسودات غير مفعّلة) ----------
  function validDraft(q) {
    if (!q || !QTYPES.includes(q.type)) return null;
    const text = SAFE(q.text).slice(0, 3000); if (!text) return null;
    const points = Number(q.points ?? 1); if (!(points > 0 && points <= 100)) return null;
    const o = { type: q.type, text, points, options: null, answer: null, explanation: SAFE(q.explanation).slice(0, 1000) || null };
    if (q.type === 'mcq' || q.type === 'multi') {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 8) return null;
      o.options = q.options.map(x => SAFE(x).slice(0, 300)); if (o.options.some(x => !x)) return null;
      const n = o.options.length;
      if (q.type === 'mcq') { if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= n) return null; o.answer = q.answer; }
      else { if (!Array.isArray(q.answer) || !q.answer.length || q.answer.some(i => !Number.isInteger(i) || i < 0 || i >= n)) return null; o.answer = [...new Set(q.answer)].sort((a, b) => a - b); }
    } else if (q.type === 'true_false') { if (typeof q.answer !== 'boolean') return null; o.answer = q.answer; }
    else if (q.type === 'short') { if (!Array.isArray(q.answer) || !q.answer.length) return null; o.answer = q.answer.map(x => SAFE(x)).filter(Boolean).slice(0, 10); if (!o.answer.length) return null; }
    return o;
  }
  async function generateQuestions(c, body) {
    gate(c);
    const subject = SAFE(body.subject).slice(0, 100), grade = SAFE(body.grade).slice(0, 60), topic = SAFE(body.topic).slice(0, 200);
    if (!subject) throw bad('المادة مطلوبة');
    const count = Number(body.count ?? 5); if (!Number.isInteger(count) || count < 1 || count > 10) throw bad('عدد الأسئلة من 1 إلى 10');
    const types = (Array.isArray(body.types) && body.types.length ? body.types : ['mcq']).filter(t => QTYPES.includes(t));
    if (!types.length) throw bad('نوع السؤال غير مدعوم');
    const system = 'أنت مساعد لإعداد أسئلة تعليمية باللغة العربية. أعد JSON فقط: مصفوفة أسئلة. كل سؤال: {"type","text","options","answer","points","explanation"}. ' +
      'mcq: answer رقم الاختيار الصحيح (يبدأ من 0). multi: answer مصفوفة أرقام. true_false: answer true أو false. short: answer مصفوفة إجابات مقبولة. essay: بلا options ولا answer.';
    const user = `المادة: ${subject}\nالصف: ${grade || 'غير محدد'}\nالموضوع: ${topic || 'عام'}\nعدد الأسئلة: ${count}\nالأنواع المطلوبة: ${types.join(', ')}`;
    const r = await callModel(system, user, 2500).catch(e => { throw e; });
    record(c, 'questions', r.tokens);
    const arr = parseJson(r.text); const items = Array.isArray(arr) ? arr : [];
    const drafts = [];
    for (const q of items.slice(0, count)) {
      const v = validDraft(q); if (!v) continue;
      const id = db.prepare(`INSERT INTO question_bank(tenant_id,subject,grade,type,text,options,answer,points,explanation,created_by,active,ai_draft)
        VALUES (:t,:s,:g,:ty,:x,:op,:an,:p,:e,:cb,0,1)`).run({ t: c.t, s: subject, g: grade || null, ty: v.type, x: v.text, op: v.options ? JSON.stringify(v.options) : null,
        an: v.answer == null ? null : JSON.stringify(v.answer), p: v.points, e: v.explanation, cb: c.user.id }).lastInsertRowid;
      drafts.push({ id: Number(id), ...v, needs_human_review: true });
    }
    return { s: 201, j: { needs_human_review: true, requested: count, saved: drafts.length, drafts } };
  }
  const draftsList = c => { can(c, AI_ROLES); const mine = c.user.role === 'teacher';
    return all(`SELECT * FROM question_bank WHERE tenant_id=:t AND ai_draft=1 AND active=0 AND deleted_at IS NULL ${mine ? 'AND created_by=:u' : ''} ORDER BY id DESC LIMIT 200`, { t: c.t, u: c.user.id })
      .map(x => ({ id: x.id, subject: x.subject, grade: x.grade, type: x.type, text: x.text, options: x.options ? JSON.parse(x.options) : null, answer: x.answer ? JSON.parse(x.answer) : null, points: x.points, explanation: x.explanation, needs_human_review: true })); };
  function draftAct(c, id, act) {
    can(c, AI_ROLES);
    const x = one('SELECT * FROM question_bank WHERE id=:i AND tenant_id=:t AND ai_draft=1 AND active=0 AND deleted_at IS NULL', { i: id, t: c.t });
    if (!x) throw new HttpErr(404, 'المسودة غير موجودة');
    if (c.user.role === 'teacher' && x.created_by !== c.user.id) throw forbid();
    if (act === 'approve') db.prepare(`UPDATE question_bank SET active=1, ai_draft=0, reviewed_by=:u, updated_at=datetime('now') WHERE id=:i`).run({ u: c.user.id, i: id });
    else db.prepare(`UPDATE question_bank SET deleted_at=datetime('now') WHERE id=:i`).run({ i: id });
    return { ok: true, status: act === 'approve' ? 'approved' : 'discarded' };
  }

  // ---------- 2) تحليل نتائج امتحان: نقاط الضعف حسب السؤال + خطة مراجعة ----------
  async function analyzeExam(c, body) {
    gate(c);
    const eid = Number(body.exam_id); if (!eid) throw bad('حدد الامتحان');
    const e = one(`SELECT e.id, e.title, e.kind, g.teacher_id, g.branch_id, g.subject FROM exams e JOIN groups g ON g.id=e.group_id
      WHERE e.id=:i AND e.tenant_id=:t AND e.deleted_at IS NULL`, { i: eid, t: c.t });
    if (!e) throw new HttpErr(404, 'الامتحان غير موجود');
    if (c.user.role === 'teacher' && e.teacher_id !== c.tid) throw forbid();
    if (c.user.role !== 'owner' && c.user.branch_id && e.branch_id !== c.user.branch_id) throw forbid();
    const qs = all('SELECT id, q_type, q_text, points, position FROM exam_questions WHERE exam_id=:e AND tenant_id=:t AND deleted_at IS NULL ORDER BY position, id', { e: eid, t: c.t });
    const atts = all(`SELECT grades FROM exam_attempts WHERE exam_id=:e AND tenant_id=:t AND deleted_at IS NULL AND status IN ('submitted','graded')`, { e: eid, t: c.t });
    if (!atts.length) throw bad('لا توجد محاولات مُسلَّمة بعد لتحليلها');
    // إحصاءات مجمّعة فقط: لا أسماء ولا معرّفات طلاب تدخل أي رسالة للنموذج
    const stats = qs.map((q, i) => {
      let correct = 0, graded = 0;
      for (const a of atts) { const g = JSON.parse(a.grades || '{}')[q.id]; if (!g) continue; graded++; if (g.points >= q.points - 1e-9) correct++; }
      return { n: i + 1, type: q.q_type, text: clip(q.q_text, 300), points: q.points, attempts: graded, rate: graded ? Math.round((correct / graded) * 100) : null };
    });
    const measured = stats.filter(s => s.rate != null);
    const weak = measured.filter(s => s.rate < 60).sort((a, b) => a.rate - b.rate).slice(0, 5);
    const avg = measured.length ? Math.round(measured.reduce((s, x) => s + x.rate, 0) / measured.length) : null;
    const system = 'أنت مساعد تعليمي باللغة العربية. حلّل نسب إجابة الأسئلة الصحيحة (لمجموعة طلاب كاملة، بلا أسماء) واقترح خطة مراجعة قصيرة وعملية للمدرس. أعد نصاً عربياً منظماً.';
    const user = `الامتحان: ${clip(e.title, 150)}\nالمادة: ${clip(e.subject, 60) || 'غير محددة'}\nعدد المحاولات المُسلَّمة: ${atts.length}\n` +
      `متوسط الإجابة الصحيحة: ${avg == null ? 'غير متاح' : avg + '%'}\nالأسئلة:\n` +
      stats.map(s => `س${s.n} (${s.type}, ${s.points} درجة): ${s.text} — نسبة الصواب ${s.rate == null ? 'غير متاحة' : s.rate + '%'}`).join('\n');
    const r = await callModel(system, user, 1200);
    record(c, 'analysis', r.tokens);
    return { s: 200, j: { needs_human_review: true, exam: { id: e.id, title: e.title }, attempts: atts.length, average_rate: avg, questions: stats, weak_questions: weak, review_plan: SAFE(r.text) } };
  }

  // ---------- 3) ملخص ملف نصي يملك المستخدم حق استخدامه ----------
  async function summarizeMaterial(c, body) {
    gate(c);
    const mid = Number(body.material_id); if (!mid) throw bad('حدد المذكرة');
    const m = one('SELECT x.*, g.teacher_id, g.branch_id FROM materials x LEFT JOIN groups g ON g.id=x.group_id WHERE x.id=:i AND x.tenant_id=:t AND x.deleted_at IS NULL', { i: mid, t: c.t });
    if (!m) throw new HttpErr(404, 'المذكرة غير موجودة');
    if (c.user.role === 'teacher') { if (m.group_id && m.teacher_id !== c.tid) throw forbid(); }
    else if (c.user.role !== 'owner' && c.user.branch_id && m.group_id && m.branch_id !== c.user.branch_id) throw forbid();
    if (!m.file_path) throw bad('لا يوجد ملف مرفق بهذه المذكرة');
    const ext = path.extname(m.file_name || '').toLowerCase();
    if (!TEXT_EXT.includes(ext)) throw bad('التلخيص متاح للملفات النصية (.txt, .md) فقط');
    const abs = path.join(UP, m.file_path); if (!abs.startsWith(path.resolve(UP))) throw forbid();
    const st = fs.statSync(abs); if (st.size > MAX_FILE) throw bad('حجم الملف أكبر من الحد المسموح (200KB)');
    const text = fs.readFileSync(abs, 'utf8').slice(0, MAX_SOURCE);
    const system = 'أنت مساعد تعليمي باللغة العربية. لخّص المحتوى التالي في نقاط واضحة مع أهم المفاهيم. لا تضف معلومات من خارج النص.';
    const r = await callModel(system, `عنوان المذكرة: ${clip(m.title, 150)}\n\n${text}`, 1200);
    record(c, 'summary', r.tokens);
    return { s: 200, j: { needs_human_review: true, material: { id: m.id, title: m.title }, summary: SAFE(r.text) } };
  }

  function route(c, [a, b, d], m, body, url) {
    if (a !== 'ai') return null;
    if (b === 'status' && m === 'GET') { can(c, AI_ROLES); return { s: 200, j: quotaState(c) }; }
    if (b === 'questions' && m === 'POST') return generateQuestions(c, body);
    if (b === 'drafts' && m === 'GET') return { s: 200, j: draftsList(c) };
    if (b === 'drafts' && /^\d+$/.test(d || '') && m === 'POST') { const act = url.pathname.split('/').pop(); return { s: 200, j: draftAct(c, Number(d), act === 'approve' ? 'approve' : 'discard') }; }
    if (b === 'analyze' && m === 'POST') return analyzeExam(c, body);
    if (b === 'summarize' && m === 'POST') return summarizeMaterial(c, body);
    return null;
  }
  return { route, setClient, configured, quotaState, _record: record };
};
