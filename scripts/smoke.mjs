// Generic browser smoke test over CDP.
// Opens a URL, waits for the app to finish its self-test, then reports:
//   - console errors
//   - every network request the page attempted (CSP / no-network assertion)
//   - whether fetch() is actually blocked by the shipped CSP
//
// Usage: node scripts/smoke.mjs <url>
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const target = process.argv[2]
if (!target) {
  console.error('usage: node scripts/smoke.mjs <url>')
  process.exit(1)
}

const port = 9500 + Math.floor(Math.random() * 200)
const profile = mkdtempSync(join(tmpdir(), 'asaani-smoke-'))

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function json(path, init) {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, init)
      if (r.ok) return await r.json()
    } catch { /* not up yet */ }
    await sleep(150)
  }
  throw new Error(`CDP endpoint never came up: ${path}`)
}

function connect(wsUrl, onEvent) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let id = 0
    const pending = new Map()
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const msgId = ++id
        return new Promise((res, rej) => {
          pending.set(msgId, { res, rej })
          ws.send(JSON.stringify({ id: msgId, method, params }))
        })
      },
      close: () => ws.close(),
    }))
    ws.addEventListener('error', reject)
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
      } else if (msg.method) {
        onEvent?.(msg)
      }
    })
  })
}

const requests = []
const consoleErrors = []

try {
  await json('/json/version')
  const tab = await json(`/json/new?${encodeURIComponent(target)}`, { method: 'PUT' })
  const cdp = await connect(tab.webSocketDebuggerUrl, (msg) => {
    if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request.url)
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? 'exception')
    }
  })

  await cdp.send('Network.enable')
  await cdp.send('Runtime.enable')

  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description ?? 'eval failed' }
    return { value: r.result.value }
  }

  // Wait for the app to finish its async self-test.
  let text = ''
  for (let i = 0; i < 120; i++) {
    const r = await evaluate('document.querySelector("main") ? document.querySelector("main").innerText : ""')
    text = r.value ?? ''
    if (text && !text.includes('running…') && !text.includes('checking')) break
    await sleep(200)
  }

  const verdict = await evaluate(
    '(() => { const el = document.querySelector("main"); if (!el) return null;' +
    ' const rows = [...el.querySelectorAll("li")].map(li => li.innerText.replace(/\\n/g, " | "));' +
    ' return { headline: el.querySelector("h1")?.innerText, badge: document.querySelector("#verdict")?.innerText, rows }; })()',
  )

  // Does the shipped CSP actually stop an outbound request?
  const cspProbe = await evaluate(
    'fetch("https://example.com/asaani-probe").then(() => "ALLOWED").catch(e => "BLOCKED: " + e.message)',
  )

  console.log(JSON.stringify({
    target,
    badge: verdict.value?.badge ?? '(none)',
    rows: verdict.value?.rows ?? [],
    cspProbe: cspProbe.value ?? cspProbe.error,
    requests,
    consoleErrors,
  }, null, 2))

  cdp.close()
} finally {
  chrome.kill()
}
