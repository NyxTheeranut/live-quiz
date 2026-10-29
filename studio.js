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
const DEFAULT_SET = { hideAt: '50', ceremony: true, phoneLive: false, music: true, hideText: false, preview: true, viewStyle: 'bars', fogKind: 'mock' };

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
const save = () => { updateSettingsSummary(); clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(S)); } catch (e) {} saveToLibrary(); }, 300); };

// ---------- ชุดของฉัน: หลายชุดในเบราว์เซอร์เดียวกัน (ควิซวันศุกร์ ควิซวันจันทร์ ...) แก้ชุดไหนก็บันทึกเข้าชุดนั้นเอง ----------
const LIB_KEY = 'quiz-sets';
const readLib = () => { try { const l = JSON.parse(localStorage.getItem(LIB_KEY)); return l && typeof l === 'object' ? l : {}; } catch (e) { return {}; } };
const newSetId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
function saveToLibrary() {
  try {
    if (!S.setId) S.setId = newSetId();
    const lib = readLib(); lib[S.setId] = { id: S.setId, updated: Date.now(), data: clone(S) };
    localStorage.setItem(LIB_KEY, JSON.stringify(lib)); localStorage.setItem(DRAFT_KEY, JSON.stringify(S));
  } catch (e) {}
}
function blankSet(kind) {
  const base = { kind, title: DEFAULT_TITLE[kind], settings: { ...DEFAULT_SET } };
  return { ...base, awards: [{ title: '', note: '', sec: 90, max: 1 }], groups: [{ name: '', names: [] }], quiz: [{ prompt: '', choices: ['', '', '', ''], correct: -1, sec: 20 }] };
}
const setCount = d => d.kind === 'quiz' ? `${(d.quiz || []).filter(q => q.prompt && q.prompt.trim()).length} ข้อ` : `${(d.awards || []).filter(a => a.title && a.title.trim()).length} รางวัล`;
function renderSets() {
  const lib = readLib(), items = Object.values(lib).sort((a, b) => b.updated - a.updated);
  $('setsList').innerHTML = items.length ? items.map(it => {
    const d = it.data, cur = it.id === S.setId, when = new Date(it.updated).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `<li class="librow${cur ? ' cur' : ''}" data-id="${esc(it.id)}">
      <div class="si"><b>${esc(d.title || DEFAULT_TITLE[d.kind])}</b><span>${d.kind === 'quiz' ? 'ควิซ' : 'โหวตรางวัล'} · ${setCount(d)} · แก้ล่าสุด ${esc(when)}</span></div>
      <div class="sa">${cur ? '<span class="chip">กำลังแก้ไข</span>' : '<button type="button" class="btn small" data-act="open">เปิด</button>'}
        <button type="button" class="iconbtn" data-act="copy" aria-label="ทำสำเนาชุดนี้"><i class="ph-bold ph-copy" aria-hidden="true"></i></button>
        <button type="button" class="iconbtn" data-act="del" aria-label="ลบชุดนี้"><i class="ph-bold ph-trash" aria-hidden="true"></i></button></div></li>`;
  }).join('') : '<li class="muted">ยังไม่มีชุดที่บันทึกไว้</li>';
}
function loadSet(d, id) { S = { ...clone(d), settings: { ...DEFAULT_SET, ...(d.settings || {}) }, setId: id }; renderAll(); save(); }

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
        ${q.topic !== undefined
          ? `<div class="topicrow"><i class="ph-fill ph-flag-banner" aria-hidden="true"></i><input type="text" data-f="topic" maxlength="40" value="${esc(q.topic)}" aria-label="ชื่อหัวข้อ" placeholder="ชื่อหัวข้อ เช่น ภูมิศาสตร์ (ข้อต่อ ๆ ไปอยู่ในหัวข้อนี้จนกว่าจะเริ่มหัวข้อใหม่)"><button type="button" class="iconbtn" data-act="topicdel" aria-label="ยกเลิกหัวข้อนี้"><i class="ph-bold ph-x" aria-hidden="true"></i></button></div>`
          : `<button type="button" class="addtopic" data-act="topicadd"><i class="ph-bold ph-flag-banner" aria-hidden="true"></i>เริ่มหัวข้อใหม่ตรงนี้</button>`}
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
  const fk = document.querySelector(`input[name=fogKind][value="${S.settings.fogKind || 'mock'}"]`); if (fk) fk.checked = true;
  const vs = document.querySelector(`input[name=viewStyle][value="${S.settings.viewStyle || 'bars'}"]`); if (vs) vs.checked = true;
  $('setPreview').checked = S.settings.preview !== false; $('setMusic').checked = S.settings.music !== false; $('setHideText').checked = !!S.settings.hideText;
  document.querySelectorAll('#settingsCard .voteOnly').forEach(e => e.classList.toggle('hide', S.kind !== 'vote'));
  document.querySelectorAll('#settingsCard .quizOnly').forEach(e => e.classList.toggle('hide', S.kind !== 'quiz'));
  updateSettingsSummary();
}
document.querySelectorAll('input[name=hideAt]').forEach(r => r.onchange = () => { S.settings.hideAt = r.value; save(); });
$('setCeremony').onchange = () => { S.settings.ceremony = $('setCeremony').checked; save(); };
$('setPhoneLive').onchange = () => { S.settings.phoneLive = $('setPhoneLive').checked; save(); };
document.querySelectorAll('input[name=fogKind]').forEach(r => r.onchange = () => { S.settings.fogKind = r.value; save(); });
document.querySelectorAll('input[name=viewStyle]').forEach(r => r.onchange = () => { S.settings.viewStyle = r.value; save(); });
$('setMusic').onchange = () => { S.settings.music = $('setMusic').checked; save(); };
$('setPreview').onchange = () => { S.settings.preview = $('setPreview').checked; save(); };
$('setHideText').onchange = () => { S.settings.hideText = $('setHideText').checked; save(); };

// สรุปค่าที่ตั้งไว้ในบรรทัดเดียว (โชว์ตอนพับเก็บ)
function settingsSummary() {
  const c = S.settings, on = [];
  const hide = c.hideAt === 'off' ? 'ไม่ซ่อนอันดับ' : c.hideAt === '0' ? 'ซ่อนอันดับตั้งแต่เริ่ม' : `ซ่อนอันดับที่ ${c.hideAt}%`;
  if (S.kind === 'vote') {
    on.push(hide);
    if (c.hideAt !== 'off') on.push(c.fogKind === 'censor' ? 'เห็นคะแนนแต่เบลอชื่อ' : 'กราฟปลอมขยับให้ลุ้น');
    on.push(c.viewStyle === 'cloud' ? 'แสดงเป็นกลุ่มคำ' : 'แสดงเป็นกราฟแท่ง');
    if (c.ceremony) on.push('พิธีรับรางวัล');
    if (c.phoneLive) on.push('ผู้เล่นเห็นอันดับสด');
  } else if (c.hideText) on.push('มือถือเห็นแค่สีกับรูปร่าง');
  on.push(c.preview !== false ? 'แสดงโจทย์ก่อน' : 'เริ่มทันที');
  on.push(c.music !== false ? 'เปิดเพลง' : 'ปิดเพลง');
  return on.join(', ');
}
function updateSettingsSummary() { $('settingsSummary').textContent = settingsSummary(); }
try { if (localStorage.getItem('quiz-settings-open') === '0') $('settingsCard').open = false; } catch (e) {}
$('settingsCard').addEventListener('toggle', () => { try { localStorage.setItem('quiz-settings-open', $('settingsCard').open ? '1' : '0'); } catch (e) {} });

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
  if (f === 'prompt') q.prompt = e.target.value; else if (f === 'topic') q.topic = e.target.value; else if (f === 'ch') q.choices[+e.target.dataset.k] = e.target.value;
  save();
});
$('quizList').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const i = +b.closest('.qcard').dataset.i, act = b.dataset.act, q = S.quiz[i];
  if (act === 'topicadd') { q.topic = ''; renderQuiz(`[data-i="${i}"] [data-f=topic]`); save(); return; }
  if (act === 'topicdel') { delete q.topic; renderQuiz(`[data-i="${i}"] [data-act=topicadd]`); save(); return; }
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
  if (act === 'dup') delete S.quiz[at].topic;                      // สำเนาไม่ต้องเริ่มหัวข้อใหม่ซ้ำ
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

$('btnSets').onclick = () => { saveToLibrary(); renderSets(); $('setsDlg').showModal(); };
$('setsClose').onclick = () => $('setsDlg').close();
$('setNew').onclick = () => { saveToLibrary(); loadSet(blankSet(S.kind), undefined); $('setsDlg').close(); focusAfter('#title'); };
$('setsList').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const id = b.closest('.librow').dataset.id, lib = readLib(), it = lib[id]; if (!it) return;
  if (b.dataset.act === 'open') { saveToLibrary(); loadSet(it.data, id); $('setsDlg').close(); }
  else if (b.dataset.act === 'copy') {
    const nid = newSetId(), d = clone(it.data); d.title = (d.title || DEFAULT_TITLE[d.kind]) + ' (สำเนา)'; d.setId = nid;
    lib[nid] = { id: nid, updated: Date.now(), data: d }; localStorage.setItem(LIB_KEY, JSON.stringify(lib)); renderSets();
  } else if (b.dataset.act === 'del') {
    if (!(await UI.confirm(`ลบชุด "${it.data.title || DEFAULT_TITLE[it.data.kind]}" ใช่ไหม`, 'ลบชุดนี้'))) return;
    delete lib[id]; localStorage.setItem(LIB_KEY, JSON.stringify(lib));
    if (id === S.setId) { S.setId = undefined; loadSet(blankSet(S.kind), undefined); }
    renderSets();
  }
});

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
    S = { setId: undefined, kind: d.kind === 'quiz' ? 'quiz' : 'vote', title: String(d.title || ''), awards: d.awards, groups: d.groups, quiz: d.quiz, settings: { ...DEFAULT_SET, ...(d.settings || {}) } };
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
    out.push({ prompt: q.prompt.trim(), choices: ch, correct: q.correct, duration: clamp(q.sec, 20), groups: (S.settings.hideText || (q.topic || '').trim()) ? { ...(S.settings.hideText ? { hideText: true } : {}), ...((q.topic || '').trim() ? { topic: q.topic.trim() } : {}) } : null });
  }
  if (!out.length) return { error: 'ใส่คำถามอย่างน้อย 1 ข้อก่อนนะ', focus: '#quizList [data-f=prompt]' };
  return { kind: 'quiz', title, questions: out, settings: { ...S.settings } };
}

// ---------- วางทั้งหมดทีเดียว: วางหรือพิมพ์เป็นข้อความธรรมดา ระบบแยกให้เองว่าอันไหนรางวัล ผู้เข้าชิง หรือคำถาม ----------
const HDR = {
  awards: /^(?:#+\s*)?(?:รางวัล|awards?)\s*[:：]?$/i,
  nominees: /^(?:#+\s*)?(?:ผู้เข้าชิง|รายชื่อ|nominees?|names?)\s*[:：]?$/i,
  quiz: /^(?:#+\s*)?(?:ควิซ|คำถาม|quiz|questions?)\s*[:：]?$/i
};
const stripNo = x => x.replace(/^\d+[.)]\s*/, '');
const splitNames = x => x.split(/[,、\t]/).map(n => stripNo(n.trim()).slice(0, 40)).filter(Boolean);

function parseAwardLine(raw) {
  const l = stripNo(raw.trim());
  let f;
  if (l.includes('|')) f = l.split('|');
  else if (l.includes('\t')) f = l.split('\t');
  else { const i = l.indexOf(' - '); f = i > 0 ? [l.slice(0, i), l.slice(i + 3)] : [l]; }
  f = f.map(x => x.trim());
  return { title: f[0].slice(0, 60), note: (f[1] || '').slice(0, 90), sec: clamp(f[2], 90), max: clampMax(f[3]) };
}
function bulkParseVote(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim());
  const awards = [], groups = new Map(), seen = new Set();
  const hasHeader = lines.some(l => HDR.awards.test(l) || HDR.nominees.test(l));
  let mode = hasHeader ? null : (lines.some(l => /[|\t]| - /.test(l)) ? 'awards' : 'nominees'), cur = '';
  const add = (g, names) => names.forEach(n => {
    if (seen.has(n.toLowerCase())) return; seen.add(n.toLowerCase());
    if (!groups.has(g)) groups.set(g, []); groups.get(g).push(n);
  });
  for (const l of lines) {
    if (!l) continue;
    if (HDR.awards.test(l)) { mode = 'awards'; continue; }
    if (HDR.nominees.test(l)) { mode = 'nominees'; cur = ''; continue; }
    if (HDR.quiz.test(l)) { mode = 'skip'; continue; }
    if (mode === 'awards') {
      const a = parseAwardLine(l), head = a.title.replace(/^[^\p{L}\p{N}]+/u, '').trim();
      if (a.title && !/^(?:ชื่อ)?รางวัล$|^awards?$/i.test(head)) awards.push(a);          // ข้ามแถวหัวตาราง
    }
    else if (mode === 'nominees') {
      const c = l.search(/[:：]/);
      if (c > 0) {                                                  // ทีมขาย: ก้อง, มิ้นท์   หรือ  ทีมขาย:  (แล้วตามด้วยชื่อทีละบรรทัด)
        const g = l.slice(0, c).trim().slice(0, 30), rest = l.slice(c + 1).trim();
        if (rest) add(g, splitNames(rest)); else cur = g;
      } else if (l.includes('\t')) { const p = l.split('\t'); add((p[1] || '').trim().slice(0, 30), splitNames(p[0])); }   // ชื่อ <แท็บ> กลุ่ม (คัดลอกจากชีต)
      else add(cur, splitNames(l));
    }
  }
  return { awards, groups: [...groups].map(([name, names]) => ({ name, names })) };
}

function quizBlock(b) {
  let sec = 20; const rest = [];
  for (const l of b) {
    const m = l.match(/^(?:เวลา|time)\s*[:：]?\s*(\d+)/i) || l.match(/^\[?\s*(\d+)\s*(?:วินาที|วิ|s)\s*\]?$/i);
    if (m) { sec = clamp(m[1], 20); continue; }
    rest.push(l);
  }
  if (rest.length < 3) return null;
  const prompt = rest[0].replace(/^(?:ข้อ\s*\d+\s*[.:)]?|\d+\s*[.)]|q\s*[:.]?)\s*/i, '').slice(0, 140);
  let correct = -1; const choices = [];
  rest.slice(1, 1 + MAXCH).forEach(l => {
    let c = l, ok = false;
    if (/^[*✓✔]\s*/.test(c)) { ok = true; c = c.replace(/^[*✓✔]\s*/, ''); }
    else if (/\s*[*✓✔]$/.test(c)) { ok = true; c = c.replace(/\s*[*✓✔]$/, ''); }
    c = c.replace(/^(?:[A-Ha-h]|[กขคงจฉชซ])[.)]\s*/, '').slice(0, 60);
    if (ok) correct = choices.length;
    choices.push(c);
  });
  return prompt && choices.length >= 2 ? { prompt, choices, correct, sec } : null;
}
function bulkParseQuiz(text) {
  const lines = text.split(/\r?\n/), nonEmpty = lines.filter(l => l.trim());
  if (nonEmpty.length && nonEmpty.filter(l => (l.match(/\t/g) || []).length >= 4).length >= nonEmpty.length / 2) return quizFromRows(parseRows(text));   // แถวที่คัดลอกจากชีต
  const out = []; let block = [], topic = null;
  const flush = () => { if (block.length) { const q = quizBlock(block); if (q) { if (topic !== null) { q.topic = topic; topic = null; } out.push(q); } } block = []; };
  for (const raw of lines) {
    const l = raw.trim(); if (HDR.quiz.test(l)) continue;
    const t = !block.length && l.match(/^(?:#+\s*|หัวข้อ(?:ที่\s*\d+)?\s*[:：]\s*)(.+)$/);   // # ชื่อหัวข้อ  ก่อนข้อแรกของหัวข้อนั้น
    if (t) topic = t[1].trim().slice(0, 40); else if (!l) flush(); else block.push(l);
  }
  flush();
  return out;
}

// colour each position of the example (k1.. match the legend); textContent stays identical to the plain example
function paintExample(kind, text) {
  const sp = (c, s) => `<span class="${c}">${esc(s)}</span>`;
  let mode = '';
  return text.split('\n').map(l => {
    if (kind === 'quiz') {
      if (!l.trim()) { mode = ''; return ''; }
      if (/^#/.test(l)) return sp('k5', l);
      if (/^เวลา\s/.test(l)) return sp('k3', l);
      if (/^\*/.test(l)) return sp('k4', l);
      const first = mode !== 'q'; mode = 'q';
      return sp(first ? 'k1' : 'k2', l);
    }
    if (/^(รางวัล|ผู้เข้าชิง)$/.test(l)) { mode = l; return `<b class="hd">${esc(l)}</b>`; }
    if (!l.trim()) return '';
    if (mode === 'รางวัล') return l.split(' | ').map((p, n) => sp('k' + (n + 1), p)).join(' | ');
    const m = l.match(/^([^:]+): (.*)$/);
    return m ? sp('k5', m[1]) + ': ' + sp('k6', m[2]) : sp('k6', l);
  }).join('\n');
}
const BULK = {
  vote: {
    hint: 'พิมพ์หรือวางทีเดียวทั้งหมด ใช้หัวข้อ "รางวัล" กับ "ผู้เข้าชิง" แล้วตามด้วยรายการ ระบบแยกให้เอง',
    example: `รางวัล
😭 ขี้แงแห่งปี | น้ำตาไหลง่ายกว่าน้ำประปา
🗣️ ปากแจ๋วแห่งปี | เรื่องเมาท์ไม่เคยพัก | 60 | 3
👑 เจ้าแม่ดราม่า | เรื่องเล่า 1 นาที ขยายได้ 3 ชั่วโมง

ผู้เข้าชิง
ทีมขาย: ก้อง, มิ้นท์, บอล
ทีมซัพพอร์ต: ปอ, แพรว, เจมส์
พี่ต้น`,
    legend: [
      ['k1', 'ชื่อรางวัล', 'ใส่อีโมจิหน้าชื่อได้'],
      ['k2', 'คำจำกัดความ', 'อธิบายว่ารางวัลนี้ให้ใคร'],
      ['k3', 'วินาที', 'เวลาโหวต (ไม่บังคับ)'],
      ['k4', 'โหวตได้กี่คน', '(ไม่บังคับ)'],
      ['k5', 'ชื่อทีม', 'ก่อนเครื่องหมาย :'],
      ['k6', 'รายชื่อคน', 'คั่นด้วยคอมมา ไม่มีทีมพิมพ์ชื่อเดียวได้']
    ],
    why: 'ใช้ | คั่น เพราะชื่อรางวัลและคำอธิบายมีเว้นวรรคกับคอมมา ถ้าคั่นด้วยอย่างอื่นระบบจะตัดผิดที่ หัวข้อ รางวัล / ผู้เข้าชิง บอกระบบว่าบรรทัดข้างล่างคืออะไร จึงวางครั้งเดียวได้ทั้งหมด',
    ai: `ช่วยจัดข้อมูลของฉันให้อยู่ในรูปแบบข้อความด้านล่างนี้ ตอบเฉพาะข้อความที่จัดแล้ว ไม่ต้องอธิบายเพิ่ม

รูปแบบ:
รางวัล
<อีโมจิ> <ชื่อรางวัล> | <คำจำกัดความสั้น ๆ>
(หนึ่งรางวัลต่อหนึ่งบรรทัด)

ผู้เข้าชิง
<ชื่อทีม>: <ชื่อ>, <ชื่อ>, <ชื่อ>
(หนึ่งทีมต่อหนึ่งบรรทัด)

ข้อมูลของฉัน:
(วางรายชื่อรางวัลและรายชื่อคนที่นี่)`
  },
  quiz: {
    hint: 'แต่ละข้อคือกลุ่มบรรทัดที่ติดกัน บรรทัดแรกคือคำถาม บรรทัดต่อไปคือตัวเลือก ใส่ * หน้าข้อที่ถูก เว้นบรรทัดก่อนข้อถัดไป',
    example: `# ภูมิศาสตร์
เมืองหลวงของประเทศไทยคือเมืองอะไร
*กรุงเทพ
เชียงใหม่
ภูเก็ต
ขอนแก่น

# คณิตศาสตร์
2 ชั่วโมงเท่ากับกี่นาที
60
90
*120
240
เวลา 30`,
    legend: [
      ['k5', 'หัวข้อ (ไม่บังคับ)', 'ขึ้นต้นด้วย # ข้อต่อ ๆ ไปอยู่หัวข้อนี้'],
      ['k1', 'คำถาม', 'บรรทัดแรกของแต่ละข้อ'],
      ['k2', 'ตัวเลือก', '2 ถึง 8 ข้อ ข้อละบรรทัด'],
      ['k4', 'ข้อที่ถูก', 'ใส่ * นำหน้า'],
      ['k3', 'เวลา', 'ไม่ใส่ = 20 วินาที']
    ],
    why: 'อยากแบ่งเป็นหลายหัวข้อในเกมเดียว ใส่ # ชื่อหัวข้อ ก่อนข้อแรกของหัวข้อนั้น คะแนนรวมกันทั้งเกม เว้นหนึ่งบรรทัดระหว่างข้อ เพื่อบอกว่าข้อหนึ่งจบแล้ว ไม่ต้องใส่เลขข้อหรือ ก ข ค ง เพราะบนจอมีสีกับรูปร่างประจำแต่ละตัวเลือกอยู่แล้ว',
    ai: `ช่วยจัดข้อสอบของฉันให้อยู่ในรูปแบบข้อความด้านล่างนี้ ตอบเฉพาะข้อความที่จัดแล้ว ไม่ต้องอธิบายเพิ่ม

รูปแบบ (หนึ่งข้อต่อหนึ่งกลุ่มบรรทัด เว้นหนึ่งบรรทัดว่างระหว่างข้อ):
<คำถาม>
<ตัวเลือก 1>
*<ตัวเลือกที่ถูก ใส่ * นำหน้า>
<ตัวเลือก 3>
<ตัวเลือก 4>
เวลา <วินาที ถ้ามี>

ข้อสอบของฉัน:
(วางคำถามและตัวเลือกที่นี่)`
  }
};
function bulkParse() { return S.kind === 'vote' ? bulkParseVote($('bulkText').value) : { quiz: bulkParseQuiz($('bulkText').value) }; }
function bulkSerialize() {
  if (S.kind === 'vote') {
    const aw = S.awards.filter(a => a.title.trim()).map(a => {
      const f = [a.title.trim(), (a.note || '').trim()];
      if (a.sec !== 90 || clampMax(a.max) !== 1) f.push(a.sec, clampMax(a.max));
      return f.join(' | ').replace(/( \| )+$/, '');
    });
    const gr = S.groups.filter(g => g.names.length).map(g => (g.name.trim() ? g.name.trim() + ': ' : '') + g.names.join(', '));
    return 'รางวัล\n' + aw.join('\n') + '\n\nผู้เข้าชิง\n' + gr.join('\n');
  }
  return S.quiz.filter(q => q.prompt.trim()).map(q => [...((q.topic || '').trim() ? ['# ' + q.topic.trim()] : []), q.prompt.trim(), ...q.choices.map((c, k) => (q.correct === k ? '*' : '') + c.trim()).filter(x => x.replace('*', '')), ...(q.sec !== 20 ? ['เวลา ' + q.sec] : [])].join('\n')).join('\n\n');
}
function bulkPreviewUpdate() {
  const r = bulkParse(); let msg = '';
  if (S.kind === 'vote') {
    const n = r.groups.reduce((t, g) => t + g.names.length, 0);
    msg = (r.awards.length || n) ? `พบรางวัล ${r.awards.length} รายการ และผู้เข้าชิง ${n} คน ใน ${r.groups.length} กลุ่ม` : 'ยังไม่พบข้อมูลที่ใช้ได้';
  } else {
    const miss = r.quiz.filter(q => q.correct < 0).length;
    msg = r.quiz.length ? `พบคำถาม ${r.quiz.length} ข้อ` + (miss ? ` (${miss} ข้อยังไม่ได้ใส่ * หน้าข้อที่ถูก)` : '') : 'ยังไม่พบข้อมูลที่ใช้ได้';
  }
  $('bulkPreview').textContent = msg; $('bulkErr').textContent = '';
}
function openBulk() {
  const k = S.kind;
  $('bulkTitle').textContent = k === 'vote' ? 'วางรางวัลและผู้เข้าชิงทีเดียว' : 'วางคำถามทั้งหมดทีเดียว';
  $('bulkHint').textContent = BULK[k].hint; $('bulkExample').innerHTML = paintExample(k, BULK[k].example);
  $('bulkLegend').innerHTML = BULK[k].legend.map(([c, h, b]) => `<li><b class="${c}">${esc(h)}</b><span>${esc(b)}</span></li>`).join('');
  $('bulkWhy').textContent = BULK[k].why; $('aiCopy').lastElementChild.textContent = 'คำสั่งให้ AI จัดให้';
  $('exCopy').lastElementChild.textContent = 'คัดลอกตัวอย่าง';
  $('bulkText').value = ''; $('bulkText').placeholder = BULK[k].example;
  document.querySelector('input[name=bulkMode][value=replace]').checked = true;
  bulkPreviewUpdate(); $('bulkDlg').showModal(); $('bulkText').focus();
}
$('bulkText').addEventListener('input', bulkPreviewUpdate);
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; }
    catch (e2) { return false; }
  }
}
$('exCopy').onclick = async () => {
  const lab = $('exCopy').lastElementChild, ok = await copyText(BULK[S.kind].example);
  lab.textContent = ok ? 'คัดลอกแล้ว' : 'คัดลอกไม่ได้ ลองลากคลุมเอง';
  setTimeout(() => { lab.textContent = 'คัดลอกตัวอย่าง'; }, 2200);
};
$('aiCopy').onclick = async () => {
  const lab = $('aiCopy').lastElementChild, ok = await copyText(BULK[S.kind].ai);
  lab.textContent = ok ? 'คัดลอกแล้ว' : 'คัดลอกไม่ได้ ลองลากคลุมเอง';
  setTimeout(() => { lab.textContent = 'คัดลอกคำสั่ง'; }, 2200);
};
$('exUse').onclick = () => { $('bulkText').value = BULK[S.kind].example; bulkPreviewUpdate(); $('bulkText').focus(); };
$('bulkFill').onclick = () => { $('bulkText').value = bulkSerialize(); bulkPreviewUpdate(); };
$('btnBulk').onclick = openBulk;
$('btnBulk2').onclick = () => { closeMenu(); openBulk(); };
$('bulkGo').onclick = e => {
  e.preventDefault();
  const append = document.querySelector('input[name=bulkMode]:checked').value === 'append', r = bulkParse();
  if (S.kind === 'vote') {
    const n = r.groups.reduce((t, g) => t + g.names.length, 0);
    if (!r.awards.length && !n) return void ($('bulkErr').textContent = 'ยังไม่พบข้อมูลที่ใช้ได้ ลองดูตัวอย่างรูปแบบด้านล่างนะ');
    if (r.awards.length) S.awards = append ? S.awards.filter(a => a.title.trim()).concat(r.awards) : r.awards;
    if (n) {
      if (!append) S.groups = r.groups;
      else {
        const have = new Set(S.groups.flatMap(g => g.names.map(x => x.toLowerCase())));
        r.groups.forEach(g => {
          const names = g.names.filter(x => !have.has(x.toLowerCase())); names.forEach(x => have.add(x.toLowerCase()));
          if (!names.length) return;
          const ex = S.groups.find(h => h.name.trim() === g.name.trim());
          if (ex) ex.names.push(...names); else S.groups.push({ name: g.name, names });
        });
        S.groups = S.groups.filter(g => g.name.trim() || g.names.length);
      }
    }
  } else {
    if (!r.quiz.length) return void ($('bulkErr').textContent = 'ยังไม่พบคำถามที่ใช้ได้ ลองดูตัวอย่างรูปแบบด้านล่างนะ');
    S.quiz = append ? S.quiz.filter(q => q.prompt.trim()).concat(r.quiz) : r.quiz;
  }
  renderAll(); save(); $('bulkDlg').close();
  UI.toast(S.kind === 'vote' ? 'นำเข้ารางวัลและผู้เข้าชิงแล้ว' : `นำเข้าคำถาม ${r.quiz.length} ข้อแล้ว`);
};

// เริ่มใหม่ว่างเปล่า (ปุ่มเด่นข้างชื่อกิจกรรม ใช้ฟังก์ชันเดียวกับ "ล้างทั้งหมด" ในเมนู)
$('btnBlank').onclick = $('btnClear').onclick;

// ตัวเลือกอีโมจิต้องลอยเหนือการ์ดข้างล่าง และกดที่อื่นแล้วปิดเอง
$('awardList').addEventListener('toggle', e => { const c = e.target.closest && e.target.closest('.acard'); if (c) c.classList.toggle('raised', e.target.open); }, true);
document.addEventListener('click', e => { if (!e.target.closest('.emo')) document.querySelectorAll('.emo[open]').forEach(d => d.open = false); });

renderAll();
window.Studio = { build, kind: () => S.kind };
