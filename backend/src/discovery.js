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

  if (!fs.existsSync(DOCKER_ROOT)) {
    console.error(`[discovery] DOCKER_ROOT "${DOCKER_ROOT}" no existe (¿falta el bind mount de /docker en el contenedor?)`);
    return projects;
  }

  const topLevel = listDirs(DOCKER_ROOT);
  console.error(`[discovery] escaneando ${DOCKER_ROOT}, ${topLevel.length} carpeta(s) encontradas: [${topLevel.map((e) => e.name).join(', ')}]`);

  for (const entry of topLevel) {
    if (IGNORED_NAMES.has(entry.name)) {
      console.error(`[discovery] "${entry.name}" ignorado (IGNORED_NAMES)`);
      continue;
    }

    if (GROUPED_DIRS[entry.name]) {
      const groupRoot = path.join(DOCKER_ROOT, entry.name);
      const type = GROUPED_DIRS[entry.name];
      const subDirs = listDirs(groupRoot);
      console.error(`[discovery] "${entry.name}/" es carpeta agrupada (tipo ${type}), ${subDirs.length} subcarpeta(s): [${subDirs.map((e) => e.name).join(', ')}]`);
      for (const sub of subDirs) {
        const projectPath = path.join(groupRoot, sub.name);
        if (hasComposeFile(projectPath)) {
          projects.push({
            name: `${entry.name}/${sub.name}`,
            type,
            path: projectPath,
          });
        } else {
          console.error(`[discovery] "${entry.name}/${sub.name}" descartado: no tiene docker-compose.yml en ${projectPath}`);
        }
      }
      continue;
    }

    const projectPath = path.join(DOCKER_ROOT, entry.name);
    if (hasComposeFile(projectPath)) {
      projects.push({ name: entry.name, type: 'fullstack', path: projectPath });
    } else {
      console.error(`[discovery] "${entry.name}" descartado: no tiene docker-compose.yml en ${projectPath}`);
    }
  }

  console.error(`[discovery] resultado final: ${projects.length} proyecto(s) desplegable(s)`);
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { scanProjects, DOCKER_ROOT };
