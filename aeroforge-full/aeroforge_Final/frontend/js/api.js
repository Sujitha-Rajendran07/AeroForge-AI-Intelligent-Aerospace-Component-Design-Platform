// api.js — AeroForge frontend API helper
const API_BASE = '/api';

const api = {
  token() { return localStorage.getItem('af_token'); },
  user()  { return JSON.parse(localStorage.getItem('af_user') || 'null'); },
  isLoggedIn() { return !!this.token(); },

  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.token()) h['Authorization'] = `Bearer ${this.token()}`;
    return h;
  },

  async post(path, body) {
    const r = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    return r.json();
  },

  async get(path) {
    const r = await fetch(`${API_BASE}${path}`, { headers: this.headers() });
    return r.json();
  },

  async del(path) {
    const r = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: this.headers() });
    return r.json();
  },

  login(token, user) {
    localStorage.setItem('af_token', token);
    localStorage.setItem('af_user', JSON.stringify(user));
  },

  logout() {
    localStorage.removeItem('af_token');
    localStorage.removeItem('af_user');
    window.location.href = '/index.html';
  },

  requireAuth() {
    if (!this.isLoggedIn()) { window.location.href = '/login.html'; return false; }
    return true;
  },

  setupNav() {
    const user = this.user();
    const userEl = document.getElementById('nav-user');
    if (userEl && user) userEl.textContent = user.name;
    document.querySelectorAll('[data-page]').forEach(a => {
      if (a.dataset.page === document.body.dataset.page) a.classList.add('active');
    });
    document.getElementById('nav-logout')?.addEventListener('click', e => { e.preventDefault(); this.logout(); });
  }
};
