// The screens around the camera (app_design/gen_canvas.py): main, permission, reading, confirm, unsure, all types, sent,
// not sent, camera blocked and profile. camera.js owns the camera, the points and the reading service: it reports through
// 'cam' events, and this file drives it through window.Camera. report.js holds the types, the agencies, the sure threshold
// and the demo send. The profile and the preferences stay on this phone (localStorage), because there is no database yet.
(() => {
const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const DEBUG = q.get('debug') === '1';
const SLOW_MS = 6000;      // after this the reading screen offers the manual choice up front; the reading itself keeps going
const RETRY_S = 8;         // the not-sent screen tries again this often, and at once when the phone is back online
const QUICK = ['حريق', 'إسعاف', 'حادث'];
const DARK = new Set(['cam', 'show']);
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const icon = (name, cls = 'i') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const norm = (s) => String(s || '').replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();
const typeByName = (name) => TYPES.find((t) => norm(t.name) === norm(name)) || null;
const agencyLine = (t) => `${AGENCIES[t.agency].name} · ${AGENCIES[t.agency].number}`;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: it lasts while the page is open */ } },
};

// ---------- profile and preferences ----------
const profile = Object.assign({name: '', phone: '', blood: '', allergy: '', hearing: '', contact: '', alerts: true, big: false, hand: 'right'},
                              store.get('yb.profile', {}));
const medParts = () => [profile.blood && `فصيلة \u2066${profile.blood}\u2069`, profile.allergy && `حساسية: ${profile.allergy}`, profile.hearing].filter(Boolean);
const medDone = () => !!(profile.blood && profile.allergy && profile.hearing && profile.contact);

function applyPrefs() {
  document.documentElement.classList.toggle('big', !!profile.big);
  const first = profile.name.trim().charAt(0);
  $('toProfile').innerHTML = first ? esc(first) : icon('user');
  $('pAvatar').textContent = first || '؟';
  $('pState').textContent = medDone() ? 'مكتمل' : 'ناقص';
  $('pState').classList.toggle('ok', medDone());
}

function fillProfile() {
  document.querySelectorAll('#s-profile [data-key]').forEach((el) => {
    const v = profile[el.dataset.key];
    if (el.type === 'checkbox') el.checked = !!v;
    else if (el.type === 'radio') el.checked = el.value === v;
    else el.value = v || '';
  });
  $('pFlashSub').textContent = 'vibrate' in navigator ? 'لما يبدأ التسجيل ويخلص، ولما ينرسل البلاغ' : 'هذا المتصفح ما يدعم الاهتزاز، فالوميض بس';
}

document.querySelectorAll('#s-profile [data-key]').forEach((el) => {
  el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'radio' ? 'change' : 'input', () => {
    profile[el.dataset.key] = el.type === 'checkbox' ? el.checked : el.value;
    store.set('yb.profile', profile);
    applyPrefs();
  });
});

// A short buzz where the phone supports it, and a soft flash everywhere, so nothing depends on sound.
function signal(kind) {
  if (!profile.alerts) return;
  try { if (navigator.vibrate) navigator.vibrate(kind === 'sent' ? [90, 70, 90] : 70); } catch (e) { /* not allowed here */ }
  const f = $('flash');
  f.classList.remove('on');
  void f.offsetWidth;
  f.classList.add('on');
}

// ---------- location ----------
const loc = {state: 'idle', pos: null, denied: false};

function locate() {
  if (loc.state === 'pending') return;
  if (!navigator.geolocation) {
    loc.state = 'fail';
    return renderLoc();
  }
  loc.state = 'pending';
  renderLoc();
  navigator.geolocation.getCurrentPosition((p) => {
    loc.state = 'ok';
    loc.pos = {lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy)};
    renderLoc();
  }, (e) => {
    loc.state = 'fail';
    loc.denied = e.code === 1;
    renderLoc();
  }, {enableHighAccuracy: true, timeout: 15000, maximumAge: 60000});
}

const coords = () => `${loc.pos.lat.toFixed(5)}, ${loc.pos.lng.toFixed(5)}`;
const landmark = () => $('landmark').value.trim();
function locShort() {
  if (loc.state === 'ok') return `محدد ±${loc.pos.accuracy} م`;
  if (landmark()) return landmark();
  return 'بدون موقع';
}

function renderLoc() {
  const pill = $('locPill');
  pill.dataset.loc = loc.state;
  $('locPillText').textContent = {idle: 'نطلب موقعك وقت البلاغ', pending: 'نحدد موقعك…', fail: 'ما قدرنا نحدد موقعك'}[loc.state] || '';
  if (loc.state === 'ok') $('locPillText').innerHTML = `موقعك جاهز <span class="sub">· ±${loc.pos.accuracy} م</span>`;
  // the confirm screen
  const fail = loc.state === 'fail';
  $('locRow').hidden = fail;
  $('locBox').hidden = !fail;
  $('locIcon').setAttribute('class', `i ${loc.state === 'ok' ? 'pin-ok' : 'pin-wait'}`);
  if (loc.state === 'ok') {
    $('locTitle').textContent = 'موقعك محدد';
    $('locSub').innerHTML = `دقة الموقع ±${loc.pos.accuracy} م · <bdi dir="ltr">${coords()}</bdi>`;
  } else {
    $('locTitle').textContent = 'نحدد موقعك…';
    $('locSub').textContent = 'اسمح بالموقع لو طلبه المتصفح';
  }
  $('locWhy').textContent = loc.denied ? 'إذن الموقع مقفل. افتحه من إعدادات المتصفح، أو اكتب أقرب معلم. وتقدر ترسل بدونه.'
                                       : 'شغّل الموقع، أو اكتب أقرب معلم. وتقدر ترسل بدونه.';
  renderWith();
  renderCards();
}

$('locPill').addEventListener('click', locate);
$('locRetry').addEventListener('click', locate);
$('landmark').addEventListener('input', () => { renderWith(); renderCards(); });

// ---------- screens and history ----------
// Every screen is a <section id="s-NAME">. Moving forward pushes a history entry, so the phone's back gesture works;
// steps of one report (camera → reading → confirm → sent) replace each other, so back leaves the report instead of replaying it.
let current = null, depth = 0;
const ENTER = {}, LEAVE = {};

function show(name) {
  const prev = current;
  if (prev === name) return ENTER[name] && ENTER[name](prev);
  current = name;
  document.querySelectorAll('body > section').forEach((s) => { s.hidden = s.id !== `s-${name}`; });
  const dark = DARK.has(name);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]').content = dark ? '#0D0F12' : '#FFFFFF';
  window.scrollTo(0, 0);
  if (prev && LEAVE[prev]) LEAVE[prev](name);
  if (ENTER[name]) ENTER[name](prev);
  const h = $(`s-${name}`).querySelector('h1');
  if (h && prev) h.focus({preventScroll: true});
}

function nav(name, replace = false) {
  if (replace) history.replaceState({s: name, d: depth}, '');
  else history.pushState({s: name, d: ++depth}, '');
  show(name);
}

function back() {
  if (depth > 0) history.back();
  else nav('main', true);
}

window.addEventListener('popstate', (e) => {
  const st = e.state || {s: 'main', d: 0};
  depth = st.d;
  show(st.s);
});

document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.to) nav(b.dataset.to, 'replace' in b.dataset);
  else if ('back' in b.dataset) back();
  else if ('home' in b.dataset) nav('main', true);
  else if ('sign' in b.dataset) sign(true);
});

// ---------- signing ----------
// The camera screen opens straight away when the camera was allowed before, otherwise the permission screen explains first.
async function camState() {
  if (store.get('yb.cam', false)) return 'granted';
  try { return (await navigator.permissions.query({name: 'camera'})).state; } catch (e) { return 'prompt'; }
}

async function sign(replace = false) {
  const st = await camState();
  nav(st === 'granted' ? 'cam' : st === 'denied' ? 'denied' : 'perm', replace);
  if (st === 'denied') showDenied('denied');
}

$('sign').addEventListener('click', () => sign());
$('start').addEventListener('click', () => nav('cam', true));
$('toProfile').addEventListener('click', () => nav('profile'));

let keepDone = false;   // set when the camera screen comes back to say why a clip was not read
ENTER.cam = () => {
  window.Camera.open(keepDone);
  keepDone = false;
};
LEAVE.cam = (next) => { if (next !== 'read') window.Camera.stop(); };

$('cancel').addEventListener('click', () => {
  const st = window.Camera.state;
  if (st === 'count' || st === 'rec') window.Camera.cancel();
  else back();
});
$('camManual').addEventListener('click', () => nav('types'));

// ---------- the main screen: how far the model got, without holding anyone back ----------
function setPrep(text, pct) {
  $('prepText').textContent = text;
  $('prepTrack').hidden = pct === null;
  if (pct !== null) $('prepBar').style.width = `${pct}%`;
}
setPrep('نجهّز قراءة الإشارة · تقدر تختار النوع الحين', 0);

const PREP = {
  files: (d) => setPrep(`نجهّز قراءة الإشارة ${d.pct}% · تقدر تختار النوع الحين`, d.pct),
  model: () => setPrep('نشغّل قراءة الإشارة…', 100),
  ready: () => setPrep('التسجيل 6 ثوانٍ بالكثير، بالكاميرا الأمامية', null),
  failed: () => setPrep('قراءة الإشارة ما جهزت. نحاول مرة ثانية لما تفتح الكاميرا، أو اختر النوع تحت.', null),
};

// ---------- camera events ----------
const CAM = {
  state(d) {
    $('cancel').setAttribute('aria-label', d.state === 'count' || d.state === 'rec' ? 'إلغاء التسجيل' : 'إغلاق والرجوع');
    if (d.state === 'ready') store.set('yb.cam', true);
    if (d.state === 'rec') signal('start');
    if (d.state === 'read') {
      signal('end');
      if (current === 'cam') startReading();
    }
  },
  prep(d) { if (PREP[d.stage]) PREP[d.stage](d); },
  error(d) {
    if (d.kind === 'denied') store.set('yb.cam', false);
    if (current === 'cam' || current === 'perm') {
      nav('denied', true);
      showDenied(d.kind, d.text);
    }
  },
  result(d) { onResult(d.result); },
  readfail() {
    if (!reading || current !== 'read') return;
    stopReading();
    readMode('fail');
  },
};
window.addEventListener('cam', (e) => { if (CAM[e.detail.type]) CAM[e.detail.type](e.detail); });

// ---------- reading ----------
let reading = null;   // {t0, timer, tick} while an answer is awaited

function readMode(mode) {
  $('s-read').dataset.mode = mode;
  $('readArc').setAttribute('d', mode === 'wait' ? 'M74 6a68 68 0 0 1 64.7 89' : 'M74 6a68 68 0 0 1 68 68');
  const T = {
    wait: ['نقرأ إشارتك…', 'ثوانٍ، وبعدها تتأكد من البلاغ قبل ما ينرسل.'],
    slow: ['أخذت وقت أطول من العادة', 'يمكن النت ضعيف. نكمل نحاول، وتقدر تختار النوع بنفسك بدل الانتظار.'],
    fail: ['ما وصلنا لخدمة القراءة', 'شيّك على النت. وتقدر تختار النوع بنفسك الحين، أو تعيد الإشارة.'],
  }[mode];
  $('readTitle').textContent = T[0];
  $('readLead').textContent = T[1];
  if (mode === 'wait') $('readStep').textContent = '13 نوع، أو إشارة عادية';
  if (mode === 'fail') $('readStep').textContent = 'ما وصلنا';
}

function startReading() {
  const clip = window.__live.clip;
  $('readFrames').textContent = clip ? clip.frames : 0;
  readMode('wait');
  const t0 = performance.now();
  reading = {t0};
  typesWhy = null;
  reading.timer = setTimeout(() => {
    if (!reading) return;
    readMode('slow');
    const tick = () => { $('readStep').textContent = `يتأخر… ${Math.round((performance.now() - t0) / 1000)} ثانية`; };
    tick();
    reading.tick = setInterval(tick, 1000);
  }, SLOW_MS);
  nav('read', true);
  if (loc.state === 'idle') locate();
}

function stopReading() {
  if (!reading) return;
  clearTimeout(reading.timer);
  clearInterval(reading.tick);
  reading = null;
}

ENTER.read = () => { if (!reading) nav('main', true); };   // came back to a reading that is over
LEAVE.read = (next) => {
  stopReading();
  if (next !== 'cam') window.Camera.stop();
};
$('readCancel').addEventListener('click', () => nav('main', true));

// The service answers {report, type_ar, p_normal, frame_ok, words}. report and type_ar are its own decision (τ, τ2 and the
// keywords in server/inference.py); SURE_BELOW only decides whether the person confirms the type or picks it first.
function onResult(r) {
  if (!reading || current !== 'read') return;    // nobody is waiting for it any more
  stopReading();
  if (DEBUG) $('dbgText').textContent = $('info').textContent;
  if (!r.frame_ok) {                             // camera.js already says what to fix, on its 'done' screen
    keepDone = true;
    return nav('cam', true);
  }
  const words = (Array.isArray(r.words) ? r.words : String(r.words || '').split(/\s+/)).map((w) => String(w).replace(/_/g, ' ')).filter(Boolean);
  const reading_ = {p_normal: r.p_normal, type_ar: r.type_ar || '', words};
  const t = r.report ? typeByName(r.type_ar) : null;
  if (!r.report) return openTypes({why: 'none', reading: reading_}, true);
  if (!t) return openTypes({why: 'unknown', reading: reading_}, true);
  const sure = typeof SURE_BELOW === 'number' && r.p_normal < SURE_BELOW;
  if (sure) openConfirm(t, 'sign', reading_, true);
  else openUnsure([t], reading_, true);
}

// ---------- unsure ----------
let unsure = null;

function openUnsure(types, reading_, replace) {
  unsure = {types, reading: reading_};
  nav('unsure', replace);
}

ENTER.unsure = () => {
  if (!unsure) return nav('main', true);
  const {types, reading: r} = unsure;
  $('uTitle').textContent = types.length > 1 ? 'هل تقصد واحد من هذول؟' : 'هل تقصد هذا؟';
  const read = r.words.length ? `قرينا «${r.words.join(' · ')}». ` : '';
  $('uLead').textContent = `${read}اضغط عليه لو هو، وتتأكد قبل ما نرسل.`;
  $('uChoices').innerHTML = types.map((t, i) => `<button class="choice" type="button" data-ag="${t.agency}" data-i="${i}">
    <span class="ticon">${icon(t.icon)}</span><span><b>${esc(t.name)}</b><small>${esc(agencyLine(t))}</small></span>${icon('chevl')}</button>`).join('');
  if (loc.state === 'idle') locate();
  renderWith();
};
$('uChoices').addEventListener('click', (e) => {
  const b = e.target.closest('.choice');
  if (b) openConfirm(unsure.types[+b.dataset.i], 'pick', unsure.reading);
});

function renderWith() {
  const where = loc.state === 'ok' ? `موقعك (±${loc.pos.accuracy} م)` : landmark() ? landmark() : 'بدون موقع للحين';
  $('uWith').textContent = `${where} · ${medParts().length ? 'الملف الطبي' : 'بدون ملف طبي'}`;
}

// ---------- all types ----------
// The notice on top of the types screen, when a reading sent the person there. It stays while they go to confirm and back.
let typesWhy = null, typesFresh = false;

function openTypes(info, replace) {
  typesWhy = info;
  typesFresh = true;
  nav('types', replace);
}

$('groups').innerHTML = Object.keys(AGENCIES).map((ag) => {
  // rows of three, and the last row stretched so every row is full (the design's NotThis grid of 6 columns)
  const items = TYPES.filter((t) => t.agency === ag), n = items.length, last = Math.floor((n - 1) / 3) * 3;
  const tiles = items.map((t, k) => `<button class="tile" type="button" style="grid-column: span ${k < last ? 2 : 6 / (n - last)}" data-ag="${ag}" data-type="${esc(t.name)}">${icon(t.icon)}${esc(t.name)}</button>`).join('');
  return `<section class="group" data-ag="${ag}"><div class="group-head"><h2>${esc(AGENCIES[ag].name)}</h2><bdi dir="ltr">${esc(AGENCIES[ag].number)}</bdi></div>
    <div class="grid6">${tiles}</div></section>`;
}).join('');
$('quick').innerHTML = QUICK.map(typeByName).map((t) => `<button class="tile" type="button" data-ag="${t.agency}" data-type="${esc(t.name)}">${icon(t.icon)}${esc(t.name)}</button>`).join('')
  + `<button class="tile" type="button" data-to="types">${icon('grid')}كل الأنواع</button>`;
document.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-type]');
  if (b) openConfirm(typeByName(b.dataset.type), 'manual', null);
});

ENTER.types = (prev) => {
  if (!typesFresh && prev !== 'confirm' && prev !== 'profile') typesWhy = null;
  typesFresh = false;
  const why = typesWhy;
  $('tNotice').hidden = !why;
  $('tSign').hidden = !why;
  if (!why) return;
  const r = why.reading;
  if (why.why === 'unknown') {
    $('tNoticeTitle').textContent = `قرينا «${r.type_ar}»، بس ما نعرف جهته`;
    $('tNoticeText').textContent = 'اختر النوع الأقرب هنا، أو أعد الإشارة.';
  } else {
    $('tNoticeTitle').textContent = 'ما قدرنا نقرأ نوع البلاغ من الإشارة';
    $('tNoticeText').textContent = r.words.length ? `قرينا «${r.words.join(' · ')}». اختر النوع هنا، أو أعد الإشارة.` : 'اختر النوع هنا، أو أعد الإشارة.';
  }
};

// ---------- confirm ----------
let draft = null;      // {type, source: 'sign' | 'pick' | 'manual', reading}

function openConfirm(type, source, reading_, replace) {
  draft = {type, source, reading: reading_};
  nav('confirm', replace);
}

ENTER.confirm = () => {
  if (!draft) return nav('main', true);
  const {type: t, source, reading: r} = draft;
  const signed = source === 'sign';
  $('kicker').dataset.src = source;
  $('kickerIcon').setAttribute('href', signed ? '#i-check' : '#i-grid');
  $('kickerText').textContent = signed ? 'قرينا إشارتك' : 'اخترته بنفسك';
  $('typeCard').dataset.ag = t.agency;
  $('cIcon').setAttribute('href', `#i-${t.icon}`);
  $('cType').textContent = t.name;
  $('cAgency').textContent = agencyLine(t);
  $('cGloss').hidden = !(r && r.words.length);
  $('cWords').innerHTML = r ? r.words.map((w) => `<span>${esc(w)}</span>`).join('') : '';
  $('cAlt1').textContent = signed ? 'مو هذا النوع' : 'غيّر النوع';
  $('cAlt2Icon').setAttribute('href', source === 'manual' ? '#i-hand' : '#i-redo');
  $('cAlt2Text').textContent = source === 'manual' ? 'أشّر بدالها' : 'أعد الإشارة';
  const med = medParts();
  $('medTitle').textContent = med.length ? 'الملف الطبي' : 'الملف الطبي فاضي';
  $('medSub').textContent = med.length ? med.join(' · ') : 'لو عبّيته، ينرسل مع البلاغ';
  $('medEdit').textContent = med.length ? 'عدّل' : 'عبّه';
  if (loc.state === 'idle') locate();
  renderLoc();
};

// ---------- send ----------
let sending = false, pending = null, lastSent = null, retry = null;

function buildReport() {
  const {type: t, source, reading: r} = draft;
  return {
    type: t.name, agency: t.agency, agency_name: AGENCIES[t.agency].name, agency_number: AGENCIES[t.agency].number,
    source, reading: r && {p_normal: r.p_normal, type_ar: r.type_ar, words: r.words},
    location: loc.state === 'ok' ? {...loc.pos} : null, landmark: landmark() || null,
    profile: {name: profile.name, phone: profile.phone, blood: profile.blood, allergy: profile.allergy, hearing: profile.hearing, contact: profile.contact},
    created_at: new Date().toISOString(),
  };
}

async function trySend(report) {
  try {
    const res = await sendReport(report);
    pending = null;
    lastSent = {report, res};
    signal('sent');
    nav('sent', true);
  } catch (e) {
    pending = pending || {report, tries: 0};
    pending.tries++;
    if (current !== 'failed') nav('failed', true);
    else armRetry();
  }
}

$('send').addEventListener('click', async () => {
  if (sending || !draft) return;
  sending = true;
  $('send').disabled = true;
  $('sendLabel').textContent = 'نرسل…';
  pending = null;
  try { await trySend(buildReport()); } finally {
    sending = false;
    $('send').disabled = false;
    $('sendLabel').textContent = 'أرسل البلاغ';
  }
});

function armRetry() {
  clearInterval(retry);
  let left = RETRY_S;
  const tick = () => {
    $('fNext').textContent = navigator.onLine ? `نحاول مرة ثانية بعد ${left} ثواني` : 'ننتظر يرجع النت';
    $('fTry').textContent = `المحاولة ${pending ? pending.tries : 1}`;
    if (navigator.onLine && left-- <= 0) {
      clearInterval(retry);
      if (pending) trySend(pending.report);
    }
  };
  tick();
  retry = setInterval(tick, 1000);
}

ENTER.failed = () => {
  if (!pending) return nav('main', true);
  renderCards();
  armRetry();
};
LEAVE.failed = () => clearInterval(retry);
$('fRetry').addEventListener('click', () => { if (pending) trySend(pending.report); });
window.addEventListener('online', () => { if (current === 'failed' && pending) trySend(pending.report); });

ENTER.sent = () => {
  if (!lastSent) return nav('main', true);
  const {report: r, res} = lastSent;
  $('sId').textContent = res.id;
  $('sTime').textContent = new Date(res.at).toLocaleTimeString('ar-SA-u-nu-latn', {hour: 'numeric', minute: '2-digit'});
  $('sType').textContent = r.type;
  $('sAgency').textContent = `${r.agency_name} · ${r.agency_number}`;
  $('sLoc').textContent = r.location ? `محدد ±${r.location.accuracy} م` : r.landmark || 'بدون موقع';
  $('sMed').textContent = medParts().length ? 'الملف الطبي' : 'بدون ملف طبي';
};

// The card for someone nearby who can call. It says what the person chose, in plain words, with the number to call.
function cardHtml() {
  const src = (pending && pending.report) || (lastSent && lastSent.report) || (draft && buildReport());
  if (!src) return '';
  const nums = src.agency_number.split(' · ').map((n) => `<bdi dir="ltr">${esc(n)}</bdi>`).join(' أو ');
  const where = loc.state === 'ok' ? `<bdi dir="ltr">${coords()}</bdi> (±${loc.pos.accuracy} م)` : esc(locShort());
  return `<span class="l1">ما أسمع، وعندي طارئ: ${esc(src.type)}.</span>
    <span class="l2">اتصل ب${esc(src.agency_name)} على ${nums} لو سمحت.</span>
    <span class="l3">${icon('pin')}${where}</span>`;
}
function renderCards() {
  if (current === 'failed') $('fCard').innerHTML = cardHtml();
  if (current === 'show') $('showCard').innerHTML = cardHtml();
}
ENTER.show = () => {
  if (!cardHtml()) return nav('main', true);
  renderCards();
};

// ---------- camera blocked ----------
let deniedKind = 'denied';
const DENIED = {
  denied: ['الكاميرا مقفلة', 'بلّغ الحين بدونها، أو افتحها من المتصفح عشان تأشّر.', 'فتحتها، كمّل'],
  none: ['ما لقينا كاميرا', 'بلّغ الحين بدونها، واختر النوع بنفسك.', 'جرّب مرة ثانية'],
  busy: ['الكاميرا مشغولة', 'فيه برنامج ثاني ماسكها. سكّره وجرّب، أو بلّغ الحين بدونها.', 'جرّب مرة ثانية'],
  https: ['الكاميرا ما تشتغل هنا', 'الكاميرا تحتاج رابط https. بلّغ الحين بدونها.', 'جرّب مرة ثانية'],
  webgl: ['قراءة الإشارة ما تشتغل هنا', 'هذا المتصفح ما يشغّل قراءة الإشارة. بلّغ الحين بدونها، أو جرّب متصفح ثاني.', 'جرّب مرة ثانية'],
  model: ['قراءة الإشارة ما اشتغلت', 'النموذج ما اشتغل على هذا الجهاز. بلّغ الحين بدونها.', 'جرّب مرة ثانية'],
  other: ['ما قدرنا نفتح الكاميرا', 'بلّغ الحين بدونها، أو جرّب مرة ثانية.', 'جرّب مرة ثانية'],
};
const STEPS = IOS
  ? ['اضغط «aA» جنب رابط الموقع', 'إعدادات الموقع ← الكاميرا ← سماح', 'ارجع واضغط «فتحتها، كمّل»']
  : [`اضغط ${icon('lock')} جنب رابط الموقع`, 'الأذونات ← الكاميرا ← سماح', 'ارجع واضغط «فتحتها، كمّل»'];

function showDenied(kind) {
  deniedKind = DENIED[kind] ? kind : 'other';
  const [title, lead, again] = DENIED[deniedKind];
  $('dTitle').textContent = title;
  $('dLead').textContent = lead;
  $('dRetryText').textContent = again;
  $('dHow').hidden = deniedKind !== 'denied';
  $('dSteps').innerHTML = STEPS.map((s, i) => `<li><span>${i + 1}</span><span>${s}</span></li>`).join('');
}
$('dRetry').addEventListener('click', () => nav('cam', true));

// ---------- profile ----------
ENTER.profile = () => fillProfile();

// ---------- debug ----------
$('dbgSave').addEventListener('click', () => { if (window.__live && window.__live.clip) window.Camera.saveClip(); });

// ---------- start ----------
applyPrefs();
renderLoc();
// Only ask for the location when a report starts. If it was allowed before, show it on the main screen now.
(async () => {
  try {
    const p = await navigator.permissions.query({name: 'geolocation'});
    if (p.state === 'granted') locate();
  } catch (e) { /* this browser cannot say, so wait for the report */ }
})();

document.addEventListener('DOMContentLoaded', () => {
  history.replaceState({s: 'main', d: 0}, '');
  show('main');
  if (q.get('auto') === '1') nav('cam');
});
})();
