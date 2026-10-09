// واجهات المرحلة الخامسة: الحجوزات، الاستفسارات، التقييمات، إعدادات الدليل
const BST = { pending: 'معلّق', waitlist: 'قائمة انتظار', confirmed: 'مؤكد', rejected: 'مرفوض', cancelled: 'ملغي' };
const RST = { pending: 'بانتظار المراجعة', published: 'منشور', hidden: 'مخفي' };
const stars = n => '★'.repeat(n) + '☆'.repeat(5 - n);

def('bookings', 'الحجوزات وقوائم الانتظار', STAFFR, async () => {
  const f = window._bf || (window._bf = { status: 'pending' });
  const [bs, seats, gs] = await Promise.all([api('bookings' + (f.status ? '?status=' + f.status : '')), api('seats'), api('groups')]);
  main.innerHTML = `<div class="bar"><h2>الحجوزات وقوائم الانتظار</h2><button onclick="bForm()">+ حجز يدوي</button></div><div id="fm"></div>
  ${tbl(['المجموعة', 'السعة', 'المسجلون', 'معلّق', 'انتظار', 'متاح', 'للحجز العام'], seats.map(g => [esc(g.name), g.capacity, g.enrolled, g.pending, g.waitlist, `<b>${g.free}</b>`, g.bookable ? 'نعم' : 'لا']))}
  <div class="card row"><div><label>الحالة</label><select id="bs"><option value="">الكل</option>${Object.entries(BST).map(([k, v]) => `<option value="${k}" ${f.status == k ? 'selected' : ''}>${v}</option>`).join('')}</select></div><button onclick="_bf.status=V('bs');PAGES.bookings()">عرض</button></div>` +
    tbl(['التاريخ', 'الاسم', 'الهاتف', 'ولي الأمر', 'الصف', 'المجموعة', 'الحالة', ''], bs.map(b => [b.created_at.slice(0, 10), esc(b.name), esc(b.phone), esc(b.parent_name || ''), esc(b.grade || ''), esc(b.group_name),
      BST[b.status] + (b.position ? ` (${b.position})` : ''), ['pending', 'waitlist'].includes(b.status) ? `<button onclick="bAct(${b.id},'confirm')">تأكيد</button> <button class="d" onclick="bAct(${b.id},'reject')">رفض</button>` : '']));
  window.bAct = async (id, a) => { try { const b = a == 'reject' ? { reason: prompt('سبب الرفض (اختياري):') || null } : {}; await api(`bookings/${id}/${a}`, 'POST', b); PAGES.bookings(); } catch (e) { alert(e.message); } };
  window.bForm = () => { fm.innerHTML = `<div class="card"><div class="row">${fld('المجموعة', `<select id="bg">${opts(gs, 0, g => g.name)}</select>`)}${fld('الاسم', '<input id="bn">')}${fld('الهاتف', '<input id="bp">')}${fld('ولي الأمر', '<input id="bpn">')}${fld('هاتف ولي الأمر', '<input id="bpp">')}${fld('الصف', '<input id="bgr">')}</div>
    <div class="err" id="fe"></div><button onclick="bSave()">حفظ</button> <button class="s" onclick="fm.innerHTML=''">إلغاء</button></div>`; };
  window.bSave = async () => { try { await api('bookings', 'POST', { group_id: +V('bg'), name: V('bn'), phone: V('bp'), parent_name: V('bpn'), parent_phone: V('bpp') || null, grade: V('bgr') }); PAGES.bookings(); } catch (e) { fe.textContent = e.message; } };
});

def('inquiries', 'الاستفسارات', STAFFR, async () => {
  const rows = await api('inquiries');
  main.innerHTML = '<div class="bar"><h2>الاستفسارات</h2></div>' + tbl(['التاريخ', 'الاسم', 'الهاتف', 'المدرس', 'الرسالة', 'الحالة', ''], rows.map(i => [i.created_at.slice(0, 10), esc(i.name), esc(i.phone), esc(i.teacher_name || ''), esc(i.message),
    i.status == 'new' ? '<b>جديد</b>' : 'تمت المعالجة' + (i.handled_note ? ' — ' + esc(i.handled_note) : ''), i.status == 'new' ? `<button onclick="iHandle(${i.id})">تمت المعالجة</button>` : '']));
  window.iHandle = async id => { try { await api(`inquiries/${id}/handle`, 'POST', { note: prompt('ملاحظة (اختياري):') || null }); PAGES.inquiries(); } catch (e) { alert(e.message); } };
});

def('reviews', 'مراجعة التقييمات', MGR, async () => {
  const rows = await api('reviews');
  main.innerHTML = '<div class="bar"><h2>مراجعة التقييمات</h2></div><p>التقييمات تُنشر في الدليل مجهولة الهوية بعد موافقتكم.</p>' + tbl(['التاريخ', 'الطالب', 'عن', 'التقييم', 'التعليق', 'الحالة', ''], rows.map(r => [r.created_at.slice(0, 10), esc(r.student_name), r.target == 'center' ? 'السنتر' : esc('المدرس ' + (r.teacher_name || '')), stars(r.rating), esc(r.comment || ''), RST[r.status],
    `${r.status != 'published' ? `<button onclick="rMod(${r.id},'publish')">نشر</button> ` : ''}${r.status != 'hidden' ? `<button class="d" onclick="rMod(${r.id},'hide')">إخفاء</button>` : ''}`]));
  window.rMod = async (id, a) => { try { await api(`reviews/${id}/${a}`, 'POST', {}); PAGES.reviews(); } catch (e) { alert(e.message); } };
});

def('dirsettings', 'إعدادات الدليل العام', MGR, async () => {
  const t = await api('directory-settings'), own = me.role == 'owner';
  main.innerHTML = `<div class="bar"><h2>إعدادات الدليل العام</h2></div><div class="card"><p>الصفحة العامة: <a href="/directory.html" target="_blank">/directory.html</a>. لإظهار مدرس أو مجموعة فعّل «ظاهر في الدليل» / «متاح للحجز» من شاشتي المدرسين والمجموعات.</p>
  <div class="row">${fld('الظهور في الدليل', `<select id="dl" ${own ? '' : 'disabled'}><option value="0" ${t.listed ? '' : 'selected'}>مخفي</option><option value="1" ${t.listed ? 'selected' : ''}>ظاهر</option></select>`)}${fld('المنطقة', `<input id="da" value="${esc(t.area || '')}">`)}${fld('المدينة', `<input id="dc" value="${esc(t.city || '')}">`)}${fld('هاتف التواصل', `<input id="dp" value="${esc(t.contact_phone || '')}">`)}</div>
  ${fld('نبذة عن السنتر', `<textarea id="dd" rows="3">${esc(t.description || '')}</textarea>`)}<div class="err" id="fe"></div>${own ? '<button onclick="dSave()">حفظ</button>' : '<p>التعديل للمالك فقط</p>'}</div>`;
  window.dSave = async () => { try { await api('directory-settings', 'PUT', { listed: +V('dl'), area: V('da'), city: V('dc'), contact_phone: V('dp'), description: V('dd') }); fe.className = 'ok'; fe.textContent = 'تم الحفظ'; } catch (e) { fe.className = 'err'; fe.textContent = e.message; } };
});

def('myreviews', 'تقييماتي', ['student', 'parent'], async () => {
  const [opt, mine] = await Promise.all([api('reviews?options=1'), api('reviews')]);
  main.innerHTML = `<div class="bar"><h2>تقييماتي</h2></div><div class="card"><div class="row">
  ${opt.students.length > 1 ? fld('الابن/الابنة', `<select id="rs">${opts(opt.students, 0, s => s.name)}</select>`) : `<input type="hidden" id="rs" value="${opt.students[0]?.id || ''}">`}
  ${fld('تقييم', `<select id="rt" onchange="rtCh()"><option value="center">السنتر</option><option value="teacher">مدرس</option></select>`)}
  <div id="rtw" style="display:none">${fld('المدرس', `<select id="rtt">${opts(opt.teachers, 0, t => t.name)}</select>`)}</div>
  ${fld('الدرجة', `<select id="rr">${[5, 4, 3, 2, 1].map(n => `<option value="${n}">${stars(n)}</option>`).join('')}</select>`)}</div>${fld('تعليق (اختياري)', '<textarea id="rc" rows="2" maxlength="500"></textarea>')}
  <p>تُنشر التقييمات بعد مراجعة الإدارة وبدون ذكر الاسم.</p><div class="err" id="fe"></div><button onclick="rSend()">إرسال التقييم</button></div>` +
    tbl(['عن', 'التقييم', 'التعليق', 'الحالة'], mine.map(r => [r.target == 'center' ? 'السنتر' : esc('المدرس ' + (r.teacher_name || '')), stars(r.rating), esc(r.comment || ''), RST[r.status]]));
  window.rtCh = () => { rtw.style.display = V('rt') == 'teacher' ? '' : 'none'; };
  window.rSend = async () => { try { const b = { student_id: +V('rs'), target: V('rt'), rating: +V('rr'), comment: V('rc') || null }; if (b.target == 'teacher') b.teacher_id = +V('rtt'); await api('reviews', 'POST', b); PAGES.myreviews(); } catch (e) { fe.textContent = e.message; } };
});
