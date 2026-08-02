const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

async function getCurrentBranch(projectPath) {
  try {
    const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: projectPath,
      timeout: 5000,
    });
    return stdout.trim() || null; // vacío: HEAD desacoplado (detached)
  } catch {
    return null;
  }
}

module.exports = { getCurrentBranch };
