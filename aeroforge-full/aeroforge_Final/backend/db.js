// db.js — AeroForge SQLite database (better-sqlite3)
'use strict';

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'aeroforge.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    github        TEXT,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS designs (
    id             TEXT PRIMARY KEY,
    user_id        INTEGER,
    name           TEXT NOT NULL,
    zone           TEXT NOT NULL,
    color          TEXT NOT NULL,
    component_type TEXT,
    created_at     TEXT NOT NULL,
    params         TEXT NOT NULL,
    prediction     TEXT NOT NULL,
    result_metrics TEXT,
    model_path     TEXT,
    prompt         TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS prompt_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER,
    prompt_text TEXT NOT NULL,
    parsed_type TEXT,
    parsed_mat  TEXT,
    ai_used     INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const userStmts = {
  insert:     db.prepare(`INSERT INTO users (name,email,github,password_hash) VALUES (@name,@email,@github,@password_hash)`),
  getByEmail: db.prepare(`SELECT * FROM users WHERE email = ?`),
  getById:    db.prepare(`SELECT id,name,email,github,created_at FROM users WHERE id = ?`),
};

const stmts = {
  insert:     db.prepare(`INSERT INTO designs (id,user_id,name,zone,color,component_type,created_at,params,prediction,result_metrics,model_path,prompt) VALUES (@id,@user_id,@name,@zone,@color,@component_type,@created_at,@params,@prediction,@result_metrics,@model_path,@prompt)`),
  getAll:     db.prepare(`SELECT * FROM designs ORDER BY created_at DESC`),
  getByUser:  db.prepare(`SELECT * FROM designs WHERE user_id = ? ORDER BY created_at DESC`),
  getById:    db.prepare(`SELECT * FROM designs WHERE id = ?`),
  delete:     db.prepare(`DELETE FROM designs WHERE id = ?`),
  deleteUser: db.prepare(`DELETE FROM designs WHERE id = ? AND user_id = ?`),
  count:      db.prepare(`SELECT COUNT(*) as count FROM designs`),
  logPrompt:  db.prepare(`INSERT INTO prompt_history (user_id,prompt_text,parsed_type,parsed_mat,ai_used) VALUES (?,?,?,?,?)`),
};

function rowToDesign(row) {
  return {
    id: row.id, userId: row.user_id, name: row.name,
    zone: row.zone, color: row.color, componentType: row.component_type,
    createdAt: row.created_at,
    params: JSON.parse(row.params),
    prediction: JSON.parse(row.prediction),
    resultMetrics: row.result_metrics ? JSON.parse(row.result_metrics) : null,
    modelPath: row.model_path || null,
    originalPrompt: row.prompt || null,
  };
}

module.exports = {
  createUser(data)    { return userStmts.insert.run(data).lastInsertRowid; },
  getUserByEmail(e)   { return userStmts.getByEmail.get(e) || null; },
  getUserById(id)     { return userStmts.getById.get(id) || null; },
  insertDesign(c) {
    stmts.insert.run({
      id: c.id, user_id: c.userId || null, name: c.name, zone: c.zone, color: c.color,
      component_type: c.params?.type || null, created_at: c.createdAt,
      params: JSON.stringify(c.params), prediction: JSON.stringify(c.prediction),
      result_metrics: c.resultMetrics ? JSON.stringify(c.resultMetrics) : null,
      model_path: c.modelPath || null, prompt: c.originalPrompt || null,
    });
  },
  getAllDesigns()           { return stmts.getAll.all().map(rowToDesign); },
  getDesignsByUser(uid)    { return stmts.getByUser.all(uid).map(rowToDesign); },
  getDesignById(id)        { const r = stmts.getById.get(id); return r ? rowToDesign(r) : null; },
  deleteDesign(id)         { return stmts.delete.run(id).changes > 0; },
  deleteDesignForUser(id,u){ return stmts.deleteUser.run(id, u).changes > 0; },
  countDesigns()           { return stmts.count.get().count; },
  logPrompt(uid,text,type,mat,ai) { stmts.logPrompt.run(uid||null,text,type||null,mat||null,ai?1:0); },
};
