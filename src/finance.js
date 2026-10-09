// المرحلة الثانية: الاشتراكات، التحصيل، الخزائن، المصروفات، مستحقات المدرسين، التقارير المالية
const { build } = require('./xlsx');
module.exports = ({ db, one, all, HttpErr, bad, forbid, can, MGMT, STAFF, ALL }) => {
  const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  const DATE = /^\d{4}-\d{2}-\d{2}$/, PER = /^\d{4}-(0[1-9]|1[0-2])$/;
  const METHOD = { cash: 'نقدي', transfer: 'تحويل', other: 'أخرى' };
  const nf = () => new HttpErr(404, 'غير موجود');
  const money = (v, label) => { const n = Number(v); if (!Number.isFinite(n) || n <= 0) throw bad(`${label} يجب أن يكون رقماً أكبر من صفر`); return r2(n); };
  const myBranch = c => (c.user.role === 'owner' || !c.user.branch_id) ? null : c.user.branch_id; // عزل الفرع (BR-002)
  const effBranch = (c, q) => myBranch(c) ?? (q && q.get('branch_id') ? Number(q.get('branch_id')) : null);
  const tx = fn => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const reason = b => { const r = String(b.reason || '').trim(); if (r.length < 3) throw bad('سبب الإلغاء مطلوب'); return r; };

  // ---------- الخزائن ----------
  const BAL = `ROUND(t.opening_balance
    + COALESCE((SELECT SUM(amount) FROM payments WHERE treasury_id=t.id AND status='valid'),0)
    - COALESCE((SELECT SUM(amount) FROM expenses WHERE treasury_id=t.id AND status='valid'),0)
    - COALESCE((SELECT SUM(amount) FROM teacher_payouts WHERE treasury_id=t.id AND status='valid'),0)
    - COALESCE((SELECT SUM(amount) FROM refunds WHERE treasury_id=t.id AND status='valid'),0),2)`;
  const treasuryRow = (c, id, activeOnly = true) => {
    const t = one(`SELECT t.*, ${BAL} balance FROM treasuries t WHERE t.id=:i AND t.tenant_id=:t AND t.deleted_at IS NULL`, { i: id, t: c.t });
    if (!t || (activeOnly && !t.active)) throw bad('الخزينة غير موجودة أو غير نشطة');
    const b = myBranch(c); if (b && t.branch_id !== b) throw forbid();
    return t;
  };
  const checkSpend = (t, amount) => { if (amount > t.balance + 1e-9) throw bad(`رصيد الخزينة غير كافٍ (المتاح ${t.balance})`); };
  const treasuryFk = (c, d) => { if (d.branch_id != null && !one('SELECT id FROM branches WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: d.branch_id, t: c.t })) throw bad('الفرع غير صالح'); };
  function treasuries(c, m, id, body) {
    if (m === 'GET') { can(c, STAFF); const b = myBranch(c);
      return { s: 200, j: all(`SELECT t.*, ${BAL} balance FROM treasuries t WHERE t.tenant_id=:t AND t.deleted_at IS NULL AND (:b IS NULL OR t.branch_id=:b) ORDER BY t.id`, { t: c.t, b }) }; }
    can(c, ['owner']);
    if (m === 'POST') {
      const name = String(body.name || '').trim(); if (!name) throw bad('اسم الخزينة مطلوب');
      const ob = body.opening_balance == null || body.opening_balance === '' ? 0 : Number(body.opening_balance);
      if (!Number.isFinite(ob) || ob < 0) throw bad('الرصيد الافتتاحي غير صالح');
      treasuryFk(c, body);
      const r = db.prepare('INSERT INTO treasuries(tenant_id,name,branch_id,opening_balance) VALUES (:t,:n,:b,:o)').run({ t: c.t, n: name, b: body.branch_id ?? null, o: r2(ob) });
      return { s: 201, j: treasuryRow(c, r.lastInsertRowid) };
    }
    const t = treasuryRow(c, id, false);
    const used = one(`SELECT (SELECT COUNT(*) FROM payments WHERE treasury_id=:i)+(SELECT COUNT(*) FROM expenses WHERE treasury_id=:i)+(SELECT COUNT(*) FROM teacher_payouts WHERE treasury_id=:i)+(SELECT COUNT(*) FROM refunds WHERE treasury_id=:i) n`, { i: id }).n;
    if (m === 'PUT') {
      const d = { name: body.name ?? t.name, active: body.active ?? t.active, branch_id: 'branch_id' in body ? (body.branch_id || null) : t.branch_id, opening_balance: body.opening_balance ?? t.opening_balance };
      if (!String(d.name).trim()) throw bad('اسم الخزينة مطلوب');
      if (used && (r2(d.opening_balance) !== t.opening_balance || d.branch_id !== t.branch_id)) throw bad('لا يمكن تغيير الرصيد الافتتاحي أو الفرع بعد وجود حركات');
      treasuryFk(c, d);
      db.prepare(`UPDATE treasuries SET name=:name, active=:active, branch_id=:branch_id, opening_balance=:opening_balance, updated_at=datetime('now') WHERE id=:id AND tenant_id=:t`).run({ ...d, opening_balance: r2(d.opening_balance), active: d.active ? 1 : 0, id, t: c.t });
      return { s: 200, j: treasuryRow(c, id, false) };
    }
    if (m === 'DELETE') {
      if (used) throw bad('لا يمكن حذف خزينة عليها حركات، عطّلها بدلاً من ذلك');
      db.prepare(`UPDATE treasuries SET deleted_at=datetime('now') WHERE id=:i AND tenant_id=:t`).run({ i: id, t: c.t }); return { s: 200, j: { ok: true } };
    }
    throw new HttpErr(405, 'طريقة غير مدعومة');
  }

  // ---------- الاشتراكات ----------
  const SUBSEL = `s.*, ROUND(s.amount-s.discount,2) net, (COALESCE((SELECT SUM(amount) FROM payments p WHERE p.subscription_id=s.id AND p.status='valid'),0)-COALESCE((SELECT SUM(amount) FROM refunds rf WHERE rf.subscription_id=s.id AND rf.status='valid'),0)) paid`;
  function subRow(c, id) {
    const s = one(`SELECT ${SUBSEL}, st.name student_name, g.name group_name FROM subscriptions s JOIN students st ON st.id=s.student_id JOIN groups g ON g.id=s.group_id
      WHERE s.id=:i AND s.tenant_id=:t AND s.deleted_at IS NULL`, { i: id, t: c.t });
    if (!s) throw nf();
    const b = myBranch(c); if (b && s.branch_id !== b) throw forbid();
    s.paid = r2(s.paid); s.remaining = r2(s.net - s.paid);
    if (s.plan_type === 'per_session') s.sessions_used = sessionsUsed(s);
    return s;
  }
  const sessionsUsed = s => one(`SELECT COUNT(*) n FROM attendance a JOIN sessions se ON se.id=a.session_id WHERE a.student_id=:st AND se.group_id=:g AND a.status IN ('present','late') AND a.deleted_at IS NULL AND date(a.created_at)>=date(:c)`, { st: s.student_id, g: s.group_id, c: s.created_at }).n;
  const nextPeriod = p => { let [y, m] = p.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, '0')}`; };
  function createSub(c, body, renewedFrom = null) {
    const st = one('SELECT * FROM students WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: Number(body.student_id), t: c.t }); if (!st) throw bad('الطالب غير موجود');
    const g = one('SELECT * FROM groups WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: Number(body.group_id), t: c.t }); if (!g) throw bad('المجموعة غير موجودة');
    const b = myBranch(c); if (b && g.branch_id !== b) throw forbid();
    if (!one('SELECT id FROM group_students WHERE group_id=:g AND student_id=:s AND tenant_id=:t AND deleted_at IS NULL', { g: g.id, s: st.id, t: c.t })) throw bad('الطالب غير مسجل في هذه المجموعة');
    const plan = body.plan_type || 'monthly'; if (!['monthly', 'per_session', 'course'].includes(plan)) throw bad('نظام الاشتراك غير صالح');
    let period = body.period, cnt = null, sd = null, ed = null, amountIn = body.amount;
    if (plan === 'per_session') {
      cnt = Number(body.sessions_count); if (!Number.isInteger(cnt) || cnt < 1 || cnt > 200) throw bad('عدد الحصص يجب أن يكون من 1 إلى 200');
      if (body.unit_price != null && body.unit_price !== '') amountIn = r2(money(body.unit_price, 'سعر الحصة') * cnt);
      if (!PER.test(period || '')) period = today().slice(0, 7);
    } else if (plan === 'course') {
      sd = body.start_date; ed = body.end_date;
      if (!DATE.test(sd || '') || !DATE.test(ed || '') || sd > ed) throw bad('تاريخا بداية ونهاية الكورس غير صالحين');
      period = sd.slice(0, 7);
    }
    if (!PER.test(period || '')) throw bad('الفترة بصيغة YYYY-MM');
    const amount = money(amountIn, 'قيمة الاشتراك'), discount = body.discount ? r2(Number(body.discount)) : 0;
    if (!(discount >= 0) || discount >= amount) throw bad('الخصم يجب أن يكون أقل من قيمة الاشتراك');
    if (plan === 'monthly' && one(`SELECT id FROM subscriptions WHERE tenant_id=:t AND student_id=:s AND group_id=:g AND period=:p AND plan_type='monthly' AND status='active' AND deleted_at IS NULL`, { t: c.t, s: st.id, g: g.id, p: period })) throw bad('يوجد اشتراك نشط لنفس الطالب والمجموعة والفترة');
    const r = db.prepare('INSERT INTO subscriptions(tenant_id,student_id,group_id,branch_id,period,amount,discount,notes,created_by,plan_type,sessions_count,start_date,end_date,renewed_from) VALUES (:t,:s,:g,:b,:p,:a,:d,:n,:u,:pt,:sc,:sd,:ed,:rf)')
      .run({ t: c.t, s: st.id, g: g.id, b: g.branch_id, p: period, a: amount, d: discount, n: body.notes || null, u: c.user.id, pt: plan, sc: cnt, sd, ed, rf: renewedFrom });
    return subRow(c, r.lastInsertRowid);
  }
  function subscriptions(c, m, id, act, body, q) {
    if (m === 'GET' && !id) { can(c, STAFF);
      let w = 's.tenant_id=:t AND s.deleted_at IS NULL AND (:b IS NULL OR s.branch_id=:b)'; const p = { t: c.t, b: myBranch(c) };
      for (const f of ['period', 'status', 'student_id', 'group_id']) if (q.get(f)) { w += ` AND s.${f}=:${f}`; p[f] = q.get(f); }
      return { s: 200, j: all(`SELECT ${SUBSEL}, st.name student_name, g.name group_name FROM subscriptions s JOIN students st ON st.id=s.student_id JOIN groups g ON g.id=s.group_id WHERE ${w} ORDER BY s.id DESC LIMIT 1000`, p)
        .map(s => ({ ...s, paid: r2(s.paid), remaining: r2(s.net - s.paid) })) }; }
    if (m === 'GET') { can(c, STAFF); return { s: 200, j: subRow(c, id) }; }
    if (m === 'POST' && !id) { can(c, STAFF); return { s: 201, j: createSub(c, body) }; }
    if (m === 'POST' && id && act === 'renew') { // تجديد (FR-122): شهري → الشهر التالي، بالحصة → باقة جديدة، كورس → تواريخ جديدة
      can(c, STAFF); const o = subRow(c, id);
      if (o.status !== 'active') throw bad('لا يمكن تجديد اشتراك ملغي');
      const nb = { student_id: o.student_id, group_id: o.group_id, plan_type: o.plan_type, amount: o.amount, discount: o.discount, notes: body.notes || null };
      if (o.plan_type === 'monthly') nb.period = body.period || nextPeriod(o.period);
      else if (o.plan_type === 'per_session') { nb.sessions_count = body.sessions_count || o.sessions_count; }
      else { nb.start_date = body.start_date; nb.end_date = body.end_date; }
      if ('amount' in body && body.amount !== '' && body.amount != null) nb.amount = body.amount;
      return { s: 201, j: createSub(c, nb, o.id) };
    }
    can(c, MGMT);
    const s = subRow(c, id);
    if (m === 'PUT') {
      if (s.status !== 'active') throw bad('الاشتراك ملغي');
      const amount = 'amount' in body ? money(body.amount, 'قيمة الاشتراك') : s.amount, discount = 'discount' in body ? r2(Number(body.discount || 0)) : s.discount;
      if (!(discount >= 0) || discount >= amount) throw bad('الخصم يجب أن يكون أقل من قيمة الاشتراك');
      if (r2(amount - discount) < s.paid) throw bad(`لا يمكن تخفيض الصافي عن المدفوع (${s.paid})`);
      db.prepare(`UPDATE subscriptions SET amount=:a, discount=:d, notes=:n, updated_at=datetime('now') WHERE id=:i AND tenant_id=:t`).run({ a: amount, d: discount, n: 'notes' in body ? body.notes : s.notes, i: id, t: c.t });
      return { s: 200, j: subRow(c, id) };
    }
    if (m === 'POST' && act === 'cancel') {
      if (s.status !== 'active') throw bad('الاشتراك ملغي بالفعل');
      if (s.paid > 0) throw bad('يوجد مدفوعات على هذا الاشتراك، ألغِ الإيصالات أولاً');
      db.prepare(`UPDATE subscriptions SET status='cancelled', updated_at=datetime('now') WHERE id=:i AND tenant_id=:t`).run({ i: id, t: c.t });
      return { s: 200, j: subRow(c, id) };
    }
    throw new HttpErr(405, 'طريقة غير مدعومة');
  }

  // ---------- التحصيل والإيصالات (BR-004: الإيصال لا يُعدّل ولا يُحذف، يُلغى بسبب فقط) ----------
  const PAYSEL = `p.*, st.name student_name, g.name group_name, s.period, tr.name treasury_name, br.name branch_name`;
  const PAYJOIN = `FROM payments p JOIN students st ON st.id=p.student_id JOIN subscriptions s ON s.id=p.subscription_id JOIN groups g ON g.id=s.group_id JOIN treasuries tr ON tr.id=p.treasury_id LEFT JOIN branches br ON br.id=p.branch_id`;
  function payRow(c, id) {
    const p = one(`SELECT ${PAYSEL}, ten.name tenant_name, u.name created_by_name ${PAYJOIN} JOIN tenants ten ON ten.id=p.tenant_id LEFT JOIN users u ON u.id=p.created_by WHERE p.id=:i AND p.tenant_id=:t`, { i: id, t: c.t });
    if (!p) throw nf(); const b = myBranch(c); if (b && p.branch_id !== b) throw forbid();
    const sub = subRow(c, p.subscription_id); p.sub_net = sub.net; p.sub_paid = sub.paid; p.sub_remaining = sub.remaining; return p;
  }
  function payments(c, m, id, act, body, q) {
    can(c, STAFF);
    if (m === 'GET' && !id) {
      let w = 'p.tenant_id=:t AND (:b IS NULL OR p.branch_id=:b)'; const p = { t: c.t, b: myBranch(c) };
      if (q.get('from')) { w += ' AND p.paid_at>=:from'; p.from = q.get('from'); } if (q.get('to')) { w += ' AND p.paid_at<=:to'; p.to = q.get('to'); }
      for (const f of ['student_id', 'treasury_id', 'status', 'subscription_id']) if (q.get(f)) { w += ` AND p.${f}=:${f}`; p[f] = q.get(f); }
      return { s: 200, j: all(`SELECT ${PAYSEL} ${PAYJOIN} WHERE ${w} ORDER BY p.receipt_no DESC LIMIT 1000`, p) };
    }
    if (m === 'GET') return { s: 200, j: payRow(c, id) };
    if (m === 'POST' && !id) {
      const s = subRow(c, Number(body.subscription_id));
      if (s.status !== 'active') throw bad('الاشتراك ملغي');
      const amount = money(body.amount, 'المبلغ');
      if (amount > s.remaining + 1e-9) throw bad(`المبلغ أكبر من المتبقي على الاشتراك (${s.remaining})`);
      const t = treasuryRow(c, Number(body.treasury_id));
      if (t.branch_id && s.branch_id && t.branch_id !== s.branch_id) throw bad('الخزينة تابعة لفرع مختلف عن فرع الاشتراك');
      if (!METHOD[body.method || 'cash']) throw bad('طريقة الدفع غير صالحة');
      const paid_at = body.paid_at || today();
      if (!DATE.test(paid_at) || paid_at > today()) throw bad('تاريخ الدفع غير صالح');
      const id2 = tx(() => {
        const no = one('SELECT COALESCE(MAX(receipt_no),0)+1 n FROM payments WHERE tenant_id=:t', { t: c.t }).n;
        return db.prepare('INSERT INTO payments(tenant_id,receipt_no,subscription_id,student_id,treasury_id,branch_id,amount,method,paid_at,note,created_by) VALUES (:t,:no,:s,:st,:tr,:b,:a,:m,:d,:n,:u)')
          .run({ t: c.t, no, s: s.id, st: s.student_id, tr: t.id, b: t.branch_id ?? s.branch_id, a: amount, m: body.method || 'cash', d: paid_at, n: body.note || null, u: c.user.id }).lastInsertRowid;
      });
      return { s: 201, j: payRow(c, id2) };
    }
    if (m === 'POST' && act === 'refund') { // استرداد كلي/جزئي (FR-122): لا يُعدَّل ولا يُحذف، سبب إلزامي
      can(c, MGMT); const why = reason(body), p = payRow(c, id);
      if (p.status !== 'valid') throw bad('لا يمكن الاسترداد من إيصال ملغي');
      const done = one(`SELECT COALESCE(SUM(amount),0) v FROM refunds WHERE payment_id=:i AND status='valid'`, { i: id }).v, left = r2(p.amount - done);
      const amount = money(body.amount, 'مبلغ الاسترداد'); if (amount > left + 1e-9) throw bad(`المبلغ أكبر من القابل للاسترداد (${left})`);
      const t = treasuryRow(c, Number(body.treasury_id || p.treasury_id));
      if (t.branch_id && p.branch_id && t.branch_id !== p.branch_id) throw bad('الخزينة تابعة لفرع مختلف عن فرع الإيصال');
      checkSpend(t, amount);
      const at = body.refunded_at || today(); if (!DATE.test(at) || at > today()) throw bad('تاريخ الاسترداد غير صالح');
      const r = db.prepare('INSERT INTO refunds(tenant_id,payment_id,subscription_id,student_id,treasury_id,branch_id,amount,refunded_at,reason,created_by) VALUES (:t,:p,:s,:st,:tr,:b,:a,:d,:r,:u)')
        .run({ t: c.t, p: id, s: p.subscription_id, st: p.student_id, tr: t.id, b: t.branch_id ?? p.branch_id, a: amount, d: at, r: why, u: c.user.id });
      return { s: 201, j: one('SELECT * FROM refunds WHERE id=:i', { i: r.lastInsertRowid }) };
    }
    if (m === 'POST' && act === 'cancel') {
      can(c, MGMT); const why = reason(body), p = payRow(c, id);
      if (p.status !== 'valid') throw bad('الإيصال ملغي بالفعل');
      if (one(`SELECT 1 x FROM refunds WHERE payment_id=:i AND status='valid'`, { i: id })) throw bad('يوجد استرداد على هذا الإيصال، لا يمكن إلغاؤه');
      const t = treasuryRow(c, p.treasury_id, false);
      if (t.balance - p.amount < -1e-9) throw bad('لا يمكن الإلغاء: سيصبح رصيد الخزينة سالباً');
      db.prepare(`UPDATE payments SET status='cancelled', cancel_reason=:r, cancelled_by=:u, updated_at=datetime('now') WHERE id=:i AND tenant_id=:t`).run({ r: why, u: c.user.id, i: id, t: c.t });
      return { s: 200, j: payRow(c, id) };
    }
    throw new HttpErr(405, 'الإيصالات لا تُعدَّل ولا تُحذف، يمكن إلغاؤها بسبب فقط');
  }

  // ---------- المصروفات ----------
  function expenses(c, m, id, act, body, q) {
    if (m === 'GET') { can(c, MGMT);
      let w = 'e.tenant_id=:t AND (:b IS NULL OR e.branch_id=:b)'; const p = { t: c.t, b: myBranch(c) };
      if (q.get('from')) { w += ' AND e.expense_date>=:from'; p.from = q.get('from'); } if (q.get('to')) { w += ' AND e.expense_date<=:to'; p.to = q.get('to'); }
      return { s: 200, j: all(`SELECT e.*, tr.name treasury_name FROM expenses e JOIN treasuries tr ON tr.id=e.treasury_id WHERE ${w} ORDER BY e.id DESC LIMIT 1000`, p) }; }
    can(c, MGMT);
    if (m === 'POST' && !id) {
      const t = treasuryRow(c, Number(body.treasury_id)), amount = money(body.amount, 'المبلغ'), cat = String(body.category || '').trim();
      if (!cat) throw bad('بند المصروف مطلوب');
      const d = body.expense_date || today(); if (!DATE.test(d) || d > today()) throw bad('تاريخ المصروف غير صالح');
      checkSpend(t, amount);
      const r = db.prepare('INSERT INTO expenses(tenant_id,treasury_id,branch_id,category,amount,description,expense_date,created_by) VALUES (:t,:tr,:b,:c,:a,:de,:d,:u)')
        .run({ t: c.t, tr: t.id, b: t.branch_id, c: cat, a: amount, de: body.description || null, d, u: c.user.id });
      return { s: 201, j: one('SELECT * FROM expenses WHERE id=:i', { i: r.lastInsertRowid }) };
    }
    if (m === 'POST' && act === 'cancel') {
      const e = one('SELECT * FROM expenses WHERE id=:i AND tenant_id=:t', { i: id, t: c.t }); if (!e) throw nf();
      const b = myBranch(c); if (b && e.branch_id !== b) throw forbid();
      if (e.status !== 'valid') throw bad('المصروف ملغي بالفعل');
      db.prepare(`UPDATE expenses SET status='cancelled', cancel_reason=:r, updated_at=datetime('now') WHERE id=:i AND tenant_id=:t`).run({ r: reason(body), i: id, t: c.t });
      return { s: 200, j: one('SELECT * FROM expenses WHERE id=:i', { i: id }) };
    }
    throw new HttpErr(405, 'المصروفات لا تُحذف، يمكن إلغاؤها بسبب فقط');
  }

  // ---------- مستحقات المدرسين ----------
  function dues(c, period, teacherId) {
    if (!PER.test(period || '')) throw bad('الفترة بصيغة YYYY-MM');
    const p = { p: period, t: c.t, b: myBranch(c) }; let w = 't.tenant_id=:t AND t.deleted_at IS NULL';
    if (teacherId != null) { w += ' AND t.id=:tid'; p.tid = teacherId; }
    return all(`SELECT t.id teacher_id, t.name, t.subject, t.pay_type, t.pay_value,
      COALESCE((SELECT SUM(py.amount) FROM payments py JOIN subscriptions s ON s.id=py.subscription_id JOIN groups g ON g.id=s.group_id
        WHERE g.teacher_id=t.id AND s.period=:p AND py.status='valid' AND py.tenant_id=:t AND (:b IS NULL OR py.branch_id=:b)),0) - COALESCE((SELECT SUM(rf.amount) FROM refunds rf JOIN subscriptions s ON s.id=rf.subscription_id JOIN groups g ON g.id=s.group_id
        WHERE g.teacher_id=t.id AND s.period=:p AND rf.status='valid' AND rf.tenant_id=:t AND (:b IS NULL OR rf.branch_id=:b)),0) collected,
      COALESCE((SELECT SUM(x.amount) FROM teacher_payouts x WHERE x.teacher_id=t.id AND x.period=:p AND x.status='valid' AND x.tenant_id=:t AND (:b IS NULL OR x.branch_id=:b)),0) paid,
      (SELECT COUNT(*) FROM groups g WHERE g.teacher_id=t.id AND g.deleted_at IS NULL AND g.active=1) groups_count
      FROM teachers t WHERE ${w} ORDER BY t.name`, p).map(r => {
      const collected = r2(r.collected), paid = r2(r.paid);
      const due = r.pay_type === 'percentage' ? r2(collected * r.pay_value / 100) : (r.pay_type === 'fixed' && r.groups_count > 0 ? r2(r.pay_value) : 0);
      return { ...r, collected, paid, due, remaining: r2(due - paid) };
    });
  }
  const teacherScope = c => { if (c.user.role === 'teacher') return c.tid; can(c, MGMT); return null; };
  function teacherDues(c, q) {
    const tid = teacherScope(c), period = q.get('period') || today().slice(0, 7);
    return { s: 200, j: dues(c, period, tid) };
  }
  function payouts(c, m, id, act, body, q) {
    if (m === 'GET') { const tid = teacherScope(c);
      let w = 'x.tenant_id=:t AND (:b IS NULL OR x.branch_id=:b)'; const p = { t: c.t, b: myBranch(c) };
      if (tid != null) { w += ' AND x.teacher_id=:tid'; p.tid = tid; } if (q.get('period')) { w += ' AND x.period=:per'; p.per = q.get('period'); }
      return { s: 200, j: all(`SELECT x.*, te.name teacher_name, tr.name treasury_name FROM teacher_payouts x JOIN teachers te ON te.id=x.teacher_id JOIN treasuries tr ON tr.id=x.treasury_id WHERE ${w} ORDER BY x.id DESC LIMIT 1000`, p) }; }
    can(c, MGMT);
    if (m === 'POST' && !id) {
      const tch = one('SELECT id FROM teachers WHERE id=:i AND tenant_id=:t AND deleted_at IS NULL', { i: Number(body.teacher_id), t: c.t }); if (!tch) throw bad('المدرس غير موجود');
      const row = dues(c, body.period, tch.id)[0], amount = money(body.amount, 'المبلغ');
      if (!row.pay_type) throw bad('لم يُحدد نظام محاسبة لهذا المدرس');
      if (amount > row.remaining + 1e-9) throw bad(`المبلغ أكبر من المستحق المتبقي (${row.remaining})`);
      const t = treasuryRow(c, Number(body.treasury_id)); checkSpend(t, amount);
      const r = db.prepare('INSERT INTO teacher_payouts(tenant_id,teacher_id,treasury_id,branch_id,period,amount,note,created_by) VALUES (:t,:te,:tr,:b,:p,:a,:n,:u)')
        .run({ t: c.t, te: tch.id, tr: t.id, b: t.branch_id, p: body.period, a: amount, n: body.note || null, u: c.user.id });
      return { s: 201, j: one('SELECT * FROM teacher_payouts WHERE id=:i', { i: r.lastInsertRowid }) };
    }
    if (m === 'POST' && act === 'cancel') {
      const x = one('SELECT * FROM teacher_payouts WHERE id=:i AND tenant_id=:t', { i: id, t: c.t }); if (!x) throw nf();
      const b = myBranch(c); if (b && x.branch_id !== b) throw forbid();
      if (x.status !== 'valid') throw bad('الصرف ملغي بالفعل');
      db.prepare(`UPDATE teacher_payouts SET status='cancelled', cancel_reason=:r, updated_at=datetime('now') WHERE id=:i AND tenant_id=:t`).run({ r: reason(body), i: id, t: c.t });
      return { s: 200, j: one('SELECT * FROM teacher_payouts WHERE id=:i', { i: id }) };
    }
    throw new HttpErr(405, 'طريقة غير مدعومة');
  }

  // ---------- التقارير ----------
  const sum = (rows, k) => r2(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0));
  function report(c, name, q) {
    can(c, MGMT);
    const b = effBranch(c, q), from = q.get('from') || today().slice(0, 8) + '01', to = q.get('to') || today();
    if (!DATE.test(from) || !DATE.test(to) || from > to) throw bad('نطاق التاريخ غير صالح');
    const P = { t: c.t, b }, range = { ...P, f: from, to };
    const R = (title, columns, rows, totals, summary = []) => ({ title, from, to, columns, rows, totals, summary });
    if (name === 'revenue') {
      const rows = all(`SELECT p.receipt_no, p.paid_at, st.name student, g.name grp, p.method, tr.name treasury, p.amount FROM payments p JOIN students st ON st.id=p.student_id
        JOIN subscriptions s ON s.id=p.subscription_id JOIN groups g ON g.id=s.group_id JOIN treasuries tr ON tr.id=p.treasury_id
        WHERE p.tenant_id=:t AND p.status='valid' AND p.paid_at BETWEEN :f AND :to AND (:b IS NULL OR p.branch_id=:b) ORDER BY p.paid_at, p.receipt_no`, range).map(r => ({ ...r, method: METHOD[r.method] }));
      const by = {}; rows.forEach(r => by[r.method] = r2((by[r.method] || 0) + r.amount));
      return R('تقرير الإيرادات', [{ key: 'receipt_no', label: 'رقم الإيصال' }, { key: 'paid_at', label: 'التاريخ' }, { key: 'student', label: 'الطالب' }, { key: 'grp', label: 'المجموعة' }, { key: 'method', label: 'الطريقة' }, { key: 'treasury', label: 'الخزينة' }, { key: 'amount', label: 'المبلغ', type: 'money' }],
        rows, { amount: sum(rows, 'amount') }, Object.entries(by).map(([k, v]) => ({ label: k, value: v })));
    }
    if (name === 'expenses') {
      const rows = all(`SELECT e.expense_date, e.category, e.description, tr.name treasury, e.amount FROM expenses e JOIN treasuries tr ON tr.id=e.treasury_id
        WHERE e.tenant_id=:t AND e.status='valid' AND e.expense_date BETWEEN :f AND :to AND (:b IS NULL OR e.branch_id=:b) ORDER BY e.expense_date, e.id`, range);
      const by = {}; rows.forEach(r => by[r.category] = r2((by[r.category] || 0) + r.amount));
      return R('تقرير المصروفات', [{ key: 'expense_date', label: 'التاريخ' }, { key: 'category', label: 'البند' }, { key: 'description', label: 'الوصف' }, { key: 'treasury', label: 'الخزينة' }, { key: 'amount', label: 'المبلغ', type: 'money' }],
        rows, { amount: sum(rows, 'amount') }, Object.entries(by).map(([k, v]) => ({ label: k, value: v })));
    }
    if (name === 'debts') {
      const rows = all(`SELECT st.name student, st.parent_name, st.parent_phone, COUNT(*) subs, SUM(x.net) total, SUM(x.paid) paid, SUM(x.net)-SUM(x.paid) remaining
        FROM (SELECT s.student_id, ROUND(s.amount-s.discount,2) net, (COALESCE((SELECT SUM(amount) FROM payments p WHERE p.subscription_id=s.id AND p.status='valid'),0)-COALESCE((SELECT SUM(amount) FROM refunds rf WHERE rf.subscription_id=s.id AND rf.status='valid'),0)) paid
          FROM subscriptions s WHERE s.tenant_id=:t AND s.status='active' AND s.deleted_at IS NULL AND s.period<=:pto AND (:b IS NULL OR s.branch_id=:b)) x
        JOIN students st ON st.id=x.student_id GROUP BY st.id HAVING remaining>0.005 ORDER BY remaining DESC`, { ...P, pto: to.slice(0, 7) })
        .map(r => ({ ...r, total: r2(r.total), paid: r2(r.paid), remaining: r2(r.remaining) }));
      return R('تقرير الديون (المتأخرات)', [{ key: 'student', label: 'الطالب' }, { key: 'parent_name', label: 'ولي الأمر' }, { key: 'parent_phone', label: 'هاتف ولي الأمر' }, { key: 'subs', label: 'عدد الاشتراكات' }, { key: 'total', label: 'الإجمالي', type: 'money' }, { key: 'paid', label: 'المدفوع', type: 'money' }, { key: 'remaining', label: 'المتبقي', type: 'money' }],
        rows, { total: sum(rows, 'total'), paid: sum(rows, 'paid'), remaining: sum(rows, 'remaining') });
    }
    if (name === 'collection') {
      const rows = all(`SELECT s.period, COUNT(*) subs, SUM(ROUND(s.amount-s.discount,2)) due,
        SUM((COALESCE((SELECT SUM(amount) FROM payments p WHERE p.subscription_id=s.id AND p.status='valid'),0)-COALESCE((SELECT SUM(amount) FROM refunds rf WHERE rf.subscription_id=s.id AND rf.status='valid'),0))) collected
        FROM subscriptions s WHERE s.tenant_id=:t AND s.status='active' AND s.deleted_at IS NULL AND s.period BETWEEN :pf AND :pto AND (:b IS NULL OR s.branch_id=:b) GROUP BY s.period ORDER BY s.period`,
        { ...P, pf: from.slice(0, 7), pto: to.slice(0, 7) }).map(r => ({ ...r, due: r2(r.due), collected: r2(r.collected), remaining: r2(r.due - r.collected), rate: r.due ? r2(r.collected / r.due * 100) : 0 }));
      const t = { due: sum(rows, 'due'), collected: sum(rows, 'collected'), remaining: sum(rows, 'remaining') }; t.rate = t.due ? r2(t.collected / t.due * 100) : 0;
      return R('تقرير التحصيل الشهري', [{ key: 'period', label: 'الشهر' }, { key: 'subs', label: 'عدد الاشتراكات' }, { key: 'due', label: 'المستحق', type: 'money' }, { key: 'collected', label: 'المحصّل', type: 'money' }, { key: 'remaining', label: 'المتبقي', type: 'money' }, { key: 'rate', label: 'نسبة التحصيل %', type: 'money' }], rows, t);
    }
    if (name === 'teacher-dues') {
      const period = q.get('period') || to.slice(0, 7), rows = dues(c, period, null).filter(r => r.pay_type);
      const rep = R(`مستحقات المدرسين — ${period}`, [{ key: 'name', label: 'المدرس' }, { key: 'subject', label: 'المادة' }, { key: 'basis', label: 'النظام' }, { key: 'collected', label: 'المحصّل من طلابه', type: 'money' }, { key: 'due', label: 'المستحق', type: 'money' }, { key: 'paid', label: 'المصروف', type: 'money' }, { key: 'remaining', label: 'المتبقي', type: 'money' }],
        rows.map(r => ({ ...r, basis: r.pay_type === 'percentage' ? `نسبة ${r.pay_value}%` : `مبلغ ثابت ${r.pay_value}` })), null);
      rep.totals = { collected: sum(rows, 'collected'), due: sum(rows, 'due'), paid: sum(rows, 'paid'), remaining: sum(rows, 'remaining') }; return rep;
    }
    if (name === 'summary') {
      const one1 = sql => r2(one(sql, range).v || 0);
      const revenue = one1(`SELECT (SELECT COALESCE(SUM(amount),0) FROM payments WHERE tenant_id=:t AND status='valid' AND paid_at BETWEEN :f AND :to AND (:b IS NULL OR branch_id=:b)) - (SELECT COALESCE(SUM(amount),0) FROM refunds WHERE tenant_id=:t AND status='valid' AND refunded_at BETWEEN :f AND :to AND (:b IS NULL OR branch_id=:b)) v`);
      const exp = one1(`SELECT SUM(amount) v FROM expenses WHERE tenant_id=:t AND status='valid' AND expense_date BETWEEN :f AND :to AND (:b IS NULL OR branch_id=:b)`);
      const pay = one1(`SELECT SUM(amount) v FROM teacher_payouts WHERE tenant_id=:t AND status='valid' AND date(created_at) BETWEEN :f AND :to AND (:b IS NULL OR branch_id=:b)`);
      const rows = all(`SELECT t.name, br.name branch, ${BAL} balance FROM treasuries t LEFT JOIN branches br ON br.id=t.branch_id WHERE t.tenant_id=:t AND t.deleted_at IS NULL AND (:b IS NULL OR t.branch_id=:b)`, P);
      return R('الملخص المالي', [{ key: 'name', label: 'الخزينة' }, { key: 'branch', label: 'الفرع' }, { key: 'balance', label: 'الرصيد', type: 'money' }], rows, { balance: sum(rows, 'balance') },
        [{ label: 'إجمالي الإيرادات', value: revenue }, { label: 'إجمالي المصروفات', value: exp }, { label: 'مدفوعات المدرسين', value: pay }, { label: 'الصافي', value: r2(revenue - exp - pay) }]);
    }
    throw nf();
  }
  function toXlsx(rep) {
    const H = c => ({ v: c.label, s: 'b' }), cell = (r, c) => { const v = r[c.key]; return v == null ? '' : c.type === 'money' ? { v: Number(v), s: 'm' } : v; };
    const rows = [[{ v: rep.title, s: 'b' }], [`من ${rep.from} إلى ${rep.to}`], [], ...rep.summary.map(s => [{ v: s.label, s: 'b' }, { v: s.value, s: 'm' }]), ...(rep.summary.length ? [[]] : []),
      rep.columns.map(H), ...rep.rows.map(r => rep.columns.map(c => cell(r, c)))];
    if (rep.totals) rows.push(rep.columns.map((c, i) => i === 0 ? { v: 'الإجمالي', s: 'b' } : rep.totals[c.key] != null ? { v: rep.totals[c.key], s: 'bm' } : ''));
    return build({ name: rep.title, rows, widths: rep.columns.map(c => c.type === 'money' ? 16 : 22) });
  }

  // ---------- الموجّه ----------
  function route(c, [a, b, d], m, body, url) {
    const id = b && /^\d+$/.test(b) ? Number(b) : null, q = url.searchParams;
    if (a === 'treasuries') return treasuries(c, m, id, body);
    if (a === 'subscriptions') return subscriptions(c, m, id, d, body, q);
    if (a === 'payments') return payments(c, m, id, d, body, q);
    if (a === 'refunds' && m === 'GET') { can(c, STAFF);
      return { s: 200, j: all(`SELECT rf.*, st.name student_name, tr.name treasury_name, p.receipt_no FROM refunds rf JOIN students st ON st.id=rf.student_id JOIN treasuries tr ON tr.id=rf.treasury_id JOIN payments p ON p.id=rf.payment_id
        WHERE rf.tenant_id=:t AND (:b IS NULL OR rf.branch_id=:b) ORDER BY rf.id DESC LIMIT 1000`, { t: c.t, b: myBranch(c) }) }; }
    if (a === 'expenses') return expenses(c, m, id, d, body, q);
    if (a === 'teacher-dues' && m === 'GET') return teacherDues(c, q);
    if (a === 'teacher-payouts') return payouts(c, m, id, d, body, q);
    if (a === 'student-groups' && m === 'GET') { can(c, STAFF);
      return { s: 200, j: all(`SELECT g.id, g.name FROM group_students gs JOIN groups g ON g.id=gs.group_id WHERE gs.student_id=:s AND gs.tenant_id=:t AND gs.deleted_at IS NULL AND g.deleted_at IS NULL AND (:b IS NULL OR g.branch_id=:b)`, { s: Number(q.get('student_id')), t: c.t, b: myBranch(c) }) }; }
    if (a === 'reports' && m === 'GET') {
      const rep = report(c, b, q);
      return q.get('format') === 'xlsx' ? { s: 200, buf: toXlsx(rep), type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } : { s: 200, j: rep };
    }
  }
  return { route };
};
