// nav.js — shared nav builder
function buildNav(activePage) {
  const user = api.user();
  return `<nav class="nav">
    <a href="home.html" class="nav-logo">AERO<span>FORGE</span></a>
    <div class="nav-links">
      <a href="home.html" data-page="home" ${activePage==='home'?'class="active"':''}>Home</a>
      <a href="generator.html" data-page="gen" ${activePage==='gen'?'class="active"':''}>Generator</a>
      <a href="comparison.html" data-page="compare" ${activePage==='compare'?'class="active"':''}>Comparison Lab</a>
      <a href="aircraft-viewer.html" data-page="viewer" ${activePage==='viewer'?'class="active"':''}>3D Viewer</a>
      <a href="dashboard.html" data-page="dash" ${activePage==='dash'?'class="active"':''}>Dashboard</a>
      <a href="#" class="nav-logout" id="nav-logout">Logout</a>
    </div>
    <span class="nav-user">${user ? user.name : ''}</span>
  </nav>`;
}
function initNav(activePage) {
  document.body.insertAdjacentHTML('afterbegin', buildNav(activePage));
  document.getElementById('nav-logout').addEventListener('click', e => { e.preventDefault(); api.logout(); });
}
