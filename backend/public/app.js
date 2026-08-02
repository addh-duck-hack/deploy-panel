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
const logoutBtn = document.getElementById('logout');
const homeBtn = document.getElementById('homeBtn');

const projectListView = document.getElementById('projectListView');
const projectList = document.getElementById('projectList');

const projectDetailView = document.getElementById('projectDetailView');
const backBtn = document.getElementById('backBtn');
const detailName = document.getElementById('detailName');
const detailType = document.getElementById('detailType');
const detailBranch = document.getElementById('detailBranch');
const detailError = document.getElementById('detailError');
const detailActions = document.getElementById('detailActions');
const detailDeployBtn = document.getElementById('detailDeployBtn');
const branchInput = document.getElementById('branchInput');
const branchSwitchBtn = document.getElementById('branchSwitchBtn');
const envBtn = document.getElementById('envBtn');
const terminalWrap = document.getElementById('terminalWrap');
const terminalStatus = document.getElementById('terminalStatus');
const terminalOutput = document.getElementById('terminalOutput');

const envModal = document.getElementById('envModal');
const envModalName = document.getElementById('envModalName');
const envTextarea = document.getElementById('envTextarea');
const envError = document.getElementById('envError');
const envSaveBtn = document.getElementById('envSaveBtn');
const envClose = document.getElementById('envClose');

let currentProject = null;

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

// --- Rutas de proyecto: el nombre puede traer "/" (ej. "staticSite/mi-sitio"),
// así que codificamos cada segmento por separado en vez de todo el string.
function projectNameToPath(name) {
  return `/${name.split('/').map(encodeURIComponent).join('/')}`;
}

function pathToProjectName(pathname) {
  return pathname.split('/').filter(Boolean).map(decodeURIComponent).join('/');
}

function projectApiUrl(name, suffix = '') {
  return `/api/projects/${name.split('/').map(encodeURIComponent).join('/')}${suffix}`;
}

// --- Router ---------------------------------------------------------------

function setPath(path) {
  if (location.pathname !== path) {
    history.replaceState(null, '', path);
  }
}

function navigate(path) {
  if (location.pathname !== path) {
    history.pushState(null, '', path);
  }
  render();
}

function render() {
  const path = location.pathname;
  if (path === '/' || path === '') {
    showProjectListView();
  } else {
    showProjectDetailView(pathToProjectName(path));
  }
}

window.addEventListener('popstate', () => {
  if (getToken()) {
    render();
  } else {
    showGate();
  }
});

// --- Gate / shell -----------------------------------------------------------

function showAppShell() {
  gate.classList.add('hidden');
  app.classList.remove('hidden');
}

function showGate(message) {
  app.classList.add('hidden');
  gate.classList.remove('hidden');
  gateError.textContent = message || '';
  setPath('/login');
}

async function tryEnter(token, { redirectHome = false } = {}) {
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
  showAppShell();
  if (redirectHome) {
    navigate('/');
  } else {
    render();
  }
}

tokenSubmit.addEventListener('click', () => {
  const value = tokenInput.value.trim();
  if (value) tryEnter(value, { redirectHome: true });
});

tokenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tokenSubmit.click();
});

logoutBtn.addEventListener('click', () => {
  clearToken();
  showGate();
});

homeBtn.addEventListener('click', () => navigate('/'));
backBtn.addEventListener('click', () => navigate('/'));

// --- Lista de proyectos -----------------------------------------------------

function showProjectListView() {
  currentProject = null;
  projectDetailView.classList.add('hidden');
  projectListView.classList.remove('hidden');
  loadProjects();
}

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
      btn.textContent = project.name + (project.locked ? ' (desplegando…)' : '');
      btn.addEventListener('click', () => navigate(projectNameToPath(project.name)));
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

// --- Detalle de proyecto -----------------------------------------------------

function resetTerminal() {
  terminalOutput.textContent = '$ _';
  terminalStatus.textContent = '';
  terminalStatus.className = 'status';
}

function renderProjectDetail(project) {
  detailName.textContent = project.name;
  detailType.textContent = TYPE_LABELS[project.type] || project.type;
  detailBranch.textContent = project.branch || '(detached)';
  envBtn.classList.toggle('hidden', !project.hasEnv);
  detailDeployBtn.disabled = project.locked;
  branchSwitchBtn.disabled = project.locked;
}

async function showProjectDetailView(name) {
  currentProject = null;
  projectListView.classList.add('hidden');
  projectDetailView.classList.remove('hidden');

  detailName.textContent = name;
  detailType.textContent = '';
  detailBranch.textContent = '—';
  detailError.textContent = '';
  branchInput.value = '';
  envBtn.classList.add('hidden');
  detailActions.classList.remove('hidden');
  terminalWrap.classList.remove('hidden');
  resetTerminal();

  const res = await apiFetch(projectApiUrl(name));
  if (res.status === 404) {
    detailError.textContent = 'Proyecto no encontrado';
    detailActions.classList.add('hidden');
    terminalWrap.classList.add('hidden');
    return;
  }
  if (!res.ok) {
    detailError.textContent = 'Error al cargar el proyecto';
    detailActions.classList.add('hidden');
    terminalWrap.classList.add('hidden');
    return;
  }

  currentProject = await res.json();
  renderProjectDetail(currentProject);
}

async function refreshProjectDetail() {
  if (!currentProject) return;
  const res = await apiFetch(projectApiUrl(currentProject.name));
  if (!res.ok) return;
  currentProject = await res.json();
  renderProjectDetail(currentProject);
}

function setDetailButtonsDisabled(disabled) {
  detailDeployBtn.disabled = disabled;
  branchSwitchBtn.disabled = disabled;
}

async function runDetailAction(url, body, errorFallback) {
  if (!currentProject) return;
  detailError.textContent = '';
  setDetailButtonsDisabled(true);
  terminalOutput.textContent = '';
  terminalStatus.textContent = 'en curso';
  terminalStatus.className = 'status running';

  const res = await apiFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });

  if (res.status === 409) {
    detailError.textContent = 'Ya hay una operación en curso para este proyecto';
    resetTerminal();
    setDetailButtonsDisabled(false);
    return;
  }
  if (res.status === 429) {
    detailError.textContent = 'Demasiadas operaciones en paralelo, intenta de nuevo en un momento';
    resetTerminal();
    setDetailButtonsDisabled(false);
    return;
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    detailError.textContent = errBody.error || errorFallback;
    resetTerminal();
    setDetailButtonsDisabled(false);
    return;
  }

  const { jobId, streamToken } = await res.json();
  streamToTerminal(jobId, streamToken, () => {
    setDetailButtonsDisabled(false);
    refreshProjectDetail();
  });
}

function streamToTerminal(jobId, streamToken, onDone) {
  const url = `/api/deploy/${jobId}/stream?token=${encodeURIComponent(streamToken)}`;
  const source = new EventSource(url);

  source.addEventListener('log', (event) => {
    terminalOutput.textContent += JSON.parse(event.data);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  });

  source.addEventListener('done', (event) => {
    const { status } = JSON.parse(event.data);
    terminalStatus.textContent = status === 'success' ? 'éxito' : 'falló';
    terminalStatus.className = `status ${status}`;
    source.close();
    onDone();
  });

  source.onerror = () => source.close();
}

detailDeployBtn.addEventListener('click', () => {
  if (!currentProject) return;
  runDetailAction('/api/deploy', { project: currentProject.name }, 'No se pudo iniciar la actualización');
});

branchSwitchBtn.addEventListener('click', () => {
  if (!currentProject) return;
  const branch = branchInput.value.trim();
  if (!branch) {
    detailError.textContent = 'Escribe el nombre de la rama';
    return;
  }
  runDetailAction(projectApiUrl(currentProject.name, '/branch'), { branch }, 'No se pudo cambiar de rama');
});

// --- Edición de .env ---------------------------------------------------------

envBtn.addEventListener('click', async () => {
  if (!currentProject) return;
  envError.textContent = '';
  envModalName.textContent = currentProject.name;
  envTextarea.value = '';
  envTextarea.disabled = true;
  envModal.classList.remove('hidden');

  const res = await apiFetch(projectApiUrl(currentProject.name, '/env'));
  envTextarea.disabled = false;
  if (!res.ok) {
    envError.textContent = 'No se pudo cargar el .env';
    return;
  }
  const { content } = await res.json();
  envTextarea.value = content;
});

envClose.addEventListener('click', () => envModal.classList.add('hidden'));

envSaveBtn.addEventListener('click', async () => {
  if (!currentProject) return;
  envError.textContent = '';
  envSaveBtn.disabled = true;

  const res = await apiFetch(projectApiUrl(currentProject.name, '/env'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: envTextarea.value }),
  });

  envSaveBtn.disabled = false;
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    envError.textContent = errBody.error || 'No se pudo guardar el .env';
    return;
  }
  envModal.classList.add('hidden');
});

// --- Arranque -----------------------------------------------------------------

if (getToken()) {
  tryEnter(getToken(), { redirectHome: location.pathname === '/login' });
} else {
  showGate();
}
