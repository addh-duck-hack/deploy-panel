const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { requireAuth, safeEqual } = require('./src/auth');
const { scanProjects } = require('./src/discovery');
const { startDeploy, startCheckout, getJob, isLocked, isAtCapacity } = require('./src/jobs');
const { getCurrentBranch } = require('./src/git');
const { findConfigFiles, MAX_CONFIG_FILE_SIZE } = require('./src/configFiles');

// Nombres de rama válidos para git checkout/fetch: sin espacios, sin ir
// como flag (nada de "-x"), sin ".." para evitar refs raros.
const BRANCH_NAME_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/;

function findProject(name) {
  return scanProjects().find((p) => p.name === name);
}

if (!process.env.DEPLOY_TOKEN) {
  console.error('DEPLOY_TOKEN no está definido. Configúralo en el .env antes de arrancar.');
  process.exit(1);
}
if (process.env.DEPLOY_TOKEN.length < 32) {
  console.error('DEPLOY_TOKEN es muy corto (mínimo 32 caracteres). Genera uno con: openssl rand -hex 32');
  process.exit(1);
}

const app = express();

// Detrás de Nginx Proxy Manager (un solo hop) — necesario para que el rate
// limiter vea la IP real del cliente y no la de NPM.
app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(helmet());
// 1mb: debe cubrir archivos de configuración razonables y quedar en sync
// con MAX_CONFIG_FILE_SIZE (src/configFiles.js) para que "se puede ver"
// y "se puede guardar" usen siempre el mismo tope.
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intenta de nuevo en un momento' },
});

app.use('/api', apiLimiter);

app.get('/api/projects', requireAuth, (req, res) => {
  const projects = scanProjects().map(({ name, type }) => ({
    name,
    type,
    locked: isLocked(name),
  }));
  res.json({ projects });
});

app.post('/api/projects/:name(.*)/branch', requireAuth, (req, res) => {
  const project = findProject(req.params.name);
  if (!project) {
    return res.status(404).json({ error: 'Proyecto no reconocido' });
  }

  const { branch } = req.body || {};
  if (typeof branch !== 'string' || !BRANCH_NAME_RE.test(branch)) {
    return res.status(400).json({ error: 'Nombre de rama inválido' });
  }

  if (isLocked(project.name)) {
    return res.status(409).json({ error: 'Ya hay una operación en curso para este proyecto' });
  }
  if (isAtCapacity()) {
    return res.status(429).json({ error: 'Ya hay demasiadas operaciones corriendo en paralelo, intenta de nuevo en un momento' });
  }

  const job = startCheckout(project, branch);
  res.json({ jobId: job.id, streamToken: job.streamToken });
});

app.get('/api/projects/:name(.*)/files', requireAuth, async (req, res) => {
  const project = findProject(req.params.name);
  if (!project) {
    return res.status(404).json({ error: 'Proyecto no reconocido' });
  }

  const files = findConfigFiles(project.path);
  if (!files.includes(req.query.path)) {
    return res.status(404).json({ error: 'Archivo no encontrado' });
  }

  const filePath = path.join(project.path, req.query.path);
  const stat = await fs.promises.stat(filePath);
  if (stat.size > MAX_CONFIG_FILE_SIZE) {
    return res.status(413).json({ error: 'El archivo es demasiado grande para editarlo aquí' });
  }

  const content = await fs.promises.readFile(filePath, 'utf8');
  res.json({ content });
});

app.post('/api/projects/:name(.*)/files', requireAuth, async (req, res) => {
  const project = findProject(req.params.name);
  if (!project) {
    return res.status(404).json({ error: 'Proyecto no reconocido' });
  }

  const { path: relPath, content } = req.body || {};
  const files = findConfigFiles(project.path);
  if (!files.includes(relPath)) {
    return res.status(404).json({ error: 'Archivo no encontrado' });
  }
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'Falta "content" en el body' });
  }

  if (isLocked(project.name)) {
    return res.status(409).json({ error: 'Ya hay una operación en curso para este proyecto' });
  }

  await fs.promises.writeFile(path.join(project.path, relPath), content, 'utf8');
  res.json({ ok: true });
});

app.get('/api/projects/:name(.*)', requireAuth, async (req, res) => {
  const project = findProject(req.params.name);
  if (!project) {
    return res.status(404).json({ error: 'Proyecto no reconocido' });
  }

  const branch = await getCurrentBranch(project.path);
  const configFiles = findConfigFiles(project.path);

  res.json({
    name: project.name,
    type: project.type,
    branch,
    locked: isLocked(project.name),
    configFiles,
  });
});

app.post('/api/deploy', requireAuth, (req, res) => {
  const { project: projectName } = req.body || {};
  if (!projectName) {
    return res.status(400).json({ error: 'Falta "project" en el body' });
  }

  const project = findProject(projectName);
  if (!project) {
    return res.status(404).json({ error: 'Proyecto no reconocido' });
  }

  if (isLocked(project.name)) {
    return res.status(409).json({ error: 'Ya hay un deploy en curso para este proyecto' });
  }

  if (isAtCapacity()) {
    return res.status(429).json({ error: 'Ya hay demasiados deploys corriendo en paralelo, intenta de nuevo en un momento' });
  }

  const job = startDeploy(project);
  res.json({ jobId: job.id, streamToken: job.streamToken });
});

app.get('/api/deploy/:jobId/stream', (req, res) => {
  const job = getJob(req.params.jobId);
  const token = req.query.token;

  if (!job || !token || !safeEqual(token, job.streamToken)) {
    return res.status(401).end();
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  // Reproduce el log ya acumulado antes de suscribir al stream en vivo.
  for (const line of job.log) {
    res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
  }

  if (job.status !== 'running') {
    res.write(`event: done\ndata: ${JSON.stringify({ status: job.status })}\n\n`);
    return res.end();
  }

  job.listeners.add(res);
  req.on('close', () => job.listeners.delete(res));
});

// SPA fallback: cualquier ruta que no sea /api/* y no matchee un archivo
// estático sirve el mismo index.html (login, "/", "/<proyecto>",
// "/staticSite/<proyecto>", etc). app.js decide qué pintar según el path.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`deploy-panel escuchando en :${PORT}`));
