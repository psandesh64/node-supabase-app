require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { pool, init } = require('./db');

const app = express();

// CORS: localhost (any port) + origins listed in ALLOWED_ORIGINS
const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    // no origin = curl, Postman, server-to-server, UptimeRobot
    if (!origin) return cb(null, true);
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
    if (allowed.includes(origin)) return cb(null, true);
    cb(null, false); // blocked: browser gets no CORS headers
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// health check (use this URL for UptimeRobot ping)
app.get('/', async (req, res) => {
  await pool.query('select 1');
  res.json({ status: 'ok' });
});

// GET all users
app.get('/users', async (req, res) => {
  const { rows } = await pool.query('select * from users order by id');
  res.json(rows);
});

// GET one user
app.get('/users/:id', async (req, res) => {
  const { rows } = await pool.query('select * from users where id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// POST create user
app.post('/users', async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email required' });
  const { rows } = await pool.query(
    'insert into users (name, email) values ($1, $2) returning *',
    [name, email]
  );
  res.status(201).json(rows[0]);
});

// PUT update user
app.put('/users/:id', async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email required' });
  const { rows } = await pool.query(
    'update users set name = $1, email = $2 where id = $3 returning *',
    [name, email, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// DELETE user
app.delete('/users/:id', async (req, res) => {
  const { rowCount } = await pool.query('delete from users where id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

// error handler (Express 4 needs async errors caught)
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
  if (err.code === '22P02') return res.status(400).json({ error: 'Invalid id' });
  res.status(500).json({ error: 'Server error' });
});

// wrap async route errors
for (const layer of app._router.stack) {
  if (layer.route) {
    for (const s of layer.route.stack) {
      const fn = s.handle;
      s.handle = (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    }
  }
}

const PORT = process.env.PORT || 3000;
init()
  .then(() => app.listen(PORT, () => console.log(`Running on port ${PORT}`)))
  .catch((err) => {
    console.error('DB init failed:', err.message);
    process.exit(1);
  });