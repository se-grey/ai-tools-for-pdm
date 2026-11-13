const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const databasePath = process.env.DB_PATH || path.join(__dirname, 'boris.db');
const publicDirectory = path.join(__dirname, 'public');
const slotTimes = ['09:00', '11:00', '13:00', '15:00', '17:00'];

const db = new DatabaseSync(databasePath);
db.exec(`
  CREATE TABLE IF NOT EXISTS walk_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    walk_date TEXT NOT NULL,
    slot_time TEXT NOT NULL,
    booked_by TEXT,
    booked_at TEXT,
    UNIQUE (walk_date, slot_time),
    CHECK (
      (booked_by IS NULL AND booked_at IS NULL)
      OR
      (booked_by IS NOT NULL AND booked_at IS NOT NULL)
    )
  );

  CREATE TABLE IF NOT EXISTS feedings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_name TEXT NOT NULL,
    fed_at TEXT NOT NULL
  );
`);

function currentDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function ensureSlots(date) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO walk_slots (walk_date, slot_time) VALUES (?, ?)'
  );
  db.exec('BEGIN');
  try {
    for (const slotTime of slotTimes) {
      insert.run(date, slotTime);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getState() {
  const date = currentDate();
  ensureSlots(date);
  const slots = db.prepare(`
    SELECT slot_time AS slotTime, booked_by AS bookedBy, booked_at AS bookedAt
    FROM walk_slots
    WHERE walk_date = ?
    ORDER BY slot_time
  `).all(date);
  const lastFeeding = db.prepare(`
    SELECT employee_name AS employeeName, fed_at AS fedAt
    FROM feedings
    ORDER BY id DESC
    LIMIT 1
  `).get() || null;
  return { date, slots, lastFeeding };
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) {
      throw new Error('REQUEST_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new Error('INVALID_JSON');
  }
}

function validatedName(body) {
  if (typeof body.employeeName !== 'string') {
    return '';
  }
  return body.employeeName.trim();
}

async function handleApi(request, response, pathname) {
  if (request.method === 'GET' && pathname === '/api/state') {
    sendJson(response, 200, getState());
    return;
  }

  if (request.method === 'POST' && pathname === '/api/bookings') {
    const body = await readJson(request);
    const employeeName = validatedName(body);
    if (!employeeName) {
      sendJson(response, 400, { error: 'Введите непустое ФИО.' });
      return;
    }
    if (!slotTimes.includes(body.slotTime)) {
      sendJson(response, 400, { error: 'Выберите один из пяти слотов.' });
      return;
    }

    const date = currentDate();
    ensureSlots(date);
    const result = db.prepare(`
      UPDATE walk_slots
      SET booked_by = ?, booked_at = ?
      WHERE walk_date = ? AND slot_time = ? AND booked_by IS NULL
    `).run(employeeName, new Date().toISOString(), date, body.slotTime);

    if (result.changes === 0) {
      sendJson(response, 409, {
        error: 'Этот слот уже занят. Выберите свободное время.'
      });
      return;
    }

    sendJson(response, 201, getState());
    return;
  }

  if (request.method === 'POST' && pathname === '/api/feedings') {
    const body = await readJson(request);
    const employeeName = validatedName(body);
    if (!employeeName) {
      sendJson(response, 400, { error: 'Введите непустое ФИО.' });
      return;
    }

    const fedAt = new Date().toISOString();
    db.prepare(
      'INSERT INTO feedings (employee_name, fed_at) VALUES (?, ?)'
    ).run(employeeName, fedAt);
    sendJson(response, 201, { employeeName, fedAt });
    return;
  }

  sendJson(response, 404, { error: 'Такого действия нет.' });
}

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
]);

async function handleStatic(response, pathname) {
  const file = staticFiles.get(pathname);
  if (!file) {
    sendJson(response, 404, { error: 'Страница не найдена.' });
    return;
  }
  const [fileName, contentType] = file;
  const content = await fs.readFile(path.join(publicDirectory, fileName));
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': content.length
  });
  response.end(content);
}

const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
    if (pathname.startsWith('/api/')) {
      await handleApi(request, response, pathname);
    } else if (request.method === 'GET') {
      await handleStatic(response, pathname);
    } else {
      sendJson(response, 405, { error: 'Метод не поддерживается.' });
    }
  } catch (error) {
    if (error.message === 'INVALID_JSON' || error.message === 'REQUEST_TOO_LARGE') {
      sendJson(response, 400, { error: 'Некорректные данные запроса.' });
      return;
    }
    console.error(error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: 'Не удалось выполнить действие. Попробуйте ещё раз.' });
    }
  }
});

ensureSlots(currentDate());
server.listen(port, host, () => {
  console.log(`Кто выгуливает Бориса: http://${host}:${port}`);
});
