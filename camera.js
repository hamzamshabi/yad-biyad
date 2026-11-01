// The camera screens of the app (app_design/gen_canvas.py): frame check, count, recording. The points are computed while filming
// (AI_PLAN.md 7.11 هـ), one row per frame with its time, in the layout of tools/browser_kp/extract.js: 86 points in pixels, right hand 0-20,
// left hand 21-41, lips 42-60 stay zero, body 61-85 = the first 25 pose points. Same MediaPipe and same settings as there.
// No face points are drawn, no video is kept, and nothing leaves the device yet: the server link comes next.
// ?debug=1 shows the speed, the CPU switch, each hand apart and a button that saves the points, ?delegate=CPU runs the model on the
// processor, ?auto=1 starts without the button.
const q = new URLSearchParams(location.search);
const DELEGATE = q.get('delegate') === 'CPU' ? 'CPU' : 'GPU';
const DEBUG = q.get('debug') === '1';
const MODEL_DIR = 'vendor/holistic/';
const POSE_N = 25;
const VIS_IDX = [0, 11, 12];                          // nose and shoulders, the frame rule looks at these
const VIS_MIN = 0.5, FRAME_SHARE = 0.8;               // the frame rule of tools/browser_kp/compare.py
const COUNT_FROM = 3, MAX_MS = 6000;                  // the design: count from 3, 6 seconds at most
const CLIP_FRAMES = 180;                              // a 6 s clip at 30 fps, for the debug estimate
const WARMUP = 5;                                     // the first frames build the GPU programs, they stay out of the average
const AVG_OVER = 30;
const CHECK_OVER = 8;                                 // the last frames, so one missed frame does not flip the screen
const BODY = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]];  // pose points 0-10 are the face
const HAND = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14],
              [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const LINE = '#F2F3F5', BODY_DOT = '#FF9DA1', HAND_DOT = '#FF6B72';
const CAMERA_ERRORS = {
  NotAllowedError: 'ما انسمح للكاميرا. افتح إذن الكاميرا من إعدادات المتصفح.',
  NotFoundError: 'ما لقينا كاميرا في هذا الجهاز.',
  NotReadableError: 'الكاميرا مشغولة ببرنامج ثاني.',
};
const SCREENS = {
  off: ['الكاميرا', 'نحتاج الكاميرا عشان نقرأ إشارتك', 'تشتغل وقت البلاغ بس، وما نسجّل صوت.', ''],
  load: ['الكاميرا', 'نجهّز النموذج', 'النقاط تتحسب داخل جهازك، وما ينحفظ فيديو.', ''],
  ready: ['جهّز الكاميرا', 'أشّر الجملة كاملة', 'امسك الجوال بيد وأشّر بالثانية، أو اسنده وأشّر بيدينك. مثل: «بيت حريق».', 'ابدأ، ونعد لك 3'],
  count: ['استعد', 'نبدأ بعد العد', 'لما يصير الإطار أحمر، يعني نسجّل. أشّر الجملة وبعدين اضغط انتهيت.', ''],
  rec: ['', 'أشّر الحين', '', 'انتهيت'],
  done: ['انتهى التسجيل', '', '', 'سجّل مرة ثانية'],
};

const $ = (id) => document.getElementById(id);
const video = $('video'), canvas = $('points'), ctx = canvas.getContext('2d');
window.__live = {state: 'off', delegate: DELEGATE, frames: 0, fps: 0, ms: 0, load_ms: 0, error: null, last: null, clip: null};
let state = 'off', rows = null, frameTime = 0, recStart = 0, clock = null, counter = null;

function go(next) {
  state = window.__live.state = next;
  $('app').dataset.state = next;
  const [title, heading, sub, label] = SCREENS[next];
  $('title').textContent = title;
  $('heading').textContent = heading;
  $('sub').textContent = sub;
  $('shootLabel').textContent = label;
  $('shoot').disabled = false;
  $('shoot').setAttribute('aria-label', next === 'rec' ? 'إيقاف التسجيل' : next === 'count' ? 'ابدأ الحين' : 'ابدأ التسجيل');
  if (next !== 'ready') setStatus('');
  if (next === 'ready') $('saveClip').hidden = true;
}

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = kind;
}

function fail(text, e) {
  window.__live.error = String(e || text);
  go('off');
  setStatus(text, 'bad');
  $('start').hidden = false;
  $('start').disabled = false;
}

function drawPart(lm, links, dot, W, H, px) {
  if (!lm) return;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.6 * px;
  ctx.beginPath();
  for (const [a, b] of links) {
    ctx.moveTo(lm[a].x * W, lm[a].y * H);
    ctx.lineTo(lm[b].x * W, lm[b].y * H);
  }
  ctx.stroke();
  ctx.fillStyle = dot;
  for (const i of new Set(links.flat())) {
    ctx.beginPath();
    ctx.arc(lm[i].x * W, lm[i].y * H, 2.6 * px, 0, 2 * Math.PI);
    ctx.fill();
  }
}

function frameRow(res, W, H) {
  const kp = new Float32Array(172), vis = new Float32Array(3);
  const put = (lm, at, n) => {
    for (let j = 0; j < n; j++) {
      kp[2 * (at + j)] = lm[j].x * W;
      kp[2 * (at + j) + 1] = lm[j].y * H;
    }
  };
  if (res.rightHandLandmarks) put(res.rightHandLandmarks, 0, 21);
  if (res.leftHandLandmarks) put(res.leftHandLandmarks, 21, 21);
  if (res.poseLandmarks) {
    put(res.poseLandmarks, 61, POSE_N);
    VIS_IDX.forEach((j, k) => { vis[k] = res.poseLandmarks[j].visibility ?? 0; });
  }
  return {kp, vis};
}

const recent = [];

function frameCheck(vis, res) {
  recent.push({head: vis[0] > VIS_MIN, shoulders: vis[1] > VIS_MIN && vis[2] > VIS_MIN, right: !!res.rightHandLandmarks, left: !!res.leftHandLandmarks});
  if (recent.length > CHECK_OVER) recent.shift();
  const on = (k) => recent.filter((r) => r[k]).length * 2 >= recent.length;
  const head = on('head'), shoulders = on('shoulders'), right = on('right'), left = on('left'), hand = right || left;
  $('pHead').classList.toggle('on', head);
  $('pShoulders').classList.toggle('on', shoulders);
  $('pHand').classList.toggle('on', hand);
  $('pRight').classList.toggle('on', right);
  $('pLeft').classList.toggle('on', left);
  if (state !== 'ready') return;
  $('shoot').disabled = !(head && shoulders);        // the app does not start without the head and the shoulders (AI_PLAN.md section 5)
  const [, heading, sub] = SCREENS.ready;
  if (!head || !shoulders) setStatus('ابعد الجوال شوي', 'bad');
  else setStatus(hand ? 'جاهز، كل شي ظاهر' : 'ما نشوف يدك', hand ? 'ok' : 'bad');
  $('heading').textContent = head && shoulders && !hand ? 'قرّب يدك للإطار' : heading;
  $('sub').textContent = head && shoulders && !hand ? 'أشّر قدّام صدرك داخل الإطار. يد وحدة تكفي.' : sub;
}

function draw(res) {
  const W = video.videoWidth, H = video.videoHeight, px = Math.max(W, H) / 480;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  ctx.clearRect(0, 0, W, H);
  drawPart(res.poseLandmarks, BODY, BODY_DOT, W, H, px);
  drawPart(res.leftHandLandmarks, HAND, HAND_DOT, W, H, px);
  drawPart(res.rightHandLandmarks, HAND, HAND_DOT, W, H, px);
  const {kp, vis} = frameRow(res, W, H);
  frameCheck(vis, res);
  if (state === 'rec') {
    rows.t.push(frameTime - recStart);
    rows.kp.push(kp);
    rows.vis.push(vis);
  }
  window.__live.last = res;
}

const spent = [], ends = [];

function note(ms, t0) {
  const live = window.__live;
  if (++live.frames === 1) {
    live.load_ms = performance.now() - t0;
    go('ready');
    $('info').textContent = `الكاميرا ${video.videoWidth}×${video.videoHeight} · ${DELEGATE} · جهز بعد ${(live.load_ms / 1000).toFixed(1)} ث`;
  }
  if (live.frames <= WARMUP) return;
  spent.push(ms);
  ends.push(performance.now());
  if (spent.length > AVG_OVER) {
    spent.shift();
    ends.shift();
  }
  if (spent.length < 2) return;
  live.ms = spent.reduce((a, b) => a + b) / spent.length;
  live.fps = (ends.length - 1) * 1000 / (ends[ends.length - 1] - ends[0]);
  $('fps').textContent = live.fps.toFixed(1);
  $('ms').textContent = Math.round(live.ms);
  $('clipSec').textContent = (live.ms * CLIP_FRAMES / 1000).toFixed(1);
}

function clearTimers() {
  clearInterval(counter);
  clearInterval(clock);
}

function countDown() {
  let n = COUNT_FROM;
  go('count');
  const show = () => {
    $('num').textContent = n;
    $('shootLabel').textContent = `يبدأ بعد ${n}`;
  };
  show();
  counter = setInterval(() => {
    if (--n > 0) show();
    else record();
  }, 1000);
}

function tick() {
  const ms = performance.now() - recStart, left = Math.ceil((MAX_MS - ms) / 1000), s = Math.floor(ms / 1000);
  $('clock').textContent = `0:0${Math.min(s, 6)}`;
  $('arc').setAttribute('stroke-dasharray', `${Math.min(100 * ms / MAX_MS, 100)} 100`);
  $('sub').textContent = `باقي ${Math.max(left, 0)} ث · الحد 6 ثوانٍ`;
  if (ms >= MAX_MS) finish();
}

function record() {
  clearTimers();
  rows = {t: [], kp: [], vis: []};
  recStart = performance.now();
  go('rec');
  tick();
  clock = setInterval(tick, 100);
}

function finish() {
  clearTimers();
  const T = rows.t.length, W = video.videoWidth, H = video.videoHeight;
  const sec = T > 1 ? (rows.t[T - 1] - rows.t[0]) / 1000 : 0;
  const pass = rows.vis.filter((v) => VIS_IDX.every((_, k) => v[k] > VIS_MIN)).length >= FRAME_SHARE * T && T > 0;
  const seen = (at) => rows.kp.filter((k) => k[2 * at] !== 0 || k[2 * at + 1] !== 0).length;
  window.__live.clip = {width: W, height: H, delegate: DELEGATE, frames: T, seconds: sec, frame_rule: pass, right: seen(0), left: seen(21),
                        t_ms: rows.t.map(Math.round), kp: rows.kp.flatMap((k) => Array.from(k, (x) => Math.round(x * 100) / 100)),
                        vis: rows.vis.flatMap((v) => Array.from(v, (x) => Math.round(x * 1e4) / 1e4))};
  go('done');
  $('heading').textContent = pass ? 'انسجل المقطع' : 'راسك وكتفيك ما بانوا كفاية';
  $('sub').textContent = `${T} إطار في ${sec.toFixed(1)} ث · ما انحفظ فيديو، ولسا ما انرسل شي.` + (pass ? '' : ' ابعد الجوال شوي وسجّل مرة ثانية.');
  $('saveClip').hidden = false;
}

function saveClip() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(window.__live.clip)], {type: 'application/json'}));
  a.download = `clip_${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// The next frame the camera gives, so one frame is never counted twice on a fast device.
const nextFrame = () => new Promise((res) => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(res) : requestAnimationFrame(res)));

async function start() {
  $('start').hidden = true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return fail('الكاميرا تشتغل على رابط https بس.');
  go('load');
  setStatus('نفتح الكاميرا');
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({audio: false, video: {
      facingMode: 'user', width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30}}});
    await video.play();
  } catch (e) {
    return fail(CAMERA_ERRORS[e.name] || 'ما قدرنا نفتح الكاميرا.', e);
  }
  setStatus('نحمّل النموذج، أول مرة حوالي 21 MB');
  const t0 = performance.now();
  try {
    const holistic = new window.Holistic({locateFile: (f) => MODEL_DIR + f});
    holistic.setOptions({modelComplexity: 1, smoothLandmarks: true, enableSegmentation: false, refineFaceLandmarks: false,
                         minDetectionConfidence: 0.5, minTrackingConfidence: 0.5, selfieMode: false,
                         useCpuInference: DELEGATE === 'CPU'});
    holistic.onResults(draw);
    await holistic.initialize();
    for (;;) {
      await nextFrame();
      frameTime = performance.now();
      await holistic.send({image: video});
      note(performance.now() - frameTime, t0);
    }
  } catch (e) {
    fail('النموذج ما اشتغل على هذا الجهاز.', e);
  }
}

function shutter() {
  if (state === 'ready') countDown();
  else if (state === 'count') record();
  else if (state === 'rec') finish();
  else if (state === 'done') go('ready');
}

function cancel() {
  clearTimers();
  rows = null;
  go('ready');
}

if (DEBUG) document.documentElement.classList.add('debug');
$(DELEGATE.toLowerCase()).setAttribute('aria-current', 'true');
go('off');
$('start').addEventListener('click', start);
$('shoot').addEventListener('click', shutter);
$('cancel').addEventListener('click', cancel);
$('saveClip').addEventListener('click', saveClip);
document.addEventListener('visibilitychange', () => { if (!document.hidden && video.paused && video.srcObject) video.play().catch(() => {}); });
if (q.get('auto') === '1') start();
