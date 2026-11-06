// Zero-dependency server for the Needlepoint Tracker.
// Serves the app from public/ and stores each user's threads and canvases on the server.
// Usage: npm start  (then open http://localhost:5173)
//
// Environment:
//   PORT          port to listen on (default 5173)
//   DATA_DIR      where accounts and databases are stored (default ./data)
//   ALLOW_SIGNUP  set to "false" to stop new accounts from being created
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 5173;
const ROOT = path.join(__dirname, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DB_DIR = path.join(DATA_DIR, 'db');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP !== 'false';

const STORES = ['threads', 'canvases'];
const COOKIE = 'np_session';
const SESSION_DAYS = 30;
const MAX_BODY = 100 * 1024 * 1024; // photos are stored inline as data URLs
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
const MIN_PASSWORD = 8;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// JSON file storage
// ---------------------------------------------------------------------------
fs.mkdirSync(DB_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

/** Write via a temp file + rename so a crash never leaves a half-written file. */
async function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value));
  await fsp.rename(tmp, file);
}

// Serialise writes per file so concurrent requests can't interleave.
const queues = new Map();
function enqueue(key, task) {
  const next = (queues.get(key) || Promise.resolve()).then(task, task);
  queues.set(key, next.catch(() => {}));
  return next;
}

const users = readJson(USERS_FILE, {}); // lowercased username -> { id, username, salt, hash, createdAt }
const sessions = readJson(SESSIONS_FILE, {}); // sha256(token) -> { userId, expires }
const saveUsers = () => enqueue(USERS_FILE, () => writeJson(USERS_FILE, users));
const saveSessions = () => enqueue(SESSIONS_FILE, () => writeJson(SESSIONS_FILE, sessions));

const dbCache = new Map(); // userId -> { threads: {id: record}, canvases: {id: record} }
const dbFile = (userId) => path.join(DB_DIR, `${userId}.json`);
function loadDb(userId) {
  if (!dbCache.has(userId)) {
    const db = readJson(dbFile(userId), {});
    for (const s of STORES) db[s] ||= {};
    dbCache.set(userId, db);
  }
  return dbCache.get(userId);
}

// ---------------------------------------------------------------------------
// Passwords & sessions
// ---------------------------------------------------------------------------
const scrypt = (password, salt) =>
  new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key))));

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return { salt: salt.toString('hex'), hash: (await scrypt(password, salt)).toString('hex') };
}

async function verifyPassword(password, user) {
  const key = await scrypt(password, Buffer.from(user.salt, 'hex'));
  return crypto.timingSafeEqual(key, Buffer.from(user.hash, 'hex'));
}

const tokenKey = (token) => crypto.createHash('sha256').update(token).digest('hex');

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions[tokenKey(token)] = { userId, expires: Date.now() + SESSION_DAYS * 864e5 };
  saveSessions();
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`);
}

function readToken(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

function currentUser(req) {
  const token = readToken(req);
  if (!token) return null;
  const key = tokenKey(token);
  const s = sessions[key];
  if (!s) return null;
  if (s.expires < Date.now()) {
    delete sessions[key];
    saveSessions();
    return null;
  }
  return Object.values(users).find((u) => u.id === s.userId) || null;
}

// Drop expired sessions at startup.
for (const [k, s] of Object.entries(sessions)) if (s.expires < Date.now()) delete sessions[k];

// Slow down password guessing: 10 failed logins per IP per 15 minutes.
const failures = new Map();
function tooManyFailures(ip) {
  const f = failures.get(ip);
  if (!f || f.reset < Date.now()) return false;
  return f.count >= 10;
}
function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || f.reset < Date.now()) failures.set(ip, { count: 1, reset: Date.now() + 15 * 60e3 });
  else f.count++;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req) {
  // Requiring JSON forces a CORS preflight for cross-site requests, which together with
  // SameSite cookies stops other websites from writing to a logged-in user's data.
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
    return Promise.reject(new HttpError(415, 'Expected a JSON body'));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function handleApi(req, res, pathname) {
  const route = `${req.method} ${pathname}`;

  if (route === 'GET /api/session') {
    const user = currentUser(req);
    return user
      ? sendJson(res, 200, { user: { username: user.username }, allowSignup: ALLOW_SIGNUP })
      : sendJson(res, 401, { error: 'Not logged in', allowSignup: ALLOW_SIGNUP });
  }

  if (route === 'POST /api/register') {
    if (!ALLOW_SIGNUP) throw new HttpError(403, 'New accounts are turned off on this server.');
    const { username, password } = await readBody(req);
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      throw new HttpError(400, 'Usernames are 3–32 characters: letters, numbers, dots, dashes or underscores.');
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      throw new HttpError(400, `Passwords need at least ${MIN_PASSWORD} characters.`);
    }
    const key = username.toLowerCase();
    if (users[key]) throw new HttpError(409, 'That username is taken.');
    const user = { id: crypto.randomUUID(), username, ...(await hashPassword(password)), createdAt: new Date().toISOString() };
    if (users[key]) throw new HttpError(409, 'That username is taken.'); // re-check after the async hash
    users[key] = user;
    await saveUsers();
    createSession(res, user.id);
    return sendJson(res, 201, { user: { username } });
  }

  if (route === 'POST /api/login') {
    const ip = req.socket.remoteAddress;
    if (tooManyFailures(ip)) throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
    const { username, password } = await readBody(req);
    const user = typeof username === 'string' ? users[username.toLowerCase()] : null;
    const ok = user && typeof password === 'string' && (await verifyPassword(password, user));
    if (!ok) {
      recordFailure(ip);
      throw new HttpError(401, 'Wrong username or password.');
    }
    failures.delete(ip);
    createSession(res, user.id);
    return sendJson(res, 200, { user: { username: user.username } });
  }

  if (route === 'POST /api/logout') {
    const token = readToken(req);
    if (token && sessions[tokenKey(token)]) {
      delete sessions[tokenKey(token)];
      saveSessions();
    }
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return sendJson(res, 200, { ok: true });
  }

  // Everything below needs a logged-in user.
  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'Not logged in');

  if (route === 'GET /api/data') {
    const db = loadDb(user.id);
    return sendJson(res, 200, { threads: Object.values(db.threads), canvases: Object.values(db.canvases) });
  }

  if (route === 'POST /api/batch') {
    // Body: { ops: [{ op: 'put', store, value } | { op: 'delete', store, id }] } — applied all-or-nothing.
    const { ops } = await readBody(req);
    if (!Array.isArray(ops)) throw new HttpError(400, 'Expected ops');
    for (const o of ops) {
      if (!o || !STORES.includes(o.store)) throw new HttpError(400, 'Unknown store');
      if (o.op === 'put' && !(o.value && typeof o.value === 'object' && typeof o.value.id === 'string')) {
        throw new HttpError(400, 'Records need a string id');
      }
      if (o.op === 'delete' && typeof o.id !== 'string') throw new HttpError(400, 'Delete needs an id');
      if (o.op !== 'put' && o.op !== 'delete') throw new HttpError(400, 'Unknown op');
    }
    await enqueue(dbFile(user.id), async () => {
      const db = loadDb(user.id);
      const next = Object.fromEntries(STORES.map((s) => [s, { ...db[s] }]));
      for (const o of ops) {
        if (o.op === 'put') next[o.store][o.value.id] = o.value;
        else delete next[o.store][o.id];
      }
      await writeJson(dbFile(user.id), next);
      dbCache.set(user.id, next);
    });
    return sendJson(res, 200, { ok: true });
  }

  throw new HttpError(404, 'Not found');
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------
function serveStatic(req, res, pathname) {
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

http
  .createServer(async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (!pathname.startsWith('/api/')) {
      serveStatic(req, res, pathname);
      return;
    }
    try {
      await handleApi(req, res, pathname);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      if (!res.headersSent) sendJson(res, err.status || 500, { error: err instanceof HttpError ? err.message : 'Server error' });
    }
  })
  .listen(PORT, () => {
    console.log(`Needlepoint Tracker running at http://localhost:${PORT}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family === 'IPv4' && !a.internal) console.log(`  on your network: http://${a.address}:${PORT}`);
      }
    }
  });
