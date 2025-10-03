const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Middleware
app.use(cors());
app.use(express.json());

// Database setup
const db = new Database('users.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL
  )
`);

// Add demo users
const addDemoUser = db.prepare('INSERT OR IGNORE INTO users (username, password, name) VALUES (?, ?, ?)');
const hashedPassword = bcrypt.hashSync('password', 10);
addDemoUser.run('demo', hashedPassword, 'Demo User');
addDemoUser.run('admin', hashedPassword, 'Admin User');

// Routes
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });

  res.json({ token, name: user.name });
});

app.post('/api/register', (req, res) => {
  const { username, password, name } = req.body;

  const hashedPassword = bcrypt.hashSync(password, 10);

  try {
    const insert = db.prepare('INSERT INTO users (username, password, name) VALUES (?, ?, ?)');
    insert.run(username, hashedPassword, name);

    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, name });
  } catch (error) {
    res.status(400).json({ error: 'Username already exists' });
  }
});

app.get('/api/me', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, name FROM users WHERE username = ?').get(decoded.username);
    res.json(user);
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

module.exports = app;
