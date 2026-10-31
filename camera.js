// Live page for the real phone test (AI_PLAN.md 7.11 هـ): front camera, hand and body points over the picture, and the speed.
// Same MediaPipe and same settings as tools/browser_kp/extract.js. No face points are drawn and nothing leaves the device.
// ?delegate=CPU runs the model on the processor, ?auto=1 starts without the button.
const q = new URLSearchParams(location.search);
const DELEGATE = q.get('delegate') === 'CPU' ? 'CPU' : 'GPU';
const MODEL_DIR = 'vendor/holistic/';
const CLIP_FRAMES = 180;                              // the longest clip in the design, 6 s at 30 fps
const WARMUP = 5;                                     // the first frames build the GPU programs, they stay out of the average
const AVG_OVER = 30;
const BODY = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]];  // pose points 0-10 are the face
const HAND = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14],
              [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
const LINE = '#F2F3F5', BODY_DOT = '#FF9DA1', HAND_DOT = '#FF6B72';
const CAMERA_ERRORS = {
  NotAllowedError: 'ما انسمح للكاميرا. افتح إذن الكاميرا من إعدادات المتصفح.',
  NotFoundError: 'ما لقينا كاميرا في هذا الجهاز.',
  NotReadableError: 'الكاميرا مشغولة ببرنامج ثاني.',
};

const $ = (id) => document.getElementById(id);
const video = $('video'), canvas = $('points'), ctx = canvas.getContext('2d');
window.__live = {delegate: DELEGATE, frames: 0, fps: 0, ms: 0, load_ms: 0, width: 0, height: 0, error: null, last: null};

function setStatus(text) {
  $('status').textContent = text;
  $('status').classList.remove('bad');
}

function fail(text, e) {
  window.__live.error = String(e || text);
  $('status').textContent = text;
  $('status').classList.add('bad');
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
  window.__live.last = res;
}

const spent = [], ends = [];

function note(ms, t0) {
  const live = window.__live;
  if (++live.frames === 1) {
    live.load_ms = performance.now() - t0;
    setStatus('');
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
  $('clip').textContent = (live.ms * CLIP_FRAMES / 1000).toFixed(1);
}

// The next frame the camera gives, so one frame is never counted twice on a fast device.
const nextFrame = () => new Promise((res) => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(res) : requestAnimationFrame(res)));

async function start() {
  $('start').disabled = true;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return fail('الكاميرا تشتغل على رابط https بس.');
  setStatus('نفتح الكاميرا');
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({audio: false, video: {
      facingMode: 'user', width: {ideal: 1280}, height: {ideal: 720}, frameRate: {ideal: 30}}});
    await video.play();
  } catch (e) {
    return fail(CAMERA_ERRORS[e.name] || 'ما قدرنا نفتح الكاميرا.', e);
  }
  $('start').hidden = true;
  setStatus('نحمّل النموذج، أول مرة حوالي 30 MB');
  window.__live.width = video.videoWidth;
  window.__live.height = video.videoHeight;
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
      const t = performance.now();
      await holistic.send({image: video});
      note(performance.now() - t, t0);
    }
  } catch (e) {
    fail('النموذج ما اشتغل على هذا الجهاز. جرّب CPU.', e);
  }
}

$(DELEGATE.toLowerCase()).setAttribute('aria-current', 'true');
$('start').addEventListener('click', start);
document.addEventListener('visibilitychange', () => { if (!document.hidden && video.paused && video.srcObject) video.play().catch(() => {}); });
if (q.get('auto') === '1') start();
