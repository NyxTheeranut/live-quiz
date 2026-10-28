// Game studio: builds the vote / quiz definition with cards instead of pasted text.
// Exposes window.Studio = { build(), kind() }.
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LETTERS = 'กขคงจฉชซ';
const MAXCH = 8;
const SHAPES = ['triangle', 'diamond', 'circle', 'square', 'star', 'heart', 'hexagon', 'pentagon'];   // choice N always has colour N and shape N
const EMOJI = ['😭', '🗣️', '👑', '🦥', '🔥', '👻', '🤥', '💃', '🐍', '🥇', '😂', '🤣', '🏆', '🎉', '😎', '🍜', '☕', '💤', '🎤', '🤡', '🧠', '💸', '🐶', '🌶️'];
const LEAD_EMOJI = /^\p{Extended_Pictographic}[\u{FE0F}\u{200D}\p{Extended_Pictographic}]*\s*/u;
const DEFAULT_TITLE = { vote: 'ประกาศรางวัลตัวตึงแห่งปี', quiz: 'ควิซวันศุกร์' };
const DRAFT_KEY = 'quiz-draft';
const DEFAULT_SET = { hideAt: '50', ceremony: true, phoneLive: false, music: true, hideText: false };

const SAMPLE = {
  awards: [
    ['😭 ขี้แงแห่งปี', 'น้ำตาไหลง่ายกว่าน้ำประปา'], ['🗣️ ปากแจ๋วแห่งปี', 'เรื่องงานอาจเงียบ แต่เรื่องเมาท์ไม่เคยพัก'],
    ['👑 เจ้าแม่ดราม่า', 'เรื่องเล่า 1 นาที ขยายได้ 3 ชั่วโมง'], ['🦥 สายชิลระดับชาติ', 'โลกจะพัง แต่ฉันยังไม่รีบ'],
    ['🔥 หัวร้อนระดับเตาปฏิกรณ์', 'อารมณ์เดือดก่อนน้ำในกาต้ม'], ['👻 ผีประจำกลุ่ม', 'ตอนทำงานหาย ตอนกินข้าวมา'],
    ['🤥 ราชาแห่งข้ออ้าง', 'ไม่เคยผิด เพราะมีเหตุผลรองรับเสมอ'], ['💃 ตัวแม่สายมั่น', 'ผิดไม่กลัว กลัวไม่โดดเด่น'],
    ['🐍 นักสืบแห่งปี', 'เรื่องชาวบ้านรู้หมด เรื่องตัวเองไม่รู้เลย'], ['🥇 รางวัลปากบอกไม่ไหว แต่ไปทุกงาน', 'บ่นว่าเหนื่อยทุกวัน แต่กิจกรรมไม่เคยขาด']
  ].map(([title, note]) => ({ title, note, sec: 90, max: 1 })),
  groups: [
    { name: 'ทีมขาย', names: ['ก้อง', 'มิ้นท์', 'บอล', 'ฝน'] },
    { name: 'ทีมซัพพอร์ต', names: ['ปอ', 'แพรว', 'เจมส์', 'นุ่น'] },
    { name: 'ทีมการตลาด', names: ['เต้', 'หมูหยอง', 'ใบเตย'] },
    { name: 'ผู้บริหาร', names: ['พี่ต้น'] }
  ],
  quiz: [
    { prompt: 'เมืองหลวงของประเทศไทยคือเมืองอะไร', choices: ['กรุงเทพ', 'เชียงใหม่', 'ภูเก็ต', 'ขอนแก่น'], correct: 0, sec: 15 },
    { prompt: '2 ชั่วโมงเท่ากับกี่นาที', choices: ['60', '90', '120', '240'], correct: 2, sec: 15 },
    { prompt: 'ดาวดวงไหนอยู่ใกล้ดวงอาทิตย์ที่สุด', choices: ['ศุกร์', 'พุธ', 'อังคาร', 'โลก'], correct: 1, sec: 20 }
  ]
};
const clone = o => JSON.parse(JSON.stringify(o));
const clamp = (v, d) => Math.min(600, Math.max(5, parseInt(v, 10) || d));
const clampMax = v => Math.min(50, Math.max(1, parseInt(v, 10) || 1));      // โหวตได้อย่างน้อย 1 เสมอ

let S = (() => {
  try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY)); if (d && d.awards && d.groups && d.quiz) return d; } catch (e) {}
  return { kind: 'vote', title: DEFAULT_TITLE.vote, ...clone(SAMPLE) };
})();
S.settings = { ...DEFAULT_SET, ...(S.settings || {}) };
let saveT = null;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(S)); } catch (e) {} }, 300); };

// ---------- อ่านข้อความที่วางมาจากชีต (แท็บ) หรือ CSV ----------
function parseRows(text) {
  const delim = text.includes('\t') ? '\t' : ',';
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}
const tsv = rows => rows.map(r => r.join('\t')).join('\n');
const isHeader = (r, re) => re.test((r[0] || '').trim());

function awardsFromRows(rows) {
  return rows.filter((r, i) => !(i === 0 && isHeader(r, /^(รางวัล|ชื่อรางวัล|award|awards|หัวข้อ)$/i)) && (r[0] || '').trim())
    .map(r => ({ title: r[0].trim(), note: (r[1] || '').trim(), sec: clamp(r[2], 90), max: clampMax(r[3]) }));
}
function groupsFromRows(rows) {
  const map = new Map();
  rows.forEach((r, i) => {
    const name = (r[0] || '').trim();
    if (!name || (i === 0 && isHeader(r, /^(ชื่อ|name|ผู้เข้าชิง|ชื่อผู้เข้าชิง)$/i))) return;
    const g = (r[1] || '').trim();
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(name.slice(0, 40));
  });
  return [...map].map(([name, names]) => ({ name, names }));
}
const LETTER_RE = /^[A-Hกขคงจฉชซ]$/i;
const letterIdx = c => { c = c.toUpperCase(); return 'ABCDEFGH'.includes(c) ? 'ABCDEFGH'.indexOf(c) : LETTERS.indexOf(c); };
// แถว: คำถาม, ตัวเลือก 2 ถึง 8 ช่อง, ข้อที่ถูก (ก ข ค ง จ ฉ ช ซ หรือ A-H), วินาที (เว้นว่างได้)
function quizFromRows(rows) {
  const out = [];
  rows.forEach(r => {
    const cells = r.map(c => (c || '').trim());
    for (let k = cells.length - 1; k >= 3; k--) {
      const tail = cells.slice(k + 1);
      if (!LETTER_RE.test(cells[k]) || tail.length > 1 || tail.some(c => c && !/^\d+$/.test(c))) continue;
      const choices = cells.slice(1, k).slice(0, MAXCH), correct = letterIdx(cells[k]);
      if (cells[0] && choices.length >= 2 && choices[correct]) out.push({ prompt: cells[0], choices, correct, sec: clamp(cells[k + 1], 20) });
      return;
    }
  });
  return out;
}

// ---------- วาดหน้าจอ ----------
const total = () => S.groups.reduce((n, g) => n + g.names.length, 0);
function counts() {
  $('awardCount').textContent = S.awards.length + ' รางวัล';
  $('nTotal').textContent = total() + ' คน';
  $('quizCount').textContent = S.quiz.length + ' ข้อ';
}
function focusAfter(sel) { const el = document.querySelector(sel); if (el) el.focus(); }

function renderAwards(focus) {
  $('awardList').innerHTML = S.awards.map((a, i) => {
    const emo = (a.title.match(LEAD_EMOJI) || ['🙂'])[0].trim() || '🙂';
    const ib = (act, icon, label, dis) => `<button type="button" class="iconbtn" data-act="${act}" aria-label="${label}" ${dis ? 'disabled' : ''}><i class="ph-bold ph-${icon}" aria-hidden="true"></i></button>`;
    return `<article class="acard tint${i % 4 + 1}" data-i="${i}">
      <div class="anum">${i + 1}</div>
      <div>
        <label for="at${i}">ชื่อรางวัล</label>
        <div class="trow">
          <details class="emo"><summary aria-label="เลือกอีโมจิ">${emo}</summary>
            <div class="emogrid">${EMOJI.map(e => `<button type="button" data-act="emo" data-e="${e}" aria-label="อีโมจิ ${e}">${e}</button>`).join('')}</div></details>
          <input type="text" id="at${i}" data-f="title" maxlength="60" value="${esc(a.title)}" placeholder="เช่น ขี้แงแห่งปี">
        </div>
        <label for="an${i}" style="margin-top:12px">คำจำกัดความ (โชว์ใต้ชื่อรางวัล)</label>
        <input type="text" id="an${i}" data-f="note" maxlength="90" value="${esc(a.note)}" placeholder="เช่น น้ำตาไหลง่ายกว่าน้ำประปา">
      </div>
      <div class="asec">
        <div><label for="as${i}">วินาทีให้โหวต</label><input type="number" id="as${i}" data-f="sec" min="5" max="600" value="${a.sec}"></div>
        <div><label for="am${i}">โหวตได้สูงสุด (คน)</label><input type="number" id="am${i}" data-f="max" min="1" max="50" value="${clampMax(a.max)}"></div>
      </div>
      <div class="acts">${ib('up', 'arrow-up', 'เลื่อนขึ้น', i === 0)}${ib('down', 'arrow-down', 'เลื่อนลง', i === S.awards.length - 1)}${ib('dup', 'copy', 'ทำสำเนา')}${ib('del', 'trash', 'ลบรางวัลนี้')}</div>
    </article>`;
  }).join('');
  counts();
  if (focus) focusAfter(focus);
}

function renderGroups(focus) {
  $('groupList').innerHTML = S.groups.map((g, gi) => `
    <section class="ggroup tint${gi % 4 + 1}" data-g="${gi}">
      <div class="ghead">
        <input type="text" data-f="gname" maxlength="30" value="${esc(g.name)}" aria-label="ชื่อกลุ่ม" placeholder="ชื่อกลุ่ม (เว้นว่างได้)">
        <span class="n num">${g.names.length} คน</span>
        <button type="button" class="iconbtn" data-act="gdel" aria-label="ลบกลุ่ม ${esc(g.name || 'นี้')}"><i class="ph-bold ph-trash" aria-hidden="true"></i></button>
      </div>
      <div class="chips">${g.names.map((n, ni) => `<span class="nchip">${esc(n)}<button type="button" data-act="ndel" data-n="${ni}" aria-label="ลบ ${esc(n)}"><i class="ph-bold ph-x" aria-hidden="true"></i></button></span>`).join('')}</div>
      <input type="text" class="gadd" data-f="gadd" aria-label="เพิ่มชื่อในกลุ่ม ${esc(g.name || 'นี้')}" placeholder="พิมพ์ชื่อแล้วกด Enter (วางหลายชื่อได้)">
    </section>`).join('');
  counts();
  if (focus) focusAfter(focus);
}

function renderQuiz(focus) {
  $('quizList').innerHTML = S.quiz.map((q, i) => {
    const ib = (act, icon, label, dis) => `<button type="button" class="iconbtn" data-act="${act}" aria-label="${label}" ${dis ? 'disabled' : ''}><i class="ph-bold ph-${icon}" aria-hidden="true"></i></button>`;
    return `<article class="qcard" data-i="${i}">
      <div class="anum tint${i % 4 + 1}">${i + 1}</div>
      <div class="qbody">
        <div><label class="mini" for="qp${i}">คำถาม</label>
          <textarea id="qp${i}" data-f="prompt" rows="2" maxlength="140" placeholder="พิมพ์คำถามที่นี่">${esc(q.prompt)}</textarea></div>
        <div class="answers">${q.choices.map((c, k) => `
          <div class="ans tint${k + 1}"><i class="ph-fill ph-${SHAPES[k]} shape" aria-hidden="true"></i>
            <input type="text" data-f="ch" data-k="${k}" maxlength="60" value="${esc(c)}" aria-label="ตัวเลือกที่ ${k + 1}" placeholder="ตัวเลือกที่ ${k + 1}${k > 1 ? ' (ไม่ใส่ก็ได้)' : ''}">
            <button type="button" class="ok" data-act="correct" data-k="${k}" aria-pressed="${q.correct === k}" aria-label="ตั้งตัวเลือกที่ ${k + 1} เป็นข้อที่ถูก"><i class="ph-bold ph-check" aria-hidden="true"></i></button>
            ${q.choices.length > 2 ? `<button type="button" class="rm" data-act="chdel" data-k="${k}" aria-label="ลบตัวเลือกที่ ${k + 1}"><i class="ph-bold ph-x" aria-hidden="true"></i></button>` : ''}
          </div>`).join('')}
          ${q.choices.length < MAXCH ? `<button type="button" class="addans" data-act="chadd"><i class="ph-bold ph-plus" aria-hidden="true"></i>เพิ่มตัวเลือก (${q.choices.length}/${MAXCH})</button>` : ''}</div>
        <div class="secs" role="group" aria-label="เวลาตอบ"><span class="muted">เวลาตอบ</span>
          ${[10, 15, 20, 30, 60].map(s => `<button type="button" class="chipbtn" data-act="sec" data-s="${s}" aria-pressed="${q.sec === s}">${s} วิ</button>`).join('')}</div>
      </div>
      <div class="acts">${ib('up', 'arrow-up', 'เลื่อนขึ้น', i === 0)}${ib('down', 'arrow-down', 'เลื่อนลง', i === S.quiz.length - 1)}${ib('dup', 'copy', 'ทำสำเนา')}${ib('del', 'trash', 'ลบคำถามนี้')}</div>
    </article>`;
  }).join('');
  counts();
  if (focus) focusAfter(focus);
}

function setKind(k) {
  if (S.title === DEFAULT_TITLE[S.kind === 'vote' ? 'vote' : 'quiz'] || !S.title) S.title = DEFAULT_TITLE[k];
  S.kind = k;
  $('title').value = S.title;
  $('voteStudio').classList.toggle('hide', k !== 'vote');
  $('quizStudio').classList.toggle('hide', k !== 'quiz');
  renderSettings(); save();
}
function renderSettings() {
  const r = document.querySelector(`input[name=hideAt][value="${S.settings.hideAt}"]`); if (r) r.checked = true;
  $('setCeremony').checked = !!S.settings.ceremony; $('setPhoneLive').checked = !!S.settings.phoneLive;
  $('setMusic').checked = S.settings.music !== false; $('setHideText').checked = !!S.settings.hideText;
  document.querySelectorAll('#settingsCard .voteOnly').forEach(e => e.classList.toggle('hide', S.kind !== 'vote'));
  document.querySelectorAll('#settingsCard .quizOnly').forEach(e => e.classList.toggle('hide', S.kind !== 'quiz'));
}
document.querySelectorAll('input[name=hideAt]').forEach(r => r.onchange = () => { S.settings.hideAt = r.value; save(); });
$('setCeremony').onchange = () => { S.settings.ceremony = $('setCeremony').checked; save(); };
$('setPhoneLive').onchange = () => { S.settings.phoneLive = $('setPhoneLive').checked; save(); };
$('setMusic').onchange = () => { S.settings.music = $('setMusic').checked; save(); };
$('setHideText').onchange = () => { S.settings.hideText = $('setHideText').checked; save(); };

function renderAll() {
  renderSettings();
  document.querySelector(`input[name=kind][value=${S.kind}]`).checked = true;
  $('title').value = S.title;
  $('voteStudio').classList.toggle('hide', S.kind !== 'vote');
  $('quizStudio').classList.toggle('hide', S.kind !== 'quiz');
  renderAwards(); renderGroups(); renderQuiz();
}

// ---------- ย้าย / ลบ / ทำสำเนา ในรายการ ----------
function listAction(arr, i, act, make) {
  if (act === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
  else if (act === 'down' && i < arr.length - 1) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
  else if (act === 'dup') arr.splice(i + 1, 0, clone(arr[i]));
  else if (act === 'del') { arr.splice(i, 1); if (!arr.length) arr.push(make()); }
  else return null;
  return act === 'up' ? i - 1 : act === 'down' ? i + 1 : act === 'dup' ? i + 1 : Math.min(i, arr.length - 1);
}

$('awardList').addEventListener('input', e => {
  const f = e.target.dataset.f; if (!f) return;
  const i = +e.target.closest('.acard').dataset.i;
  S.awards[i][f] = f === 'sec' ? clamp(e.target.value, 90) : f === 'max' ? clampMax(e.target.value) : e.target.value; save();
});
$('awardList').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const i = +b.closest('.acard').dataset.i, act = b.dataset.act;
  if (act === 'emo') {
    S.awards[i].title = b.dataset.e + ' ' + S.awards[i].title.replace(LEAD_EMOJI, '');
    renderAwards(`[data-i="${i}"] [data-f=title]`); save(); return;
  }
  const at = listAction(S.awards, i, act, () => ({ title: '', note: '', sec: 90, max: 1 }));
  if (at === null) return;
  renderAwards(`[data-i="${at}"] [data-act="${act === 'del' || act === 'dup' ? 'del' : act}"]:not(:disabled), [data-i="${at}"] [data-f=title]`); save();
});

$('addAward').onclick = () => { S.awards.push({ title: '', note: '', sec: 90, max: 1 }); renderAwards(`[data-i="${S.awards.length - 1}"] [data-f=title]`); save(); };

// ผู้เข้าชิง
function addNames(gi, text) {
  const have = new Set(S.groups.flatMap(g => g.names.map(n => n.toLowerCase())));
  let added = 0;
  text.split(/[\n,\t]+/).map(s => s.trim().slice(0, 40)).filter(Boolean).forEach(n => {
    if (have.has(n.toLowerCase())) return;
    have.add(n.toLowerCase()); S.groups[gi].names.push(n); added++;
  });
  return added;
}
$('groupList').addEventListener('input', e => {
  if (e.target.dataset.f === 'gname') { S.groups[+e.target.closest('.ggroup').dataset.g].name = e.target.value; save(); }
});
$('groupList').addEventListener('keydown', e => {
  if (e.target.dataset.f !== 'gadd' || (e.key !== 'Enter' && e.key !== ',')) return;
  e.preventDefault();
  const gi = +e.target.closest('.ggroup').dataset.g;
  if (addNames(gi, e.target.value)) { renderGroups(`[data-g="${gi}"] [data-f=gadd]`); save(); } else e.target.value = '';
});
$('groupList').addEventListener('paste', e => {
  if (e.target.dataset.f !== 'gadd') return;
  const text = e.clipboardData.getData('text');
  if (!/[\n,\t]/.test(text)) return;
  e.preventDefault();
  const gi = +e.target.closest('.ggroup').dataset.g;
  addNames(gi, text); renderGroups(`[data-g="${gi}"] [data-f=gadd]`); save();
});
$('groupList').addEventListener('focusout', e => {
  if (e.target.dataset.f !== 'gadd' || !e.target.value.trim()) return;
  const gi = +e.target.closest('.ggroup').dataset.g;
  addNames(gi, e.target.value); renderGroups(); save();
});
$('groupList').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const gi = +b.closest('.ggroup').dataset.g;
  if (b.dataset.act === 'ndel') { S.groups[gi].names.splice(+b.dataset.n, 1); renderGroups(`[data-g="${gi}"] [data-f=gadd]`); save(); }
  if (b.dataset.act === 'gdel') {
    S.groups.splice(gi, 1); if (!S.groups.length) S.groups.push({ name: '', names: [] });
    renderGroups(); save();
  }
});
$('addGroup').onclick = () => { S.groups.push({ name: '', names: [] }); renderGroups(`[data-g="${S.groups.length - 1}"] [data-f=gname]`); save(); };

// คำถามควิซ
$('quizList').addEventListener('input', e => {
  const f = e.target.dataset.f; if (!f) return;
  const q = S.quiz[+e.target.closest('.qcard').dataset.i];
  if (f === 'prompt') q.prompt = e.target.value; else if (f === 'ch') q.choices[+e.target.dataset.k] = e.target.value;
  save();
});
$('quizList').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const i = +b.closest('.qcard').dataset.i, act = b.dataset.act, q = S.quiz[i];
  if (act === 'chadd') {
    if (q.choices.length < MAXCH) { q.choices.push(''); renderQuiz(`[data-i="${i}"] [data-f=ch][data-k="${q.choices.length - 1}"]`); save(); }
    return;
  }
  if (act === 'chdel') {
    const k = +b.dataset.k; q.choices.splice(k, 1);
    if (q.correct === k) q.correct = -1; else if (q.correct > k) q.correct--;
    renderQuiz(`[data-i="${i}"] [data-act=chadd]`); save(); return;
  }
  if (act === 'correct') { q.correct = +b.dataset.k; renderQuiz(`[data-i="${i}"] [data-act=correct][data-k="${b.dataset.k}"]`); save(); return; }
  if (act === 'sec') { q.sec = +b.dataset.s; renderQuiz(`[data-i="${i}"] [data-act=sec][data-s="${b.dataset.s}"]`); save(); return; }
  const at = listAction(S.quiz, i, act, () => ({ prompt: '', choices: ['', '', '', ''], correct: -1, sec: 20 }));
  if (at === null) return;
  renderQuiz(`[data-i="${at}"] [data-f=prompt]`); save();
});
$('addQuiz').onclick = () => { S.quiz.push({ prompt: '', choices: ['', '', '', ''], correct: -1, sec: 20 }); renderQuiz(`[data-i="${S.quiz.length - 1}"] [data-f=prompt]`); save(); };

$('title').addEventListener('input', () => { S.title = $('title').value; save(); });
document.querySelectorAll('input[name=kind]').forEach(r => r.onchange = () => setKind(r.value));

// ---------- เมนูนำเข้า / ส่งออก ----------
const closeMenu = () => { $('importMenu').open = false; };
document.addEventListener('click', e => { if (!e.target.closest('#importMenu')) closeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

$('btnSample').onclick = () => { closeMenu(); const s = clone(SAMPLE); if (S.kind === 'vote') { S.awards = s.awards; S.groups = s.groups; } else S.quiz = s.quiz; renderAll(); save(); };
$('btnClear').onclick = async () => {
  closeMenu(); if (!(await UI.confirm('ล้างข้อมูลทั้งหมดของโหมดนี้ใช่ไหม', 'ล้างทั้งหมด'))) return;
  if (S.kind === 'vote') { S.awards = [{ title: '', note: '', sec: 90, max: 1 }]; S.groups = [{ name: '', names: [] }]; }
  else S.quiz = [{ prompt: '', choices: ['', '', '', ''], correct: -1, sec: 20 }];
  renderAll(); save();
};

$('btnPaste').onclick = () => {
  closeMenu();
  const vote = S.kind === 'vote';
  $('pasteVote').classList.toggle('hide', !vote); $('pasteQuiz').classList.toggle('hide', vote);
  $('pasteMsg').textContent = '';
  if (vote) {
    $('pasteAwards').value = tsv(S.awards.map(a => [a.title, a.note, a.sec, clampMax(a.max)]));
    $('pasteNominees').value = tsv(S.groups.flatMap(g => g.names.map(n => [n, g.name])));
  } else $('pasteQs').value = tsv(S.quiz.map(q => [q.prompt, ...q.choices, q.correct >= 0 ? LETTERS[q.correct] : '', q.sec]));
  $('pasteDlg').showModal();
};
$('pasteGo').onclick = e => {
  e.preventDefault();
  if (S.kind === 'vote') {
    const aw = awardsFromRows(parseRows($('pasteAwards').value)), gr = groupsFromRows(parseRows($('pasteNominees').value));
    if (!aw.length || !gr.length) return void ($('pasteMsg').textContent = 'ต้องมีทั้งรางวัลและผู้เข้าชิงอย่างน้อยอย่างละ 1 รายการ');
    S.awards = aw; S.groups = gr;
  } else {
    const qs = quizFromRows(parseRows($('pasteQs').value));
    if (!qs.length) return void ($('pasteMsg').textContent = 'ไม่พบแถวที่ใช้ได้ แต่ละแถวต้องมีคำถาม ตัวเลือก และข้อที่ถูก (ก ข ค ง)');
    S.quiz = qs;
  }
  renderAll(); save(); $('pasteDlg').close();
};

$('btnSheet').onclick = () => {
  closeMenu();
  try { $('sheetUrl').value = localStorage.getItem('quiz-sheet-url') || ''; $('sheetCode').value = localStorage.getItem('quiz-sheet-code') || ''; } catch (e) {}
  $('sheetMsg').textContent = ''; $('sheetDlg').showModal();
};
$('loadSheetBtn').onclick = async e => {
  e.preventDefault();
  const url = $('sheetUrl').value.trim(), code = $('sheetCode').value.trim(), msg = t => $('sheetMsg').textContent = t;
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) return msg('ลิงก์ต้องเป็นรูปแบบ https://script.google.com/macros/s/.../exec');
  msg('กำลังโหลด...');
  try {
    const j = await (await fetch(url + '?code=' + encodeURIComponent(code))).json();
    if (j.error) return msg('ชีตตอบกลับว่า: ' + j.error);
    if (S.kind === 'vote') {
      const aw = awardsFromRows(j.awards || []), gr = groupsFromRows(j.nominees || []);
      if (!aw.length || !gr.length) return msg('ชีตยังไม่มีข้อมูลในแท็บ Awards หรือ Nominees');
      S.awards = aw; S.groups = gr; msg(`โหลดแล้ว: ${aw.length} รางวัล ${gr.reduce((n, g) => n + g.names.length, 0)} ผู้เข้าชิง`);
    } else {
      const qs = quizFromRows(j.quiz || []);
      if (!qs.length) return msg('ชีตยังไม่มีข้อมูลในแท็บ Quiz');
      S.quiz = qs; msg(`โหลดแล้ว: ${qs.length} ข้อ`);
    }
    try { localStorage.setItem('quiz-sheet-url', url); localStorage.setItem('quiz-sheet-code', code); } catch (err) {}
    renderAll(); save();
  } catch (err) { msg('โหลดไม่สำเร็จ ตรวจว่าเปิดเว็บแอปเป็น "ทุกคน" และมีฟังก์ชัน doGet แล้ว'); }
};

$('btnExport').onclick = () => {
  closeMenu();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ v: 1, ...S }, null, 2)], { type: 'application/json' }));
  a.download = 'เกมของฉัน.json'; a.click();
};
$('btnImport').onclick = () => { closeMenu(); $('fileIn').click(); };
$('fileIn').onchange = async () => {
  const f = $('fileIn').files[0]; $('fileIn').value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!Array.isArray(d.awards) || !Array.isArray(d.groups) || !Array.isArray(d.quiz)) throw new Error('bad');
    S = { kind: d.kind === 'quiz' ? 'quiz' : 'vote', title: String(d.title || ''), awards: d.awards, groups: d.groups, quiz: d.quiz, settings: { ...DEFAULT_SET, ...(d.settings || {}) } };
    renderAll(); save();
  } catch (e) { $('setupErr').textContent = 'ไฟล์นี้ไม่ใช่ไฟล์เกมที่บันทึกจากสตูดิโอนี้'; }
};

// ---------- ตรวจและแปลงเป็นข้อมูลสำหรับสร้างเกม ----------
function build() {
  const title = S.title.trim() || DEFAULT_TITLE[S.kind];
  if (S.kind === 'vote') {
    const awards = S.awards.filter(a => a.title.trim());
    if (!awards.length) return { error: 'ใส่ชื่อรางวัลอย่างน้อย 1 รางวัลก่อนนะ', focus: '#awardList [data-f=title]' };
    const choices = [], groups = [];
    S.groups.forEach(g => g.names.forEach(n => { choices.push(n); groups.push(g.name.trim()); }));
    if (choices.length < 2) return { error: 'ใส่ผู้เข้าชิงอย่างน้อย 2 คนก่อนนะ', focus: '#groupList [data-f=gadd]' };
    return { kind: 'vote', title, settings: { ...S.settings }, questions: awards.map(a => ({
      prompt: a.title.trim().replace(/^\d+[.)]\s*/, ''), note: a.note.trim(), choices, groups, duration: clamp(a.sec, 90), max_votes: Math.min(clampMax(a.max), choices.length) })) };
  }
  const out = [];
  for (let i = 0; i < S.quiz.length; i++) {
    const q = S.quiz[i], ch = q.choices.map(c => c.trim()), n = i + 1;
    while (ch.length > 2 && !ch[ch.length - 1]) ch.pop();                          // ตัดช่องว่างท้ายทิ้ง
    if (!q.prompt.trim() && ch.every(c => !c) && S.quiz.length > 1) continue;     // ข้อว่างที่เผลอเพิ่มไว้
    if (!q.prompt.trim()) return { error: `ข้อ ${n} ยังไม่มีคำถาม`, focus: `#quizList [data-i="${i}"] [data-f=prompt]` };
    if (ch.filter(Boolean).length < 2) return { error: `ข้อ ${n} ต้องมีตัวเลือกอย่างน้อย 2 ข้อ`, focus: `#quizList [data-i="${i}"] [data-f=ch]` };
    if (q.correct < 0 || !ch[q.correct]) return { error: `ข้อ ${n} ยังไม่ได้เลือกข้อที่ถูก (กดปุ่มเครื่องหมายถูกที่ตัวเลือกที่ถูก)`, focus: `#quizList [data-i="${i}"] [data-act=correct]` };
    out.push({ prompt: q.prompt.trim(), choices: ch, correct: q.correct, duration: clamp(q.sec, 20), groups: S.settings.hideText ? { hideText: true } : null });
  }
  if (!out.length) return { error: 'ใส่คำถามอย่างน้อย 1 ข้อก่อนนะ', focus: '#quizList [data-f=prompt]' };
  return { kind: 'quiz', title, questions: out, settings: { ...S.settings } };
}

renderAll();
window.Studio = { build, kind: () => S.kind };
