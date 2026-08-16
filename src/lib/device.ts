import { useEffect, useState } from 'react'

export type DeviceNav = {
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
}

/**
 * True for phones, tablets, and iPads — including iPadOS which reports as
 * Macintosh. False for laptops and desktops, even if the browser window is
 * short or narrow. Do not use viewport size here: that is what made laptop
 * browsers pick up the compact table UI.
 */
export function isHandheldDevice(nav: DeviceNav = typeof navigator === 'undefined' ? {} : navigator): boolean {
  const ua = nav.userAgent ?? ''
  if (/iPhone|iPod/i.test(ua)) return true
  if (/iPad/i.test(ua)) return true
  // iPadOS 13+ Safari/Chrome: Macintosh UA + touch.
  if (/Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1) return true
  if (/Android/i.test(ua)) return true
  if (/webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true
  if (/\b(Tablet|PlayBook|Kindle|Silk)/i.test(ua)) return true
  // Generic phones (Windows Phone, some WebViews) without the tokens above.
  if (/\bMobile\b/i.test(ua) && !/\bWindows NT\b/i.test(ua)) return true
  return false
}

export function applyDeviceClass(
  root: { classList: { toggle: (token: string, force?: boolean) => void } } = document.documentElement,
  nav: DeviceNav = navigator,
): boolean {
  const handheld = isHandheldDevice(nav)
  root.classList.toggle('device-handheld', handheld)
  root.classList.toggle('device-desktop', !handheld)
  return handheld
}

/** Syncs `html.device-handheld` / `html.device-desktop` and returns the current class. */
export function useIsHandheld(): boolean {
  const [handheld, setHandheld] = useState(() =>
    typeof navigator === 'undefined' ? false : isHandheldDevice(navigator),
  )

  useEffect(() => {
    setHandheld(applyDeviceClass())
  }, [])

  return handheld
}
