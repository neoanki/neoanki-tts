import { expect, test, _electron as electron } from '@playwright/test'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const extensionRoot = resolve(here, '..')
const coreRoot = resolve(extensionRoot, '..', 'neo-anki')
const require = createRequire(import.meta.url)
const electronExecutable = require(join(coreRoot, 'node_modules', 'electron')) as string

test('installs the full extension and keeps provider credentials encrypted', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'neoanki-tts-'))
  const packagePath = join(extensionRoot, 'build', 'org.neoanki.tts-1.0.0.neoanki-extension')
  const insecureLinuxBackend = process.platform === 'linux'
  const desktop = await electron.launch({
    executablePath: electronExecutable,
    args: [...(insecureLinuxBackend ? ['--password-store=basic'] : []), coreRoot, `--install-extension=${packagePath}`],
    env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData, NEO_ANKI_TEST_ALLOW_MULTIPLE_INSTANCES: '1' },
  })
  try {
    const window = await desktop.firstWindow()
    await window.getByRole('button', { name: /30 minutes/i }).click()
    await window.getByRole('button', { name: /build my first plan/i }).click()
    await window.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'NeoAnki TTS' })).toBeVisible()
    await expect(window.getByRole('tab', { name: 'Profiles & tracks' })).toBeVisible()
    await expect(window.getByRole('tab', { name: 'Providers' })).toBeVisible()
    await expect(window.getByRole('tab', { name: 'Generate' })).toBeVisible()

    await window.getByRole('tab', { name: 'Profiles & tracks' }).click()
    await expect(window.locator('.tts-track')).toHaveCount(2)
    await expect(window.getByText(/generate several sides and languages in one job/i)).toBeVisible()
    if (process.env.NEOANKI_TTS_SCREENSHOT) await window.screenshot({ path: process.env.NEOANKI_TTS_SCREENSHOT.replace(/\.png$/, '-profiles.png'), fullPage: true })

    await window.getByRole('tab', { name: 'Providers' }).click()
    const openAi = window.locator('.tts-card').filter({ has: window.getByRole('heading', { name: 'OpenAI' }) })
    await openAi.getByLabel('API key').fill('local-test-key-not-real')
    await openAi.getByRole('button', { name: 'Save key' }).click()
    if (insecureLinuxBackend) {
      await expect(window.getByText(/secure OS credential storage is unavailable/i)).toBeVisible()
      await expect(openAi.getByText('Not configured')).toBeVisible()
    } else {
      await expect(window.getByText('OpenAI credentials saved securely.')).toBeVisible()
      await expect(openAi.getByText('Configured')).toBeVisible()
    }

    await window.getByRole('tab', { name: 'Generate' }).click()
    await expect(window.getByText(/26 matching items/i)).toBeVisible()
    await expect(window.getByText(/no cloud track in “Generated & synced” mode/i)).toBeVisible()
    if (process.env.NEOANKI_TTS_SCREENSHOT) await window.screenshot({ path: process.env.NEOANKI_TTS_SCREENSHOT, fullPage: true })
  } finally {
    const child = desktop.process()
    if (child.exitCode === null) {
      child.kill('SIGKILL')
      await new Promise<void>((resolve) => child.once('exit', () => resolve()))
    }
  }

  try {
    const secretFile = join(userData, 'extensions', 'data', 'org.neoanki.tts', 'secrets.json')
    if (insecureLinuxBackend) {
      expect(await readFile(secretFile, 'utf8').then(() => true, () => false)).toBe(false)
    } else {
      const stored = await readFile(secretFile, 'utf8')
      expect(stored).not.toContain('local-test-key-not-real')
      expect(JSON.parse(stored).values['openai.api-key']).toMatch(/^[A-Za-z0-9+/=]+$/)
    }
  } finally { await rm(userData, { recursive: true, force: true }) }
})
