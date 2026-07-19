// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

describe('SDK v2 worker bootstrap', () => {
  it('installs transport without relying on the host-removed importScripts global', async () => {
    const addEventListener = vi.fn()
    const postMessage = vi.fn()
    vi.stubGlobal('addEventListener', addEventListener)
    vi.stubGlobal('postMessage', postMessage)
    await import('./worker.js')
    expect(addEventListener).toHaveBeenCalledWith('message', expect.any(Function))
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ protocol: 2, type: 'ready', extensionId: 'org.neoanki.tts' }))
  })
})
