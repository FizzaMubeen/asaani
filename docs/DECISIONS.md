# Decisions

Locked choices for Phase 1. Each has a rationale, the evidence behind it, and the
condition that would make us reopen it. Anything not listed here is still open.

---

## D1 — Distribution: APK primary, PWA secondary, single-file HTML is library-only

**Decision.** The pilot ships an Android APK built with Capacitor. The installable
PWA is a secondary channel for people who already have a browser and a connection.
The single-file `.html` contains the library, search, calculators and print — and
nothing else.

**Why.** Capacitor serves the app from `https://localhost`, which is a real secure
context, so camera, crypto and install behave predictably. Sideloading one APK is
something an anchor can do hand-to-hand; talking an elder through a PWA install
prompt over a flaky connection is not.

The single-file build is excluded from identity and trades because the spike shows it
cannot register a service worker, cannot use Cache Storage, and cannot request
persistent storage (`docs/SPIKE-RESULTS.md` §1). It also shares one opaque origin
with every other local file, so two copies opened on the same device share the same
storage. That is fine for read-only content and unacceptable for trust records.

**Evidence.** Chrome 156 probe: `serviceWorker.register()` fails with
`protocol of the current origin ('null')`; `caches.put()` rejects `file` scheme;
`storage.persist()` returns `false`. Crypto, IndexedDB and a reloaded `CryptoKey`
all work, which is why the line is drawn at *writes*, not at *capability*.

**Revisit if.** The device matrix (spec §9.1) shows APK sideloading fails on the
pilot hardware (Android 14+ install restrictions, managed devices), or the trusted
anchor model cannot supply APKs.

**Consequence.** §3.2 of the spec is answered: option A for data transport, option B
for packaging. Local Wi-Fi is a *data* channel between installed apps, never a way
to serve the app.

---

## D2 — Key model: one non-extractable identity key, no key export

**Decision.** The identity is an ECDSA P-256 key pair generated once with
`extractable: false`, stored as a `CryptoKey` in IndexedDB. It is never exported and
never backed up. Recovery after device loss is circle re-vouch (Phase 3).

Data that needs to be secret at rest (receipts, contacts, notes) is encrypted with a
separate symmetric key derived from the user's PIN via PBKDF2-SHA256, 600 000
iterations.

**Why.** The spec asks for both "non-extractable" and "wrapped by a PIN-derived
key", and those cannot both be true: `wrapKey` over a non-extractable key fails with
`InvalidAccessError` (measured, spike §1). This decision picks the honest half.

Non-extractable means the key is useless to anyone who copies the IndexedDB file,
which is the realistic seizure scenario. The cost is that a lost phone means a lost
identity — but offline, a lost phone already means a lost identity to everyone who
knew that person, and the app should mirror that rather than pretend otherwise.

**Evidence.** `CryptoKey` survives a round trip through IndexedDB and can still sign.
PBKDF2 at 600k iterations takes 469 ms on a desktop core, so expect 1.5–3 s on a
2 GB phone — an acceptable unlock delay, and the number to tune on real hardware.

**Revisit if.** Usability testing shows PIN entry every session is unworkable for
the persona set, or key loss proves to be the dominant failure in the pilot. The
fallback is a passphrase-encrypted export, which requires an extractable key and
therefore a different threat model.

---

## D3 — Sync: encrypted file bundle first, QR second, fountain coding later

**Decision.** Phase 4's primary transport is an encrypted sync bundle exported as a
single file and moved by whatever the people actually have: Bluetooth, Nearby Share,
USB, SD card, or a messaging app that still works. Animated QR is the fallback for
when no other channel exists. Fountain coding is a later optimisation, not a Phase 4
gate.

**Why.** QR screen-to-camera is the slowest and most fragile link in the whole
design: a few hundred bytes per frame, at 3–10 frames per second on a 2 GB phone,
sensitive to lighting, focus and hand tremor. A 200-listing catalog is roughly
30–50 KB compressed — a couple of seconds as a file, a minute or more as a perfect
QR dance. Fountain codes also add real implementation risk for a benefit that a file
transfer makes moot.

The security property does not change: signatures are verified on import either way,
so a hostile bundle is rejected before anything is written.

**Revisit if.** Field testing finds the file channel genuinely unavailable in the
pilot neighbourhood (no Bluetooth pairing between strangers, no shared USB), or QR
benchmarks come in far better than expected.

---

## D4 — Framework: Svelte 5 + Vite + TypeScript + Tailwind 4

**Decision.** As scaffolded in this repository. Dexie for IndexedDB.

**Why.** Small runtime, no virtual DOM, and the compiler is happy with the
accessibility and print requirements. Print stylesheets, RTL and large-text scaling
are plain CSS concerns that Svelte does not get in the way of. Preact would also
work; there is no strong reason to switch.

**Revisit if.** Bundle measurement after Phase 1 content lands shows the runtime is
a meaningful share of a 5 MB budget.

---

## D5 — Domain tags are bound to `asaani/`

**Decision.** `asaani/listing/v1`, `asaani/receipt/v1/A`, `asaani/receipt/v1/B`,
`asaani/vouch/v1`, `asaani/revoke/v1`, `asaani/anchor/v1`, `asaani/dispute/v1`.

**Why.** The spec used the generic prefix `resilience/`, which is a namespace
anyone could also claim. Binding signatures to the product name means a signature
minted here cannot be replayed in a look-alike app. It is free, and it can never be
changed after the first release without invalidating every receipt.

---

## D6 — Receipt id: `SHA-256(JCS(body without id))`

**Decision.** The id is derived from the body with the `id` field omitted, then
inserted. Peers never supply an id that the verifier trusts.

**Why.** Spec v2 §5.5 says "SHA-256 of canonical body (excluding sigs)". The id
lives inside the body, so that instruction is circular: two independent
implementations would hash different byte strings and produce receipts that fail to
verify against each other. See `src/lib/crypto.ts → receiptId()`.

---

## D7 — `sigB` input: `JCS(body) || 0x00 || sigA_bytes`

**Decision.** Party B signs the canonical body, a zero byte, then the raw signature
bytes of A.

**Why.** Spec v2 says sigB "covers body + sigA", but the signature rule is defined
over `CanonicalJSON(payload)` and `body + sigA` is not JSON. Binding `sigA` into
B's signature is what prevents a third party from swapping A's signature after B has
countersigned — the self-test asserts exactly that case.

---

## D8 — Trust model v0 (numbers chosen, not yet validated)

**Decision.** Trust is computed from a local graph and rendered only as words.

- Receipt between you and the person: weight **1.0**.
- Vouch from someone you have a receipt with: **1.0**.
- Vouch from someone at distance 2: **0.5**. Distance 3 or more: **0**, shown as no path.
- Anchor introduction: **0.5**, and the anchor is named in the label.
- At most **one** vouch per issuer per target counts; a second vouch from the same
  issuer adds nothing.
- Age decay: a vouch older than 24 months counts at half weight. Decay uses the
  *relative order* of timestamps, never an absolute clock.
- Revocations are applied before display and always subtract.

Labels: "You have traded with Ravi (2 times)" · "Vouched for by Karim, whom you
know" · "Vouched for by 2 people you know" · "New member, introduced by Teacher
Salma (community anchor)" · "No one you know has vouched for this person. Meet in a
public place." · "A vouch for this person was withdrawn."

Every label carries the path it came from, so the UI can answer "how do you know?"
without exposing keys or jargon.

**Why.** Phase 3's definition of done says trust labels must match the table for all
fixtures, which is untestable until the weights are written down. These numbers are
placeholders with a defensible shape, not results — they need pilot calibration.

**Revisit if.** Pilot data shows anchors dominate every path, or newcomers with a
single anchor vouch behave indistinguishably from established members.

---

## D9 — Device clocks are not trusted

**Decision.** A receipt is valid forever once both signatures verify. Nothing
expires because of a timestamp. Listing expiry is a *display* hint, and the app warns
when the clock jumps backwards or is implausible.

**Why.** Offline devices have no time source. A phone that has been off for a month,
or whose battery was pulled, will have a wrong clock. If validity depended on it, an
honest trade would become unverifiable — the worst possible failure for a record of
trust.

---

## D10 — Content licence: permissive sources only

**Decision.** Guides are built from public-domain or permissively licensed sources,
or written in-house. Every guide carries version, sources and review date.

**Why.** The spec proposes CC BY-SA content, but the obvious first-aid references
are not compatible: Hesperian's *Where There Is No Doctor* is CC BY-NC-SA
(non-commercial), and FAO material is CC BY-NC-SA IGO. Mixing them into a
permissively licensed pack creates a licensing problem the pilot cannot afford to
discover late.

**Blocking.** Phase 1's "every guide has a named reviewer and sources" cannot close
until a source list is agreed. This is a human decision, not a code one.

---

## D11 — No photos in listings for v1

**Decision.** Listings carry text and structured quality fields only. A local photo
may be attached for the owner's own reference but is never synced.

**Why.** `photoHash` with local-only photos means a synced listing shows a broken
image on the other device, which reads as data loss. Syncing thumbnails would blow
the bundle budget. Defer until there is a measured need.

---

## D12 — Pilot telemetry: local, opt-in, exported at debrief

**Decision.** No analytics endpoint, ever. The app keeps a local usage log (feature
counts, failures, timings) that is off by default, visibly on when enabled, and
exported as a file during the debrief.

**Why.** §5 of the spec requires "real usage data" from the pilot and a "feedback
channel", but the app has no network. Without this decision the pilot produces
anecdotes and the go/no-go meeting has nothing to read.

---

## Still open — these need a person, not a commit

| # | Question | Blocks |
| :-- | :-- | :-- |
| 1 | Which language(s) and script(s) for the pilot | Phase 1A content and font subsetting |
| 2 | Who the first anchors are and how they are chosen | Phase 3, and Phase 1's reviewer sign-off |
| 3 | Named reviewer for food-safety and first-aid content | Phase 1 definition of done |
| 4 | Source list and licence for each guide | Phase 1 content |
| 5 | Pilot jurisdiction and liability notice wording | Phase 5 |
| 6 | Whether deferred trades are in scope at all | Phase 5, §7 |
| 7 | Pilot success measure and stop condition | Phase 5 |
