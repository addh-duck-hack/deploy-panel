const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { requireAuth, safeEqual } = require('./src/auth');
const { scanProjects } = require('./src/discovery');
const { startDeploy, getJob, isLocked, isAtCapacity } = require('./src/jobs');

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
app.use(express.json());
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

app.post('/api/deploy', requireAuth, (req, res) => {
  const { project: projectName } = req.body || {};
  if (!projectName) {
    return res.status(400).json({ error: 'Falta "project" en el body' });
  }

  const project = scanProjects().find((p) => p.name === projectName);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`deploy-panel escuchando en :${PORT}`));
