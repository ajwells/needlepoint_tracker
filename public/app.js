/* Needlepoint Tracker — threads & canvases, stored locally in IndexedDB. */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------
  const COLOR_FAMILIES = [
    ['White', '#f7f5f0'], ['Black', '#1f1d1c'], ['Grey', '#9a9a9e'], ['Yellow', '#f2c94c'],
    ['Red', '#d23b3b'], ['Blue', '#2f6fd6'], ['Green', '#2f9a5a'], ['Brown', '#8a5a32'],
    ['Pink', '#ef8fb6'], ['Orange', '#f08a32'], ['Purple', '#8a4fd1'],
  ];
  const FAMILY_COLOR = Object.fromEntries(COLOR_FAMILIES);
  const familyLabel = (f) => (f === 'Grey' ? 'Grey / Gray' : f);
  const MESH_SIZES = [13, 18];
  /** Canvas lifecycle, in order. */
  const CANVAS_STATUSES = [
    ['wishlist', 'Wish list'], ['purchased', 'Purchased'], ['kitted', 'Kitted'],
    ['in_progress', 'In progress'], ['stitched', 'Stitched'], ['finished', 'Finished'],
  ];
  const STATUS_LABEL = Object.fromEntries(CANVAS_STATUSES);
  const STATUS_KEYS = CANVAS_STATUSES.map(([k]) => k);
  const DEFAULT_STATUS = 'purchased';

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3.5"/>',
    download: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    upload: '<path d="M12 21V9m0 0-4 4m4-4 4 4M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    spool: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M6 7h12M6 17h12M9 10l6 2M9 13l6 2"/>',
    canvas: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  };
  const icon = (name) =>
    `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const uid = () =>
    (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const intOrNull = (v) => {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  const numOrNull = (v) => {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const str = (v) => String(v ?? '').trim();
  const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
  const fmtYards = (n) => `${+Number(n).toFixed(2)} yd`;
  const fmtNum = (n) => `${+Number(n).toFixed(2)}`;
  /** Amount left is either yards or a percentage of a skein/card (may exceed 100%). */
  const AMOUNT_UNITS = { yards: { label: 'Yards', suffix: 'yd' }, percent: { label: '% of skein/card', suffix: '%' } };
  const fmtAmount = (t) =>
    t.amountLeft == null ? '' : t.amountUnit === 'percent' ? `${fmtNum(t.amountLeft)}%` : fmtYards(t.amountLeft);
  const fmtDate = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const normalizeUrl = (u) => {
    u = str(u);
    if (!u) return '';
    return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
  };
  const safeHref = (u) => (/^https?:\/\//i.test(u) ? u : '');
  const plural = (n, word, pl = `${word}s`) => `${n} ${n === 1 ? word : pl}`;

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  /** Read an image file, downscale it, and return a JPEG data URL. */
  async function imageToDataUrl(file, max = 1600) {
    const readRaw = () =>
      new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file);
      });
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      return readRaw(); // format the browser can't decode for resizing — store as-is
    }
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    return c.toDataURL('image/jpeg', 0.86);
  }

  // ---------------------------------------------------------------------------
  // Storage (IndexedDB)
  // ---------------------------------------------------------------------------
  const DB_NAME = 'needlepoint-tracker';
  const STORES = ['threads', 'canvases'];
  let dbPromise;

  function openDb() {
    dbPromise ||= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function dbGetAll(store) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /** Run writes across one or more stores in a single atomic transaction. */
  async function dbWrite(stores, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      fn((name) => tx.objectStore(name));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    threads: [],
    canvases: [],
    tab: 'threads',
    threadQuery: '',
    threadFamily: '',
    threadSort: 'brand',
    canvasQuery: '',
    canvasStatus: '',
  };

  async function loadAll() {
    const [threads, canvases] = await Promise.all([dbGetAll('threads'), dbGetAll('canvases')]);
    state.threads = threads.map(normalizeThread);
    state.canvases = canvases.map(normalizeCanvas);
  }

  /**
   * Upgrade older thread records:
   * - amounts saved as `yardsLeft` before units existed
   * - code / dye lot saved as numbers before they became text (codes like "C-109", lots like "512B")
   */
  function normalizeThread(t) {
    const { yardsLeft, ...rest } = t;
    const out = { ...rest, code: textOrEmpty(rest.code), dyeLot: textOrEmpty(rest.dyeLot) };
    if ('yardsLeft' in t) {
      out.amountLeft = rest.amountLeft ?? yardsLeft ?? null;
      out.amountUnit = rest.amountUnit || 'yards';
    }
    return out;
  }
  function textOrEmpty(v) {
    return v === null || v === undefined ? '' : String(v).trim();
  }

  function normalizeCanvas(c) {
    // Canvases saved before statuses existed: finished if a year was set, otherwise in progress.
    const status = STATUS_KEYS.includes(c.status) ? c.status : c.yearFinished != null ? 'finished' : 'in_progress';
    return { ...c, status, threads: Array.isArray(c.threads) ? c.threads : [], cording: Array.isArray(c.cording) ? c.cording : [] };
  }

  const threadById = (id) => state.threads.find((t) => t.id === id);
  const canvasById = (id) => state.canvases.find((c) => c.id === id);

  /** Map of threadId -> [{ canvas, roles[] }], derived from canvas thread & cording lists. */
  function buildUsage() {
    const map = new Map();
    for (const c of state.canvases) {
      const add = (threadId, role) => {
        if (!threadId) return;
        if (!map.has(threadId)) map.set(threadId, new Map());
        const byCanvas = map.get(threadId);
        if (!byCanvas.has(c.id)) byCanvas.set(c.id, { canvas: c, roles: [] });
        if (role) byCanvas.get(c.id).roles.push(role);
      };
      c.threads.forEach((r) => add(r.threadId, r.itemDescription || r.colorDescription || 'Thread'));
      c.cording.forEach((r) => add(r.threadId, 'Cording'));
    }
    return map;
  }
  const usageFor = (usage, threadId) => [...(usage.get(threadId)?.values() || [])];

  function threadName(t) {
    return [t.brand, t.color].filter(Boolean).join(' ') || 'Untitled thread';
  }
  function threadOptionLabel(t) {
    let s = t.brand || 'Untitled';
    if (t.code) s += ` #${t.code}`;
    if (t.color) s += ` · ${t.color}`;
    const extra = [t.material, t.size != null ? `size ${t.size}` : ''].filter(Boolean).join(' ');
    if (extra) s += ` (${extra})`;
    if (t.amountLeft != null) s += ` — ${fmtAmount(t)} left`;
    return s;
  }
  function compareThreads(a, b) {
    return (
      (a.brand || '').localeCompare(b.brand || '', undefined, { sensitivity: 'base' }) ||
      // Natural order so "C-9" < "C-10" and "2" < "10"; threads without a code go last.
      (!a.code - !b.code) ||
      (a.code || '').localeCompare(b.code || '', undefined, { numeric: true, sensitivity: 'base' }) ||
      (a.color || '').localeCompare(b.color || '')
    );
  }
  const familyIndex = (f) => {
    const i = COLOR_FAMILIES.findIndex(([n]) => n === f);
    return i < 0 ? 99 : i;
  };

  // ---------------------------------------------------------------------------
  // Rendering: list views
  // ---------------------------------------------------------------------------
  function render() {
    for (const tab of ['threads', 'canvases']) {
      $(`#view-${tab}`).hidden = state.tab !== tab;
      const btn = $(`.tab[data-tab="${tab}"]`);
      btn.classList.toggle('active', state.tab === tab);
      btn.setAttribute('aria-selected', String(state.tab === tab));
    }
    $('#count-threads').textContent = state.threads.length;
    $('#count-canvases').textContent = state.canvases.length;
    if (state.tab === 'threads') renderThreads();
    else renderCanvases();
  }

  function renderFamilyFilter() {
    const counts = {};
    state.threads.forEach((t) => { if (t.colorFamily) counts[t.colorFamily] = (counts[t.colorFamily] || 0) + 1; });
    const chip = (value, label, sw) =>
      `<button class="chip ${state.threadFamily === value ? 'active' : ''}" data-family="${value}">${
        sw ? `<span class="dot" style="--sw:${sw}"></span>` : ''
      }${esc(label)}${value && counts[value] ? ` <span class="muted">${counts[value]}</span>` : ''}</button>`;
    $('#family-filter').innerHTML =
      chip('', 'All colors') + COLOR_FAMILIES.map(([name, sw]) => chip(name, familyLabel(name), sw)).join('');
  }

  function renderThreads() {
    renderFamilyFilter();
    const usage = buildUsage();
    const q = state.threadQuery.trim().toLowerCase();
    let list = state.threads.filter((t) => {
      if (state.threadFamily && t.colorFamily !== state.threadFamily) return false;
      if (!q) return true;
      const hay = [t.brand, t.material, t.color, t.code, t.dyeLot, t.colorFamily, t.colorFamily === 'Grey' ? 'gray' : '', t.size]
        .join(' ')
        .toLowerCase();
      return q.split(/\s+/).every((w) => hay.includes(w));
    });
    const sorters = {
      brand: compareThreads,
      color: (a, b) => familyIndex(a.colorFamily) - familyIndex(b.colorFamily) || compareThreads(a, b),
      // Yards and percentages can't be compared directly, so group by unit, then least first.
      amount: (a, b) =>
        (a.amountLeft == null) - (b.amountLeft == null) ||
        (a.amountUnit === 'percent') - (b.amountUnit === 'percent') ||
        (a.amountLeft ?? 0) - (b.amountLeft ?? 0) ||
        compareThreads(a, b),
      recent: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    };
    list.sort(sorters[state.threadSort] || compareThreads);

    const sum = (unit) =>
      state.threads.filter((t) => (t.amountUnit === 'percent') === (unit === 'percent')).reduce((s, t) => s + (t.amountLeft || 0), 0);
    const yards = sum('yards');
    const skeins = sum('percent') / 100;
    const onHand = [yards ? fmtYards(yards) : '', skeins ? `${fmtNum(skeins)} skeins/cards` : ''].filter(Boolean).join(' + ');
    $('#threads-summary').textContent = state.threads.length
      ? `${plural(state.threads.length, 'thread')}${onHand ? ` · ${onHand} on hand` : ''}`
      : 'Your thread stash, all in one place.';

    const grid = $('#thread-grid');
    if (!state.threads.length) {
      grid.innerHTML = emptyState('spool', 'No threads yet', 'Add your first thread to start building your stash.', 'thread', 'Add thread');
    } else if (!list.length) {
      grid.innerHTML = emptyState('search', 'No matches', 'Try a different search or color filter.');
    } else {
      grid.innerHTML = list.map((t) => threadCard(t, usageFor(usage, t.id))).join('');
    }
  }

  function threadCard(t, used) {
    const sw = FAMILY_COLOR[t.colorFamily];
    const media = t.picture
      ? `<img src="${esc(t.picture)}" alt="" loading="lazy">`
      : sw
        ? `<div class="swatch-fill" style="--sw:${sw}"></div>`
        : `<div class="placeholder">${icon('spool')}</div>`;
    const meta = [
      t.colorFamily ? `<span class="badge"><span class="dot" style="--sw:${sw}"></span>${esc(familyLabel(t.colorFamily))}</span>` : '',
      t.size != null ? `<span class="badge">Size ${t.size}</span>` : '',
      t.amountLeft != null ? `<span class="badge accent yards" title="Amount left">${fmtAmount(t)}${t.amountUnit === 'percent' ? ' of skein' : ''}</span>` : '',
      used.length ? `<span class="badge">${icon('canvas').replace('class="icon"', 'class="icon" style="width:12px;height:12px"')}${plural(used.length, 'canvas', 'canvases')}</span>` : '',
    ].join('');
    const sub = [t.color, t.material].filter(Boolean).join(' · ');
    return `<article class="card" tabindex="0" data-open-thread="${t.id}" aria-label="${esc(threadName(t))}">
      <div class="card-media">${media}</div>
      <div class="card-body">
        <div class="card-title"><span class="name">${esc(t.brand || 'Untitled thread')}</span>${t.code ? `<span class="code">#${esc(t.code)}</span>` : ''}</div>
        ${sub ? `<div class="card-sub">${esc(sub)}</div>` : ''}
        <div class="card-meta">${meta}</div>
      </div>
    </article>`;
  }

  const statusBadge = (c) =>
    `<span class="badge status st-${c.status}"><span class="st-dot"></span>${esc(STATUS_LABEL[c.status])}${
      c.status === 'finished' && c.yearFinished != null ? ` ${c.yearFinished}` : ''
    }</span>`;

  function renderStatusFilter(counts) {
    const chip = (value, label) =>
      `<button class="chip ${state.canvasStatus === value ? 'active' : ''}" data-status="${value}">${
        value ? `<span class="st-dot st-${value}"></span>` : ''
      }${esc(label)}${value && counts[value] ? ` <span class="muted">${counts[value]}</span>` : ''}</button>`;
    $('#status-filter').innerHTML = chip('', 'All') + CANVAS_STATUSES.map(([k, label]) => chip(k, label)).join('');
  }

  function renderCanvases() {
    const counts = {};
    state.canvases.forEach((c) => { counts[c.status] = (counts[c.status] || 0) + 1; });
    renderStatusFilter(counts);

    const q = state.canvasQuery.trim().toLowerCase();
    const list = state.canvases
      .filter((c) => {
        if (state.canvasStatus && c.status !== state.canvasStatus) return false;
        if (!q) return true;
        const hay = [c.name, c.designer, c.shopName, c.notes, c.yearFinished, c.meshSize, STATUS_LABEL[c.status]].join(' ').toLowerCase();
        return q.split(/\s+/).every((w) => hay.includes(w));
      })
      .sort((a, b) => (b.datePurchased || '').localeCompare(a.datePurchased || '') || (a.name || '').localeCompare(b.name || ''));

    const breakdown = CANVAS_STATUSES.filter(([k]) => counts[k]).map(([k, label]) => `${counts[k]} ${label.toLowerCase()}`);
    $('#canvases-summary').textContent = state.canvases.length
      ? [plural(state.canvases.length, 'canvas', 'canvases'), ...breakdown].join(' · ')
      : 'Every canvas, from wish list to finished piece.';

    const grid = $('#canvas-grid');
    if (!state.canvases.length) {
      grid.innerHTML = emptyState('canvas', 'No canvases yet', 'Add a canvas to track its threads, stitches, and progress.', 'canvas', 'Add canvas');
    } else if (!list.length) {
      grid.innerHTML = emptyState('search', 'No matches', 'Try a different search or filter.');
    } else {
      grid.innerHTML = list.map(canvasCard).join('');
    }
  }

  function canvasCard(c) {
    const img = c.finishedPicture || c.picture;
    const status = statusBadge(c);
    const meta = [
      c.meshSize ? `<span class="badge">${c.meshSize} mesh</span>` : '',
      c.threads.length ? `<span class="badge">${plural(c.threads.length, 'thread')}</span>` : '',
      c.price != null ? `<span class="badge">${currency.format(c.price)}</span>` : '',
    ].join('');
    const sub = [c.designer, c.shopName].filter(Boolean).join(' · ');
    return `<article class="card" tabindex="0" data-open-canvas="${c.id}" aria-label="${esc(c.name || 'Untitled canvas')}">
      <div class="card-media">
        ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<div class="placeholder">${icon('canvas')}</div>`}
        <div class="corner">${status}</div>
      </div>
      <div class="card-body">
        <div class="card-title"><span class="name">${esc(c.name || 'Untitled canvas')}</span></div>
        ${sub ? `<div class="card-sub">${esc(sub)}</div>` : ''}
        <div class="card-meta">${meta}</div>
      </div>
    </article>`;
  }

  function emptyState(ic, title, text, newKind, btnLabel) {
    return `<div class="empty">${icon(ic)}<h2>${esc(title)}</h2><p>${esc(text)}</p>${
      newKind ? `<button class="btn primary" data-new="${newKind}">${icon('plus')}${esc(btnLabel)}</button>` : ''
    }</div>`;
  }

  // ---------------------------------------------------------------------------
  // Modal / forms
  // ---------------------------------------------------------------------------
  const modal = $('#modal');
  /** Current form session: { kind: 'thread'|'canvas', id, images: {}, dirty } */
  let form = null;

  function confirmDiscard() {
    return !form?.dirty || confirm('Discard unsaved changes?');
  }

  function closeModal(force = false) {
    if (!force && !confirmDiscard()) return false;
    modal.close();
    modal.innerHTML = '';
    form = null;
    return true;
  }

  function openModal(html, { wide = false } = {}) {
    modal.classList.toggle('wide', wide);
    modal.innerHTML = `<form class="modal-form" id="modal-form" novalidate>${html}</form>`;
    if (!modal.open) modal.showModal();
    $('.modal-body', modal).scrollTop = 0;
    hydrateIcons(modal);
  }

  const field = (label, inner, cls = '') => `<label class="field ${cls}"><span class="label">${label}</span>${inner}</label>`;

  function imageFieldHtml(name, label) {
    const value = form.images[name];
    return `<div class="image-field" data-image-field="${name}" data-label="${esc(label)}">
      <span class="label">${esc(label)}</span>
      <label class="image-drop ${value ? 'has-image' : ''}">
        <input type="file" accept="image/*" data-image-input="${name}" aria-label="${esc(label)}">
        ${value ? `<img src="${esc(value)}" alt="${esc(label)}">` : `<span class="image-placeholder">${icon('camera')}<span>Add photo</span></span>`}
      </label>
      <div class="image-actions">
        <span>${value ? 'Click photo to replace' : 'Click or drop an image'}</span>
        ${value ? `<button type="button" class="link-btn danger" data-remove-image="${name}">Remove</button>` : ''}
      </div>
    </div>`;
  }
  function refreshImageField(name) {
    const el = $(`[data-image-field="${name}"]`, modal);
    el.outerHTML = imageFieldHtml(name, el.dataset.label);
  }

  function modalHead(title) {
    return `<header class="modal-head"><h2 id="modal-title">${esc(title)}</h2>
      <button type="button" class="icon-btn" data-close aria-label="Close">${icon('close')}</button></header>`;
  }
  function modalFoot(isEdit, kindLabel) {
    return `<footer class="modal-foot">
      ${isEdit ? `<button type="button" class="btn danger" data-delete>${icon('trash')}Delete</button>` : ''}
      <span class="spacer"></span>
      <button type="button" class="btn ghost" data-close>Cancel</button>
      <button type="submit" class="btn primary">${isEdit ? 'Save changes' : `Add ${kindLabel}`}</button>
    </footer>`;
  }

  // ---- Thread form ----
  const YARDS_HINT = 'Yards remaining.';
  const PERCENT_HINT = 'Percent of a full skein or card. Use more than 100% for extras, e.g. 250% = 2½ skeins.';
  function openThreadForm(id) {
    if (modal.open && !confirmDiscard()) return;
    const t = id ? threadById(id) : {};
    if (id && !t) return;
    form = { kind: 'thread', id: id || null, images: { picture: t.picture || null }, dirty: false };
    const v = (k) => esc(t[k] ?? '');
    const unit = t.amountUnit === 'percent' ? 'percent' : 'yards';

    const familyPicker = `<div class="family-picker" role="radiogroup" aria-label="Color family">
      ${COLOR_FAMILIES.map(([name, sw]) => `<label>
        <input type="radio" name="colorFamily" value="${name}" ${t.colorFamily === name ? 'checked' : ''}>
        <span class="chip"><span class="dot" style="--sw:${sw}"></span>${esc(familyLabel(name))}</span>
      </label>`).join('')}
    </div>`;

    const used = id ? usageFor(buildUsage(), id) : [];
    const usedHtml = !id
      ? `<p class="note">Once saved, this thread can be linked from a canvas's thread or cording list, and those canvases will show up here automatically.</p>`
      : used.length
        ? `<div class="used-list">${used.map(({ canvas: c, roles }) => {
            const img = c.finishedPicture || c.picture;
            return `<button type="button" class="used-item" data-open-canvas="${c.id}">
              <span class="used-thumb">${img ? `<img src="${esc(img)}" alt="">` : icon('canvas')}</span>
              <span class="used-text"><strong>${esc(c.name || 'Untitled canvas')}</strong>
              <span>${esc([...new Set(roles)].join(', '))}</span></span>
            </button>`;
          }).join('')}</div>`
        : `<p class="note">Not used in any canvases yet. Link it from a canvas's thread or cording list.</p>`;

    openModal(`
      ${modalHead(id ? 'Edit thread' : 'New thread')}
      <div class="modal-body">
        <div class="section">
          <div class="form-grid">
            <div class="span-all" style="max-width:340px">${imageFieldHtml('picture', 'Picture')}</div>
            ${field('Brand', `<input name="brand" value="${v('brand')}" placeholder="e.g. DMC, Silk & Ivory" autocomplete="off">`)}
            ${field('Material', `<input name="material" value="${v('material')}" placeholder="e.g. Pearl cotton, wool, silk" autocomplete="off">`)}
            ${field('Color', `<input name="color" value="${v('color')}" placeholder="e.g. Christmas Red" autocomplete="off">`)}
            ${field('Code', `<input name="code" value="${v('code')}" placeholder="e.g. 321, C-109, SL40" autocomplete="off">`)}
            ${field('Thread size', `<input name="size" type="number" inputmode="numeric" min="0" step="1" value="${v('size')}" placeholder="e.g. 5">`)}
            ${field('Dye lot', `<input name="dyeLot" value="${v('dyeLot')}" placeholder="e.g. 512B" autocomplete="off">`)}
            <div class="field span-2"><span class="label">Amount left</span>
              <div class="amount-row">
                <div class="input-adorn"><input name="amountLeft" class="has-suffix" type="number" inputmode="decimal" min="0" step="any" value="${v('amountLeft')}" placeholder="0" aria-label="Amount left"><span class="suffix" data-amount-suffix>${AMOUNT_UNITS[unit].suffix}</span></div>
                <div class="segmented" role="radiogroup" aria-label="Amount unit">
                  ${Object.entries(AMOUNT_UNITS).map(([k, u]) => `<label><input type="radio" name="amountUnit" value="${k}" ${unit === k ? 'checked' : ''}>${u.label}</label>`).join('')}
                </div>
              </div>
              <span class="hint">${unit === 'percent' ? PERCENT_HINT : YARDS_HINT}</span>
            </div>
            <div class="field span-all"><span class="label">Color family</span>${familyPicker}</div>
          </div>
        </div>
        <div class="section">
          <h3>Canvases used in</h3>
          ${usedHtml}
        </div>
      </div>
      ${modalFoot(!!id, 'thread')}
    `);
  }

  async function saveThread(fd) {
    const existing = form.id ? threadById(form.id) : null;
    const t = {
      id: form.id || uid(),
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
      brand: str(fd.get('brand')),
      material: str(fd.get('material')),
      size: intOrNull(fd.get('size')),
      colorFamily: fd.get('colorFamily') || '',
      color: str(fd.get('color')),
      code: str(fd.get('code')),
      dyeLot: str(fd.get('dyeLot')),
      picture: form.images.picture || null,
      amountLeft: numOrNull(fd.get('amountLeft')),
      amountUnit: fd.get('amountUnit') === 'percent' ? 'percent' : 'yards',
    };
    await dbWrite(['threads'], (s) => s('threads').put(t));
    const i = state.threads.findIndex((x) => x.id === t.id);
    if (i >= 0) state.threads[i] = t;
    else state.threads.push(t);
    return existing ? 'Thread updated' : 'Thread added';
  }

  async function deleteThread(id) {
    const used = usageFor(buildUsage(), id);
    const msg = used.length
      ? `Delete this thread? It's linked in ${plural(used.length, 'canvas', 'canvases')}; those rows will be kept but unlinked.`
      : 'Delete this thread?';
    if (!confirm(msg)) return false;
    const touched = [];
    for (const c of state.canvases) {
      let changed = false;
      const unlink = (r) => (r.threadId === id ? ((changed = true), { ...r, threadId: null }) : r);
      const next = { ...c, threads: c.threads.map(unlink), cording: c.cording.map(unlink) };
      if (changed) touched.push(next);
    }
    await dbWrite(['threads', 'canvases'], (s) => {
      s('threads').delete(id);
      touched.forEach((c) => s('canvases').put(c));
    });
    state.threads = state.threads.filter((t) => t.id !== id);
    touched.forEach((c) => { state.canvases[state.canvases.findIndex((x) => x.id === c.id)] = c; });
    return true;
  }

  // ---- Canvas form ----
  function threadOptions(selected) {
    const sorted = [...state.threads].sort(compareThreads);
    return `<option value="">— Not linked —</option>${sorted
      .map((t) => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${esc(threadOptionLabel(t))}</option>`)
      .join('')}`;
  }

  const cell = (label, inner, cls = '') => `<label class="cell ${cls}"><span class="cell-label">${label}</span>${inner}</label>`;
  const rowActions = (threadId) => `<div class="row-actions">
      <button type="button" class="icon-btn" data-open-linked title="Open linked thread" aria-label="Open linked thread" ${threadId ? '' : 'disabled'}>${icon('external')}</button>
      <button type="button" class="icon-btn" data-remove-row title="Remove row" aria-label="Remove row">${icon('close')}</button>
    </div>`;

  function threadRowHtml(r = {}) {
    return `<div class="row" data-row="thread">
      ${cell('Color description', `<input name="colorDescription" value="${esc(r.colorDescription)}" placeholder="e.g. dark green">`)}
      ${cell('Item description', `<input name="itemDescription" value="${esc(r.itemDescription)}" placeholder="e.g. holly leaves">`)}
      ${cell('Stitch type', `<input name="stitchType" value="${esc(r.stitchType)}" placeholder="e.g. basketweave">`)}
      ${cell('Strands', `<input name="strands" type="number" inputmode="numeric" min="0" step="1" value="${esc(r.strands)}">`)}
      ${cell('Linked thread', `<select name="threadId">${threadOptions(r.threadId)}</select>`, 'wide')}
      ${rowActions(r.threadId)}
    </div>`;
  }
  function cordingRowHtml(r = {}) {
    return `<div class="row" data-row="cording">
      ${cell('Strands', `<input name="strands" type="number" inputmode="numeric" min="0" step="1" value="${esc(r.strands)}">`)}
      ${cell('Linked thread', `<select name="threadId">${threadOptions(r.threadId)}</select>`, 'wide')}
      ${rowActions(r.threadId)}
    </div>`;
  }

  function openCanvasForm(id) {
    if (modal.open && !confirmDiscard()) return;
    const c = id ? canvasById(id) : { status: DEFAULT_STATUS, threads: [], cording: [] };
    if (id && !c) return;
    const stepIdx = STATUS_KEYS.indexOf(c.status);
    const stepper = `<div class="stepper" role="radiogroup" aria-label="Status">
      ${CANVAS_STATUSES.map(([k, label], i) => `<label class="step st-${k} ${i < stepIdx ? 'done' : ''}">
        <input type="radio" name="status" value="${k}" ${k === c.status ? 'checked' : ''}>
        <span class="step-dot">${i + 1}</span><span class="step-label">${esc(label)}</span>
      </label>`).join('')}
    </div>`;
    form = {
      kind: 'canvas', id: id || null, dirty: false,
      images: { picture: c.picture || null, finishedPicture: c.finishedPicture || null },
    };
    const v = (k) => esc(c[k] ?? '');
    const noThreadsHint = state.threads.length
      ? ''
      : `<p class="note">Tip: add threads in the Threads tab first so you can link them here.</p>`;

    openModal(`
      ${modalHead(id ? 'Edit canvas' : 'New canvas')}
      <div class="modal-body">
        <div class="section">
          <h3>Status</h3>
          ${stepper}
        </div>

        <div class="section">
          <div class="image-row">
            ${imageFieldHtml('picture', 'Canvas picture')}
            ${imageFieldHtml('finishedPicture', 'Finished picture')}
          </div>
        </div>

        <div class="section">
          <h3>Details</h3>
          <div class="form-grid three">
            ${field('Name', `<input name="name" value="${v('name')}" placeholder="e.g. Winter Cardinal" autocomplete="off">`, 'span-2')}
            ${field('Designer', `<input name="designer" value="${v('designer')}" autocomplete="off">`)}
            ${field('Date purchased', `<input name="datePurchased" type="date" value="${v('datePurchased')}">`)}
            ${field('Price', `<div class="input-adorn"><span class="prefix">$</span><input name="price" class="has-prefix" type="number" inputmode="decimal" min="0" step="0.01" value="${c.price != null ? c.price.toFixed(2) : ''}" placeholder="0.00"></div>`)}
            ${field('Year finished', `<input name="yearFinished" type="number" inputmode="numeric" min="1900" max="2100" step="1" value="${v('yearFinished')}" placeholder="e.g. ${new Date().getFullYear()}">`)}
            <div class="field"><span class="label">Mesh size</span>
              <div class="segmented" role="radiogroup" aria-label="Mesh size">
                ${MESH_SIZES.map((m) => `<label><input type="radio" name="meshSize" value="${m}" ${c.meshSize === m ? 'checked' : ''}>${m} mesh</label>`).join('')}
              </div>
            </div>
            ${field('Needlepoint shop', `<input name="shopName" value="${v('shopName')}" placeholder="Shop name" autocomplete="off">`)}
            <label class="field"><span class="label">Shop website</span>
              <div class="url-row">
                <input name="shopUrl" type="text" inputmode="url" value="${v('shopUrl')}" placeholder="e.g. shopname.com" autocomplete="off">
                ${safeHref(c.shopUrl) ? `<a class="icon-btn" href="${esc(c.shopUrl)}" target="_blank" rel="noopener noreferrer" title="Visit shop" aria-label="Visit shop">${icon('external')}</a>` : ''}
              </div>
            </label>
          </div>
        </div>

        <div class="section">
          <div class="section-head"><h3>Threads</h3>
            <button type="button" class="btn ghost sm" data-add-row="thread">${icon('plus')}Add thread</button></div>
          ${noThreadsHint}
          <div class="rows thread-rows">
            <div class="rows-head"><span>Color description</span><span>Item description</span><span>Stitch type</span><span>Strands</span><span>Linked thread</span><span></span><span></span></div>
            <div class="rows" data-rows="thread">${c.threads.map(threadRowHtml).join('')}</div>
          </div>
        </div>

        <div class="section">
          <div class="section-head"><h3>Cording</h3>
            <button type="button" class="btn ghost sm" data-add-row="cording">${icon('plus')}Add cording</button></div>
          <div class="rows cording-rows">
            <div class="rows-head"><span>Strands</span><span>Linked thread</span><span></span><span></span></div>
            <div class="rows" data-rows="cording">${c.cording.map(cordingRowHtml).join('')}</div>
          </div>
        </div>

        <div class="section">
          <h3>Notes</h3>
          <label class="field"><textarea name="notes" placeholder="Stitch guide notes, finishing plans, ideas…" aria-label="Notes">${v('notes')}</textarea></label>
        </div>
      </div>
      ${modalFoot(!!id, 'canvas')}
    `, { wide: true });
    updateRowsEmpty();
  }

  function updateRowsEmpty() {
    for (const kind of ['thread', 'cording']) {
      const rows = $(`[data-rows="${kind}"]`, modal);
      if (!rows) continue;
      const wrap = rows.parentElement;
      const has = !!rows.querySelector('.row');
      $('.rows-head', wrap).hidden = !has;
      let empty = $('.rows-empty', wrap);
      if (!has && !empty) {
        wrap.insertAdjacentHTML('beforeend', `<div class="rows-empty">No ${kind === 'thread' ? 'threads' : 'cording'} added yet.</div>`);
      } else if (has && empty) {
        empty.remove();
      }
    }
  }

  async function saveCanvas(fd) {
    const existing = form.id ? canvasById(form.id) : null;
    const rowVal = (row, name) => row.querySelector(`[name="${name}"]`).value;
    const threads = $$('[data-rows="thread"] .row', modal)
      .map((row) => ({
        colorDescription: str(rowVal(row, 'colorDescription')),
        itemDescription: str(rowVal(row, 'itemDescription')),
        stitchType: str(rowVal(row, 'stitchType')),
        strands: intOrNull(rowVal(row, 'strands')),
        threadId: rowVal(row, 'threadId') || null,
      }))
      .filter((r) => r.colorDescription || r.itemDescription || r.stitchType || r.strands != null || r.threadId);
    const cording = $$('[data-rows="cording"] .row', modal)
      .map((row) => ({ strands: intOrNull(rowVal(row, 'strands')), threadId: rowVal(row, 'threadId') || null }))
      .filter((r) => r.strands != null || r.threadId);
    const price = numOrNull(fd.get('price'));

    const c = {
      id: form.id || uid(),
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
      name: str(fd.get('name')),
      datePurchased: fd.get('datePurchased') || '',
      price: price == null ? null : Math.round(price * 100) / 100,
      picture: form.images.picture || null,
      status: STATUS_KEYS.includes(fd.get('status')) ? fd.get('status') : DEFAULT_STATUS,
      yearFinished: intOrNull(fd.get('yearFinished')),
      finishedPicture: form.images.finishedPicture || null,
      designer: str(fd.get('designer')),
      shopName: str(fd.get('shopName')),
      shopUrl: normalizeUrl(fd.get('shopUrl')),
      meshSize: intOrNull(fd.get('meshSize')),
      threads,
      cording,
      notes: String(fd.get('notes') || ''),
    };
    await dbWrite(['canvases'], (s) => s('canvases').put(c));
    const i = state.canvases.findIndex((x) => x.id === c.id);
    if (i >= 0) state.canvases[i] = c;
    else state.canvases.push(c);
    return existing ? 'Canvas updated' : 'Canvas added';
  }

  async function deleteCanvas(id) {
    if (!confirm('Delete this canvas? This cannot be undone.')) return false;
    await dbWrite(['canvases'], (s) => s('canvases').delete(id));
    state.canvases = state.canvases.filter((c) => c.id !== id);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Modal events
  // ---------------------------------------------------------------------------
  modal.addEventListener('cancel', (e) => { e.preventDefault(); closeModal(); });
  modal.addEventListener('mousedown', (e) => { modal._downOnBackdrop = e.target === modal; });
  modal.addEventListener('click', (e) => {
    if (e.target === modal && modal._downOnBackdrop) { closeModal(); return; }
    const t = e.target.closest('button, [data-open-canvas], [data-open-thread]');
    if (!t || !modal.contains(t)) return;

    if (t.matches('[data-close]')) closeModal();
    else if (t.matches('[data-remove-image]')) {
      form.images[t.dataset.removeImage] = null;
      form.dirty = true;
      refreshImageField(t.dataset.removeImage);
    } else if (t.matches('[data-add-row]')) {
      const kind = t.dataset.addRow;
      const rows = $(`[data-rows="${kind}"]`, modal);
      rows.insertAdjacentHTML('beforeend', kind === 'thread' ? threadRowHtml() : cordingRowHtml());
      form.dirty = true;
      updateRowsEmpty();
      rows.lastElementChild.querySelector('input, select').focus();
    } else if (t.matches('[data-remove-row]')) {
      t.closest('.row').remove();
      form.dirty = true;
      updateRowsEmpty();
    } else if (t.matches('[data-open-linked]')) {
      const id = t.closest('.row').querySelector('[name="threadId"]').value;
      if (id) openThreadForm(id);
    } else if (t.matches('[data-open-canvas]')) openCanvasForm(t.dataset.openCanvas);
    else if (t.matches('[data-delete]')) onDelete();
  });

  modal.addEventListener('input', () => { if (form) form.dirty = true; });
  modal.addEventListener('change', async (e) => {
    if (!form) return;
    form.dirty = true;
    const el = e.target;
    if (el.matches('[data-image-input]')) {
      const file = el.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) { alert('Please choose an image file.'); return; }
      try {
        form.images[el.dataset.imageInput] = await imageToDataUrl(file);
        refreshImageField(el.dataset.imageInput);
      } catch (err) {
        console.error(err);
        alert('Sorry, that image could not be read.');
      }
    } else if (el.matches('input[name="amountUnit"]')) {
      const percent = el.value === 'percent';
      $('[data-amount-suffix]', modal).textContent = AMOUNT_UNITS[el.value].suffix;
      el.closest('.field').querySelector('.hint').textContent = percent ? PERCENT_HINT : YARDS_HINT;
    } else if (el.matches('input[name="status"]')) {
      const idx = STATUS_KEYS.indexOf(el.value);
      $$('.stepper .step', modal).forEach((s, i) => s.classList.toggle('done', i < idx));
      const year = $('[name="yearFinished"]', modal);
      if (el.value === 'finished' && !year.value) year.value = new Date().getFullYear();
    } else if (el.matches('select[name="threadId"]')) {
      el.closest('.row').querySelector('[data-open-linked]').disabled = !el.value;
    }
  });

  modal.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formEl = e.target;
    if (!formEl.reportValidity()) return;
    const btn = $('button[type="submit"]', formEl);
    btn.disabled = true;
    try {
      const fd = new FormData(formEl);
      const msg = form.kind === 'thread' ? await saveThread(fd) : await saveCanvas(fd);
      closeModal(true);
      render();
      toast(msg);
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      alert(storageErrorMessage(err));
    }
  });

  async function onDelete() {
    try {
      const ok = form.kind === 'thread' ? await deleteThread(form.id) : await deleteCanvas(form.id);
      if (!ok) return;
      const label = form.kind === 'thread' ? 'Thread deleted' : 'Canvas deleted';
      closeModal(true);
      render();
      toast(label);
    } catch (err) {
      console.error(err);
      alert(storageErrorMessage(err));
    }
  }

  function storageErrorMessage(err) {
    return err?.name === 'QuotaExceededError'
      ? 'Your browser is out of storage space for this app. Try removing some photos or exporting a backup.'
      : `Something went wrong saving your data: ${err?.message || err}`;
  }

  // ---------------------------------------------------------------------------
  // Page events
  // ---------------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    if (modal.contains(e.target)) return;
    const tab = e.target.closest('[data-tab]');
    if (tab) { setTab(tab.dataset.tab); return; }
    const nw = e.target.closest('[data-new]');
    if (nw) { nw.dataset.new === 'thread' ? openThreadForm() : openCanvasForm(); return; }
    const ot = e.target.closest('[data-open-thread]');
    if (ot) { openThreadForm(ot.dataset.openThread); return; }
    const oc = e.target.closest('[data-open-canvas]');
    if (oc) { openCanvasForm(oc.dataset.openCanvas); return; }
    const fam = e.target.closest('[data-family]');
    if (fam) { state.threadFamily = fam.dataset.family; renderThreads(); return; }
    const st = e.target.closest('[data-status]');
    if (st) {
      state.canvasStatus = st.dataset.status;
      renderCanvases();
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.card')) {
      e.preventDefault();
      e.target.click();
    }
  });

  $('#thread-search').addEventListener('input', (e) => { state.threadQuery = e.target.value; renderThreads(); });
  $('#thread-sort').addEventListener('change', (e) => { state.threadSort = e.target.value; renderThreads(); });
  $('#canvas-search').addEventListener('input', (e) => { state.canvasQuery = e.target.value; renderCanvases(); });

  function setTab(tab) {
    if (!['threads', 'canvases'].includes(tab)) tab = 'threads';
    state.tab = tab;
    if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
    render();
  }
  window.addEventListener('hashchange', () => setTab(location.hash.slice(1)));

  // ---------------------------------------------------------------------------
  // Backup: export / import
  // ---------------------------------------------------------------------------
  $('#btn-export').addEventListener('click', () => {
    const data = { app: 'needlepoint-tracker', version: 1, exportedAt: new Date().toISOString(), threads: state.threads, canvases: state.canvases };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `needlepoint-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Backup downloaded');
  });

  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.threads) || !Array.isArray(data.canvases)) throw new Error('This file is not a Needlepoint Tracker backup.');
      const valid = (x) => x && typeof x === 'object' && typeof x.id === 'string';
      const threads = data.threads.filter(valid).map(normalizeThread);
      const canvases = data.canvases.filter(valid).map(normalizeCanvas);
      if (!confirm(`Import ${plural(threads.length, 'thread')} and ${plural(canvases.length, 'canvas', 'canvases')}? Items with the same ID will be replaced; everything else is kept.`)) return;
      await dbWrite(STORES, (s) => {
        threads.forEach((t) => s('threads').put(t));
        canvases.forEach((c) => s('canvases').put(c));
      });
      await loadAll();
      render();
      toast('Import complete');
    } catch (err) {
      console.error(err);
      alert(`Import failed: ${err.message || err}`);
    }
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function hydrateIcons(root = document) {
    $$('[data-icon]', root).forEach((el) => { el.outerHTML = icon(el.dataset.icon); });
  }

  async function init() {
    hydrateIcons();
    if (!('indexedDB' in window)) {
      document.querySelector('main').innerHTML = '<div class="empty"><h2>Storage unavailable</h2><p>This browser does not support IndexedDB, which is needed to save your data.</p></div>';
      return;
    }
    navigator.storage?.persist?.().catch(() => {});
    try {
      await loadAll();
    } catch (err) {
      console.error(err);
      alert(`Could not open saved data: ${err.message || err}`);
    }
    setTab(location.hash.slice(1) || 'threads');
  }

  init();
})();
