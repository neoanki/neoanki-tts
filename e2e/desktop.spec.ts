import { expect, test, _electron as electron, type ElectronApplication } from '@playwright/test'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
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

test('installs the full extension and keeps provider credentials behind the secret broker', async () => {
  test.setTimeout(240_000)
  const userData = await mkdtemp(join(tmpdir(), 'neoanki-tts-'))
  const packageName = (await readdir(join(extensionRoot, 'build'))).find((name) => /^org\.neoanki\.tts-.*\.neoanki-extension$/.test(name))
  if (!packageName) throw new Error('The TTS extension package was not built before the desktop test.')
  const packagePath = join(extensionRoot, 'build', packageName)
  const insecureLinuxBackend = process.platform === 'linux'
  let desktop = await electron.launch({
    executablePath: electronExecutable,
    args: [...(insecureLinuxBackend ? ['--password-store=basic'] : []), coreRoot, `--install-extension=${packagePath}`],
    env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData, NEO_ANKI_TEST_ALLOW_MULTIPLE_INSTANCES: '1', NEO_ANKI_E2E_HEADLESS: '1', NEO_ANKI_E2E_SECRET_BACKEND: 'disposable-file' },
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
    await window.getByRole('button', { name: 'Library' }).first().click()
    await window.locator('.library-header').getByRole('button', { name: 'Add knowledge item' }).click()
    await expect(window.getByRole('heading', { name: 'New knowledge' })).toBeVisible()
    await window.getByLabel('Prompt', { exact: true }).fill('Why does retrieval practice improve memory?')
    await window.getByLabel('Answer', { exact: true }).fill('It strengthens the pathway used to recall the information.')
    const unavailableAction = window.locator('.authoring-action').filter({ hasText: 'Generate offline audio after adding knowledge' })
    await expect(unavailableAction.getByRole('checkbox')).toBeDisabled()
    await expect(unavailableAction).toContainText(/has no generated cloud track/i)
    if (process.env.NEOANKI_TTS_SCREENSHOT) {
      await window.screenshot({ path: process.env.NEOANKI_TTS_SCREENSHOT.replace(/\.png$/, '-create-setup.png'), fullPage: true })
      await unavailableAction.screenshot({ path: process.env.NEOANKI_TTS_SCREENSHOT.replace(/\.png$/, '-create-setup-action.png') })
    }
    await unavailableAction.getByRole('button', { name: 'Set up Text to Speech' }).click()
    let settings = window.frameLocator('iframe[title="Text to Speech: settings"]')
    await expect(window.getByRole('heading', { name: 'Text to Speech' })).toBeVisible()
    await expect(settings.getByRole('heading', { name: 'General' })).toBeVisible()
    await expect(settings.getByText(/Cloud voice privacy/i)).toBeVisible()
    await expect(settings.locator('#status')).toBeEmpty()
    await expect(settings.locator('#profile')).toHaveValue('language-learning')
    await expect(settings.locator('#track')).toHaveValue('prompt')
    await expect(settings.locator('#secret-status')).not.toBeEmpty()
    if (process.env.NEOANKI_TTS_SCREENSHOT) await window.screenshot({ path: process.env.NEOANKI_TTS_SCREENSHOT.replace(/\.png$/, '-profiles.png'), fullPage: true })

    await settings.locator('#quick-openai-key').fill('local-test-key-not-real')
    await settings.getByRole('button', { name: 'Enable offline audio' }).click()
    await expect(settings.locator('#quick-setup-status')).toHaveText(/Offline prompt audio is ready/i, { timeout: 30_000 })
    await expect(settings.getByText(/OpenAI key is configured/i)).toBeVisible()
    await expect.poll(() => persistedTrack(window), { timeout: 30_000 }).toMatchObject({ provider: 'openai', mode: 'generated', voice: 'coral' })
    await expect(settings.locator('#provider-disclosure')).toContainText(/processed prompt text is sent to OpenAI using model/i)
    await expect(settings.locator('#provider-disclosure a')).toHaveAttribute('href', /platform\.openai\.com/)
    await expect(settings.locator('#overlaps')).toContainText(/No other profile can match/i)

    await window.getByRole('button', { name: 'Back to new knowledge' }).click()
    await expect(window.getByLabel('Prompt', { exact: true })).toHaveValue('Why does retrieval practice improve memory?')
    await expect(window.getByLabel('Answer', { exact: true })).toHaveValue('It strengthens the pathway used to recall the information.')
    const authoringAction = window.locator('.authoring-action').filter({ hasText: 'Generate offline audio after adding knowledge' })
    await expect(authoringAction.getByRole('checkbox')).toBeEnabled()
    await expect(authoringAction).toContainText(/Language learning · Prompt/i)
    if (process.env.NEOANKI_TTS_SCREENSHOT) {
      await window.screenshot({ path: process.env.NEOANKI_TTS_SCREENSHOT.replace(/\.png$/, '-create-ready.png'), fullPage: true })
      await authoringAction.screenshot({ path: process.env.NEOANKI_TTS_SCREENSHOT.replace(/\.png$/, '-create-ready-action.png') })
    }
    await authoringAction.getByRole('checkbox').check()
    await window.getByRole('button', { name: 'Add knowledge & generate audio' }).click()
    await expect(window.getByText(/1 portable audio track generated/i)).toBeVisible({ timeout: 30_000 })

    await window.getByRole('button', { name: /^Extensions/ }).first().click()
    await window.getByRole('tab', { name: /configure/i }).click()
    settings = window.frameLocator('iframe[title="Text to Speech: settings"]')
    await expect(settings.getByText(/OpenAI key is configured/i)).toBeVisible()
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
    desktop = await electron.launch({ executablePath: electronExecutable, args: [...(insecureLinuxBackend ? ['--password-store=basic'] : []), coreRoot], env: { ...process.env, NEO_ANKI_USER_DATA_DIR: userData, NEO_ANKI_TEST_ALLOW_MULTIPLE_INSTANCES: '1', NEO_ANKI_E2E_HEADLESS: '1', NEO_ANKI_E2E_SECRET_BACKEND: 'disposable-file' } })
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
  } finally {
    const child = desktop.process()
    if (child.exitCode === null) {
      child.kill('SIGKILL')
      await new Promise<void>((resolve) => child.once('exit', () => resolve()))
    }
  }

  try {
    const secretFile = join(userData, 'extensions', 'data', 'org.neoanki.tts', 'secrets.json')
    const stored = await readFile(secretFile, 'utf8')
    expect(stored).not.toContain('local-test-key-not-real')
    expect(JSON.parse(stored).values['openai.api-key']).toMatch(/^[A-Za-z0-9+/=]+$/)
  } finally { await rm(userData, { recursive: true, force: true }) }
})
