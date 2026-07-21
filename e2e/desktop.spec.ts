import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
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

const registerProviderMock = (application: ElectronApplication, initialMode: 'success' | 'fail' | 'delay' = 'success') => application.evaluate(async ({ session }, mode) => {
  const state = globalThis as typeof globalThis & { __neoAnkiTtsMockMode?: string; __neoAnkiTtsMockCalls?: number }
  state.__neoAnkiTtsMockMode = mode; state.__neoAnkiTtsMockCalls = 0
  await session.defaultSession.protocol.handle('https', async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'api.openai.com' || url.pathname !== '/v1/audio/speech') return new Response('Unmocked HTTPS request', { status: 502 })
    state.__neoAnkiTtsMockCalls = (state.__neoAnkiTtsMockCalls || 0) + 1
    if (state.__neoAnkiTtsMockMode === 'delay') await new Promise((resolve) => setTimeout(resolve, 10_000))
    if (state.__neoAnkiTtsMockMode === 'fail') return new Response('Provider mock intentionally disabled', { status: 503 })
    return new Response(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
  })
}, initialMode)

const setProviderMockMode = async (application: ElectronApplication, mode: 'success' | 'fail' | 'delay') => {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await application.evaluate((_electron, value) => { (globalThis as typeof globalThis & { __neoAnkiTtsMockMode?: string }).__neoAnkiTtsMockMode = value }, mode)
      return
    } catch (error) {
      lastError = error
      if (!(error instanceof Error) || !/execution context was destroyed/i.test(error.message)) throw error
    }
  }
  throw lastError
}
const providerMockCalls = (application: ElectronApplication) => application.evaluate(() => (globalThis as typeof globalThis & { __neoAnkiTtsMockCalls?: number }).__neoAnkiTtsMockCalls || 0)
const persistedTrack = (window: Awaited<ReturnType<ElectronApplication['firstWindow']>>) => window.evaluate(async () => {
  const document = await window.neoAnkiDesktop!.loadWorkspaceV4Document()
  const config = document.clientState.settings.extensionConfig?.['org.neoanki.tts'] as { profiles?: Array<{ tracks?: Array<{ provider?: string; mode?: string; voice?: string; speed?: number }> }> } | undefined
  return config?.profiles?.[0]?.tracks?.[0] || null
})

test('installs the full extension and keeps provider credentials encrypted', async () => {
  test.setTimeout(120_000)
  const userData = await mkdtemp(join(tmpdir(), 'neoanki-tts-'))
  const packagePath = join(extensionRoot, 'build', 'org.neoanki.tts-2.0.4.neoanki-extension')
  const insecureLinuxBackend = process.platform === 'linux'
  let desktop = await electron.launch({
    executablePath: electronExecutable,
    args: [...(insecureLinuxBackend ? ['--password-store=basic'] : []), coreRoot, `--install-extension=${packagePath}`],
    env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData, NEO_ANKI_TEST_ALLOW_MULTIPLE_INSTANCES: '1', NEO_ANKI_E2E_HEADLESS: '1' },
  })
  try {
    let window = await desktop.firstWindow()
    await registerProviderMock(desktop)
    const rendererErrors: string[] = []
    window.on('console', (message) => { if (message.type() === 'error') rendererErrors.push(message.text()) })
    window.on('pageerror', (error) => rendererErrors.push(error.message))
    await window.getByRole('button', { name: /start fresh/i }).click()
    await window.getByRole('button', { name: /30 minutes/i }).click()
    await window.getByRole('button', { name: /create workspace/i }).click()
    window.once('dialog', (dialog) => dialog.accept())
    await window.getByRole('button', { name: /load sample workspace/i }).click()
    await window.getByRole('button', { name: /^Extensions/ }).first().click()
    await window.getByRole('tab', { name: /configure/i }).click()
    const settings = window.frameLocator('iframe[title="Text to Speech: settings"]')
    await expect(settings.getByRole('heading', { name: 'Text to Speech' })).toBeVisible()
    await expect(settings.getByText(/Cloud voice privacy/i)).toBeVisible()
    await expect(settings.locator('#status')).toBeEmpty()
    await expect(settings.locator('#profile')).toHaveValue('language-learning')
    await expect(settings.locator('#track')).toHaveValue('prompt')
    await expect(settings.locator('#secret-status')).not.toBeEmpty()
    if (process.env.NEOANKI_TTS_SCREENSHOT) await window.screenshot({ path: process.env.NEOANKI_TTS_SCREENSHOT.replace(/\.png$/, '-profiles.png'), fullPage: true })

    await settings.locator('#secret-provider').selectOption('openai')
    await settings.locator('#secret').fill('local-test-key-not-real')
    await settings.getByRole('button', { name: 'Save key on this device' }).click()
    if (insecureLinuxBackend) {
      await expect(settings.getByText(/secure OS credential storage is unavailable/i)).toBeVisible()
    } else {
      await expect(settings.getByText(/OpenAI key is configured/i)).toBeVisible()
    }
    if (insecureLinuxBackend) {
      const saveSettings = settings.getByRole('button', { name: 'Save settings' })
      await expect(saveSettings).toBeEnabled()
      await saveSettings.dispatchEvent('click')
      await expect(settings.locator('#status')).toHaveText('Settings saved to the encrypted workspace.', { timeout: 30_000 })
      expect(rendererErrors).toEqual([])
    } else {
    await settings.locator('#provider').selectOption('openai')
    await settings.locator('#mode').selectOption('generated')
    await settings.locator('#voice').fill('coral')
    await expect(settings.locator('#provider-disclosure')).toContainText(/processed prompt text is sent to OpenAI using model/i)
    await expect(settings.locator('#provider-disclosure a')).toHaveAttribute('href', /platform\.openai\.com/)
    await expect(settings.locator('#overlaps')).toContainText(/No other profile can match/i)
    await settings.getByRole('button', { name: 'Save settings' }).click()
    await expect.poll(() => persistedTrack(window), { timeout: 30_000 }).toMatchObject({ provider: 'openai', mode: 'generated', voice: 'coral' })
    await settings.getByRole('button', { name: 'Generate missing and outdated audio' }).dispatchEvent('click')
    await expect(settings.locator('#batch-status')).toHaveText(/completed: \d+\/\d+ notes · [1-9]\d* generated · \d+ skipped · 0 failed/i, { timeout: 20_000 })
    expect(await providerMockCalls(desktop)).toBeGreaterThan(0)
    const persisted = await window.evaluate(async () => {
      const document = await window.neoAnkiDesktop!.loadWorkspaceV4Document()
      return { media: document.workspace.media.length, records: document.workspace.extensionRecords.filter((value) => value.extensionId === 'org.neoanki.tts').length }
    })
    expect(persisted.media).toBeGreaterThan(0); expect(persisted.records).toBeGreaterThan(0)
    expect(rendererErrors).toEqual([])
    if (process.env.NEOANKI_TTS_SCREENSHOT) await window.screenshot({ path: process.env.NEOANKI_TTS_SCREENSHOT, fullPage: true })

    await desktop.close()
    desktop = await electron.launch({ executablePath: electronExecutable, args: [...(insecureLinuxBackend ? ['--password-store=basic'] : []), coreRoot], env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData, NEO_ANKI_TEST_ALLOW_MULTIPLE_INSTANCES: '1', NEO_ANKI_E2E_HEADLESS: '1' } })
    window = await desktop.firstWindow(); await registerProviderMock(desktop, 'fail')
    await window.addInitScript(() => {
      Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value() { document.documentElement.dataset.neoAnkiTestPlayed = (this as HTMLMediaElement).src; setTimeout(() => this.dispatchEvent(new Event('ended')), 10); return Promise.resolve() } })
      Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value() {} })
    })
    await window.getByRole('button', { name: /^Extensions/ }).first().click()
    await window.getByRole('tab', { name: /configure/i }).click()
    const restoredSettings = window.frameLocator('iframe[title="Text to Speech: settings"]')
    await expect(restoredSettings.getByText(/OpenAI key is configured/i)).toBeVisible()
    await restoredSettings.getByRole('button', { name: 'Generate missing and outdated audio' }).dispatchEvent('click')
    await expect(restoredSettings.locator('#batch-status')).toHaveText(/completed: \d+\/\d+ notes · 0 generated · [1-9]\d* skipped · 0 failed/i, { timeout: 45_000 })
    expect(await providerMockCalls(desktop)).toBe(0)

    await window.getByRole('button', { name: 'Today' }).first().click()
    await window.locator('button.study-button').click()
    const reviewFrame = window.locator('iframe[title$=": review"]')
    await expect(reviewFrame).toBeVisible()
    await reviewFrame.contentFrame().locator('html').evaluate(() => {
      Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value() { document.documentElement.dataset.neoAnkiTestPlayed = (this as HTMLMediaElement).src; setTimeout(() => this.dispatchEvent(new Event('ended')), 10); return Promise.resolve() } })
      Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value() {} })
    })
    await reviewFrame.contentFrame().getByRole('button', { name: 'Play TTS audio' }).click()
    await expect.poll(async () => `${await reviewFrame.contentFrame().locator('html').getAttribute('data-neo-anki-test-played')}|${await reviewFrame.contentFrame().locator('.message').textContent()}`).toMatch(/^neoanki-media:\/\/asset\//)

    await window.getByRole('button', { name: 'End session' }).click()
    await window.getByRole('button', { name: /^Extensions/ }).first().click()
    await window.getByRole('tab', { name: /configure/i }).click()
    const updatedSettings = window.frameLocator('iframe[title="Text to Speech: settings"]')
    await updatedSettings.locator('#speed').fill('1.1')
    const updatedSave = updatedSettings.getByRole('button', { name: 'Save settings' })
    await expect(updatedSave).toBeEnabled()
    await updatedSave.dispatchEvent('click')
    await expect(updatedSettings.locator('#status')).toHaveText('Settings saved to the encrypted workspace.', { timeout: 30_000 })
    await expect.poll(() => persistedTrack(window), { timeout: 30_000 }).toMatchObject({ speed: 1.1 })
    await setProviderMockMode(desktop, 'success')
    await updatedSettings.getByRole('button', { name: 'Generate missing and outdated audio' }).dispatchEvent('click')
    await expect(updatedSettings.locator('#batch-status')).toHaveText(/completed: \d+\/\d+ notes · [1-9]\d* generated · \d+ skipped · 0 failed/i, { timeout: 20_000 })

    await updatedSettings.locator('#speed').fill('1.2')
    await expect(updatedSave).toBeEnabled()
    await updatedSave.dispatchEvent('click')
    await expect(updatedSettings.locator('#status')).toHaveText('Settings saved to the encrypted workspace.', { timeout: 30_000 })
    await expect.poll(() => persistedTrack(window), { timeout: 30_000 }).toMatchObject({ speed: 1.2 })
    await setProviderMockMode(desktop, 'delay')
    await updatedSettings.getByRole('button', { name: 'Generate missing and outdated audio' }).dispatchEvent('click')
    await expect(updatedSettings.locator('#batch-status')).toContainText('running:')
    const stopBatch = updatedSettings.getByRole('button', { name: 'Stop' })
    await expect(stopBatch).toBeEnabled()
    await stopBatch.dispatchEvent('click')
    await expect(updatedSettings.locator('#batch-status')).toContainText('cancelled:', { timeout: 15_000 })
    }
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
