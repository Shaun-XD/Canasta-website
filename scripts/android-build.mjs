// Use the bundled site and the verified production game service in every release.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const env = { ...process.env, VITE_SOCKET_URL: 'https://canasta-api-production.up.railway.app' }
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd, env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const localBin = name => resolve(root, 'node_modules', '.bin', name)
run(localBin('tsc'), ['-b'])
run(localBin('vite'), ['build', '--mode', 'android', '--outDir', 'dist/android'])
run(localBin('cap'), ['sync', 'android'])
if (process.argv[2] === 'bundle') run('./gradlew', [':app:bundleRelease'], resolve(root, 'android'))
