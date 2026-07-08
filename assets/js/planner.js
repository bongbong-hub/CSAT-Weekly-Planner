const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
const SLOT_MIN = 10;
const START_MIN = 6 * 60;
const END_MIN = 26 * 60; // 다음날 02:00 (26시)
const SLOTS = (END_MIN - START_MIN) / SLOT_MIN; // 120
const COLORS = [
  { id: 'none', css: '#FFFFFF' },
  { id: 'yellow', css: 'var(--hl-yellow)' },
  { id: 'mint', css: 'var(--hl-mint)' },
  { id: 'blue', css: 'var(--hl-blue)' },
  { id: 'pink', css: 'var(--hl-pink)' },
  { id: 'purple', css: 'var(--hl-purple)' },
  { id: 'orange', css: 'var(--hl-orange)' },
];
const STORAGE_KEY = 'suneung-planner-v1';
const SUNEUNG_DATE = '2026-11-19'; // 2027학년도 수능 시행일 (교육부 발표)

let state = { weeks: {} };
let saveTimer = null;
let nextId = 1;
let currentWeekStart = mondayOf(new Date());
let draft = null; // {key, blocks} — 이전 주에서 복사된 미저장 시간표

/* ---------- 저장소 어댑터 ----------
   Claude 안에서 열면 window.storage(계정 저장),
   외부에 배포하면 브라우저 localStorage에 저장됩니다. */
const store = (function () {
  if (typeof window.storage !== 'undefined' && window.storage) {
    return {
      async get() {
        try {
          const r = await window.storage.get(STORAGE_KEY);
          return r ? r.value : null;
        } catch (e) {
          return null;
        }
      },
      async set(v) {
        await window.storage.set(STORAGE_KEY, v);
      },
    };
  }
  let mem = null;
  try {
    window.localStorage.getItem(STORAGE_KEY); // 접근 가능 여부 확인
    return {
      async get() {
        return window.localStorage.getItem(STORAGE_KEY);
      },
      async set(v) {
        window.localStorage.setItem(STORAGE_KEY, v);
      },
    };
  } catch (e) {
    return {
      async get() {
        return mem;
      },
      async set(v) {
        mem = v;
      },
    };
  }
})();

/* ---------- 날짜 유틸 ---------- */
function mondayOf(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return dt;
}
function fmtKey(dt) {
  return (
    dt.getFullYear() +
    '-' +
    String(dt.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(dt.getDate()).padStart(2, '0')
  );
}
function addDays(dt, n) {
  const d = new Date(dt);
  d.setDate(d.getDate() + n);
  return d;
}
function fmtShort(dt) {
  return dt.getMonth() + 1 + '/' + dt.getDate();
}
function fmtRange(monday) {
  const sun = addDays(monday, 6);
  return (
    monday.getFullYear() +
    '년 ' +
    (monday.getMonth() + 1) +
    '월 ' +
    monday.getDate() +
    '일 – ' +
    (sun.getMonth() + 1) +
    '월 ' +
    sun.getDate() +
    '일'
  );
}
function currentKey() {
  return fmtKey(currentWeekStart);
}
function slotLabel(slot) {
  const m = START_MIN + slot * SLOT_MIN;
  return (
    String(Math.floor(m / 60)).padStart(2, '0') +
    ':' +
    String(m % 60).padStart(2, '0')
  );
}

/* ---------- 주 데이터 접근 ---------- */
function storedWeek(create) {
  const k = currentKey();
  if (!state.weeks[k] && create) state.weeks[k] = { blocks: [], todos: [] };
  return state.weeks[k] || { blocks: [], todos: [] };
}
function visibleBlocks() {
  if (draft && draft.key === currentKey()) return draft.blocks;
  return storedWeek(false).blocks;
}
/* 복사본(draft)이 있으면 실제 데이터로 확정 */
function materializeDraft() {
  if (!draft || draft.key !== currentKey()) return false;
  const wk = storedWeek(true);
  wk.blocks = draft.blocks;
  draft = null;
  document.getElementById('draftNotice').classList.remove('show');
  return true;
}
/* 이 주가 비어 있고 바로 이전 주에 시간표가 있으면 복사본 생성 */
function maybeCreateDraft() {
  draft = null;
  document.getElementById('draftNotice').classList.remove('show');
  const k = currentKey();
  const stored = state.weeks[k];
  if (stored && (stored.blocks || []).length) return;
  const prevKey = fmtKey(addDays(currentWeekStart, -7));
  const prev = state.weeks[prevKey];
  if (prev && (prev.blocks || []).length) {
    draft = {
      key: k,
      blocks: prev.blocks.map((b) => ({ ...b, id: nextId++ })),
    };
    document.getElementById('draftNotice').classList.add('show');
  }
}

/* ---------- 저장/불러오기 ---------- */
async function load() {
  try {
    const raw = await store.get();
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.weeks) {
        state.weeks = parsed.weeks;
      } else {
        const wk = {
          blocks: [],
          todos: Array.isArray(parsed.todos) ? parsed.todos : [],
        };
        if (Array.isArray(parsed.blocks)) {
          wk.blocks = parsed.blocks;
        } else if (parsed.cells) {
          for (const key in parsed.cells) {
            const [d, h] = key.split('-').map(Number);
            const c = parsed.cells[key];
            const start = (h - 6) * 6;
            if (start >= 0 && start < SLOTS) {
              wk.blocks.push({
                id: nextId++,
                day: d,
                start,
                end: Math.min(start + 6, SLOTS),
                text: c.text || '',
                color: c.color || 'none',
              });
            }
          }
        }
        state.weeks[fmtKey(mondayOf(new Date()))] = wk;
      }
      for (const k in state.weeks) {
        (state.weeks[k].blocks || []).forEach((b) => {
          if (b.id >= nextId) nextId = b.id + 1;
        });
      }
    }
  } catch (e) {
    /* 저장된 데이터 없음 */
  }
  maybeCreateDraft();
  renderAll();
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}
async function save() {
  const st = document.getElementById('status');
  try {
    await store.set(JSON.stringify(state));
    st.textContent = '저장됨 ✓';
    setTimeout(() => {
      st.textContent = '';
    }, 1500);
    return true;
  } catch (e) {
    st.textContent = '저장에 실패했어요. 잠시 후 다시 시도됩니다.';
    setTimeout(scheduleSave, 2000);
    return false;
  }
}

/* ---------- 저장 버튼 ---------- */
document.getElementById('saveBtn').addEventListener('click', async () => {
  materializeDraft();
  renderWeekSelect();
  const ok = await save();
  const btn = document.getElementById('saveBtn');
  if (ok) {
    btn.textContent = '✅ 저장됨';
    setTimeout(() => {
      btn.textContent = '💾 저장';
    }, 1500);
  }
});
document.getElementById('draftKeep').addEventListener('click', () => {
  materializeDraft();
  renderWeekSelect();
  save();
});
document.getElementById('draftClear').addEventListener('click', () => {
  draft = null;
  document.getElementById('draftNotice').classList.remove('show');
  renderBlocks();
});

/* ---------- D-day ---------- */
function renderDday() {
  const target = new Date(SUNEUNG_DATE + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((target - today) / 86400000);
  document.getElementById('ddayNum').textContent =
    diff > 0 ? 'D-' + diff : diff === 0 ? 'D-DAY' : 'D+' + Math.abs(diff);
}

/* ---------- 주 이동 ---------- */
function renderWeekBar() {
  document.getElementById('weekRange').textContent = fmtRange(currentWeekStart);
  const badge = document.getElementById('weekBadge');
  const diffWeeks = Math.round(
    (currentWeekStart - mondayOf(new Date())) / (7 * 86400000),
  );
  badge.className = 'week-badge';
  if (diffWeeks === 0) {
    badge.textContent = '이번 주';
  } else if (diffWeeks < 0) {
    badge.textContent = Math.abs(diffWeeks) + '주 전';
    badge.classList.add('past');
  } else {
    badge.textContent = diffWeeks + '주 후';
    badge.classList.add('future');
  }
  renderWeekSelect();
  renderDayHeader();
}
function renderWeekSelect() {
  const sel = document.getElementById('weekSelect');
  const keys = Object.keys(state.weeks)
    .filter(
      (k) =>
        (state.weeks[k].blocks || []).length ||
        (state.weeks[k].todos || []).length,
    )
    .sort()
    .reverse();
  sel.innerHTML = '<option value="">📁 보관된 주 보기</option>';
  const thisKey = fmtKey(mondayOf(new Date()));
  keys.forEach((k) => {
    const mon = new Date(k + 'T00:00:00');
    sel.add(new Option(fmtRange(mon) + (k === thisKey ? ' (이번 주)' : ''), k));
  });
}
function goToWeek(monday) {
  currentWeekStart = mondayOf(monday);
  maybeCreateDraft();
  renderWeekBar();
  renderBlocks();
  renderTodos();
}
document
  .getElementById('prevWeek')
  .addEventListener('click', () => goToWeek(addDays(currentWeekStart, -7)));
document
  .getElementById('nextWeek')
  .addEventListener('click', () => goToWeek(addDays(currentWeekStart, 7)));
document
  .getElementById('goToday')
  .addEventListener('click', () => goToWeek(new Date()));
document.getElementById('weekSelect').addEventListener('change', (e) => {
  if (e.target.value) {
    goToWeek(new Date(e.target.value + 'T00:00:00'));
    e.target.value = '';
  }
});

/* ---------- 그리드 ---------- */
function renderDayHeader() {
  const header = document.getElementById('dayHeader');
  const todayKey = fmtKey(new Date(new Date().setHours(0, 0, 0, 0)));
  let html = '<div>시간</div>';
  for (let i = 0; i < 7; i++) {
    const date = addDays(currentWeekStart, i);
    const cls = [];
    if (i === 5) cls.push('sat');
    if (i === 6) cls.push('sun');
    if (fmtKey(date) === todayKey) cls.push('today-col');
    html +=
      '<div class="' +
      cls.join(' ') +
      '">' +
      DAYS[i] +
      '<small>' +
      fmtShort(date) +
      '</small></div>';
  }
  header.innerHTML = html;
}
function buildGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  const timeCol = document.createElement('div');
  timeCol.className = 'time-col';
  for (let s = 0; s <= SLOTS; s += 6) {
    const lb = document.createElement('div');
    lb.className = 'time-label';
    lb.style.top = (s / SLOTS) * 100 + '%';
    lb.textContent = slotLabel(s);
    timeCol.appendChild(lb);
  }
  grid.appendChild(timeCol);
  for (let d = 0; d < 7; d++) {
    const col = document.createElement('div');
    col.className = 'day-col';
    col.dataset.day = d;
    for (let s = 0; s <= SLOTS; s += 3) {
      const line = document.createElement('div');
      line.className = 'hline ' + (s % 6 === 0 ? 'hour' : 'half');
      line.style.top = (s / SLOTS) * 100 + '%';
      col.appendChild(line);
    }
    const sel = document.createElement('div');
    sel.className = 'sel-overlay';
    col.appendChild(sel);
    attachPointer(col, sel);
    grid.appendChild(col);
  }
}
function renderBlocks() {
  document.querySelectorAll('.block').forEach((b) => b.remove());
  visibleBlocks().forEach((b) => {
    const col = document.querySelector('.day-col[data-day="' + b.day + '"]');
    if (!col) return;
    const el = document.createElement('div');
    el.className = 'block';
    el.dataset.id = b.id;
    el.style.top = (b.start / SLOTS) * 100 + '%';
    el.style.height = ((b.end - b.start) / SLOTS) * 100 + '%';
    const c = COLORS.find((c) => c.id === b.color);
    el.style.background = c && b.color !== 'none' ? c.css : '#F7F6F1';
    const tm = document.createElement('span');
    tm.className = 'tm';
    tm.textContent = slotLabel(b.start) + '–' + slotLabel(b.end);
    const tx = document.createElement('span');
    tx.textContent = b.text;
    if (b.end - b.start >= 3) el.appendChild(tm);
    el.appendChild(tx);
    col.appendChild(el);
  });
}

/* ---------- 드래그 선택 ---------- */
function slotFromEvent(col, e) {
  const rect = col.getBoundingClientRect();
  const y = Math.min(Math.max(e.clientY - rect.top, 0), rect.height - 0.01);
  return Math.floor((y / rect.height) * SLOTS);
}
function attachPointer(col, sel) {
  let dragging = false,
    startSlot = 0,
    curSlot = 0,
    moved = false,
    hitBlock = null;
  col.addEventListener('pointerdown', (e) => {
    const blockEl = e.target.closest('.block');
    if (blockEl) {
      hitBlock = Number(blockEl.dataset.id);
      return;
    }
    hitBlock = null;
    dragging = true;
    moved = false;
    startSlot = curSlot = slotFromEvent(col, e);
    col.setPointerCapture(e.pointerId);
    drawSel();
  });
  col.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const s = slotFromEvent(col, e);
    if (s !== curSlot) {
      curSlot = s;
      moved = true;
      drawSel();
    }
  });
  col.addEventListener('pointerup', () => {
    if (hitBlock !== null) {
      const b = visibleBlocks().find((x) => x.id === hitBlock);
      hitBlock = null;
      if (b) openEditor({ mode: 'edit', block: b });
      return;
    }
    if (!dragging) return;
    dragging = false;
    sel.style.display = 'none';
    let a = Math.min(startSlot, curSlot);
    let b = Math.max(startSlot, curSlot) + 1;
    if (!moved) {
      b = Math.min(a + 3, SLOTS);
    }
    openEditor({
      mode: 'new',
      day: Number(col.dataset.day),
      start: a,
      end: b,
    });
  });
  col.addEventListener('pointercancel', () => {
    dragging = false;
    hitBlock = null;
    sel.style.display = 'none';
  });
  function drawSel() {
    const a = Math.min(startSlot, curSlot);
    const b = Math.max(startSlot, curSlot) + 1;
    sel.style.display = 'block';
    sel.style.top = (a / SLOTS) * 100 + '%';
    sel.style.height = ((b - a) / SLOTS) * 100 + '%';
  }
}

/* ---------- 편집 팝업 ---------- */
const editor = document.getElementById('editor');
const blockText = document.getElementById('blockText');
const startSel = document.getElementById('startSel');
const endSel = document.getElementById('endSel');
let editorCtx = null;
let selectedColor = 'none';

function buildSelects() {
  for (let s = 0; s < SLOTS; s++) startSel.add(new Option(slotLabel(s), s));
  for (let s = 1; s <= SLOTS; s++) endSel.add(new Option(slotLabel(s), s));
}
function buildSwatches() {
  const box = document.getElementById('swatches');
  COLORS.forEach((c) => {
    const btn = document.createElement('button');
    btn.className = 'swatch' + (c.id === 'none' ? ' none' : '');
    btn.dataset.color = c.id;
    btn.setAttribute('aria-label', c.id === 'none' ? '색 없음' : c.id);
    if (c.id !== 'none') btn.style.background = c.css;
    btn.addEventListener('click', () => {
      selectedColor = c.id;
      updateSwatch();
    });
    box.appendChild(btn);
  });
}
function updateSwatch() {
  document
    .querySelectorAll('.swatch')
    .forEach((s) =>
      s.classList.toggle('selected', s.dataset.color === selectedColor),
    );
}
function openEditor(ctx) {
  editorCtx = ctx;
  const day = ctx.mode === 'edit' ? ctx.block.day : ctx.day;
  const date = addDays(currentWeekStart, day);
  document.getElementById('editorTitle').textContent =
    date.getMonth() + 1 + '월 ' + date.getDate() + '일 (' + DAYS[day] + ')';
  startSel.value = ctx.mode === 'edit' ? ctx.block.start : ctx.start;
  endSel.value = ctx.mode === 'edit' ? ctx.block.end : ctx.end;
  blockText.value = ctx.mode === 'edit' ? ctx.block.text || '' : '';
  selectedColor = ctx.mode === 'edit' ? ctx.block.color || 'none' : 'none';
  updateSwatch();
  document.getElementById('btnDel').style.display =
    ctx.mode === 'edit' ? 'block' : 'none';
  editor.classList.add('open');
  blockText.focus();
}
function closeEditor() {
  editor.classList.remove('open');
  editorCtx = null;
}
function carveOverlaps(week, day, s, e, ignoreId) {
  const out = [];
  week.blocks.forEach((b) => {
    if (b.day !== day || b.id === ignoreId || b.end <= s || b.start >= e) {
      out.push(b);
      return;
    }
    if (b.start < s) out.push({ ...b, id: nextId++, end: s });
    if (b.end > e) out.push({ ...b, id: nextId++, start: e });
  });
  week.blocks = out;
}
document.getElementById('btnSave').addEventListener('click', () => {
  if (!editorCtx) return;
  materializeDraft(); // 복사본 상태에서 수정하면 이 주 데이터로 확정
  let s = Number(startSel.value),
    e = Number(endSel.value);
  if (e <= s) e = s + 1;
  const day = editorCtx.mode === 'edit' ? editorCtx.block.day : editorCtx.day;
  const id = editorCtx.mode === 'edit' ? editorCtx.block.id : null;
  const week = storedWeek(true);
  carveOverlaps(week, day, s, e, id);
  if (id !== null) week.blocks = week.blocks.filter((b) => b.id !== id);
  week.blocks.push({
    id: id !== null ? id : nextId++,
    day,
    start: s,
    end: e,
    text: blockText.value.trim(),
    color: selectedColor,
  });
  renderBlocks();
  renderWeekSelect();
  scheduleSave();
  closeEditor();
});
document.getElementById('btnDel').addEventListener('click', () => {
  if (!editorCtx || editorCtx.mode !== 'edit') return;
  materializeDraft();
  const week = storedWeek(true);
  week.blocks = week.blocks.filter((b) => b.id !== editorCtx.block.id);
  renderBlocks();
  renderWeekSelect();
  scheduleSave();
  closeEditor();
});
document.getElementById('btnCancel').addEventListener('click', closeEditor);
editor.addEventListener('click', (e) => {
  if (e.target === editor) closeEditor();
});
blockText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btnSave').click();
  if (e.key === 'Escape') closeEditor();
});

/* ---------- 할 일 목록 (주별) ---------- */
const todoInput = document.getElementById('todoInput');
function renderTodos() {
  const list = document.getElementById('todoList');
  const empty = document.getElementById('todoEmpty');
  const todos = storedWeek(false).todos;
  list.innerHTML = '';
  empty.style.display = todos.length ? 'none' : 'block';
  todos.forEach((t, i) => {
    const li = document.createElement('li');
    if (t.done) li.classList.add('done');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!t.done;
    cb.setAttribute('aria-label', '완료 표시');
    cb.addEventListener('change', () => {
      storedWeek(true).todos[i].done = cb.checked;
      renderTodos();
      scheduleSave();
    });
    const span = document.createElement('span');
    span.className = 'txt';
    span.textContent = t.text;
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.setAttribute('aria-label', '삭제');
    del.addEventListener('click', () => {
      storedWeek(true).todos.splice(i, 1);
      renderTodos();
      renderWeekSelect();
      scheduleSave();
    });
    li.append(cb, span, del);
    list.appendChild(li);
  });
}
function addTodo() {
  const text = todoInput.value.trim();
  if (!text) return;
  storedWeek(true).todos.push({ text, done: false });
  todoInput.value = '';
  renderTodos();
  renderWeekSelect();
  scheduleSave();
  todoInput.focus();
}
document.getElementById('todoAddBtn').addEventListener('click', addTodo);
todoInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTodo();
});

/* ---------- 인쇄 ---------- */
document
  .getElementById('printBtn')
  .addEventListener('click', () => window.print());

/* ---------- 초기화 ---------- */
function renderAll() {
  renderDday();
  renderWeekBar();
  renderBlocks();
  renderTodos();
}
buildGrid();
buildSelects();
buildSwatches();
renderWeekBar();
load();
