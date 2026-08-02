const fs = require('fs');
const path = require('path');

// Patrones de nombre de archivo (contra el basename) que cuentan como
// "archivo de configuración" editable desde el panel.
const CONFIG_FILE_PATTERNS = [
  /^\.env(\..+)?$/, // .env, .env.local, .env.production, ...
  /^environment(\..+)?\.ts$/, // environment.ts, environment.prod.ts (Angular)
];

// Carpetas que nunca vale la pena recorrer: dependencias, artefactos de
// build, o (para WordPress) la biblioteca de medios, que puede ser enorme
// y nunca va a tener un .env/environment.ts adentro.
const IGNORED_DIR_NAMES = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage', 'tmp', 'wp-content']);

const MAX_DEPTH = 6;
const MAX_ENTRIES = 20000;
const MAX_CONFIG_FILE_SIZE = 1 * 1024 * 1024; // 1MB — debe quedar en sync con el límite del JSON body parser

function isIgnoredDir(name) {
  return name.startsWith('.') || IGNORED_DIR_NAMES.has(name);
}

function matchesConfigPattern(basename) {
  return CONFIG_FILE_PATTERNS.some((re) => re.test(basename));
}

/**
 * Escanea recursivamente projectPath y devuelve las rutas relativas
 * (estilo POSIX, con "/") de todos los archivos que matcheen
 * CONFIG_FILE_PATTERNS. Sin caché — se recorre de cero en cada llamada,
 * igual que scanProjects() en discovery.js.
 */
function findConfigFiles(projectPath) {
  const results = [];
  let visited = 0;

  function walk(dir, depth) {
    if (visited >= MAX_ENTRIES) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (visited >= MAX_ENTRIES) {
        console.error(`[configFiles] tope de ${MAX_ENTRIES} entradas alcanzado escaneando ${projectPath}, resultado parcial`);
        return;
      }
      visited += 1;

      const fullPath = path.join(dir, entry.name);

      // lstat (no stat) para no seguir symlinks: evita ciclos tipo a->b->a
      // que colgarían el recorrido. No es control de acceso — esta
      // herramienta ya tiene acceso root-equivalente al host por diseño.
      let stat;
      try {
        stat = fs.lstatSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (isIgnoredDir(entry.name)) continue;
        if (depth >= MAX_DEPTH) continue;
        walk(fullPath, depth + 1);
      } else if (stat.isFile() && matchesConfigPattern(entry.name)) {
        results.push(path.relative(projectPath, fullPath).split(path.sep).join('/'));
      }
    }
  }

  walk(projectPath, 0);
  return results.sort();
}

module.exports = { findConfigFiles, MAX_CONFIG_FILE_SIZE };
