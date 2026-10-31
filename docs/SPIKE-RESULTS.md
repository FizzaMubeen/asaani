# Phase 0 spike results

Run against **Chrome 156.0.8078.48** (desktop, headless) on Windows, plus the built
artifacts of this repo. Reproduce with:

```
node spike/probe.mjs "file:///D:/Android/asaani/spike/env-probe.html"
node scripts/smoke.mjs "file:///D:/Android/asaani/dist-single/index.html"
```

These results decide the §3.2 question in the spec, and they changed two of my
assumptions. Android WebView and iOS Safari still need the device matrix in §9.1.

## 1. What works on `file://` (the single-file build)

| Capability | Result | Consequence |
| :-- | :-- | :-- |
| `isSecureContext` | **true** | `crypto.subtle` is available; the single file is not a crypto dead end |
| `crypto.subtle` ECDSA P-256 sign/verify | **pass** (1 ms) | receipts could technically be signed in the single-file build |
| Ed25519 | **supported** | optional faster path on modern devices |
| IndexedDB open + put + get | **pass** | storage exists |
| 200-item write (~44 KB) | **42 ms** | a realistic catalog write is not a bottleneck |
| `CryptoKey` stored in IndexedDB, reloaded, used to sign | **pass** | a non-extractable identity survives page reloads |
| `localStorage` | **pass** | works |
| `navigator.storage.persist()` | **false** | storage is evictable — the browser may delete it |
| `serviceWorker.register()` | **FAIL** — `protocol of the current origin ('null') is not supported` | no offline install, no precache, no update path |
| `caches` API | **FAIL** — `Request scheme 'file' is unsupported` | Cache Storage is unusable |
| `BarcodeDetector` | **absent** (headless) | QR needs a WASM/JS fallback — as the spec already assumes |
| `getUserMedia` | present | camera may exist, but see WebView note |
| `wrapKey` over a non-extractable key | **FAIL** — `InvalidAccessError` | confirms the spec's contradiction: a non-extractable key cannot be PIN-wrapped |
| ECDSA determinism | **non-deterministic** (random k) | never assert signature bytes in tests |

### The decisive finding

`file://` has no service worker and no Cache Storage, and `persist()` is false. So
a single-file build **cannot be installed, cannot update itself, and cannot promise
to keep its data.** Everything else works — including crypto.

**Therefore:** the single-file build is the **library**, not the app. It gets guides,
search, calculators and print. It does not get identity, trades or durable records.

This is better than the spec's assumption. §3.1 assumed the single-file build was a
full-featured fallback; it is really a *content* fallback, and saying so makes
Phase 1's definition-of-done achievable instead of impossible.

## 2. The two artifacts, measured

```
npm run build          -> dist/         5 files, 160.0 KB total, index.html 1.1 KB
npm run build:single   -> dist-single/  1 file,  161.3 KB,     index.html 161.3 KB
```

- The single file is **161 KB**, against a 5 MB budget without audio. Content, not
  code, will decide whether that budget holds.
- Rebuilding the single file twice gives the **same hash** (`86df050d81399375` on
  the build in this commit), so §3.3's reproducible-build requirement is met for
  this stage. `dist.build.json` / `dist-single.build.json` record the digest, and
  the hash is stamped into the page so the running app can display it offline.
- `dist-single/` contains **exactly one file**, because the manifest link is dropped
  and the icon is inlined as a data URI in that mode. Sharing by Bluetooth means
  sharing one file.

## 3. The shipped CSP does block the network

Both artifacts carry a `Content-Security-Policy` meta tag with `connect-src 'none'`.
A deliberate `fetch("https://example.com/...")` from the running page returns
`BLOCKED: Failed to fetch` in both builds, and the request never reaches the network
layer.

The installed build's only requests are same-origin assets:

```
/assets/index-*.js, /assets/index-*.css, /manifest.webmanifest, /icon.svg
```

The single-file build makes **zero** requests.

## 4. Unresolved by this spike

| Question | Why it still matters | How to close it |
| :-- | :-- | :-- |
| Android WebView on a 2 GB phone | WebView may differ from Chrome on `file://`, crypto and camera permissions | Run `spike/env-probe.html` on the pilot device; it needs no server |
| iOS Safari | storage eviction and PWA limits are documented but not measured here | Same probe, opened from Files |
| `BarcodeDetector` availability | absent in headless; present on some Android builds | Probe on device; plan for the WASM decoder regardless |
| QR transfer throughput | Phase 4's plan depends on it | benchmark before committing to fountain coding |
| Capacitor `https://localhost` | expected to give a secure context and a real install path | build the shell in Phase 1 and confirm |
