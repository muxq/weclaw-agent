import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const packageRoot = path.resolve('node_modules', '@pinixai', 'weixin-bot')
const distEntry = path.join(packageRoot, 'dist', 'index.js')

if (!existsSync(packageRoot)) {
  console.warn('[repair-weixin-bot] Package @pinixai/weixin-bot is not installed. Skipping repair.')
  process.exit(0)
}

if (existsSync(distEntry)) {
  process.exit(0)
}

console.log('[repair-weixin-bot] Missing dist output for @pinixai/weixin-bot, building package locally...')

const result = spawnSync('npm', ['run', 'build'], {
  cwd: packageRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}