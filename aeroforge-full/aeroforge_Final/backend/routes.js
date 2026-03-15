// routes.js — AeroForge API routes v3 (with auth)
'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('./db');
const engine  = require('./engine');
const { hashPassword, verifyPassword, signToken, requireAuth } = require('./auth');

// ── GET /api/health ────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({
    status: 'ok', version: '3.0.0',
    designs: db.countDesigns(),
    uptime: Math.floor(process.uptime()),
    aiEnabled: engine.USE_AI,
  });
});

// ── POST /api/register ─────────────────────────────────────
router.post('/register', (req, res) => {
  const { name, email, github, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'name, email and password are required' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });

  if (db.getUserByEmail(email))
    return res.status(409).json({ error: 'Email already registered' });

  try {
    const password_hash = hashPassword(password);
    const id = db.createUser({ name, email, github: github || null, password_hash });
    const token = signToken({ id, name, email });
    res.status(201).json({ success: true, token, user: { id, name, email, github } });
  } catch (err) {
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

// ── POST /api/login ────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'email and password are required' });

  const user = db.getUserByEmail(email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  if (!verifyPassword(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });

  const token = signToken({ id: user.id, name: user.name, email: user.email });
  res.json({ success: true, token, user: { id: user.id, name: user.name, email: user.email, github: user.github } });
});

// ── GET /api/profile ───────────────────────────────────────
router.get('/profile', requireAuth, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const designs = db.getDesignsByUser(req.user.id);
  res.json({ user, designCount: designs.length });
});

// ── POST /api/predict ─────────────────────────────────────
router.post('/predict', async (req, res) => {
  try {
    const result = await engine.buildComponent(req.body);
    if (result.errors) return res.status(400).json({ error: 'Validation failed', details: result.errors });
    res.json({ component: result });
  } catch (err) {
    res.status(500).json({ error: 'Prediction failed', details: err.message });
  }
});

// ── POST /api/predict/prompt ──────────────────────────────
router.post('/predict/prompt', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3)
    return res.status(400).json({ error: 'prompt must be a non-empty string (min 3 chars)' });
  try {
    const result = await engine.buildFromPrompt(prompt.trim());
    if (result.errors) return res.status(400).json({ error: 'Could not parse prompt', details: result.errors });
    res.json({ component: result, aiUsed: engine.USE_AI });
  } catch (err) {
    res.status(500).json({ error: 'Prompt failed', details: err.message });
  }
});

// ── POST /api/generate-component ──────────────────────────
router.post('/generate-component', async (req, res) => {
  try {
    const result = await engine.buildComponent(req.body);
    if (result.errors) return res.status(400).json({ error: 'Validation failed', details: result.errors });
    res.json({ component: result, aiUsed: engine.USE_AI });
  } catch (err) {
    res.status(500).json({ error: 'Generation failed', details: err.message });
  }
});

// ── POST /api/compare-designs ─────────────────────────────
router.post('/compare-designs', async (req, res) => {
  try {
    const params = req.body;
    const variations = await engine.generateVariations(params);
    res.json({ designs: variations, count: variations.length });
  } catch (err) {
    res.status(500).json({ error: 'Comparison failed', details: err.message });
  }
});

// ── GET /api/user-designs ─────────────────────────────────
router.get('/user-designs', requireAuth, (req, res) => {
  try {
    const designs = db.getDesignsByUser(req.user.id);
    res.json({ designs, count: designs.length });
  } catch (err) {
    res.status(500).json({ error: 'Could not load designs', details: err.message });
  }
});

// ── GET /api/designs ──────────────────────────────────────
router.get('/designs', (req, res) => {
  try {
    const designs = db.getAllDesigns();
    res.json({ designs, count: designs.length });
  } catch (err) {
    res.status(500).json({ error: 'Could not load designs', details: err.message });
  }
});

// ── GET /api/designs/:id ──────────────────────────────────
router.get('/designs/:id', (req, res) => {
  const design = db.getDesignById(req.params.id);
  if (!design) return res.status(404).json({ error: 'Design not found' });
  res.json({ design });
});

// ── POST /api/designs ─────────────────────────────────────
router.post('/designs', requireAuth, (req, res) => {
  const comp = req.body;
  if (!comp?.id || !comp?.name || !comp?.params || !comp?.prediction)
    return res.status(400).json({ error: 'Invalid design payload' });
  if (db.getDesignById(comp.id))
    return res.status(409).json({ error: 'Design already exists' });
  try {
    comp.userId = req.user.id;
    db.insertDesign(comp);
    res.status(201).json({ success: true, id: comp.id });
  } catch (err) {
    res.status(500).json({ error: 'Could not save design', details: err.message });
  }
});

// ── DELETE /api/designs/:id ───────────────────────────────
router.delete('/designs/:id', requireAuth, (req, res) => {
  const deleted = db.deleteDesignForUser(req.params.id, req.user.id);
  if (!deleted) return res.status(404).json({ error: 'Design not found or not yours' });
  res.json({ success: true, id: req.params.id });
});

// ── DELETE /api/delete-design/:id ────────────────────────
router.delete('/delete-design/:id', requireAuth, (req, res) => {
  const deleted = db.deleteDesignForUser(req.params.id, req.user.id);
  if (!deleted) return res.status(404).json({ error: 'Design not found' });
  res.json({ success: true });
});

// ── POST /api/generate/cad ────────────────────────────────
router.post('/generate/cad', async (req, res) => {
  try {
    const result = await engine.buildCADComponent(req.body);
    if (result.errors) return res.status(400).json({ error: 'Validation failed', details: result.errors });
    res.json({ component: result, cadEnabled: true });
  } catch (err) {
    res.status(500).json({ error: 'CAD generation failed', details: err.message });
  }
});

// ── GET /api/stats ────────────────────────────────────────
router.get('/stats', (req, res) => {
  try {
    const designs = db.getAllDesigns();
    if (!designs.length) return res.json({ count: 0, avgScore: 0, topMaterial: null, topZone: null });
    const avgScore = Math.round(designs.reduce((s, d) => s + (d.prediction.overallScore || 0), 0) / designs.length);
    const matC = {}, zoneC = {};
    designs.forEach(d => {
      if (d.params.material) matC[d.params.material] = (matC[d.params.material] || 0) + 1;
      if (d.zone) zoneC[d.zone] = (zoneC[d.zone] || 0) + 1;
    });
    const top = obj => Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    res.json({ count: designs.length, avgScore, topMaterial: top(matC), topZone: top(zoneC) });
  } catch (err) {
    res.status(500).json({ error: 'Could not compute stats' });
  }
});

module.exports = router;
