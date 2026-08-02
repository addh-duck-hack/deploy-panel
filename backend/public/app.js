const TOKEN_KEY = 'deployPanelToken';

const TYPE_LABELS = {
  fullstack: 'Full-stack',
  static: 'Static site',
  wordpress: 'WordPress',
};

const gate = document.getElementById('gate');
const app = document.getElementById('app');
const tokenInput = document.getElementById('tokenInput');
const tokenSubmit = document.getElementById('tokenSubmit');
const gateError = document.getElementById('gateError');
const projectList = document.getElementById('projectList');
const logoutBtn = document.getElementById('logout');
const homeBtn = document.getElementById('homeBtn');

const logModal = document.getElementById('logModal');
const logTitle = document.getElementById('logTitle');
const logStatus = document.getElementById('logStatus');
const logOutput = document.getElementById('logOutput');
const logClose = document.getElementById('logClose');

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${getToken()}`,
    },
  });
  return res;
}

function showApp() {
  gate.classList.add('hidden');
  app.classList.remove('hidden');
}

function showGate(message) {
  app.classList.add('hidden');
  gate.classList.remove('hidden');
  gateError.textContent = message || '';
}

async function tryEnter(token) {
  setToken(token);
  const res = await apiFetch('/api/projects');
  if (res.status === 401) {
    clearToken();
    showGate('Token inválido');
    return;
  }
  if (!res.ok) {
    showGate('Error al conectar con el panel');
    return;
  }
  showApp();
  await loadProjects();
}

tokenSubmit.addEventListener('click', () => {
  const value = tokenInput.value.trim();
  if (value) tryEnter(value);
});

tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tokenSubmit.click();
});

logoutBtn.addEventListener('click', () => {
  clearToken();
  showGate();
});

homeBtn.addEventListener('click', () => {
  logModal.classList.add('hidden');
  loadProjects();
});

function renderProjects(projects) {
  projectList.innerHTML = '';
  const groups = {};
  for (const p of projects) {
    groups[p.type] = groups[p.type] || [];
    groups[p.type].push(p);
  }

  for (const [type, items] of Object.entries(groups)) {
    const section = document.createElement('div');
    section.className = 'group';
    section.innerHTML = `<h2>${TYPE_LABELS[type] || type}</h2>`;
    const grid = document.createElement('div');
    grid.className = 'grid';

    for (const project of items) {
      const btn = document.createElement('button');
      btn.className = 'project-btn';
      btn.textContent = project.name;
      btn.disabled = project.locked;
      if (project.locked) btn.textContent += ' (desplegando…)';
      btn.addEventListener('click', () => deploy(project.name, btn));
      grid.appendChild(btn);
    }

    section.appendChild(grid);
    projectList.appendChild(section);
  }
}

async function loadProjects() {
  const res = await apiFetch('/api/projects');
  if (!res.ok) return;
  const { projects } = await res.json();
  renderProjects(projects);
}

async function deploy(projectName, btn) {
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = `${projectName} (iniciando…)`;

  const res = await apiFetch('/api/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project: projectName }),
  });

  if (res.status === 409) {
    btn.textContent = `${projectName} (ya en curso)`;
    return;
  }
  if (!res.ok) {
    btn.disabled = false;
    btn.textContent = originalText;
    alert('No se pudo iniciar el deploy');
    return;
  }

  const { jobId, streamToken } = await res.json();
  openLogModal(projectName);
  streamLogs(jobId, streamToken, (status) => {
    btn.disabled = false;
    btn.textContent = originalText;
    if (status !== 'success') loadProjects();
  });
}

function openLogModal(projectName) {
  logTitle.textContent = projectName;
  logStatus.textContent = 'en curso';
  logStatus.className = 'status running';
  logOutput.textContent = '';
  logModal.classList.remove('hidden');
}

logClose.addEventListener('click', () => logModal.classList.add('hidden'));

function streamLogs(jobId, streamToken, onDone) {
  const url = `/api/deploy/${jobId}/stream?token=${encodeURIComponent(streamToken)}`;
  const source = new EventSource(url);

  source.addEventListener('log', (event) => {
    logOutput.textContent += JSON.parse(event.data);
    logOutput.scrollTop = logOutput.scrollHeight;
  });

  source.addEventListener('done', (event) => {
    const { status } = JSON.parse(event.data);
    logStatus.textContent = status === 'success' ? 'éxito' : 'falló';
    logStatus.className = `status ${status}`;
    source.close();
    onDone(status);
    loadProjects();
  });

  source.onerror = () => {
    source.close();
  };
}

if (getToken()) {
  tryEnter(getToken());
}
