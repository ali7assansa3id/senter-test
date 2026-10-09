// المرحلة 6: لوحة الإدارة المركزية (FR-160–163)
// دور super_admin يعمل داخل مستأجر المنصة (is_platform=1) ولا يصل إلى بيانات أي سنتر (لا طلاب ولا درجات ولا مالية).
// كل عملية حسّاسة تُسجَّل في audit_log.
const PLANS = ['basic', 'pro', 'ai'];
const PHONE = /^01\d{9}$/;

// node:sqlite يرفض المفاتيح غير المستخدمة في الاستعلام: نمرّر فقط ما يذكره الاستعلام فعلاً
const keep = (sql, p) => Object.fromEntries(Object.entries(p || {}).filter(([k]) => new RegExp(':' + k + '(?![A-Za-z0-9_])').test(sql)));
module.exports = ({ db, one: rawOne, all: rawAll, HttpErr, bad, can }) => {
  const one = (s, p) => rawOne(s, keep(s, p)), all = (s, p) => rawAll(s, keep(s, p));
  const SA = ['super_admin'];
  const log = (actor, tenantId, action, detail) =>
    db.prepare('INSERT INTO audit_log(tenant_id,actor_id,action,detail) VALUES (:t,:a,:ac,:d)').run({ t: tenantId, a: actor, ac: action, d: JSON.stringify(detail || {}) });
  const txt = (v, label, min, max) => { const s = String(v ?? '').trim(); if (s.length < min) throw bad(`${label} مطلوب`); if (s.length > max) throw bad(`${label} طويل جداً`); return s; };

  function stats(c) {
    can(c, SA);
    const n = sql => one(sql, {}).n;
    return {
      centers: n(`SELECT COUNT(*) n FROM tenants WHERE is_platform=0`),
      active_centers: n(`SELECT COUNT(*) n FROM tenants WHERE is_platform=0 AND active=1`),
      suspended_centers: n(`SELECT COUNT(*) n FROM tenants WHERE is_platform=0 AND active=0`),
      by_plan: all(`SELECT plan, COUNT(*) n FROM tenants WHERE is_platform=0 GROUP BY plan`, {}),
      students: n(`SELECT COUNT(*) n FROM students WHERE deleted_at IS NULL AND tenant_id IN (SELECT id FROM tenants WHERE is_platform=0)`),
      groups: n(`SELECT COUNT(*) n FROM groups WHERE deleted_at IS NULL AND tenant_id IN (SELECT id FROM tenants WHERE is_platform=0)`),
      ai_tokens_this_month: n(`SELECT COALESCE(SUM(tokens),0) n FROM ai_usage WHERE created_at >= date('now','start of month')`),
    };
  }
  function centers(c) {
    can(c, SA);
    return all(`SELECT t.id, t.name, t.plan, t.ai_monthly_quota, t.active, t.created_at,
      (SELECT u.name FROM users u WHERE u.tenant_id=t.id AND u.role='owner' AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1) owner_name,
      (SELECT COUNT(*) FROM users u WHERE u.tenant_id=t.id AND u.deleted_at IS NULL) users_count
      FROM tenants t WHERE t.is_platform=0 ORDER BY t.id DESC LIMIT 500`, {});
  }
  function createCenter(c, b) {
    can(c, SA);
    const name = txt(b.name, 'اسم السنتر', 2, 120), oname = txt(b.owner_name, 'اسم المالك', 2, 120);
    const plan = b.plan ?? 'basic'; if (!PLANS.includes(plan)) throw bad('الباقة غير صالحة');
    const quota = b.ai_monthly_quota ?? 200000; if (!Number.isInteger(quota) || quota < 0) throw bad('حصة الذكاء يجب أن تكون عدداً صحيحاً موجباً');
    const phone = String(b.owner_phone || ''); if (!PHONE.test(phone)) throw bad('هاتف المالك يجب أن يكون رقماً مصرياً من 11 رقماً');
    const pw = String(b.owner_password || ''); if (pw.length < 8) throw bad('كلمة مرور المالك 8 أحرف على الأقل');
    if (all('SELECT id FROM users WHERE phone=:p AND deleted_at IS NULL', { p: phone }).length) throw bad('هذا الرقم مسجل بالفعل لمستخدم آخر، استخدم رقماً مختلفاً');
    const hash = require('./db').hashPassword(pw);
    db.exec('BEGIN IMMEDIATE');
    try {
      const t = db.prepare('INSERT INTO tenants(name,plan,ai_monthly_quota,active) VALUES (:n,:p,:q,1)').run({ n: name, p: plan, q: quota }).lastInsertRowid;
      db.prepare(`INSERT INTO users(tenant_id,name,phone,password_hash,role) VALUES (:t,:n,:p,:h,'owner')`).run({ t, n: oname, p: phone, h: hash });
      log(c.user.id, Number(t), 'center.create', { name, plan, quota });
      db.exec('COMMIT');
      return { s: 201, j: one('SELECT id,name,plan,ai_monthly_quota,active FROM tenants WHERE id=:i', { i: Number(t) }) };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  function updateCenter(c, id, b) {
    can(c, SA);
    const cur = one('SELECT * FROM tenants WHERE id=:i AND is_platform=0', { i: id }); if (!cur) throw new HttpErr(404, 'السنتر غير موجود');
    const d = {};
    if ('name' in b) d.name = txt(b.name, 'اسم السنتر', 2, 120);
    if ('plan' in b) { if (!PLANS.includes(b.plan)) throw bad('الباقة غير صالحة'); d.plan = b.plan; }
    if ('ai_monthly_quota' in b) { if (!Number.isInteger(b.ai_monthly_quota) || b.ai_monthly_quota < 0) throw bad('حصة الذكاء غير صالحة'); d.ai_monthly_quota = b.ai_monthly_quota; }
    if ('active' in b) d.active = b.active ? 1 : 0;
    const cols = Object.keys(d); if (!cols.length) throw bad('لا توجد بيانات للتحديث');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`UPDATE tenants SET ${cols.map(k => `${k}=:${k}`).join(', ')} WHERE id=:id`).run({ ...d, id });
      const changes = cols.filter(k => String(cur[k]) !== String(d[k]));
      if (changes.length) log(c.user.id, id, changes.includes('active') ? (d.active ? 'center.enable' : 'center.suspend') : 'center.update',
        Object.fromEntries(changes.map(k => [k, { from: cur[k], to: d[k] }])));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return one('SELECT id,name,plan,ai_monthly_quota,active FROM tenants WHERE id=:i', { i: id });
  }
  function auditList(c, q) {
    can(c, SA);
    const lim = Math.min(Number(q.get('limit')) || 100, 500);
    return all(`SELECT l.id, l.action, l.detail, l.created_at, t.name center_name, u.name actor_name
      FROM audit_log l LEFT JOIN tenants t ON t.id=l.tenant_id LEFT JOIN users u ON u.id=l.actor_id ORDER BY l.id DESC LIMIT :n`, { n: lim });
  }

  function route(c, [a, b, d], m, body, url) {
    if (a !== 'admin') return null;
    if (b === 'stats' && m === 'GET') return { s: 200, j: stats(c) };
    if (b === 'centers' && m === 'GET' && !d) return { s: 200, j: centers(c) };
    if (b === 'centers' && m === 'POST' && !d) return createCenter(c, body);
    if (b === 'centers' && /^\d+$/.test(d || '') && m === 'PUT') return { s: 200, j: updateCenter(c, Number(d), body) };
    if (b === 'audit' && m === 'GET') return { s: 200, j: auditList(c, url.searchParams) };
    return null;
  }
  return { route, log };
};
