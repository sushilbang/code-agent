// Installs and builds the web app. A user-level npm `allow-scripts` setting is
// re-exported into npm scripts as an env var and makes `npm ci` fail
// (EALLOWSCRIPTS), so clear it for the child processes.
import { spawnSync } from 'node:child_process';

const env = { ...process.env };
for (const key of Object.keys(env)) if (key.toLowerCase() === 'npm_config_allow_scripts') delete env[key];

for (const args of [['ci', '--prefix', 'web', '--ignore-scripts'], ['run', 'build', '--prefix', 'web']]) {
  const r = spawnSync('npm', args, { stdio: 'inherit', env, shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
