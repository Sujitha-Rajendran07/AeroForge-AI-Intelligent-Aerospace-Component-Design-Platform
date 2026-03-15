// auth.js — AeroForge JWT-like auth using built-in crypto (no external deps)
'use strict';

const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET || 'aeroforge-secret-key-2024';
const SALT_ROUNDS = 10000;

// ── Password hashing (PBKDF2) ──────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, SALT_ROUNDS, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = crypto.pbkdf2Sync(password, salt, SALT_ROUNDS, 64, 'sha512').toString('hex');
  return attempt === hash;
}

// ── Simple JWT (header.payload.signature) ─────────────────
function signToken(payload, expiresInHours = 72) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp    = Math.floor(Date.now() / 1000) + expiresInHours * 3600;
  const body   = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const sig    = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, body, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// ── Express middleware ─────────────────────────────────────
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  req.user = payload;
  next();
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, requireAuth };
