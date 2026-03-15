// server.js — AeroForge AI Backend Server v3
'use strict';

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const routes  = require('./routes');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: (origin, callback) => callback(null, true),
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms    = Date.now() - start;
    const color = res.statusCode >= 400 ? '\x1b[31m' : '\x1b[32m';
    console.log(`${color}${req.method}\x1b[0m ${req.path} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// Serve static frontend
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR));
  console.log(`\x1b[36mServing frontend from:\x1b[0m ${FRONTEND_DIR}`);
}

// API routes
app.use('/api', routes);

// For .html pages, serve them directly; otherwise fallback to index
app.get('*', (req, res) => {
  const PAGES = ['index','login','register','home','generator','comparison','aircraft-viewer','dashboard'];
  const reqPath = req.path.replace(/^\//, '').replace(/\.html$/, '') || 'index';
  if (PAGES.includes(reqPath)) {
    const filePath = path.join(FRONTEND_DIR, `${reqPath}.html`);
    if (fs.existsSync(filePath)) return res.sendFile(filePath);
  }
  const indexPath = path.join(FRONTEND_DIR, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

app.use((err, req, res, _next) => {
  console.error('\x1b[31mUnhandled error:\x1b[0m', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

app.listen(PORT, () => {
  const aiKey = process.env.ANTHROPIC_API_KEY;
  const aiStatus = aiKey && aiKey !== 'your_api_key_here'
    ? '\x1b[32m✓ Anthropic AI connected\x1b[0m'
    : '\x1b[33m⚠ No API key — using local engine (set ANTHROPIC_API_KEY in .env)\x1b[0m';

  console.log('');
  console.log('  \x1b[36m✈  AeroForge AI — v3.0 (Auth + Multi-page)\x1b[0m');
  console.log(`  \x1b[32m✓\x1b[0m  http://localhost:${PORT}            ← open in browser`);
  console.log(`  \x1b[32m✓\x1b[0m  http://localhost:${PORT}/api/health ← API health check`);
  console.log(`  ${aiStatus}`);
  console.log('');
});

module.exports = app;
