const fs = require('fs');
const path = require('path');

const DOCKER_ROOT = process.env.DOCKER_ROOT || '/docker';

// Carpetas bajo /docker que agrupan proyectos de un tipo particular
// en vez de ser ellas mismas un proyecto (ver docker-compose.yml de cada uno).
const GROUPED_DIRS = {
  staticSite: 'static',
  wordpress: 'wordpress',
};

// Nombres que nunca deben ofrecerse como "proyecto" desplegable.
const IGNORED_NAMES = new Set(['deploy-panel']);

function hasComposeFile(dirPath) {
  return fs.existsSync(path.join(dirPath, 'docker-compose.yml'));
}

function listDirs(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'));
}

/**
 * Escanea /docker y devuelve la whitelist de proyectos desplegables.
 * Cada proyecto: { name, type, path }. `name` es el identificador único
 * usado por el cliente (para grupos: "staticSite/mi-sitio").
 */
function scanProjects() {
  const projects = [];

  for (const entry of listDirs(DOCKER_ROOT)) {
    if (IGNORED_NAMES.has(entry.name)) continue;

    if (GROUPED_DIRS[entry.name]) {
      const groupRoot = path.join(DOCKER_ROOT, entry.name);
      const type = GROUPED_DIRS[entry.name];
      for (const sub of listDirs(groupRoot)) {
        const projectPath = path.join(groupRoot, sub.name);
        if (hasComposeFile(projectPath)) {
          projects.push({
            name: `${entry.name}/${sub.name}`,
            type,
            path: projectPath,
          });
        }
      }
      continue;
    }

    const projectPath = path.join(DOCKER_ROOT, entry.name);
    if (hasComposeFile(projectPath)) {
      projects.push({ name: entry.name, type: 'fullstack', path: projectPath });
    }
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { scanProjects, DOCKER_ROOT };
