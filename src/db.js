const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const db = new DatabaseSync(process.env.DB_FILE || 'senter.db');
db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');

const base = `id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id),
 created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')), deleted_at TEXT`;
db.exec(`
CREATE TABLE IF NOT EXISTS tenants(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS branches(${base}, name TEXT NOT NULL, address TEXT, phone TEXT);
CREATE TABLE IF NOT EXISTS rooms(${base}, branch_id INTEGER NOT NULL REFERENCES branches(id), name TEXT NOT NULL, capacity INTEGER DEFAULT 20);
CREATE TABLE IF NOT EXISTS users(${base}, name TEXT NOT NULL, phone TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','manager','employee','teacher','student','parent','super_admin')), branch_id INTEGER REFERENCES branches(id), active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS students(${base}, name TEXT NOT NULL, phone TEXT, parent_name TEXT, parent_phone TEXT, grade TEXT,
  branch_id INTEGER REFERENCES branches(id), notes TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS teachers(${base}, name TEXT NOT NULL, phone TEXT, subject TEXT, user_id INTEGER REFERENCES users(id), active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS groups(${base}, name TEXT NOT NULL, teacher_id INTEGER NOT NULL REFERENCES teachers(id), branch_id INTEGER REFERENCES branches(id),
  subject TEXT, grade TEXT, capacity INTEGER DEFAULT 20, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS group_students(${base}, group_id INTEGER NOT NULL REFERENCES groups(id), student_id INTEGER NOT NULL REFERENCES students(id));
CREATE TABLE IF NOT EXISTS schedules(${base}, group_id INTEGER NOT NULL REFERENCES groups(id), room_id INTEGER REFERENCES rooms(id),
  weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6), start_time TEXT NOT NULL, end_time TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(${base}, group_id INTEGER NOT NULL REFERENCES groups(id), room_id INTEGER REFERENCES rooms(id),
  session_date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, status TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled','done','cancelled')));
CREATE TABLE IF NOT EXISTS attendance(${base}, session_id INTEGER NOT NULL REFERENCES sessions(id), student_id INTEGER NOT NULL REFERENCES students(id),
  status TEXT NOT NULL CHECK(status IN ('present','absent','late','excused')), note TEXT, marked_by INTEGER REFERENCES users(id),
  UNIQUE(session_id, student_id));
CREATE INDEX IF NOT EXISTS ix_students_t ON students(tenant_id, deleted_at);
CREATE INDEX IF NOT EXISTS ix_sessions_t ON sessions(tenant_id, session_date);
`);


// ===== المرحلة الثانية: المالية =====
const tcols = db.prepare('PRAGMA table_info(teachers)').all().map(c => c.name);
if (!tcols.includes('pay_type')) db.exec("ALTER TABLE teachers ADD COLUMN pay_type TEXT CHECK(pay_type IN ('percentage','fixed'))");
if (!tcols.includes('pay_value')) db.exec('ALTER TABLE teachers ADD COLUMN pay_value REAL');
db.exec(`
CREATE TABLE IF NOT EXISTS treasuries(${base}, name TEXT NOT NULL, branch_id INTEGER REFERENCES branches(id), opening_balance REAL NOT NULL DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS subscriptions(${base}, student_id INTEGER NOT NULL REFERENCES students(id), group_id INTEGER NOT NULL REFERENCES groups(id),
  branch_id INTEGER REFERENCES branches(id), period TEXT NOT NULL, amount REAL NOT NULL CHECK(amount>0), discount REAL NOT NULL DEFAULT 0 CHECK(discount>=0),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')), notes TEXT, created_by INTEGER REFERENCES users(id));
CREATE UNIQUE INDEX IF NOT EXISTS ux_sub_active ON subscriptions(tenant_id,student_id,group_id,period) WHERE status='active' AND deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS payments(${base}, receipt_no INTEGER NOT NULL, subscription_id INTEGER NOT NULL REFERENCES subscriptions(id), student_id INTEGER NOT NULL REFERENCES students(id),
  treasury_id INTEGER NOT NULL REFERENCES treasuries(id), branch_id INTEGER REFERENCES branches(id), amount REAL NOT NULL CHECK(amount>0),
  method TEXT NOT NULL CHECK(method IN ('cash','transfer','other')), paid_at TEXT NOT NULL, note TEXT,
  status TEXT NOT NULL DEFAULT 'valid' CHECK(status IN ('valid','cancelled')), cancel_reason TEXT, cancelled_by INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id), UNIQUE(tenant_id,receipt_no));
CREATE TABLE IF NOT EXISTS expenses(${base}, treasury_id INTEGER NOT NULL REFERENCES treasuries(id), branch_id INTEGER REFERENCES branches(id), category TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount>0), description TEXT, expense_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'valid' CHECK(status IN ('valid','cancelled')),
  cancel_reason TEXT, created_by INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS teacher_payouts(${base}, teacher_id INTEGER NOT NULL REFERENCES teachers(id), treasury_id INTEGER NOT NULL REFERENCES treasuries(id),
  branch_id INTEGER REFERENCES branches(id), period TEXT NOT NULL, amount REAL NOT NULL CHECK(amount>0), note TEXT,
  status TEXT NOT NULL DEFAULT 'valid' CHECK(status IN ('valid','cancelled')), cancel_reason TEXT, created_by INTEGER REFERENCES users(id));
CREATE INDEX IF NOT EXISTS ix_pay_t ON payments(tenant_id, paid_at);
CREATE INDEX IF NOT EXISTS ix_pay_sub ON payments(subscription_id);
`);

// ===== المرحلة الثالثة: حسابات الطلاب وأولياء الأمور والإشعارات =====
if (!db.prepare("SELECT sql FROM sqlite_master WHERE name='users'").get().sql.includes("'super_admin'")) { // ترحيل قيد الأدوار
  db.exec('PRAGMA foreign_keys=OFF; BEGIN');
  db.exec(`CREATE TABLE users_new(${base}, name TEXT NOT NULL, phone TEXT NOT NULL, password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner','manager','employee','teacher','student','parent','super_admin')), branch_id INTEGER REFERENCES branches(id), active INTEGER DEFAULT 1)`);
  db.exec('INSERT INTO users_new SELECT id,tenant_id,created_at,updated_at,deleted_at,name,phone,password_hash,role,branch_id,active FROM users');
  db.exec('DROP TABLE users; ALTER TABLE users_new RENAME TO users; COMMIT; PRAGMA foreign_keys=ON');
}
if (!db.prepare('PRAGMA table_info(students)').all().some(c => c.name === 'user_id')) db.exec('ALTER TABLE students ADD COLUMN user_id INTEGER REFERENCES users(id)');
db.exec(`
CREATE TABLE IF NOT EXISTS parent_students(${base}, parent_id INTEGER NOT NULL REFERENCES users(id), student_id INTEGER NOT NULL REFERENCES students(id),
  relation TEXT NOT NULL DEFAULT 'guardian' CHECK(relation IN ('father','mother','guardian')));
CREATE UNIQUE INDEX IF NOT EXISTS ux_parent_student ON parent_students(parent_id, student_id) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS notifications(${base}, user_id INTEGER NOT NULL REFERENCES users(id), student_id INTEGER REFERENCES students(id),
  type TEXT NOT NULL CHECK(type IN ('absence','late','change')), title TEXT NOT NULL, body TEXT NOT NULL, ref_type TEXT, ref_id INTEGER, read_at TEXT);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, read_at, id);
CREATE TABLE IF NOT EXISTS notification_prefs(tenant_id INTEGER NOT NULL REFERENCES tenants(id), user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK(type IN ('absence','late','change')), enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(user_id, type));
`);

// ===== المرحلة الرابعة: الدروس والمذكرات والامتحانات =====
db.exec(`
CREATE TABLE IF NOT EXISTS lessons(${base}, group_id INTEGER NOT NULL REFERENCES groups(id), title TEXT NOT NULL, description TEXT,
  type TEXT NOT NULL CHECK(type IN ('live','recorded')), url TEXT, file_path TEXT, file_name TEXT, mime TEXT, size INTEGER,
  scheduled_at TEXT, duration_min INTEGER, position INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 0, created_by INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS lesson_progress(tenant_id INTEGER NOT NULL REFERENCES tenants(id), lesson_id INTEGER NOT NULL REFERENCES lessons(id), student_id INTEGER NOT NULL REFERENCES students(id),
  last_position REAL NOT NULL DEFAULT 0, duration REAL, percent REAL NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, updated_at TEXT DEFAULT (datetime('now')), PRIMARY KEY(lesson_id, student_id));
CREATE TABLE IF NOT EXISTS materials(${base}, group_id INTEGER REFERENCES groups(id), title TEXT NOT NULL, subject TEXT NOT NULL, grade TEXT, description TEXT,
  access TEXT NOT NULL DEFAULT 'group' CHECK(access IN ('group','free')), file_path TEXT, file_name TEXT, mime TEXT, size INTEGER, published INTEGER NOT NULL DEFAULT 1, created_by INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS question_bank(${base}, subject TEXT NOT NULL, grade TEXT, type TEXT NOT NULL CHECK(type IN ('mcq','multi','true_false','short','essay')),
  text TEXT NOT NULL, options TEXT, answer TEXT, points REAL NOT NULL DEFAULT 1, explanation TEXT, created_by INTEGER REFERENCES users(id), active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS exams(${base}, group_id INTEGER NOT NULL REFERENCES groups(id), title TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('exam','assignment')), description TEXT,
  start_at TEXT, end_at TEXT, duration_min INTEGER, attempts_allowed INTEGER NOT NULL DEFAULT 1, shuffle INTEGER NOT NULL DEFAULT 0,
  release_mode TEXT NOT NULL DEFAULT 'manual' CHECK(release_mode IN ('immediate','manual')), show_answers INTEGER NOT NULL DEFAULT 0, pass_mark REAL, max_points REAL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','closed')), results_released_at TEXT, created_by INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS exam_questions(${base}, exam_id INTEGER NOT NULL REFERENCES exams(id), question_id INTEGER REFERENCES question_bank(id), position INTEGER NOT NULL DEFAULT 0,
  q_type TEXT NOT NULL, q_text TEXT NOT NULL, q_options TEXT, q_answer TEXT, q_explanation TEXT, points REAL NOT NULL CHECK(points>0));
CREATE TABLE IF NOT EXISTS exam_attempts(${base}, exam_id INTEGER NOT NULL REFERENCES exams(id), student_id INTEGER NOT NULL REFERENCES students(id), attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','submitted','graded')), started_at TEXT NOT NULL, deadline_at TEXT, submitted_at TEXT,
  q_order TEXT, answers TEXT NOT NULL DEFAULT '{}', grades TEXT NOT NULL DEFAULT '{}', total_score REAL, max_score REAL, feedback TEXT,
  graded_by INTEGER REFERENCES users(id), graded_at TEXT, file_path TEXT, file_name TEXT, UNIQUE(exam_id, student_id, attempt_no));
CREATE INDEX IF NOT EXISTS ix_lessons_g ON lessons(tenant_id, group_id);
CREATE INDEX IF NOT EXISTS ix_att_exam ON exam_attempts(exam_id, student_id);
`);

// ===== المرحلة الخامسة: الدليل والحجز والاشتراكات المتقدمة =====
const addCol = (t, col, ddl) => { if (!db.prepare(`PRAGMA table_info(${t})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${ddl}`); };
addCol('tenants', 'listed', 'INTEGER NOT NULL DEFAULT 0'); addCol('tenants', 'area', 'TEXT'); addCol('tenants', 'city', 'TEXT');
addCol('tenants', 'description', 'TEXT'); addCol('tenants', 'contact_phone', 'TEXT');
addCol('tenants', 'plan', "TEXT NOT NULL DEFAULT 'basic' CHECK(plan IN ('basic','pro','ai'))"); addCol('tenants', 'ai_monthly_quota', 'INTEGER NOT NULL DEFAULT 200000');
addCol('tenants', 'active', 'INTEGER NOT NULL DEFAULT 1'); addCol('tenants', 'is_platform', 'INTEGER NOT NULL DEFAULT 0');
addCol('teachers', 'listed', 'INTEGER NOT NULL DEFAULT 0'); addCol('teachers', 'bio', 'TEXT');
addCol('groups', 'bookable', 'INTEGER NOT NULL DEFAULT 0'); addCol('groups', 'price', 'REAL');
addCol('subscriptions', 'plan_type', "TEXT NOT NULL DEFAULT 'monthly' CHECK(plan_type IN ('monthly','per_session','course'))");
addCol('subscriptions', 'sessions_count', 'INTEGER'); addCol('subscriptions', 'start_date', 'TEXT'); addCol('subscriptions', 'end_date', 'TEXT');
addCol('subscriptions', 'renewed_from', 'INTEGER REFERENCES subscriptions(id)');
const ux = db.prepare("SELECT sql FROM sqlite_master WHERE name='ux_sub_active'").get();
if (!ux || !ux.sql.includes('plan_type')) { // التفرّد للشهري فقط؛ بالحصة والكورس يسمحان بأكثر من اشتراك
  db.exec(`DROP INDEX IF EXISTS ux_sub_active; CREATE UNIQUE INDEX ux_sub_active ON subscriptions(tenant_id,student_id,group_id,period) WHERE status='active' AND deleted_at IS NULL AND plan_type='monthly'`);
}
db.exec(`
CREATE TABLE IF NOT EXISTS refunds(${base}, payment_id INTEGER NOT NULL REFERENCES payments(id), subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  student_id INTEGER NOT NULL REFERENCES students(id), treasury_id INTEGER NOT NULL REFERENCES treasuries(id), branch_id INTEGER REFERENCES branches(id),
  amount REAL NOT NULL CHECK(amount>0), refunded_at TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'valid' CHECK(status IN ('valid')), created_by INTEGER REFERENCES users(id));
CREATE INDEX IF NOT EXISTS ix_ref_sub ON refunds(subscription_id);
CREATE TABLE IF NOT EXISTS bookings(${base}, code TEXT NOT NULL UNIQUE, group_id INTEGER NOT NULL REFERENCES groups(id), name TEXT NOT NULL, phone TEXT NOT NULL,
  parent_name TEXT, parent_phone TEXT, grade TEXT, note TEXT, source TEXT NOT NULL DEFAULT 'public' CHECK(source IN ('public','staff')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','waitlist','confirmed','rejected','cancelled')),
  student_id INTEGER REFERENCES students(id), reject_reason TEXT, promoted_at TEXT, decided_by INTEGER REFERENCES users(id));
CREATE INDEX IF NOT EXISTS ix_book_g ON bookings(tenant_id, group_id, status);
CREATE TABLE IF NOT EXISTS inquiries(${base}, teacher_id INTEGER REFERENCES teachers(id), name TEXT NOT NULL, phone TEXT NOT NULL, message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','handled')), handled_by INTEGER REFERENCES users(id), handled_note TEXT);
CREATE TABLE IF NOT EXISTS reviews(${base}, student_id INTEGER NOT NULL REFERENCES students(id), author_id INTEGER NOT NULL REFERENCES users(id),
  target TEXT NOT NULL CHECK(target IN ('center','teacher')), teacher_id INTEGER REFERENCES teachers(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), comment TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','hidden')), moderated_by INTEGER REFERENCES users(id));
CREATE UNIQUE INDEX IF NOT EXISTS ux_review ON reviews(tenant_id, student_id, target, COALESCE(teacher_id,0)) WHERE deleted_at IS NULL;
`);

// ===== المرحلة السادسة: الذكاء الاصطناعي والإدارة المركزية =====
addCol('question_bank', 'ai_draft', 'INTEGER NOT NULL DEFAULT 0'); addCol('question_bank', 'reviewed_by', 'INTEGER REFERENCES users(id)');
db.exec(`
CREATE TABLE IF NOT EXISTS ai_usage(id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id), user_id INTEGER REFERENCES users(id),
  feature TEXT NOT NULL, tokens INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS ix_ai_usage ON ai_usage(tenant_id, created_at);
CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER REFERENCES tenants(id), actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL, detail TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS ix_audit_t ON audit_log(tenant_id, id);
`);

// مستأجر داخلي لمشرفي المنصة (بلا بيانات طلاب). يُنشأ مرة واحدة، ويُنشأ أول super_admin من متغيرات البيئة فقط.
function ensurePlatform() {
  let p = db.prepare('SELECT id FROM tenants WHERE is_platform=1').get();
  if (!p) p = { id: Number(db.prepare("INSERT INTO tenants(name,plan,is_platform) VALUES ('منصة SENTER','ai',1)").run().lastInsertRowid) };
  const ph = process.env.SUPER_ADMIN_PHONE, pw = process.env.SUPER_ADMIN_PASSWORD;
  if (ph && pw && !db.prepare("SELECT id FROM users WHERE role='super_admin' AND phone=:p AND deleted_at IS NULL").get({ p: ph })) {
    if (String(pw).length < 8) throw new Error('SUPER_ADMIN_PASSWORD يجب أن يكون 8 أحرف على الأقل');
    db.prepare('INSERT INTO users(tenant_id,name,phone,password_hash,role) VALUES (?,?,?,?,?)').run(p.id, 'مشرف المنصة', ph, hashPassword(String(pw)), 'super_admin');
  }
  return p.id;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
function verifyPassword(pw, stored) {
  const [salt, h] = stored.split(':');
  const x = crypto.scryptSync(pw, salt, 32);
  return crypto.timingSafeEqual(x, Buffer.from(h, 'hex'));
}
function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM tenants').get().c) return;
  const t = db.prepare('INSERT INTO tenants(name) VALUES (?)').run('سنتر تجريبي').lastInsertRowid;
  db.prepare('INSERT INTO users(tenant_id,name,phone,password_hash,role) VALUES (?,?,?,?,?)')
    .run(t, 'المالك', '01000000000', hashPassword('admin123'), 'owner');
  console.log('تم إنشاء حساب المالك: 01000000000 / admin123 (غيّر كلمة المرور فوراً)');
}
module.exports = { db, hashPassword, verifyPassword, seed, ensurePlatform };
