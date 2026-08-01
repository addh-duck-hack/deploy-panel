const crypto = require('crypto');
const { spawn } = require('child_process');

const JOB_TTL_MS = 30 * 60 * 1000; // cuánto se conserva un job terminado en memoria
const STEP_TIMEOUT_MS = Number(process.env.DEPLOY_STEP_TIMEOUT_MS) || 20 * 60 * 1000;
const MAX_CONCURRENT_DEPLOYS = Number(process.env.MAX_CONCURRENT_DEPLOYS) || 2;

const jobs = new Map(); // jobId -> job
const locks = new Set(); // nombres de proyecto con un deploy en curso

// git pull primero: si falla, el stack ni se toca (sin downtime). down/up van
// después para minimizar la ventana en la que el sitio queda caído.
const DEPLOY_STEPS = [
  ['git', ['pull', '--ff-only']],
  ['docker', ['compose', 'down']],
  ['docker', ['compose', 'up', '-d', '--build']],
];

function isLocked(projectName) {
  return locks.has(projectName);
}

function activeDeployCount() {
  return locks.size;
}

function isAtCapacity() {
  return locks.size >= MAX_CONCURRENT_DEPLOYS;
}

function emit(job, line) {
  job.log.push(line);
  for (const res of job.listeners) {
    res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
  }
}

function finish(job, status) {
  job.status = status;
  locks.delete(job.project.name);
  for (const res of job.listeners) {
    res.write(`event: done\ndata: ${JSON.stringify({ status })}\n\n`);
    res.end();
  }
  job.listeners.clear();
  setTimeout(() => jobs.delete(job.id), JOB_TTL_MS).unref();
}

function runCommand(job, cmd, args) {
  return new Promise((resolve) => {
    // detached: true pone al hijo como líder de su propio grupo de procesos,
    // para poder matar también a sus descendientes (ej. un script que a su
    // vez lanza otro proceso) usando kill(-pid) en vez de kill(pid).
    const child = spawn(cmd, args, { cwd: job.project.path, shell: false, detached: true });
    let timedOut = false;

    const killGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        // el proceso ya terminó
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      emit(job, `\n✖ "${cmd} ${args.join(' ')}" excedió ${STEP_TIMEOUT_MS / 1000}s, matando el proceso\n`);
      killGroup('SIGTERM');
      setTimeout(() => killGroup('SIGKILL'), 5000).unref();
    }, STEP_TIMEOUT_MS);
    timer.unref();

    child.stdout.on('data', (chunk) => emit(job, chunk.toString()));
    child.stderr.on('data', (chunk) => emit(job, chunk.toString()));

    child.on('error', (err) => {
      clearTimeout(timer);
      emit(job, `\n✖ No se pudo ejecutar "${cmd}": ${err.message}\n`);
      resolve(1);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(timedOut ? 1 : code);
    });
  });
}

async function runDeploy(job) {
  for (const [cmd, args] of DEPLOY_STEPS) {
    emit(job, `\n$ ${cmd} ${args.join(' ')}\n`);
    const code = await runCommand(job, cmd, args);
    if (code !== 0) {
      emit(job, `\n✖ Falló "${cmd} ${args.join(' ')}" (código ${code})\n`);
      finish(job, 'failed');
      return;
    }
  }
  emit(job, '\n✔ Deploy completado con éxito\n');
  finish(job, 'success');
}

function startDeploy(project) {
  const job = {
    id: crypto.randomUUID(),
    streamToken: crypto.randomBytes(24).toString('hex'),
    project,
    status: 'running',
    log: [],
    listeners: new Set(),
  };
  jobs.set(job.id, job);
  locks.add(project.name);

  runDeploy(job).catch((err) => {
    emit(job, `\n✖ Error inesperado: ${err.message}\n`);
    finish(job, 'failed');
  });

  return job;
}

function getJob(jobId) {
  return jobs.get(jobId);
}

module.exports = {
  startDeploy,
  getJob,
  isLocked,
  isAtCapacity,
  activeDeployCount,
  MAX_CONCURRENT_DEPLOYS,
};
