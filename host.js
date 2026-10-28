// Host game engine. Uses $, esc, LETTERS, SHAPES from studio.js (loaded first).
const { SUPABASE_URL, SUPABASE_KEY } = window.QUIZ_CONFIG;
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const SCREENS = ['h-setup', 'h-lobby', 'h-q', 'h-reveal', 'h-end'];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, ms));
const show = id => {
  SCREENS.forEach(s => $(s).classList.toggle('hide', s !== id));
  $('tbar').classList.add('hide');
  window.scrollTo(0, 0);
};
const restart = (el, name) => { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = name || ''; };

let G = null;            // { game_id, pin, host_token, kind, title, questions, qi }
let channel = null, poll = null, tick = null, revealing = false, lastTally = '', lastTallyAt = 0, view = 'person';

const saveGame = () => { try { localStorage.setItem('quiz-host', JSON.stringify(G)); } catch (e) {} };
const stopTimers = () => { clearInterval(poll); clearInterval(tick); };
const host = (fn, args) => db.rpc(fn, { p_game: G.game_id, p_token: G.host_token, ...args });

// ---------- เสียงเอฟเฟกต์ (สังเคราะห์เอง ไม่ต้องโหลดไฟล์) ----------
let muted = false, ac = null;
try { muted = localStorage.getItem('quiz-mute') === '1'; } catch (e) {}
function syncMute() {
  $('muteBtn').setAttribute('aria-pressed', String(!muted));
  $('muteBtn').firstElementChild.className = 'ph-bold ' + (muted ? 'ph-speaker-slash' : 'ph-speaker-high');
}
$('muteBtn').onclick = () => { muted = !muted; try { localStorage.setItem('quiz-mute', muted ? '1' : '0'); } catch (e) {} syncMute(); };
syncMute();
function tone(f, d = .12, type = 'sine', vol = .12, at = 0) {
  if (muted) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + d);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + d + .03);
  } catch (e) {}
}
const sfx = {
  tick: () => tone(660, .1, 'square', .05),
  go: () => { tone(880, .12, 'triangle', .12); tone(1320, .25, 'triangle', .12, .1); },
  blip: () => tone(300 + Math.random() * 500, .05, 'square', .035),
  pop: () => tone(520 + Math.random() * 300, .08, 'sine', .08),
  win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, .4, 'triangle', .13, i * .11))
};

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
$('discardBtn').onclick = () => { localStorage.removeItem('quiz-host'); $('resumeBox').classList.add('hide'); };

$('createBtn').onclick = async () => {
  const b = Studio.build();
  if (b.error) {
    $('setupErr').textContent = b.error;
    const el = document.querySelector(b.focus);
    if (el) { el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); el.focus({ preventScroll: true }); }
    return;
  }
  $('createBtn').disabled = true; $('setupErr').textContent = '';
  const { data, error } = await db.rpc('create_game', { p_title: b.title, p_questions: b.questions, p_kind: b.kind });
  $('createBtn').disabled = false;
  if (error) return void ($('setupErr').textContent = error.message);
  G = { ...data, title: b.title, kind: b.kind, questions: b.questions, qi: -1 };
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
async function intro(i) {
  stopTimers();
  const q = G.questions[i], vote = G.kind === 'vote';
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
  stopTimers(); revealing = false; lastTally = ''; lastTallyAt = 0;
  const q = G.questions[i], vote = G.kind === 'vote';
  const { error } = await host('set_phase', { p_phase: 'question', p_q: i });
  if (error) return alert(error.message);
  G.qi = i; saveGame();
  await send({ type: 'question', idx: i, kind: G.kind, prompt: q.prompt, note: q.note || '', choices: q.choices, groups: q.groups || null, duration: q.duration });

  $('qnum').textContent = `${vote ? 'รางวัลที่' : 'ข้อที่'} ${i + 1} จาก ${G.questions.length}`;
  $('qprompt').textContent = q.prompt; restart($('qprompt'), 'rise .6s var(--ease) both');
  $('qnote').textContent = q.note || '';
  $('qans').textContent = vote ? 'ยังไม่มีใครโหวต' : 'ยังไม่มีใครตอบ';
  $('qbar').style.transform = 'scaleX(0)';
  $('voteLive').classList.toggle('hide', !vote);
  $('quizLive').classList.toggle('hide', vote);
  if (vote) { resetChart(); paintVote({}, 0); }
  else $('qchoices').innerHTML = q.choices.map((c, k) => c
    ? `<div class="tile tint${k + 1}" style="animation-delay:${k * 90}ms"><i class="ph-fill ph-${SHAPES[k]}" aria-hidden="true"></i><span>${esc(c)}</span></div>` : '').join('');
  show('h-q');

  const bar = $('tbar'); bar.classList.remove('hide', 'low');
  bar.style.setProperty('--dur', q.duration + 's'); restart(bar.firstElementChild);
  const end = Date.now() + q.duration * 1000; let lastS = -1;
  tick = setInterval(() => {
    const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    $('qtimer').textContent = s;
    $('qtimer').classList.toggle('low', s <= 10);
    bar.classList.toggle('low', s <= 10);
    if (s !== lastS && s <= 5 && s > 0) sfx.tick();
    lastS = s;
    if (s === 0) { clearInterval(tick); setTimeout(reveal, 1200); }   // รอคำตอบที่ยังอยู่บนเครือข่าย
  }, 250);
  poll = setInterval(async () => {
    const { data } = await host('host_stats', { p_idx: i });
    if (!data) return;
    const noun = vote ? 'โหวต' : 'ตอบ';
    $('qans').textContent = data.answered ? `${noun}แล้ว ${data.answered} จาก ${data.players} คน` : `ยังไม่มีใคร${noun}`;
    $('qbar').style.transform = `scaleX(${data.players ? Math.min(1, data.answered / data.players) : 0})`;
    if (vote) { paintVote(data.dist, data.answered); broadcastTally(i, data); }
    else if (data.players > 0 && data.answered >= data.players) reveal();   // ควิซ: ตอบครบก็เฉลยเลย
  }, 1000);
}
$('revealBtn').onclick = () => reveal();
$('closeBtn').onclick = () => reveal();

// ส่งอันดับสดให้มือถือเป็นระยะ (เฉพาะเมื่อเปลี่ยน และห่างกันอย่างน้อย 2 วินาที)
function broadcastTally(i, data) {
  const top = Object.entries(data.dist).map(([k, n]) => [+k, n]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5);
  const sig = JSON.stringify([top, data.answered]);
  if (sig === lastTally || Date.now() - lastTallyAt < 2000) return;
  lastTally = sig; lastTallyAt = Date.now();
  send({ type: 'tally', idx: i, answered: data.answered, players: data.players, top });
}

// ---------- กราฟคะแนนสด (แถวเลื่อนขึ้นลงตามอันดับ) ----------
const ROW = 76, TOPK = 6;
const rows = new Map();
function resetChart() { rows.clear(); $('chart').innerHTML = ''; }
document.querySelectorAll('input[name=view]').forEach(r => r.onchange = () => { view = r.value; resetChart(); });

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
  await host('set_phase', { p_phase: 'reveal', p_q: i });
  $('rprompt').textContent = q.prompt;
  const last = i + 1 >= G.questions.length;
  $('nextBtn').disabled = true;

  if (G.kind === 'vote') return revealVote(i, q, last);

  const { data, error } = await host('host_reveal', { p_idx: i });
  if (error) { revealing = false; return alert(error.message); }
  const board = data.board.map(r => [r.nickname, r.score, r.last]);
  await send({ type: 'reveal', kind: 'quiz', idx: i, correct: data.correct, board });
  const total = Object.values(data.dist).reduce((a, b) => a + b, 0) || 1;
  $('voteResult').classList.add('hide'); $('quizResult').classList.remove('hide');
  $('bars').innerHTML = q.choices.map((c, k) => !c ? '' : `
    <div class="qb tint${k + 1} ${k === data.correct ? '' : 'wrong'}"><i class="ph-fill ph-${SHAPES[k]}" aria-hidden="true"></i>
      <span>${esc(c)}</span><b>${data.dist[k] || 0}${k === data.correct ? ' (ถูก)' : ''}</b></div>`).join('');
  renderPodium($('qpod'), board.filter(r => r[1] > 0).map(r => ({ label: r[0], sub: r[1] + ' คะแนน', n: r[1] })));
  $('nextBtn').innerHTML = last ? 'ดูผลรวม' : 'ข้อถัดไป'; $('nextBtn').disabled = false;
  show('h-reveal');
  sfx.win(); confetti();
}

async function revealVote(i, q, last) {
  const { data, error } = await host('host_stats', { p_idx: i });
  if (error) { revealing = false; return alert(error.message); }
  $('voteResult').classList.remove('hide'); $('quizResult').classList.add('hide');
  $('nextBtn').innerHTML = last ? 'ดูสรุปทุกรางวัล' : 'รางวัลถัดไป';

  const ranked = Object.entries(data.dist).map(([k, n]) => ({ k: +k, n })).sort((a, b) => b.n - a.n || a.k - b.k);
  const topN = ranked.length ? ranked[0].n : 0;
  const winners = ranked.filter(r => r.n === topN && topN > 0);
  const winText = winners.length ? winners.map(r => q.choices[r.k]).join(' และ ') : 'ไม่มีใครโหวตเลย';

  $('stage').classList.add('pending'); $('stage').classList.remove('pop');
  $('drum').classList.remove('done'); $('winner').textContent = '...'; $('winnerSub').textContent = '';
  $('pod').innerHTML = ''; $('runners').innerHTML = '';
  show('h-reveal');

  // สล็อตเมชชีน: ชื่อวิ่งเร็วแล้วค่อย ๆ ช้าลง ก่อนหยุดที่ผู้ชนะ
  if (!reduceMotion && q.choices.length > 1) {
    const steps = 16;
    for (let k = 0; k < steps; k++) {
      $('winner').textContent = q.choices[(Math.random() * q.choices.length) | 0];
      sfx.blip();
      await wait(70 + k * k * .55);
    }
  }
  $('stage').classList.remove('pending'); restart($('winner'), 'pop .6s var(--spring) both');
  $('drum').classList.add('done');
  $('winner').textContent = winText;
  $('winnerSub').textContent = !winners.length ? '' : (winners.length > 1 ? `เสมอกัน ${topN} คะแนน` : `${topN} คะแนน จากผู้โหวต ${data.answered} คน`);
  const label = r => q.choices[r.k], sub = r => (q.groups && q.groups[r.k]) || '';
  renderPodium($('pod'), ranked.filter(r => r.n > 0).map(r => ({ label: label(r), sub: sub(r), n: r.n })));
  $('runners').innerHTML = ranked.filter(r => r.n > 0).slice(3, 6)
    .map((r, k) => `<li style="animation-delay:${.9 + k * .12}s"><span class="aw">${k + 4}. ${esc(label(r))}</span><b>${r.n}</b></li>`).join('');
  $('nextBtn').disabled = false;
  if (winners.length) { sfx.win(); confetti(); }
  await send({ type: 'reveal', kind: 'vote', idx: i, dist: data.dist, answered: data.answered });
}
$('nextBtn').onclick = () => G.qi + 1 < G.questions.length ? intro(G.qi + 1) : finish();

// ---------- 5. จบเกม ----------
async function finish() {
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
  if (error) return alert(error.message);
  const cols = ['nickname', 'question', 'prompt', 'choice', 'correct', 'is_correct', 'elapsed_ms', 'points'];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...data.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));   // BOM ให้ Excel อ่านภาษาไทยได้
  a.download = `quiz-${G.pin}.csv`;
  a.click();
};
$('newBtn').onclick = () => { localStorage.removeItem('quiz-host'); location.reload(); };
