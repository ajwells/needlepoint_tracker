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
  /** Which canvases a thread suits; a thread can have several. */
  const THREAD_SIZES = [['13', '13 mesh'], ['18', '18 mesh'], ['strandable', 'Strandable']];
  const THREAD_SIZE_LABEL = Object.fromEntries(THREAD_SIZES);
  const sizesLabel = (t) => (t.sizes || []).map((s) => THREAD_SIZE_LABEL[s]).join(', ');
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
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
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
  // Storage
  // Served over http(s): each user's data lives on the server behind a login.
  // Opened as a file: data stays in this browser's IndexedDB (no login).
  // ---------------------------------------------------------------------------
  const DB_NAME = 'needlepoint-tracker';
  const STORES = ['threads', 'canvases'];
  const SERVER = location.protocol === 'http:' || location.protocol === 'https:';
  /** True while logged in to an account; false for guests and file:// use, whose data stays in this browser. */
  let useServer = SERVER;
  let dbPromise;

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'Could not reach the server. Check your connection.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.startsWith('/api/login') && !url.startsWith('/api/session')) showAuth('Your session has ended. Please log in again.');
    if (!res.ok) throw Object.assign(new ApiError(res.status, data.error || `Request failed (${res.status})`), { data });
    return data;
  }

  /** Load every record from the active backend. */
  async function dbLoad() {
    if (useServer) return api('GET', '/api/data');
    const [threads, canvases] = await Promise.all([idbGetAll('threads'), idbGetAll('canvases')]);
    return { threads, canvases };
  }

  /**
   * Run writes across one or more stores atomically.
   * `fn` receives `s(storeName)` exposing `put(record)` and `delete(id)`.
   */
  async function dbWrite(stores, fn) {
    if (!useServer) return idbWrite(stores, fn);
    const ops = [];
    fn((store) => ({
      put: (value) => ops.push({ op: 'put', store, value }),
      delete: (id) => ops.push({ op: 'delete', store, id }),
    }));
    if (ops.length) await api('POST', '/api/batch', { ops });
  }

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

  async function idbGetAll(store) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /** Run writes across one or more IndexedDB stores in a single atomic transaction. */
  async function idbWrite(stores, fn) {
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
    threadStock: '', // '' all, 'in' in stash, 'out' out of stock
    threadSort: 'brand',
    canvasQuery: '',
    canvasStatus: '',
  };

  async function loadAll() {
    const { threads, canvases } = await dbLoad();
    state.threads = threads.map(normalizeThread);
    state.canvases = canvases.map(normalizeCanvas);
  }

  /**
   * Upgrade older thread records:
   * - amounts saved as `yardsLeft` before units existed
   * - code / dye lot saved as numbers before they became text (codes like "C-109", lots like "512B")
   * - a single numeric `size` (e.g. Perle #5) before sizes became 13 / 18 / strandable:
   *   the number is a product size, so it moves into the material ("Pearl cotton #5")
   */
  function normalizeThread(t) {
    const { yardsLeft, size, ...rest } = t;
    const out = { ...rest, code: textOrEmpty(rest.code), dyeLot: textOrEmpty(rest.dyeLot) };
    if ('yardsLeft' in t) {
      out.amountLeft = rest.amountLeft ?? yardsLeft ?? null;
      out.amountUnit = rest.amountUnit || 'yards';
    }
    const valid = THREAD_SIZES.map(([k]) => k);
    out.sizes = Array.isArray(rest.sizes) ? valid.filter((k) => rest.sizes.map(String).includes(k)) : [];
    if (size !== null && size !== undefined && size !== '') {
      const material = textOrEmpty(rest.material);
      out.material = material.includes(`#${size}`) ? material : `${material} #${size}`.trim();
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
    const extra = [t.material, sizesLabel(t)].filter(Boolean).join(', ');
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

  /** Out of stock only when the amount is explicitly 0; an empty amount means "have it, not measured". */
  const isOutOfStock = (t) => t.amountLeft === 0;
  const STOCK_FILTERS = [['', 'All threads'], ['in', 'In stash'], ['out', 'Out of stock']];

  function renderStockFilter() {
    const out = state.threads.filter(isOutOfStock).length;
    const counts = { '': state.threads.length, in: state.threads.length - out, out };
    $('#stock-filter').innerHTML = STOCK_FILTERS.map(([value, label]) =>
      `<button class="chip ${state.threadStock === value ? 'active' : ''}" data-stock="${value}" aria-pressed="${state.threadStock === value}">${
        esc(label)} <span class="muted">${counts[value]}</span></button>`).join('');
  }

  function renderThreads() {
    renderStockFilter();
    renderFamilyFilter();
    const usage = buildUsage();
    const q = state.threadQuery.trim().toLowerCase();
    let list = state.threads.filter((t) => {
      if (state.threadStock && isOutOfStock(t) !== (state.threadStock === 'out')) return false;
      if (state.threadFamily && t.colorFamily !== state.threadFamily) return false;
      if (!q) return true;
      const hay = [t.brand, t.material, t.color, t.code, t.dyeLot, t.colorFamily, t.colorFamily === 'Grey' ? 'gray' : '', sizesLabel(t)]
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
      grid.innerHTML = emptyState('search', 'No matches', 'Try a different search, stock or color filter.');
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
      ...(t.sizes || []).map((s) => `<span class="badge">${esc(THREAD_SIZE_LABEL[s])}</span>`),
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
        const hay = [c.name, c.designer, c.shopName, c.notes, c.yearFinished, c.meshSize, STATUS_LABEL[c.status],
          c.finishType, c.giftedTo, isGifted(c) ? 'gifted' : ''].join(' ').toLowerCase();
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

  /** A canvas counts as gifted once someone is named in "Gifted to". */
  const isGifted = (c) => !!(c.giftedTo && c.giftedTo.trim());

  function canvasCard(c) {
    const img = c.finishedPicture || c.picture;
    const status = statusBadge(c) + (isGifted(c)
      ? `<span class="badge gifted" title="Gifted to ${esc(c.giftedTo)}">${icon('gift')}Gifted</span>` : '');
    const meta = [
      c.finishType ? `<span class="badge">${esc(c.finishType)}</span>` : '',
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

  /**
   * How a read-only canvas shows its thread and cording lists: 'table' (default; one line per row,
   * scrolls sideways on narrow screens) or 'cards' (stacked). Remembered per device.
   */
  const LIST_LAYOUT_KEY = 'needlepoint-list-layout';
  const listLayout = {
    get: () => { try { return localStorage.getItem(LIST_LAYOUT_KEY) === 'cards' ? 'cards' : 'table'; } catch { return 'table'; } },
    set: (v) => { try { localStorage.setItem(LIST_LAYOUT_KEY, v); } catch {} },
  };
  function applyListLayout(layout) {
    modal.classList.toggle('list-table', layout === 'table');
    // Full linked-thread name on hover, for names too long for the column.
    $$('[data-rows] select[name="threadId"]', modal).forEach((s) => { s.title = s.selectedOptions[0]?.textContent || ''; });
    $$('[data-list-layout]', modal).forEach((b) => {
      b.classList.toggle('active', b.dataset.listLayout === layout);
      b.setAttribute('aria-pressed', String(b.dataset.listLayout === layout));
    });
  }

  function openModal(html, { wide = false } = {}) {
    modal.classList.toggle('wide', wide);
    modal.classList.remove('list-table');
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
        ${value ? `<img src="${esc(value)}" alt="${esc(label)}">` : `<span class="image-placeholder">${icon('camera')}<span data-edit-only>Add photo</span><span data-view-only>No photo</span></span>`}
      </label>
      <div class="image-actions" data-edit-only>
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
      ${isEdit ? `<button type="button" class="btn danger" data-delete data-edit-only>${icon('trash')}Delete</button>` : ''}
      <span class="spacer"></span>
      <button type="button" class="btn ghost" data-close data-view-only>Close</button>
      <button type="button" class="btn primary" data-edit data-view-only>${icon('edit')}Edit</button>
      <button type="button" class="btn ghost" data-cancel-edit data-edit-only>Cancel</button>
      <button type="submit" class="btn primary" data-edit-only>${isEdit ? 'Save changes' : `Add ${kindLabel}`}</button>
    </footer>`;
  }

  /**
   * Switch the open form between read-only viewing and editing.
   * Existing items open read-only; new items open straight into editing.
   */
  function setEditing(on) {
    form.editing = on;
    modal.classList.toggle('viewing', !on);
    $('#modal-title', modal).textContent = on ? `${form.id ? 'Edit' : 'New'} ${form.kind}` : form.title;
    for (const el of $$('input, select, textarea', modal)) {
      if (el.matches('select, [type="checkbox"], [type="radio"], [type="file"]')) {
        el.disabled = !on;
      } else {
        el.readOnly = !on;
        if (!('ph' in el.dataset)) el.dataset.ph = el.placeholder;
        el.placeholder = on ? el.dataset.ph : '—';
      }
    }
    $('button[type="submit"]', modal).disabled = !on;
  }

  // ---- Thread form ----
  const YARDS_HINT = 'Yards remaining.';
  const PERCENT_HINT = 'Percent of a full skein or card. Use more than 100% for extras, e.g. 250% = 2½ skeins.';
  function openThreadForm(id, { edit = !id } = {}) {
    if (modal.open && !confirmDiscard()) return;
    const t = id ? threadById(id) : {};
    if (id && !t) return;
    form = { kind: 'thread', id: id || null, title: threadName(t), images: { picture: t.picture || null }, dirty: false };
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
            <div class="field" role="group" aria-label="Thread size"><span class="label">Thread size</span>
              <div class="family-picker">
                ${THREAD_SIZES.map(([k, label]) => `<label><input type="checkbox" name="sizes" value="${k}" ${(t.sizes || []).includes(k) ? 'checked' : ''}><span class="chip">${label}</span></label>`).join('')}
              </div>
            </div>
            ${field('Dye lot', `<input name="dyeLot" value="${v('dyeLot')}" placeholder="e.g. 512B" autocomplete="off">`)}
            <div class="field span-2"><span class="label">Amount left</span>
              <div class="amount-row">
                <div class="input-adorn"><input name="amountLeft" class="has-suffix" type="number" inputmode="decimal" min="0" step="any" value="${v('amountLeft')}" placeholder="0" aria-label="Amount left"><span class="suffix" data-amount-suffix>${AMOUNT_UNITS[unit].suffix}</span></div>
                <div class="segmented" role="radiogroup" aria-label="Amount unit">
                  ${Object.entries(AMOUNT_UNITS).map(([k, u]) => `<label><input type="radio" name="amountUnit" value="${k}" ${unit === k ? 'checked' : ''}>${u.label}</label>`).join('')}
                </div>
              </div>
              <span class="hint" data-edit-only>${unit === 'percent' ? PERCENT_HINT : YARDS_HINT}</span>
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
    setEditing(edit);
  }

  async function saveThread(fd) {
    const existing = form.id ? threadById(form.id) : null;
    const t = {
      id: form.id || uid(),
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now(),
      brand: str(fd.get('brand')),
      material: str(fd.get('material')),
      sizes: THREAD_SIZES.map(([k]) => k).filter((k) => fd.getAll('sizes').includes(k)),
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
      <button type="button" class="icon-btn" data-remove-row data-edit-only title="Remove row" aria-label="Remove row">${icon('close')}</button>
    </div>`;

  function threadRowHtml(r = {}) {
    return `<div class="row" data-row="thread">
      ${cell('Color description', `<input name="colorDescription" value="${esc(r.colorDescription)}" placeholder="e.g. dark green">`)}
      ${cell('Item description', `<input name="itemDescription" value="${esc(r.itemDescription)}" placeholder="e.g. holly leaves">`)}
      ${cell('Specialty stitch type', `<input name="stitchType" value="${esc(r.stitchType)}" placeholder="e.g. French knots">`)}
      ${cell('Strands', `<input name="strands" type="number" inputmode="numeric" min="0" step="1" value="${esc(r.strands)}">`)}
      ${cell('Linked thread', `<select name="threadId">${threadOptions(r.threadId)}</select>`, 'wide')}
      ${rowActions(r.threadId)}
    </div>`;
  }
  /** Strands in a finished cord: strands × bundles per row; an empty bundle count means one bundle. */
  const cordingTotal = (rows) => rows.reduce((sum, r) => sum + (r.strands || 0) * (r.bundles ?? 1), 0);

  function cordingRowHtml(r = {}) {
    return `<div class="row" data-row="cording">
      ${cell('Strands', `<input name="strands" type="number" inputmode="numeric" min="0" step="1" value="${esc(r.strands)}" aria-label="Strands per bundle">`)}
      ${cell('Bundles', `<input name="bundles" type="number" inputmode="numeric" min="0" step="1" value="${esc(r.bundles)}" placeholder="1">`)}
      ${cell('Linked thread', `<select name="threadId">${threadOptions(r.threadId)}</select>`, 'wide')}
      ${rowActions(r.threadId)}
    </div>`;
  }

  function openCanvasForm(id, { edit = !id } = {}) {
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
      kind: 'canvas', id: id || null, title: c.name || 'Untitled canvas', dirty: false,
      images: { picture: c.picture || null, finishedPicture: c.finishedPicture || null },
    };
    const v = (k) => esc(c[k] ?? '');
    const noThreadsHint = state.threads.length
      ? ''
      : `<p class="note" data-edit-only>Tip: add threads in the Threads tab first so you can link them here.</p>`;

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
            ${field('Finish type', `<input name="finishType" value="${v('finishType')}" placeholder="e.g. ornament, pillow, framed" autocomplete="off">`)}
            ${field('Gifted to', `<input name="giftedTo" value="${v('giftedTo')}" placeholder="e.g. Mom" autocomplete="off">
              <span class="hint" data-edit-only>Filling this in marks the canvas as gifted.</span>`)}
          </div>
        </div>

        <div class="section">
          <div class="section-head"><h3>Threads</h3>
            <div class="layout-toggle" role="group" aria-label="Thread and cording list layout" data-view-only>
              <button type="button" data-list-layout="table">Table</button>
              <button type="button" data-list-layout="cards">Cards</button>
            </div>
            <button type="button" class="btn ghost sm" data-add-row="thread" data-edit-only>${icon('plus')}Add thread</button></div>
          ${noThreadsHint}
          <div class="rows thread-rows">
            <div class="rows-head"><span>Color description</span><span>Item description</span><span>Specialty stitch type</span><span>Strands</span><span>Linked thread</span><span></span><span></span></div>
            <div class="rows" data-rows="thread">${c.threads.map(threadRowHtml).join('')}</div>
          </div>
        </div>

        <div class="section">
          <div class="section-head"><h3>Cording</h3>
            <button type="button" class="btn ghost sm" data-add-row="cording" data-edit-only>${icon('plus')}Add cording</button></div>
          <div class="rows cording-rows">
            <div class="rows-head"><span>Strands</span><span>Bundles</span><span>Linked thread</span><span></span><span></span></div>
            <div class="rows" data-rows="cording">${c.cording.map(cordingRowHtml).join('')}</div>
          </div>
          <p class="cording-total" data-cording-total></p>
        </div>

        <div class="section">
          <h3>Notes</h3>
          <label class="field"><textarea name="notes" placeholder="Stitch guide notes, finishing plans, ideas…" aria-label="Notes">${v('notes')}</textarea></label>
        </div>
      </div>
      ${modalFoot(!!id, 'canvas')}
    `, { wide: true });
    updateRowsEmpty();
    updateCordingTotal();
    applyListLayout(listLayout.get());
    setEditing(edit);
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

  /** Read the cording rows currently in the form. */
  function formCordingRows() {
    const val = (row, name) => row.querySelector(`[name="${name}"]`).value;
    return $$('[data-rows="cording"] .row', modal).map((row) => ({
      strands: intOrNull(val(row, 'strands')),
      bundles: intOrNull(val(row, 'bundles')),
      threadId: val(row, 'threadId') || null,
    }));
  }

  function updateCordingTotal() {
    const el = $('[data-cording-total]', modal);
    if (!el) return;
    const rows = formCordingRows().filter((r) => r.strands != null);
    el.hidden = !rows.length;
    el.innerHTML = `Total cording size: <strong>${plural(cordingTotal(rows), 'strand')}</strong>
      <span class="muted">(strands × bundles${rows.some((r) => r.bundles == null) ? '; empty bundles count as 1' : ''})</span>`;
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
    const cording = formCordingRows().filter((r) => r.strands != null || r.bundles != null || r.threadId);
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
      finishType: str(fd.get('finishType')),
      giftedTo: str(fd.get('giftedTo')),
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
    else if (t.matches('[data-list-layout]')) {
      listLayout.set(t.dataset.listLayout);
      applyListLayout(t.dataset.listLayout);
    } else if (t.matches('[data-edit]')) {
      setEditing(true);
      $('.modal-body input:not([type="file"]):not([type="radio"]):not([type="checkbox"])', modal)?.focus({ preventScroll: true });
    } else if (t.matches('[data-cancel-edit]')) {
      // Existing item: drop the edits and go back to viewing the saved version. New item: close.
      if (!form.id) closeModal();
      else if (confirmDiscard()) {
        const { kind, id } = form;
        form.dirty = false;
        kind === 'thread' ? openThreadForm(id) : openCanvasForm(id);
      }
    } else if (t.matches('[data-remove-image]')) {
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
      updateCordingTotal();
    } else if (t.matches('[data-open-linked]')) {
      const id = t.closest('.row').querySelector('[name="threadId"]').value;
      if (id) openThreadForm(id);
    } else if (t.matches('[data-open-canvas]')) openCanvasForm(t.dataset.openCanvas);
    else if (t.matches('[data-delete]')) onDelete();
  });

  modal.addEventListener('input', (e) => {
    if (form) form.dirty = true;
    if (e.target.closest('[data-rows="cording"]')) updateCordingTotal();
  });
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
    if (!form?.editing) return; // Enter in a read-only field shouldn't save
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
    if (err?.status === 401) return 'You were logged out, so this change was not saved. Log in and try again.';
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
    const stock = e.target.closest('[data-stock]');
    if (stock) { state.threadStock = stock.dataset.stock; renderThreads(); return; }
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
  function downloadFile(content, type, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const today = () => new Date().toISOString().slice(0, 10);

  /**
   * Build CSV text that opens cleanly in Excel / Google Sheets:
   * quoted where needed, CRLF line endings, a BOM so Excel reads UTF-8,
   * and text starting with = + - @ prefixed with ' so spreadsheets don't run it as a formula.
   */
  function toCsv(header, rows) {
    const cell = (v) => {
      if (v === null || v === undefined) return '';
      let s = String(v);
      if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  const csvDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');
  const threadRef = (id) => {
    const t = id && threadById(id);
    return t ? [t.brand, t.code ? `#${t.code}` : '', t.color, t.dyeLot ? `(lot ${t.dyeLot})` : ''].filter(Boolean).join(' ') : '';
  };

  function threadsCsv() {
    const usage = buildUsage();
    const header = ['Brand', 'Material', 'Color', 'Code', 'Dye lot', 'Color family', 'Thread sizes',
      'Amount left', 'Amount unit', 'In stock', 'Canvases used in', 'Added', 'Updated'];
    const rows = [...state.threads].sort(compareThreads).map((t) => [
      t.brand, t.material, t.color, t.code, t.dyeLot, t.colorFamily ? familyLabel(t.colorFamily) : '', sizesLabel(t),
      t.amountLeft, t.amountLeft == null ? '' : t.amountUnit === 'percent' ? '% of skein/card' : 'yards',
      isOutOfStock(t) ? 'No' : 'Yes',
      usageFor(usage, t.id).map(({ canvas }) => canvas.name || 'Untitled canvas').join('; '),
      csvDate(t.createdAt), csvDate(t.updatedAt),
    ]);
    return toCsv(header, rows);
  }

  function canvasesCsv() {
    const header = ['Name', 'Status', 'Designer', 'Needlepoint shop', 'Shop website', 'Mesh size', 'Date purchased',
      'Price', 'Year finished', 'Finish type', 'Gifted', 'Gifted to', 'Threads', 'Cording', 'Cording total strands', 'Notes', 'Added', 'Updated'];
    const strands = (n) => (n != null ? `${n} strand${n === 1 ? '' : 's'}` : '');
    const rows = [...state.canvases]
      .sort((a, b) => STATUS_KEYS.indexOf(a.status) - STATUS_KEYS.indexOf(b.status) || (a.name || '').localeCompare(b.name || ''))
      .map((c) => [
        c.name, STATUS_LABEL[c.status], c.designer, c.shopName, c.shopUrl, c.meshSize ? `${c.meshSize} mesh` : '',
        c.datePurchased, c.price != null ? c.price.toFixed(2) : '', c.yearFinished,
        c.finishType, isGifted(c) ? 'Yes' : 'No', c.giftedTo,
        // One line per thread row inside the cell: "Dark green: holly leaves, basketweave, 2 strands - DMC #890 Green"
        c.threads.map((r) => {
          const label = [r.colorDescription, r.itemDescription].filter(Boolean).join(': ');
          const detail = [r.stitchType, strands(r.strands)].filter(Boolean).join(', ');
          return [[label, detail].filter(Boolean).join(', '), threadRef(r.threadId)].filter(Boolean).join(' - ');
        }).filter(Boolean).join('\n'),
        c.cording.map((r) => [
          [r.bundles != null ? `${plural(r.bundles, 'bundle')} of` : '', strands(r.strands)].filter(Boolean).join(' '),
          threadRef(r.threadId),
        ].filter(Boolean).join(' - ')).filter(Boolean).join('\n'),
        c.cording.some((r) => r.strands != null) ? cordingTotal(c.cording) : '',
        c.notes, csvDate(c.createdAt), csvDate(c.updatedAt),
      ]);
    return toCsv(header, rows);
  }

  const EXPORTS = {
    json: () => {
      const data = { app: 'needlepoint-tracker', version: 1, exportedAt: new Date().toISOString(), threads: state.threads, canvases: state.canvases };
      downloadFile(JSON.stringify(data), 'application/json', `needlepoint-backup-${today()}.json`);
      toast('Backup downloaded');
    },
    'threads-csv': () => {
      downloadFile(threadsCsv(), 'text/csv;charset=utf-8', `needlepoint-threads-${today()}.csv`);
      toast(`Exported ${plural(state.threads.length, 'thread')} to CSV`);
    },
    'canvases-csv': () => {
      downloadFile(canvasesCsv(), 'text/csv;charset=utf-8', `needlepoint-canvases-${today()}.csv`);
      toast(`Exported ${plural(state.canvases.length, 'canvas', 'canvases')} to CSV`);
    },
  };

  const exportMenu = $('#export-menu');
  function setExportMenu(open) {
    exportMenu.hidden = !open;
    $('#btn-export').setAttribute('aria-expanded', String(open));
    exportMenu.style.setProperty('--menu-top', `${$('#btn-export').getBoundingClientRect().bottom + 6}px`);
    if (open) $('button', exportMenu).focus();
  }
  $('#btn-export').addEventListener('click', (e) => {
    e.stopPropagation();
    setExportMenu(exportMenu.hidden);
  });
  exportMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-export]');
    if (!b) return;
    setExportMenu(false);
    EXPORTS[b.dataset.export]();
  });
  document.addEventListener('click', (e) => {
    if (!exportMenu.hidden && !exportMenu.contains(e.target)) setExportMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !exportMenu.hidden) {
      setExportMenu(false);
      $('#btn-export').focus();
    }
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

  // ---------------------------------------------------------------------------
  // Accounts (server mode only)
  // ---------------------------------------------------------------------------
  const auth = { mode: 'login', allowSignup: true };
  const GUEST_KEY = 'needlepoint-guest';
  const GUEST_WARNING =
    "Guest data is not saved on the server. It stays in this browser only, so it won't appear on your other devices, " +
    'and clearing your browser data erases it. Use Export and Import to back it up or share it.';
  // Remember guest mode across reloads; storage can be unavailable (private windows), so never rely on it.
  const guestFlag = {
    get: () => { try { return localStorage.getItem(GUEST_KEY) === '1'; } catch { return false; } },
    set: (on) => { try { on ? localStorage.setItem(GUEST_KEY, '1') : localStorage.removeItem(GUEST_KEY); } catch {} },
  };

  function showAuth(message = '') {
    state.threads = [];
    state.canvases = [];
    $('#thread-grid').innerHTML = '';
    $('#canvas-grid').innerHTML = '';
    $('#count-threads').textContent = $('#count-canvases').textContent = '0';
    if ($('#modal').open) $('#modal').close();
    useServer = SERVER;
    document.body.classList.add('signed-out');
    document.body.classList.remove('guest');
    $('#guest-banner').hidden = true;
    $('#auth').hidden = false;
    $('#user-menu').hidden = true;
    setAuthMode(auth.mode);
    $('#auth-error').textContent = message;
    $('#auth-error').hidden = !message;
    $('#auth-form [name="password"]').value = '';
    $('#auth-form [name="username"]').focus();
  }

  function setAuthMode(mode) {
    auth.mode = auth.allowSignup ? mode : 'login';
    const signup = auth.mode === 'register';
    $('#auth-title').textContent = signup ? 'Create your account' : 'Log in';
    $('#auth-lead').textContent = signup
      ? 'Your threads and canvases are saved to your account so you can reach them from any device.'
      : 'Log in to see your threads and canvases.';
    $('#auth-submit').textContent = signup ? 'Create account' : 'Log in';
    $('#auth-form [name="password"]').autocomplete = signup ? 'new-password' : 'current-password';
    $('#auth-form [name="password"]').minLength = signup ? 8 : 0;
    $('#auth-password-hint').hidden = !signup;
    $('#auth-switch').hidden = !auth.allowSignup;
    $('#auth-switch').innerHTML = signup
      ? 'Already have an account? <button type="button" class="link" data-auth-mode="login">Log in</button>'
      : 'New here? <button type="button" class="link" data-auth-mode="register">Create an account</button>';
    $('#auth-error').hidden = true;
  }

  function showUserMenu(name, buttonLabel, buttonTitle) {
    document.body.classList.remove('signed-out');
    $('#auth').hidden = true;
    $('#user-menu').hidden = false;
    $('#user-name').textContent = name;
    $('#btn-logout .btn-label').textContent = buttonLabel;
    $('#btn-logout').title = buttonTitle;
  }

  /** Use the app without an account: data lives in this browser's IndexedDB, like the file:// version. */
  async function enterGuest() {
    if (!('indexedDB' in window)) {
      showAuth('Guest mode needs browser storage, which is unavailable here (it can be blocked in private windows). Please log in instead.');
      return;
    }
    useServer = false;
    guestFlag.set(true);
    document.body.classList.add('guest');
    $('#guest-banner').hidden = false;
    $('#guest-signup').hidden = !auth.allowSignup; // no "Create an account" when the server has signups turned off
    showUserMenu('Guest', 'Exit guest', 'Leave guest mode (your guest data stays in this browser)');
    navigator.storage?.persist?.().catch(() => {});
    try {
      await loadAll();
    } catch (err) {
      console.error(err);
      alert(`Could not open saved data: ${err.message || err}`);
    }
    setTab(location.hash.slice(1) || 'threads');
  }

  async function signedIn(username) {
    useServer = true;
    guestFlag.set(false);
    document.body.classList.remove('guest');
    $('#guest-banner').hidden = true;
    showUserMenu(username, 'Log out', `Log out ${username}`);
    try {
      await loadAll();
    } catch (err) {
      console.error(err);
      if (err.status !== 401) alert(`Could not load your data: ${err.message || err}`);
      return;
    }
    setTab(location.hash.slice(1) || 'threads');
    offerLocalUpload();
  }

  /** If this browser has local data (guest mode, or from before accounts existed), offer to move it into the empty account. */
  async function offerLocalUpload() {
    if (state.threads.length || state.canvases.length || !('indexedDB' in window)) return;
    let local;
    try {
      const [threads, canvases] = await Promise.all([idbGetAll('threads'), idbGetAll('canvases')]);
      local = { threads, canvases };
    } catch {
      return;
    }
    if (!local.threads.length && !local.canvases.length) return;
    const what = `${plural(local.threads.length, 'thread')} and ${plural(local.canvases.length, 'canvas', 'canvases')}`;
    if (!confirm(`This browser has ${what} saved locally (from guest mode or before you had an account). Add them to your account?`)) return;
    try {
      await dbWrite(STORES, (s) => {
        local.threads.forEach((t) => s('threads').put(normalizeThread(t)));
        local.canvases.forEach((c) => s('canvases').put(normalizeCanvas(c)));
      });
      await loadAll();
      render();
      toast(`Added ${what} to your account`);
    } catch (err) {
      console.error(err);
      alert(storageErrorMessage(err));
    }
  }

  $('#auth-guest').addEventListener('click', () => {
    if (confirm(`Continue as a guest?\n\n${GUEST_WARNING}`)) enterGuest();
  });
  $('#guest-signup').addEventListener('click', () => {
    guestFlag.set(false);
    auth.mode = 'register';
    showAuth();
  });

  $('#auth').addEventListener('click', (e) => {
    const b = e.target.closest('[data-auth-mode]');
    if (b) {
      setAuthMode(b.dataset.authMode);
      $('#auth-form [name="username"]').focus();
    }
  });

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = $('#auth-submit');
    btn.disabled = true;
    $('#auth-error').hidden = true;
    try {
      const { user } = await api('POST', auth.mode === 'register' ? '/api/register' : '/api/login', {
        username: String(fd.get('username')).trim(),
        password: String(fd.get('password')),
      });
      e.target.reset();
      await signedIn(user.username);
    } catch (err) {
      $('#auth-error').textContent = err.message;
      $('#auth-error').hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  $('#btn-logout').addEventListener('click', async () => {
    if (!useServer) {
      // Leaving guest mode keeps the guest data in this browser for next time.
      guestFlag.set(false);
    } else {
      try {
        await api('POST', '/api/logout');
      } catch (err) {
        console.error(err);
      }
    }
    auth.mode = 'login';
    showAuth();
  });

  async function init() {
    hydrateIcons();
    if (!SERVER) {
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
      return;
    }
    document.body.classList.add('signed-out'); // keep the app hidden until we know who is logged in
    let session;
    try {
      session = await api('GET', '/api/session');
    } catch (err) {
      auth.allowSignup = err.data?.allowSignup !== false;
      if (guestFlag.get()) enterGuest();
      else showAuth(err.status === 401 ? '' : err.message);
      return;
    }
    auth.allowSignup = session.allowSignup !== false;
    await signedIn(session.user.username);
  }

  init();
})();
