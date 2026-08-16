import { describe, expect, it } from 'vitest'
import { applyDeviceClass, isHandheldDevice } from './device'

describe('isHandheldDevice', () => {
  it('treats laptop / desktop browsers as desktop, even with a short window', () => {
    expect(
      isHandheldDevice({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      }),
    ).toBe(false)
    expect(
      isHandheldDevice({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        platform: 'Win32',
        maxTouchPoints: 0,
      }),
    ).toBe(false)
  })

  it('detects iPhone, Android phones, iPad, and iPadOS-as-Macintosh', () => {
    expect(
      isHandheldDevice({
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      }),
    ).toBe(true)
    expect(
      isHandheldDevice({
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
      }),
    ).toBe(true)
    expect(
      isHandheldDevice({
        userAgent:
          'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      }),
    ).toBe(true)
    expect(
      isHandheldDevice({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      }),
    ).toBe(true)
  })
})

describe('applyDeviceClass', () => {
  it('sets exactly one of device-handheld / device-desktop', () => {
    const tokens = new Set<string>()
    const root = {
      classList: {
        toggle(token: string, force?: boolean) {
          if (force) tokens.add(token)
          else tokens.delete(token)
        },
      },
    }
    applyDeviceClass(root, {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    })
    expect([...tokens]).toEqual(['device-handheld'])
  })
})
