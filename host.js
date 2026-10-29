// Host game engine. Uses $, esc, LETTERS, SHAPES from studio.js (loaded first).
const { SUPABASE_URL, SUPABASE_KEY } = window.QUIZ_CONFIG;
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const SCREENS = ['h-setup', 'h-lobby', 'h-pre', 'h-q', 'h-reveal', 'h-end'];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, ms));
const show = id => {
  SCREENS.forEach(s => $(s).classList.toggle('hide', s !== id));
  if (id !== 'h-reveal') { setNext(null, false); tapResolve = null; }
  if (id !== 'h-q') leaveFog();            // เปิดกราฟจริงคืนก็ต่อเมื่อออกจากหน้าโหวตไปแล้วเท่านั้น
  $('tbar').classList.add('hide');
  window.scrollTo(0, 0);
};
const restart = (el, name) => { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = name || ''; };

const DEFAULT_CFG = { hideAt: '50', ceremony: true, phoneLive: false, music: true, hideText: false, preview: true, viewStyle: 'bars', fogKind: 'mock' };
const cfg = () => ({ ...DEFAULT_CFG, ...((G && G.settings) || {}) });
let viewStyle = 'bars', lastDist = {}, lastAnswered = 0;
let allIn = false, frozenLeft = 0, censored = false;
let qEnd = 0, fogged = false, fogIntensity = 0, fogMode = 'normal', fogTxtT = null;
let G = null;            // { game_id, pin, host_token, kind, title, questions, qi }
let channel = null, poll = null, tick = null, revealing = false, lastTally = '', lastTallyAt = 0, view = 'person';

const saveGame = () => { try { localStorage.setItem('quiz-host', JSON.stringify(G)); } catch (e) {} };
const stopTimers = () => { clearInterval(poll); clearInterval(tick); };
const host = (fn, args) => db.rpc(fn, { p_game: G.game_id, p_token: G.host_token, ...args });

// ---------- เสียง (ดู sound.js) ----------
const sfx = Sound.sfx;
const musicOn = () => cfg().music !== false;
function syncMute() {
  const m = Sound.isMuted();
  $('muteBtn').setAttribute('aria-pressed', String(!m));
  $('muteBtn').firstElementChild.className = 'ph-bold ' + (m ? 'ph-speaker-slash' : 'ph-speaker-high');
}
$('muteBtn').onclick = () => { Sound.setMuted(!Sound.isMuted()); syncMute(); };
syncMute();

// ---------- พลุกระดาษ ----------
function confetti() {
  if (reduceMotion) return;
  const cv = $('confetti'), ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const css = getComputedStyle(document.documentElement);
  const cols = ['--c1', '--c2', '--c3', '--c4', '--text'].map(v => css.getPropertyValue(v).trim());
  const bits = Array.from({ length: 170 }, () => ({
    x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * .6,
    w: 7 + Math.random() * 9, h: 11 + Math.random() * 11, vy: 3 + Math.random() * 4.5,
    vx: -2 + Math.random() * 4, r: Math.random() * 6, vr: -.25 + Math.random() * .5, c: cols[(Math.random() * cols.length) | 0]
  }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, cv.width, cv.height);
    bits.forEach(b => {
      b.x += b.vx; b.y += b.vy; b.r += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
    });
    if (t - t0 < 4200) requestAnimationFrame(frame); else ctx.clearRect(0, 0, cv.width, cv.height);
  })(t0);
}

// ---------- ช่องสัญญาณสด: โฮสต์ส่ง มือถือฟัง ----------
function openChannel() {
  channel = db.channel('quiz-' + G.pin, { config: { broadcast: { self: false, ack: true } } });
  channel.subscribe();
}
const send = payload => channel.send({ type: 'broadcast', event: 'state', payload });

// ---------- 1. เริ่มเกมจากสตูดิโอ ----------
try {
  const saved = JSON.parse(localStorage.getItem('quiz-host'));
  if (saved && saved.pin) { $('resumePin').textContent = saved.pin; $('resumeBox').classList.remove('hide'); }
} catch (e) {}

$('resumeBtn').onclick = () => {
  G = JSON.parse(localStorage.getItem('quiz-host'));
  openChannel();
  G.qi < 0 ? lobby() : setTimeout(reveal, 800);   // รีเฟรชกลางเกม: ข้ามไปหน้าผลของข้อนั้น
};
// ปิดเกมค้างให้จริง: จบเกมที่ฐานข้อมูล (ไม่รับโหวตหรือคนเข้าเพิ่ม) แล้วบอกมือถือทุกเครื่อง
async function endGame(g) {
  const prev = G; G = g;
  try {
    const ch = db.channel('quiz-' + g.pin, { config: { broadcast: { self: false, ack: true } } });
    channel = ch;
    await new Promise(res => { ch.subscribe(st => { if (st === 'SUBSCRIBED' || st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') res(); }); setTimeout(res, 3000); });
    await host('set_phase', { p_phase: 'ended', p_q: g.qi });
    await send({ type: 'ended', kind: g.kind, aborted: true });
    try { db.removeChannel(ch); } catch (e) {}
  } catch (e) {}
  channel = null; G = prev;
}
$('discardBtn').onclick = async () => {
  if (!(await UI.confirm('ปิดเกมที่ค้างอยู่ใช่ไหม ผู้เล่นทุกคนจะถูกตัดออกจากเกมนี้ทันที', 'ปิดเกม'))) return;
  $('discardBtn').disabled = true;
  try { await endGame(JSON.parse(localStorage.getItem('quiz-host'))); } catch (e) {}
  localStorage.removeItem('quiz-host'); $('resumeBox').classList.add('hide'); $('discardBtn').disabled = false;
};

$('createBtn').onclick = async () => {
  const b = Studio.build();
  if (b.error) {
    $('setupErr').textContent = b.error;
    const el = document.querySelector(b.focus);
    if (el) { el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); el.focus({ preventScroll: true }); }
    return;
  }
  if (b.kind === 'vote' && b.questions.some(q => q.max_votes > 1)) {       // โหวตหลายคนต้องใช้ฐานข้อมูลเวอร์ชันใหม่
    const v = await db.rpc('schema_version');
    if (v.error || !(v.data >= 2)) { $('setupErr').textContent = 'รางวัลที่ตั้งให้โหวตได้หลายคนต้องอัปเดตฐานข้อมูลก่อน: เปิด Supabase > SQL Editor > วางไฟล์ schema.sql ทั้งไฟล์ > Run (ไม่ลบข้อมูลเดิม) แล้วกดสร้างเกมอีกครั้ง หรือตั้งทุกรางวัลเป็นโหวตได้ 1 คน'; return; }
  }
  $('createBtn').disabled = true; $('setupErr').textContent = '';
  try { const old = JSON.parse(localStorage.getItem('quiz-host')); if (old && old.game_id) { await endGame(old); localStorage.removeItem('quiz-host'); } } catch (e) {}
  const { data, error } = await db.rpc('create_game', { p_title: b.title, p_questions: b.questions, p_kind: b.kind });
  $('createBtn').disabled = false;
  if (error) return void ($('setupErr').textContent = error.message);
  G = { ...data, title: b.title, kind: b.kind, questions: b.questions, settings: b.settings, qi: -1 };
  saveGame(); openChannel(); lobby();
};

// ---------- 2. ล็อบบี้ ----------
function lobby() {
  const url = new URL('./', location.href);
  $('joinUrl').textContent = url.host + url.pathname;
  $('pinBig').textContent = G.pin;
  $('lobbyTitle').textContent = G.title || '';
  $('startBtn').innerHTML = `<i class="ph-fill ph-play" aria-hidden="true"></i>${G.kind === 'vote' ? 'เริ่มโหวตรางวัลแรก' : 'เริ่มเล่น'}`;
  $('names').innerHTML = '';
  show('h-lobby');
  stopTimers();
  Sound.music(musicOn(), .18);
  const seen = new Set();
  const refresh = async () => {
    const { data } = await db.from('players').select('nickname').eq('game_id', G.game_id).order('joined_at');
    if (!data) return;
    data.forEach(p => {
      if (seen.has(p.nickname)) return;
      const b = document.createElement('span');
      b.className = 'bubble tint' + (seen.size % 4 + 1);
      b.style.setProperty('--bd', (seen.size % 7) * -.45 + 's');
      b.textContent = p.nickname;
      $('names').appendChild(b);
      seen.add(p.nickname); sfx.pop();
    });
    const n = data.length;
    if (String(n) !== $('countNum').textContent) { $('countNum').textContent = n; restart($('countNum'), 'bump .35s'); }
    $('count').textContent = n ? `เข้าร่วมแล้ว ${n} คน` : 'ยังไม่มีผู้เล่น';
  };
  refresh(); poll = setInterval(refresh, 1500);
}
$('startBtn').onclick = () => intro(0);

// ---------- 3-2-1 ก่อนเปิดข้อ ----------
let preResolve = null;
$('preGo').onclick = () => { if (preResolve) { const r = preResolve; preResolve = null; r(); } };
async function intro(i) {
  stopTimers(); Sound.stopMusic();
  const q = G.questions[i], vote = G.kind === 'vote';
  if (cfg().preview !== false) {                     // แสดงโจทย์ค้างไว้ จนกว่าผู้จัดจะกดเริ่ม ผู้เล่นถึงจะโหวตหรือตอบได้
    send({ type: 'ready', idx: i, kind: G.kind, prompt: q.prompt, note: q.note || '', preview: true });
    $('preLabel').textContent = `${vote ? 'รางวัลที่' : 'ข้อที่'} ${i + 1} จาก ${G.questions.length}`;
    $('preTitle').textContent = q.prompt; restart($('preTitle'), 'rise .6s var(--ease) both');
    $('preNote').textContent = q.note || ''; $('preNote').classList.toggle('hide', !q.note);
    $('preTime').textContent = `${vote ? 'โหวต' : 'ตอบ'} ${q.duration} วินาที`;
    $('preMax').textContent = `โหวตได้คนละ ${q.max_votes || 1} คน`; $('preMax').classList.toggle('hide', !vote || !(q.max_votes > 1));
    $('preGo').innerHTML = `<i class="ph-fill ph-play" aria-hidden="true"></i>${vote ? 'เริ่มโหวต' : 'เริ่มตอบ'}`;
    show('h-pre'); Sound.music(musicOn(), .14); $('preGo').focus();
    await new Promise(res => { preResolve = res; });
    sfx.go();
    return askQuestion(i);
  }
  $('cdLabel').textContent = `${vote ? 'รางวัลที่' : 'ข้อที่'} ${i + 1} จาก ${G.questions.length}`;
  $('cdTitle').textContent = q.prompt;
  $('cd').classList.remove('hide');
  send({ type: 'ready', idx: i, kind: G.kind, prompt: q.prompt, note: q.note || '' });
  for (let n = 3; n >= 1; n--) {
    $('cdNum').textContent = n; restart($('cdNum'), 'pop .6s var(--spring) both');
    sfx.tick(); await wait(reduceMotion ? 350 : 1000);
  }
  sfx.go(); $('cd').classList.add('hide');
  askQuestion(i);
}

// ---------- 3. คำถาม / โหวต ----------
async function askQuestion(i) {
  stopTimers(); revealing = false; lastTally = ''; lastTallyAt = 0; leaveFog(); resetAllIn();
  const q = G.questions[i], vote = G.kind === 'vote';
  const { error } = await host('set_phase', { p_phase: 'question', p_q: i });
  if (error) return UI.toast(error.message);
  G.qi = i; saveGame();
  await send({ type: 'question', idx: i, kind: G.kind, prompt: q.prompt, note: q.note || '', choices: q.choices, groups: q.groups || null, hideText: !vote && !!(q.groups && q.groups.hideText), maxVotes: q.max_votes || 1, duration: q.duration });

  $('qnum').textContent = `${vote ? 'รางวัลที่' : 'ข้อที่'} ${i + 1} จาก ${G.questions.length}`;
  $('qprompt').textContent = q.prompt; restart($('qprompt'), 'rise .6s var(--ease) both');
  $('qnote').textContent = q.note || '';
  $('qmax').textContent = 'โหวตได้คนละ ' + (q.max_votes || 1) + ' คน'; $('qmax').classList.toggle('hide', !vote || !(q.max_votes > 1));
  $('qans').textContent = vote ? 'ยังไม่มีใครโหวต' : 'ยังไม่มีใครตอบ';
  $('qbar').style.transform = 'scaleX(0)';
  $('voteLive').classList.toggle('hide', !vote);
  $('quizLive').classList.toggle('hide', vote);
  if (vote) { viewStyle = cfg().viewStyle || 'bars'; resetChart(); showLive(); paintVote({}, 0); }
  else {
    $('qchoices').className = 'tiles' + (q.choices.length > 4 ? ' many' : '');
    $('qchoices').innerHTML = q.choices.map((c, k) => c
      ? `<div class="tile tint${k + 1}" style="animation-delay:${k * 80}ms"><i class="ph-fill ph-${SHAPES[k]} sh" aria-hidden="true"></i><span>${esc(c)}</span></div>` : '').join('');
  }
  show('h-q');
  Sound.music(musicOn(), .24);
  if (vote && cfg().hideAt === '0') cfg().fogKind === 'censor' ? enterCensor() : enterFog();

  const bar = $('tbar'); bar.classList.remove('hide', 'low');
  bar.style.setProperty('--dur', q.duration + 's'); restart(bar.firstElementChild);
  qEnd = Date.now() + q.duration * 1000; runTick(q);
  poll = setInterval(async () => {
    const { data } = await host('host_stats', { p_idx: i });
    if (!data) return;
    const noun = vote ? 'โหวต' : 'ตอบ';
    $('qans').textContent = data.answered ? `${noun}แล้ว ${data.answered} จาก ${data.players} คน` : `ยังไม่มีใคร${noun}`;
    $('qbar').style.transform = `scaleX(${data.players ? Math.min(1, data.answered / data.players) : 0})`;
    if (vote) {
      paintVote(data.dist, data.answered); broadcastTally(i, data);
      const everyone = data.players > 0 && data.answered >= data.players;
      setAllIn(everyone);                                              // ครบทุกคน: หยุดเวลา ปุ่มเหลือแค่ "ประกาศผล" ตรงกลาง
      const c = cfg();
      if (!fogged && !censored && c.hideAt !== 'off' && data.players > 0 && data.answered / data.players * 100 >= +c.hideAt) c.fogKind === 'censor' ? enterCensor() : enterFog(data.answered);
      if (fogged) updateFog(data.answered, data.players);
    }
    else if (data.players > 0 && data.answered >= data.players) reveal();   // ควิซ: ตอบครบก็เฉลยเลย
  }, 1000);
}
// จับเวลาถอยหลัง อ่านเวลาจบจาก qEnd เสมอ เลยหยุดแล้วเดินต่อได้
function runTick(q) {
  clearInterval(tick);
  const bar = $('tbar'); let lastS = -1;
  tick = setInterval(() => {
    const left = qEnd - Date.now(), s = Math.max(0, Math.ceil(left / 1000));
    $('qtimer').textContent = s;
    $('qtimer').classList.toggle('low', s <= 10);
    bar.classList.toggle('low', s <= 10);
    if (s !== lastS && s <= 5 && s > 0) sfx.tick();
    lastS = s;
    Sound.setIntensity(.24 + .66 * (1 - Math.max(0, left) / (q.duration * 1000)) + (s <= 10 ? .1 : 0));
    if (s === 0) { clearInterval(tick); setTimeout(reveal, 1200); }   // รอคำตอบที่ยังอยู่บนเครือข่าย
  }, 250);
}
function resetAllIn() {
  allIn = false; frozenLeft = 0;
  $('qtimer').classList.remove('frozen'); $('tbar').classList.remove('frozen'); $('tbar').firstElementChild.style.animationPlayState = '';
  document.querySelector('#voteLive .tools').appendChild($('closeBtn')); $('liveArea').classList.remove('allin');
  $('closeBtn').classList.remove('allin'); document.querySelector('#voteLive .tools').classList.remove('allin');
  $('closeLabel').textContent = 'ปิดโหวตและประกาศผล';
}
// ทุกคนโหวตครบ: หยุดเวลา (เปลี่ยนสีเป็นเขียว) และเหลือปุ่ม "ประกาศผล" ปุ่มเดียวตรงกลาง ถ้ามีคนใหม่เข้ามาเพิ่มจะกลับไปนับต่อ
function setAllIn(on) {
  if (on === allIn || !G || G.kind !== 'vote') return;
  allIn = on;
  const bar = $('tbar');
  if (on) {
    frozenLeft = Math.max(0, qEnd - Date.now()); clearInterval(tick);
    bar.firstElementChild.style.animationPlayState = 'paused';
    $('qtimer').classList.remove('low'); bar.classList.remove('low'); sfx.go();
  } else {
    qEnd = Date.now() + frozenLeft; bar.firstElementChild.style.animationPlayState = '';
    runTick(G.questions[G.qi]);
  }
  $('qtimer').classList.toggle('frozen', on); bar.classList.toggle('frozen', on);
  const tools = document.querySelector('#voteLive .tools');
  (on ? $('allStage') : tools).appendChild($('closeBtn'));           // ครบแล้ว: ปุ่มไปอยู่ใต้ข้อความกลางจอ
  $('liveArea').classList.toggle('allin', on);
  $('closeBtn').classList.toggle('allin', on); tools.classList.toggle('allin', on);
  $('closeLabel').textContent = on ? 'ประกาศผล' : 'ปิดโหวตและประกาศผล';
}
$('revealBtn').onclick = () => reveal();
$('closeBtn').onclick = () => reveal();

// ส่งอันดับสดให้มือถือเป็นระยะ (เฉพาะเมื่อเปลี่ยน และห่างกันอย่างน้อย 2 วินาที)
function broadcastTally(i, data) {
  const live = cfg().phoneLive;
  const top = live ? Object.entries(data.dist).map(([k, n]) => [+k, n]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5) : [];
  const sig = JSON.stringify([top, data.answered, data.players]);
  if (sig === lastTally || Date.now() - lastTallyAt < 2000) return;
  lastTally = sig; lastTallyAt = Date.now();
  send({ type: 'tally', idx: i, answered: data.answered, players: data.players, live, top });
}

// ---------- โหมดลุ้น: กราฟอันดับที่ถูกหมอกบัง ----------
// หน้าตาเหมือนกราฟอันดับจริง แต่แถวทั้งหมดเป็นของปลอม: ไม่มีชื่อ ไม่มีคะแนนจริง ค่าเดินสุ่มเอง
// แท่งสั้นยาวและแถวสลับอันดับกันไปมา มีแค่ "จังหวะ" ที่ผูกกับการโหวตจริง ทุกครั้งที่มีคนโหวตเพิ่มจะมีแถวถูกดันขึ้น
const FOG_LINES = {
  normal: ['คะแนนถูกซ่อนไว้แล้ว', 'มีคนกำลังนำอยู่...', 'พลิกเกมได้ทุกเมื่อ', 'ใครกันนะที่จะได้มงกุฎ?', 'ห้ามกะพริบตา!'],
  near: ['ใกล้ครบแล้ว!', 'ใครยังไม่โหวตรีบเลย!', 'อีกไม่กี่คนเท่านั้น...'],
  last: ['ใกล้หมดเวลาแล้ว!', 'หัวใจจะวาย!', 'ลุ้นสุดตัว!']
};
const shuffled = a => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [r[i], r[j]] = [r[j], r[i]]; } return r; };
const FOG = { rows: [], timer: 0, seen: 0, style: 'bars' };

function fogLayout() {
  const sorted = [...FOG.rows].sort((a, b) => b.v - a.v);
  sorted.forEach((R, rank) => {
    R.el.style.transform = `translateY(${rank * ROW}px)`;
    R.rk.textContent = rank + 1;
    R.el.classList.toggle('lead', rank === 0);
    R.bar.style.transform = `scaleX(${R.v.toFixed(3)})`;
  });
}
function fogTick() {
  const vol = .05 + .09 * fogIntensity;
  FOG.rows.forEach(R => {
    R.v += (Math.random() - .5) * vol * 2 + (.55 - R.v) * .05 + R.kick; R.kick = 0;
    R.v = Math.max(.12, Math.min(1, R.v));
  });
  FOG.style === 'cloud' ? fogCloudLayout() : fogLayout();
  FOG.timer = setTimeout(fogTick, reduceMotion ? 1600 : 900 - 480 * fogIntensity);
}
function fogJolt(n) {                                    // มีคนโหวตเพิ่ม: ดันแถวสุ่มให้พุ่งขึ้น
  for (let k = 0; k < Math.min(3, n); k++) FOG.rows[(Math.random() * FOG.rows.length) | 0].kick += .2 + .25 * Math.random();
  sfx.pop();
}
function enterFog(answered = 0) {
  fogged = true; fogMode = 'normal'; fogIntensity = 0; FOG.seen = answered;
  showLive(); $('chartEmpty').classList.add('hide');
  $('fog').classList.remove('hide'); restart($('fog'), 'rise .6s var(--ease) both');
  FOG.style = viewStyle;
  $('fogChart').classList.toggle('hide', viewStyle === 'cloud'); $('fogCloud').classList.toggle('hide', viewStyle !== 'cloud');
  if (viewStyle === 'cloud') {                         // กลุ่มคำปลอม: ก้อนเบลอไม่มีชื่อ ขนาดแกว่งและสลับที่กันเอง
    const decoys = shuffled(G.questions[G.qi].choices);       // ชื่อหลอกสุ่มคนละที่กับคะแนนจริง และถูกเบลอจนอ่านไม่ออก
    const n = Math.min(12, decoys.length);
    $('fogCloud').innerHTML = '';
    FOG.rows = Array.from({ length: n }, (_, i) => {
      const el = document.createElement('div');
      el.className = 'cw tint' + (i % 4 + 1);
      el.innerHTML = `<span class="in" style="--bd:${-(Math.random() * 4).toFixed(2)}s"><span class="smudge"></span></span>`;
      el.querySelector('.smudge').textContent = decoys[i];
      $('fogCloud').appendChild(el);
      return { el, v: .2 + Math.random() * .75, kick: 0, s: 1 };
    });
    fogCloudLayout();
  } else {
    const decoys = shuffled(G.questions[G.qi].choices);
    const n = Math.min(TOPK, decoys.length);
    $('fogChart').innerHTML = '';
    FOG.rows = Array.from({ length: n }, (_, i) => {
      const el = document.createElement('div');
      el.className = 'crow tint' + (i % 4 + 1);
      el.innerHTML = `<div class="top"><span class="rk"></span><span class="nm"><span class="smudge"></span></span><i class="ph-fill ph-crown-simple lead-ico" aria-hidden="true"></i><b class="ct">?</b></div><div class="bar"><i></i></div>`;
      el.querySelector('.smudge').textContent = decoys[i];
      $('fogChart').appendChild(el);
      return { el, rk: el.querySelector('.rk'), bar: el.querySelector('.bar i'), v: .25 + Math.random() * .7, kick: 0 };
    });
    $('fogChart').style.height = n * ROW + 'px';
    fogLayout();
  }
  clearTimeout(FOG.timer); FOG.timer = setTimeout(fogTick, 700);
  $('fogText').textContent = FOG_LINES.normal[0];
  sfx.fog();
  let li = 0; clearInterval(fogTxtT);
  fogTxtT = setInterval(() => {
    const lines = FOG_LINES[fogMode]; li = (li + 1) % lines.length;
    $('fogText').textContent = lines[li]; restart($('fogText'), 'rise .5s var(--ease) both');
  }, 3200);
}
function updateFog(answered, players) {
  const pct = players ? Math.min(1, answered / players) : 0, left = allIn ? frozenLeft / 1000 : Math.max(0, (qEnd - Date.now()) / 1000);
  fogIntensity = Math.max(pct, 1 - left / G.questions[G.qi].duration);
  if (answered > FOG.seen) fogJolt(answered - FOG.seen);
  FOG.seen = answered;
  const mode = left <= 10 ? 'last' : pct >= .9 ? 'near' : 'normal';
  if (mode !== fogMode) { fogMode = mode; $('fogText').textContent = FOG_LINES[mode][0]; restart($('fogText'), 'rise .5s var(--ease) both'); }
}
// ---------- โหมดเบลอชื่อ: เห็นคะแนนจริงทุกอย่าง แต่ชื่อถูกเบลอจนอ่านไม่ออก ----------
function enterCensor() {
  censored = true;
  $('chart').classList.add('censor'); $('cloud').classList.add('censor');
  sfx.fog();
}
function leaveFog() {
  if (censored) { censored = false; $('chart').classList.remove('censor'); $('cloud').classList.remove('censor'); }
  if (!fogged) return;
  fogged = false; clearTimeout(FOG.timer); clearInterval(fogTxtT);
  $('fog').classList.add('hide'); showLive();
}

// ---------- กราฟคะแนนสด (แถวเลื่อนขึ้นลงตามอันดับ) ----------
const ROW = 76, TOPK = 6;
const rows = new Map();
function resetChart() { rows.clear(); $('chart').innerHTML = ''; cloudWords.clear(); $('cloud').innerHTML = ''; }
// แสดงเฉพาะมุมมองที่เลือก (แท่งหรือกลุ่มคำ) และซ่อนทั้งหมดตอนมีหมอก
function showLive() {
  const cloud = viewStyle === 'cloud';
  $('chart').classList.toggle('hide', cloud || fogged);
  $('cloud').classList.toggle('hide', !cloud || fogged);
  $('viewSeg').classList.toggle('hide', fogged);
}
document.querySelectorAll('input[name=view]').forEach(r => r.onchange = () => { view = r.value; resetChart(); paintVote(lastDist, lastAnswered); });
window.addEventListener('resize', () => { if (G && G.kind === 'vote' && !$('h-q').classList.contains('hide')) fogged ? fogCloudLayout() : paintVote(lastDist, lastAnswered); });

// ---------- กลุ่มคำ: วางคำแบบเกลียว ขนาดตามคะแนน แล้วให้ลอยไปที่ใหม่เมื่อคะแนนเปลี่ยน ----------
const cloudWords = new Map();
function cloudLayout(items, box) {                       // items: [{el, s}] เรียงจากตัวใหญ่ไปเล็ก
  const W = box.clientWidth, H = box.clientHeight;
  if (!W || !H) return;
  const cx = W / 2, cy = H / 2, placed = [];
  items.sort((a, b) => b.s - a.s).forEach(it => {
    const bw = it.el.offsetWidth, bh = it.el.offsetHeight;
    let s = it.s, spot = null, tries = 0;
    while (!spot && tries < 6) {
      const w = bw * s + 22, h = bh * s + 6;
      for (let t = 0; t < 500 && !spot; t += .3) {
        const r = 5.5 * t, x = cx + r * Math.cos(t) * 1.7 - w / 2, y = cy + r * Math.sin(t) * .85 - h / 2;
        if (x < 0 || y < 0 || x + w > W || y + h > H) continue;
        if (placed.every(p => x + w <= p.x || p.x + p.w <= x || y + h <= p.y || p.y + p.h <= y)) spot = { x, y, w, h };
      }
      if (!spot) { s *= .85; tries++; }                  // ไม่มีที่พอ: ย่อลงแล้วลองใหม่
    }
    if (!spot) { it.el.classList.add('off'); return; }
    placed.push(spot);
    it.el.classList.remove('off');
    it.el.style.transform = `translate(${(spot.x + 11).toFixed(1)}px, ${(spot.y + 3).toFixed(1)}px) scale(${s.toFixed(3)})`;
  });
}
function fogCloudLayout() {
  FOG.rows.forEach(R => { R.s = .55 + 2.1 * Math.sqrt(R.v); });
  cloudLayout(FOG.rows, $('fogCloud'));
}
function paintCloud(entries, answered) {
  if (fogged) return;                                    // ตอนมีหมอกใช้กลุ่มคำปลอมแทน
  const box = $('cloud'), max = Math.max(1, ...entries.map(e => e.count)), items = [];
  entries.forEach(e => {
    let w = cloudWords.get(e.key);
    if (!w) {
      const el = document.createElement('div');
      el.className = 'cw off tint' + e.tint;
      el.innerHTML = '<span class="in"></span>';
      el.firstChild.textContent = e.label; el.firstChild.style.setProperty('--bd', -(Math.random() * 4).toFixed(2) + 's');
      box.appendChild(el); w = { el, count: 0 }; cloudWords.set(e.key, w);
    }
    if (e.count > w.count && w.count > 0) sfx.pop();
    w.count = e.count;
    w.el.setAttribute('aria-label', `${e.label} ${e.count} คะแนน`);
    if (e.count > 0) items.push({ el: w.el, s: .6 + 2.3 * Math.sqrt(e.count / max), top: e.count === max });
    else w.el.classList.add('off');
  });
  box.classList.toggle('empty', !items.length);
  cloudLayout(items, box);
  items.forEach(it => it.el.classList.toggle('lead', it.top));
  $('chartEmpty').classList.toggle('hide', answered > 0);
}

function entriesFor(dist) {
  const q = G.questions[G.qi];
  if (view === 'group') {
    const m = new Map();
    q.choices.forEach((_, k) => { const g = (q.groups && q.groups[k]) || 'ไม่มีกลุ่ม'; m.set(g, (m.get(g) || 0) + (dist[k] || 0)); });
    return [...m].map(([g, n], gi) => ({ key: 'g:' + g, label: g, sub: '', count: n, tint: gi % 4 + 1 }));
  }
  return q.choices.map((c, k) => ({ key: 'c:' + k, label: c, sub: (q.groups && q.groups[k]) || '', count: dist[k] || 0, tint: k % 4 + 1 }));
}

function paintVote(dist, answered) {
  lastDist = dist; lastAnswered = answered;
  if (viewStyle === 'cloud') return paintCloud(entriesFor(dist), answered);
  const list = entriesFor(dist).sort((a, b) => b.count - a.count);
  const max = Math.max(1, list[0] ? list[0].count : 0);
  let shown = 0;
  list.forEach((e, rank) => {
    let el = rows.get(e.key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'crow off tint' + e.tint;
      el.innerHTML = '<div class="top"><span class="rk"></span><span class="nm"></span><span class="gp"></span><i class="ph-fill ph-crown-simple lead-ico" aria-hidden="true"></i><b class="ct num"></b></div><div class="bar"><i></i></div>';
      el.querySelector('.nm').textContent = e.label;
      el.querySelector('.gp').textContent = e.sub;
      $('chart').appendChild(el); rows.set(e.key, el);
    }
    const visible = rank < TOPK && e.count > 0;
    if (visible) shown++;
    el.classList.toggle('off', !visible);
    el.classList.toggle('lead', visible && rank === 0);
    el.style.transform = `translateY(${Math.min(rank, TOPK) * ROW}px)`;
    el.querySelector('.rk').textContent = rank + 1;
    const ct = el.querySelector('.ct');
    if (ct.textContent !== String(e.count)) {
      const first = ct.textContent === '';
      ct.textContent = e.count;
      if (!first) { restart(ct, 'bump .35s var(--ease)'); sfx.pop(); }
    }
    el.querySelector('.bar i').style.transform = `scaleX(${e.count / max})`;
  });
  $('chart').style.height = Math.max(shown, 1) * ROW + 'px';
  $('chartEmpty').classList.toggle('hide', answered > 0);
}

// ---------- 4. ประกาศผล ----------
// แท่นรับรางวัล: items เรียงจากที่ 1 ลงไป แสดงเป็น ที่ 2, ที่ 1, ที่ 3
function renderPodium(el, items) {
  const top = items.slice(0, 3), max = Math.max(1, top[0] ? top[0].n : 1);
  const order = [top[1], top[0], top[2]].filter(Boolean);
  const rankOf = it => top.indexOf(it) + 1;
  el.style.setProperty('--cols', order.length);
  el.innerHTML = order.map(it => {
    const r = rankOf(it), h = Math.max(80, Math.round(it.n / max * 230));
    const tint = r === 1 ? 3 : r === 2 ? 2 : 4, dl = r === 3 ? 0 : r === 2 ? .35 : .75;
    return `<div class="step tint${tint}"><div class="who" style="--dl:${dl}s">${esc(it.label)}<small>${esc(it.sub || '')}</small></div><div class="block" style="--h:${h}px;--dl:${dl}s">${r}</div></div>`;
  }).join('');
}

async function reveal() {
  if (revealing) return; revealing = true;
  stopTimers();
  const i = G.qi, q = G.questions[i];
  Sound.stopMusic(.25);
  $('rprompt').textContent = q.prompt;
  const last = i + 1 >= G.questions.length;
  setNext(null, false);
  if (G.kind === 'vote') {            // ขึ้นหน้าประกาศผลทันที ก่อนรอเน็ต จะได้ไม่มีภาพอันดับหลุดให้เห็น
    $('voteResult').classList.remove('hide'); $('quizResult').classList.add('hide');
    $('stage').classList.add('pending'); $('stage').classList.remove('pop');
    $('drum').classList.remove('done'); $('drum').textContent = 'กำลังนับคะแนน...';
    $('winner').textContent = '...'; $('winnerSub').textContent = ''; $('pod').innerHTML = ''; $('runners').innerHTML = ''; $('placed').innerHTML = '';
    show('h-reveal');
  }
  await host('set_phase', { p_phase: 'reveal', p_q: i });

  if (G.kind === 'vote') return revealVote(i, q, last);

  const { data, error } = await host('host_reveal', { p_idx: i });
  if (error) { revealing = false; return UI.toast(error.message); }
  const board = data.board.map(r => [r.nickname, r.score, r.last]);
  await send({ type: 'reveal', kind: 'quiz', idx: i, correct: data.correct, board });
  const total = Object.values(data.dist).reduce((a, b) => a + b, 0) || 1;
  $('voteResult').classList.add('hide'); $('quizResult').classList.remove('hide');
  $('bars').innerHTML = q.choices.map((c, k) => !c ? '' : `
    <div class="qb tint${k + 1} ${k === data.correct ? '' : 'wrong'}"><i class="ph-fill ph-${SHAPES[k]}" aria-hidden="true"></i>
      <span>${esc(c)}</span><b>${data.dist[k] || 0}${k === data.correct ? ' (ถูก)' : ''}</b></div>`).join('');
  renderPodium($('qpod'), board.filter(r => r[1] > 0).map(r => ({ label: r[0], sub: r[1] + ' คะแนน', n: r[1] })));
  setNext('แตะที่หน้าจอเพื่อ' + (last ? 'ดูผลรวม' : 'ไปข้อถัดไป'), true, 900);
  show('h-reveal');
  sfx.crash(); sfx.win(); confetti();
}

async function revealVote(i, q, last) {
  const { data, error } = await host('host_stats', { p_idx: i });
  if (error) { revealing = false; return UI.toast(error.message); }
  $('voteResult').classList.remove('hide'); $('quizResult').classList.add('hide');
  const nextLabel = 'แตะที่หน้าจอเพื่อ' + (last ? 'ดูสรุปทุกรางวัล' : 'ไปรางวัลถัดไป');

  const ranked = Object.entries(data.dist).map(([k, n]) => ({ k: +k, n })).sort((a, b) => b.n - a.n || a.k - b.k);
  const topN = ranked.length ? ranked[0].n : 0;
  const winners = ranked.filter(r => r.n === topN && topN > 0);
  const winText = winners.length ? winners.map(r => q.choices[r.k]).join(' และ ') : 'ไม่มีใครโหวตเลย';

  $('drum').textContent = 'กำลังเปิดซอง...';

  // พิธีรับรางวัล: เปิดอันดับ 3 แล้วอันดับ 2 ทีละคน ก่อนเฉลยผู้ชนะ
  const c = cfg();
  const steps = c.ceremony ? 22 : 16;
  let drumOn = false, spinSec = 0; for (let k = 0; k < steps; k++) spinSec += (70 + k * k * .55) / 1000;
  if (c.ceremony && !reduceMotion && winners.length) {
    const seq = [];
    if (ranked[2] && ranked[2].n > 0 && !winners.includes(ranked[2])) seq.push([3, ranked[2]]);
    if (ranked[1] && ranked[1].n > 0 && !winners.includes(ranked[1])) seq.push([2, ranked[1]]);
    $('drum').textContent = 'นับคะแนนเสร็จแล้ว!'; $('winner').textContent = '...';
    for (const [rk, r] of seq) {                                  // แต่ละอันดับรอให้ผู้จัดแตะหน้าจอก่อนเปิด
      await waitTap(`แตะที่หน้าจอเพื่อเปิดอันดับ ${rk}`);
      $('drum').textContent = `อันดับ ${rk} ตกเป็นของ...`; $('winner').textContent = '...'; $('winnerSub').textContent = '';
      $('stage').classList.add('pending');
      Sound.drumroll(1.5); await wait(1500); sfx.crash();
      $('stage').classList.remove('pending'); $('winner').textContent = q.choices[r.k]; restart($('winner'), 'pop .6s var(--spring) both');
      $('winnerSub').textContent = `${r.n} คะแนน`; $('drum').textContent = `อันดับ ${rk}`; sfx.pop(); sfx.pop();
      $('placed').insertAdjacentHTML('afterbegin', `<li>อันดับ ${rk}: <b>${esc(q.choices[r.k])}</b> ${r.n} คะแนน</li>`);
    }
    await waitTap('แตะที่หน้าจอเพื่อเปิดผู้ชนะ');
    $('stage').classList.add('pending'); $('winnerSub').textContent = '';
    $('drum').textContent = 'แล้วผู้ชนะคือ...'; $('winner').textContent = '...';
    drumOn = true; Sound.drumroll(1.4 + spinSec); await wait(1400);
  }
  // สล็อตเมชชีน: ชื่อวิ่งเร็วแล้วค่อย ๆ ช้าลง ก่อนหยุดที่ผู้ชนะ
  if (!reduceMotion && q.choices.length > 1) {
    if (!drumOn) Sound.drumroll(spinSec);
    for (let k = 0; k < steps; k++) {
      $('winner').textContent = q.choices[(Math.random() * q.choices.length) | 0];
      sfx.blip();
      await wait(70 + k * k * .55);
    }
  }
  $('stage').classList.remove('pending'); restart($('winner'), 'pop .6s var(--spring) both');
  $('drum').classList.add('done'); $('placed').innerHTML = '';
  $('winner').textContent = winText;
  $('winnerSub').textContent = !winners.length ? '' : (winners.length > 1 ? `เสมอกัน ${topN} คะแนน` : `${topN} คะแนน จากผู้โหวต ${data.answered} คน`);
  const label = r => q.choices[r.k], sub = r => (q.groups && q.groups[r.k]) || '';
  renderPodium($('pod'), ranked.filter(r => r.n > 0).map(r => ({ label: label(r), sub: sub(r), n: r.n })));
  $('runners').innerHTML = ranked.filter(r => r.n > 0).slice(3, 6)
    .map((r, k) => `<li style="animation-delay:${.9 + k * .12}s"><span class="aw">${k + 4}. ${esc(label(r))}</span><b>${r.n}</b></li>`).join('');
  setNext(nextLabel, true, 900);
  if (winners.length) { sfx.crash(); sfx.win(); confetti(); } else Sound.stopDrum();
  await send({ type: 'reveal', kind: 'vote', idx: i, dist: data.dist, answered: data.answered });
}
// ปุ่มเต็มจอ "แตะที่ไหนก็ได้เพื่อไปต่อ": เปิดให้กดได้หลังผลขึ้นครบ + หน่วงสั้น ๆ กันเผลอดับเบิลคลิกข้ามผล
function setNext(label, on, delay = 0) {
  clearTimeout(setNext.t);
  const b = $('nextBtn');
  if (!on) { b.disabled = true; b.classList.add('hide'); return; }
  $('nextLabel').textContent = label;
  setNext.t = setTimeout(() => { b.disabled = false; b.classList.remove('hide'); b.focus({ preventScroll: true }); }, delay);
}
// รอให้ผู้จัดแตะหน้าจอ (ใช้กับแต่ละขั้นของพิธีรับรางวัล)
let tapResolve = null;
function waitTap(label) { return new Promise(res => { tapResolve = res; setNext(label, true, 700); }); }
$('nextBtn').onclick = () => {
  if ($('nextBtn').disabled) return;
  if (tapResolve) { const r = tapResolve; tapResolve = null; setNext(null, false); return r(); }   // ขั้นของพิธี: แตะเพื่อเปิดต่อ
  G.qi + 1 < G.questions.length ? intro(G.qi + 1) : finish();                                    // จบแล้ว: แตะเพื่อไปรางวัลถัดไป
};
document.addEventListener('keydown', e => {            // ลูกศรขวาไปต่อได้ด้วย (Space และ Enter ทำงานกับปุ่มที่โฟกัสอยู่แล้ว)
  const b = $('nextBtn');
  if (e.key === 'ArrowRight' && !b.disabled && !b.classList.contains('hide') && !e.target.closest('input,textarea,select,dialog')) { e.preventDefault(); b.click(); }
});

// ---------- 5. จบเกม ----------
async function finish() {
  Sound.stopMusic();
  await host('set_phase', { p_phase: 'ended', p_q: G.qi });
  if (G.kind === 'vote') {
    const { data } = await host('host_summary', {});
    await send({ type: 'ended', kind: 'vote' });
    $('endTitle').textContent = 'ผู้ชนะทุกรางวัล';
    $('podium').innerHTML = G.questions.map((q, i) => {
      const dist = ((data || []).find(d => d.idx === i) || { dist: {} }).dist;
      const ranked = Object.entries(dist).map(([k, n]) => ({ k: +k, n })).sort((a, b) => b.n - a.n);
      const top = ranked.length ? ranked[0].n : 0;
      const w = ranked.filter(r => r.n === top && top > 0).map(r => q.choices[r.k]);
      return `<li class="tint${i % 4 + 1}" style="--i:${i}"><div class="aw">${esc(q.prompt)}</div><div class="wn">${w.length ? esc(w.join(' และ ')) : 'ไม่มีผู้โหวต'}</div><div class="vt">${top ? top + ' คะแนน' : ''}</div></li>`;
    }).join('');
  } else {
    const { data } = await host('host_reveal', { p_idx: G.qi });
    const board = data.board.map(r => [r.nickname, r.score, r.last]);
    await send({ type: 'ended', kind: 'quiz', board });
    $('endTitle').textContent = 'ผลสุดท้าย';
    $('podium').innerHTML = board.slice(0, 10).map((r, i) =>
      `<li class="tint${i % 4 + 1}" style="--i:${i}"><div class="aw">อันดับ ${i + 1}</div><div class="wn">${esc(r[0])}</div><div class="vt">${r[1]} คะแนน</div></li>`).join('');
  }
  $('endPin').textContent = G.pin;
  $('endToken').textContent = G.host_token;
  show('h-end');
  sfx.win(); confetti();
}

$('csvBtn').onclick = async () => {
  const { data, error } = await db.rpc('get_results', { p_pin: G.pin, p_token: G.host_token });
  if (error) return UI.toast(error.message);
  const cols = ['nickname', 'question', 'prompt', 'choice', 'correct', 'is_correct', 'elapsed_ms', 'points'];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...data.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));   // BOM ให้ Excel อ่านภาษาไทยได้
  a.download = `quiz-${G.pin}.csv`;
  a.click();
};
$('newBtn').onclick = () => { localStorage.removeItem('quiz-host'); location.reload(); };
