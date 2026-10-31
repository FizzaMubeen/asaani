# Asaani — آسانی

An offline-first survival library and trust-based barter tool for neighbourhoods with
no network, no server and no accounts.

**Status: Phase 0 (environment and crypto readiness) — complete.**

```
npm install
npm run dev            # http://localhost:5173
npm run build          # dist/           installable payload (PWA shell / APK webroot)
npm run build:single   # dist-single/    one self-contained .html — the library
npm run check          # svelte-check, must stay at 0 errors
```

## What Phase 0 delivered

- **Working shell** — Svelte 5 + Vite + TypeScript + Tailwind 4 + Dexie, mobile-first,
  large-text scaling, dark mode, print stylesheet.
- **Two build artifacts**, both verified in a real browser: a 160 KB installable build
  and a **161 KB single file** that works from `file://` with no network.
- **Reproducible build identity** — the bundle is hashed deterministically, the digest
  is stamped into the page, and the running app displays it with no network request.
- **Strict CSP** — `connect-src 'none'`; a deliberate `fetch()` from the shipped page
  is blocked in both artifacts.
- **Crypto core** — JCS canonicalization, domain-separated ECDSA P-256 signing, and the
  dual-signed receipt handshake, with two spec bugs fixed (see below).
- **12 passing self-tests** covering every failure case in spec §5.5, shown in the app
  at startup so a broken crypto path is visible immediately.
- **Schema** — the full IndexedDB table set, so Phase 2 does not need a destructive
  migration.
- **Decisions and spec amendments** — `docs/DECISIONS.md`,
  `docs/SPEC-AMENDMENTS-v2.1.md`, `docs/SPIKE-RESULTS.md`.

## What the spike changed

`docs/SPIKE-RESULTS.md` has the measurements. The two that altered the plan:

1. **`file://` cannot install or persist.** No service worker, no Cache Storage,
   `storage.persist()` is false — but crypto and IndexedDB work fine. So the
   single-file build is the **library**, not the app.
2. **A non-extractable key cannot be PIN-wrapped.** `wrapKey` refuses it. The spec
   asked for both; we chose non-extractable and made recovery a social process.

Two defects in spec §5.5 are fixed in code: the receipt `id` was circular, and the
`sigB` input was not a canonicalizable value.

## Layout

```
src/
  App.svelte              readiness screen: build hash, device, storage, self-test
  lib/crypto.ts           signing, keys, receipt handshake
  lib/jcs.ts              RFC 8785 canonical JSON
  lib/selftest.ts         spec §5.5 failure cases, executable
  lib/db.ts               Dexie schema (§5.2)
  lib/capabilities.ts     runtime feature detection
scripts/
  hash-build.mjs          reproducible digest + in-page stamp
  smoke.mjs               headless browser test: console, requests, CSP
  serve.mjs               static server for testing the built app
spike/
  env-probe.html          device probe — run this on the pilot phone
  probe.mjs               CDP driver for the probe
docs/                     decisions, spike results, spec amendments
```

## Testing a real phone

Copy `spike/env-probe.html` to the device and open it. It needs no server and reports
every capability the app depends on. If a required row fails, the device is out of
scope before any feature work starts.

## Not built yet

Guides and content, search, print output, PIN lock and panic wipe, listings,
QR transfer, trust engine, sync. Those are Phases 1–4; see `docs/DECISIONS.md` for
what is locked and what still needs a human decision.
