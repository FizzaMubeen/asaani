/**
 * Runtime capability detection.
 *
 * The pilot targets phones that are old, offline, and often running a WebView that
 * is years behind. Every optional capability is probed here once, and the UI
 * degrades instead of throwing.
 */

export type CapabilityState = 'ok' | 'degraded' | 'missing'

export interface Capability {
  id: string
  label: string
  state: CapabilityState
  detail: string
  /** true when the app cannot do its core job without this */
  required: boolean
}

export const MODE = {
  /** One self-contained .html opened from local storage: library only. */
  singleFile: location.protocol === 'file:',
  secureContext: window.isSecureContext,
  serviceWorker: 'serviceWorker' in navigator && location.protocol !== 'file:',
}

function state(ok: boolean | undefined, soft = false): CapabilityState {
  if (ok) return 'ok'
  return soft ? 'degraded' : 'missing'
}

export async function detectCapabilities(): Promise<Capability[]> {
  const caps: Capability[] = []
  const push = (
    id: string,
    label: string,
    s: CapabilityState,
    detail: string,
    required = false,
  ) => caps.push({ id, label, state: s, detail, required })

  push(
    'mode',
    'Build mode',
    MODE.singleFile ? 'degraded' : 'ok',
    MODE.singleFile
      ? 'Single-file library (file://) — no trades, no identity, storage is evictable'
      : 'Installed app (http/https) — full functionality',
  )

  push('secure', 'Secure context', state(MODE.secureContext), MODE.secureContext ? 'yes' : 'no', true)
  push('subtle', 'Web Crypto', state(!!crypto?.subtle), typeof crypto?.subtle, true)

  // ECDSA P-256 round trip
  try {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
    const data = new TextEncoder().encode('probe')
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, data)
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, sig, data)
    push('ecdsa', 'ECDSA P-256', state(ok), ok ? 'sign + verify ok' : 'verify failed', true)
  } catch (err) {
    push('ecdsa', 'ECDSA P-256', 'missing', String(err), true)
  }

  push('idb', 'IndexedDB', state(typeof indexedDB !== 'undefined'), typeof indexedDB, true)
  push(
    'persist',
    'Durable storage',
    state(await navigator.storage?.persisted?.().catch(() => false), true),
    MODE.singleFile ? 'not available on file://' : 'navigator.storage.persisted()',
  )

  push('sw', 'Service worker', state(MODE.serviceWorker, true), MODE.serviceWorker ? 'available' : 'unavailable in this mode')
  push('caches', 'Cache Storage', state(MODE.serviceWorker, true), MODE.serviceWorker ? 'available' : 'unavailable in this mode')
  push(
    'barcode',
    'QR decoding',
    state('BarcodeDetector' in window, true),
    'BarcodeDetector' in window ? 'native detector' : 'needs WASM/JS fallback',
  )
  const hasCamera = typeof navigator.mediaDevices?.getUserMedia === 'function'
  push('camera', 'Camera', state(hasCamera, true), hasCamera ? 'getUserMedia present' : 'absent')

  // Ed25519 is an optional upgrade, never a requirement: old WebViews lack it.
  try {
    await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    push('ed25519', 'Ed25519 (optional)', 'ok', 'supported — usable as faster signing')
  } catch {
    push('ed25519', 'Ed25519 (optional)', 'degraded', 'not supported — P-256 baseline is used')
  }

  push('rtl', 'RTL layout', 'ok', 'dir attribute + logical CSS properties')

  return caps
}
