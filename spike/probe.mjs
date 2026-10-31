// Minimal CDP driver: opens a file:// page in real Chrome and waits for window.__done.
// Usage: node spike/probe.mjs "file:///D:/Android/asaani/spike/env-probe.html"
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const target = process.argv[2]
if (!target) { console.error('usage: node probe.mjs <url>'); process.exit(1) }

const port = 9333 + Math.floor(Math.random() * 200)
const profile = mkdtempSync(join(tmpdir(), 'asaani-cdp-'))

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
  throw new Error('CDP endpoint never came up: ' + path)
}

function connect(wsUrl) {
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
      }
    })
  })
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed')
  return r.result.value
}

try {
  await json('/json/version')
  const tab = await json(`/json/new?${encodeURIComponent(target)}`, { method: 'PUT' })
  const cdp = await connect(tab.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')

  let results = null
  for (let i = 0; i < 150; i++) {
    results = await evaluate(cdp, 'window.__done ? window.__results : null').catch(() => null)
    if (results) break
    await sleep(200)
  }

  if (!results) {
    console.error('TIMED OUT waiting for window.__done')
    console.error(await evaluate(cdp, 'document.body.innerText').catch(() => '?'))
    process.exitCode = 1
  } else {
    console.log(JSON.stringify({ url: target, results }, null, 2))
  }
  cdp.close()
} finally {
  chrome.kill()
}
