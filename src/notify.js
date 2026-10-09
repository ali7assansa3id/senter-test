// نقطة تمديد الإشعارات الخارجية (SMS / واتساب / بريد) — FR-140 و FR-120.
// لا يوجد مزوّد مربوط افتراضياً: notify() يعيد {sent:false} ولا يرسل شيئاً خارجياً.
// لربط مزوّد لاحقاً: setChannel('sms', async (to, msg) => { ... }) من ملف الإقلاع، دون تعديل منطق الحجز.
const channels = {};
function setChannel(name, fn) { channels[name] = fn; }
async function notify(channel, to, msg) {
  const fn = channels[channel];
  if (!fn) return { sent: false, channel, reason: 'no_provider' };
  try { await fn(to, msg); return { sent: true, channel }; }
  catch { return { sent: false, channel, reason: 'provider_error' }; } // لا نسرب تفاصيل المزوّد ولا نوقف العملية التجارية
}
module.exports = { notify, setChannel };
