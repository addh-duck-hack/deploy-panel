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
const configFilesGroup = document.getElementById('configFilesGroup');
const configFilesList = document.getElementById('configFilesList');
const terminalWrap = document.getElementById('terminalWrap');
const terminalStatus = document.getElementById('terminalStatus');
const terminalOutput = document.getElementById('terminalOutput');

const configModal = document.getElementById('configModal');
const configModalName = document.getElementById('configModalName');
const configTextarea = document.getElementById('configTextarea');
const configError = document.getElementById('configError');
const configSaveBtn = document.getElementById('configSaveBtn');
const configClose = document.getElementById('configClose');

let currentProject = null;
let currentConfigPath = null;

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

// Para acciones que no pasan por el pipeline de jobs con streaming (ej.
// guardar un archivo de configuración): registra un comando + resultado
// en la terminal igual que si fuera un paso más del log.
function logTerminalResult(commandLabel, message, success) {
  terminalOutput.textContent += `\n$ ${commandLabel}\n${success ? '✔' : '✖'} ${message}\n`;
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
  terminalStatus.textContent = success ? 'éxito' : 'falló';
  terminalStatus.className = `status ${success ? 'success' : 'failed'}`;
}

function renderProjectDetail(project) {
  detailName.textContent = project.name;
  detailType.textContent = TYPE_LABELS[project.type] || project.type;
  detailBranch.textContent = project.branch || '(detached)';

  configFilesList.innerHTML = '';
  const files = project.configFiles || [];
  configFilesGroup.classList.toggle('hidden', files.length === 0);
  for (const relPath of files) {
    const btn = document.createElement('button');
    btn.className = 'action-btn config-file-btn';
    btn.textContent = relPath;
    btn.title = relPath;
    btn.disabled = project.locked;
    btn.addEventListener('click', () => openConfigModal(relPath));
    configFilesList.appendChild(btn);
  }

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
  configFilesGroup.classList.add('hidden');
  configFilesList.innerHTML = '';
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

// --- Edición de archivos de configuración -------------------------------

function openConfigModal(relPath) {
  if (!currentProject) return;
  currentConfigPath = relPath;
  configError.textContent = '';
  configModalName.textContent = relPath;
  configTextarea.value = '';
  configTextarea.disabled = true;
  configModal.classList.remove('hidden');
  loadConfigFile(relPath);
}

async function loadConfigFile(relPath) {
  const res = await apiFetch(projectApiUrl(currentProject.name, `/files?path=${encodeURIComponent(relPath)}`));
  configTextarea.disabled = false;
  if (res.status === 404) {
    configError.textContent = 'Este archivo ya no existe en el proyecto';
    return;
  }
  if (!res.ok) {
    configError.textContent = 'No se pudo cargar el archivo';
    return;
  }
  const { content } = await res.json();
  configTextarea.value = content;
}

configClose.addEventListener('click', () => {
  configModal.classList.add('hidden');
  currentConfigPath = null;
});

configSaveBtn.addEventListener('click', async () => {
  if (!currentProject || !currentConfigPath) return;
  configError.textContent = '';
  configSaveBtn.disabled = true;

  const res = await apiFetch(projectApiUrl(currentProject.name, '/files'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: currentConfigPath, content: configTextarea.value }),
  });

  configSaveBtn.disabled = false;
  const commandLabel = `guardar ${currentConfigPath}`;

  if (res.status === 404) {
    const message = 'Este archivo ya no existe en el proyecto';
    configError.textContent = message;
    logTerminalResult(commandLabel, message, false);
    return;
  }
  if (res.status === 409) {
    const message = 'Hay una operación en curso para este proyecto, intenta de nuevo cuando termine';
    configError.textContent = message;
    logTerminalResult(commandLabel, message, false);
    return;
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const message = errBody.error || 'No se pudo guardar el archivo';
    configError.textContent = message;
    logTerminalResult(commandLabel, message, false);
    return;
  }
  logTerminalResult(commandLabel, `Archivo "${currentConfigPath}" guardado con éxito`, true);
  configModal.classList.add('hidden');
  currentConfigPath = null;
});

// --- Arranque -----------------------------------------------------------------

if (getToken()) {
  tryEnter(getToken(), { redirectHome: location.pathname === '/login' });
} else {
  showGate();
}
