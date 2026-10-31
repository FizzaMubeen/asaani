# Spec v2 → v2.1 amendments

Proposed edits to `Offline Resilience & Barter App Developer Specification v2.md`.
Each amendment is self-contained and traceable; `A1`…`A16` are the ids used in
review. Nothing here changes the vision or the non-goals.

---

## A1 — §3.1/§3.2: distribution roles are now explicit

**Replace** the five-path list and the "Decision required" block with:

> **Primary:** Android APK (Capacitor), served from `https://localhost`, therefore a
> secure context. **Secondary:** installed PWA. **Content fallback:** a single
> self-contained `.html`.
>
> The single-file build is **library-only**: guides, search, calculators, print. It
> does **not** create an identity, sign receipts, or store anything the user would
> miss. Reason: on `file://` a service worker cannot register, Cache Storage rejects
> requests, and `storage.persist()` is false (measured, see `docs/SPIKE-RESULTS.md`).
>
> Local Wi-Fi is a data transport between installed apps, never a way to serve the
> app. Decision §3.2 is therefore **option B for packaging, option A for transport.**

## A2 — §3.3: the build hash is a shipped feature, not a process note

Add: the hash is computed by the build, stamped into the page as
`<meta name="asaani-build">`, and displayed in Settings → About with no network
request. Reproducibility is asserted by rebuilding and comparing digests; the current
build produces the same digest on two consecutive runs.

## A3 — §4.2: storage promises must match the mode

Add:

> Installed: request persistence, show the result plainly, and warn when it is
> refused. Single-file: **never** promise durability; the origin is shared with every
> other local file and may be cleared at any time.

## A4 — §5.3: the key model contradiction is resolved

**Replace** the `Profile` interface note and §8.1.2 with a single statement:

> The identity private key is generated with `extractable: false` and stored as a
> `CryptoKey` in IndexedDB. It is never exported and never wrapped. Sensitive tables
> are encrypted with a separate symmetric key derived from the PIN
> (PBKDF2-SHA256, ≥600 000 iterations). Recovery from device loss is circle
> re-vouch, not key export.
>
> `wrapKey` over a non-extractable key fails with `InvalidAccessError`, so
> "non-extractable" and "PIN-wrapped backup" cannot both hold. This spec chooses
> non-extractable.

## A5 — §5.4: define the byte layout, not just the idea

Add the exact construction:

```
signature = Sign(priv, UTF8(domainTag) || 0x00 || payloadBytes)
```

and state that multi-part payloads are joined with an explicit `0x00` separator, and
that `payloadBytes` is always `UTF8(JCS(payload))` unless a section says otherwise.

Also replace the domain tag prefix `resilience/` with `asaani/`, and list all tags.

## A6 — §5.5: fix the receipt id (currently circular)

**Replace** `"id": "SHA-256 of canonical body (excluding sigs)"` with:

> `id = base64url(SHA-256(UTF8(JCS(body with the id field omitted))))`
>
> The id is derived by the verifier and never trusted from the peer. A receipt whose
> `id` does not match its body is rejected before any signature check.

Without this, two implementations hash different byte strings and every receipt they
exchange fails to verify.

## A7 — §5.5: fix the `sigB` input

**Replace** "covers body + sigA" with:

> `sigB = Sign(privB, "asaani/receipt/v1/B" || 0x00 || JCS(body) || 0x00 || sigA_bytes)`
>
> Binding `sigA` into B's signature prevents a third party from swapping A's
> signature after B has countersigned.

## A8 — §5.4: signatures are not reproducible

Add a testing note: Web Crypto ECDSA uses a random nonce, so two signatures over the
same payload differ. Tests must assert *verify true/false*, never signature bytes.

## A9 — §5.6: the trust model needs numbers

Add D8's weights (receipt 1.0, distance-2 vouch 0.5, anchor intro 0.5, one vouch per
issuer per target, 24-month half-life, revocations subtract first) and require that
every label carry the path it was derived from. Mark all weights as *pilot
calibration targets*, not settled policy.

## A10 — new subsection: time

Add to §5.1:

> Device clocks are untrusted. A receipt, once dual-signed, is valid forever.
> `handedOverAt` is evidence of ordering, not of validity. `expiresAt` on listings is
> a display hint. The app warns when the clock moves backwards or is implausible.

## A11 — new subsection: merge and retention

Add to §5.1:

> Concurrent copies of the same `listing.id` resolve to the highest `revision`, with
> ties broken by the lexicographically smallest signature hash, so every device
> reaches the same answer without a coordinator. Deletions are tombstones and are
> never garbage-collected while a peer might still hold the row. A retention policy
> and a compact export are required before receipt volume becomes a problem.

## A12 — §5.3/§6: anchor capture

Add to the Phase 3 deliverables:

> Anchors are revocable by the community, not only by themselves: N independent
> members may attach a signed counter-attestation marking an anchor disputed, shown
> as "This anchor's status is disputed by 2 people you know."

## A13 — §6: split Phase 1

**1A — pipeline (must close first):** shell, build tooling (PWA + single-file + hash
+ poster), **one** guide authored end to end through expert review, local search,
bookmarks, print, text scaling, RTL scaffolding, the salt-brine calculator, PIN lock,
panic wipe, cache-complete indicator.

**1B — content scale-out:** the remaining guides, audio, additional languages, seed
viability tracker.

Rationale: Phase 1 as written bundles six guide families with expert review, audio,
three languages and distribution tooling into a single gate. The long pole is expert
review time, not engineering, and the pipeline should be proven on one guide before
ten are commissioned.

## A14 — §6: Phase 4 transport order

**Replace** the fountain-coded-QR-first deliverables with:

1. Encrypted sync bundle, exported and imported as a single file (primary).
2. Animated QR with chunk index, CRC and retransmit-on-missing (fallback).
3. Fountain coding as an optimisation, only if benchmarks justify it.
4. Selective sync, needs board, market-day mode, printable outputs — unchanged.

Add a Phase 4 **entry gate**: publish measured QR throughput on the low-end device
before any fountain work starts.

## A15 — §8.1: CSP and local transport

Note that `connect-src 'none'` is correct for Phase 1 and must be widened
deliberately — and only for private address ranges — if a Phase 4 local-network
transport is chosen. Widening it silently would break the no-network guarantee.

## A16 — §9.2: tests that now exist

Record as already automated: JCS key-order independence and NaN rejection; the
full A→B→A handshake; tampered body; forged id; mis-addressed receipt; swapped
`sigA` after countersign; duplicate-scan idempotency; domain separation; CSP blocks
`fetch`; reproducible build digest. Still missing: schema fuzzing, property tests,
offline cold start under Playwright, bundle budget in CI.

---

## §11 open questions — current status

| # | Question | Status |
| :-- | :-- | :-- |
| 1 | Primary distribution path | **answered** — APK, see A1 |
| 2 | Framework and transports | **answered** — Svelte 5; file bundle then QR, see D4/A14 |
| 3 | First anchors | open — needs a person |
| 4 | Languages and scripts | open — blocks Phase 1A |
| 5 | Food-safety and medical reviewers | open — blocks Phase 1 definition of done |
| 6 | Deferred-trade mode | open — recommend deferring past the pilot |
| 7 | Success measure and stop condition | open — needed before Phase 5 |
