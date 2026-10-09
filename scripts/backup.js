// نسخة احتياطية متسقة لقاعدة SQLite أثناء التشغيل: node scripts/backup.js [مجلد_الوجهة]
// تستخدم VACUUM INTO (آمنة مع WAL وتنتج ملفاً واحداً مضغوطاً ومتسقاً).
const path = require('path'), fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const src = process.env.DB_FILE || path.join(__dirname, '..', 'senter.db');
const outDir = process.argv[2] || process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
if (src === ':memory:' || !fs.existsSync(src)) { console.error('لا توجد قاعدة بيانات ملفية للنسخ (DB_FILE=' + src + ')'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = path.join(outDir, `senter-${stamp}.db`);
const db = new DatabaseSync(src, { readOnly: true });
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();
// احتفظ بآخر 14 نسخة فقط
const files = fs.readdirSync(outDir).filter(f => /^senter-.*\.db$/.test(f)).sort();
for (const f of files.slice(0, Math.max(0, files.length - 14))) fs.rmSync(path.join(outDir, f));
console.log('تم إنشاء النسخة: ' + dest);
