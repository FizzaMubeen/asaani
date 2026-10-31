/**
 * Executable version of spec §5.5 "Failure cases to test".
 * Phase 0 runs this in the browser on startup so a broken crypto path is visible
 * immediately instead of at the two-phone pilot.
 */

import {
  createIdentity,
  DOMAIN,
  draftReceipt,
  signObject,
  signReceiptAsA,
  signReceiptAsB,
  verifyObject,
  verifyReceipt,
  verifyReceiptA,
  verifyReceiptB,
  type ItemLine,
  type ReceiptDraft,
} from './crypto'
import { canonicalize } from './jcs'

export interface TestResult {
  name: string
  pass: boolean
  detail: string
}

const repair: ItemLine = {
  description: 'Repair of 20A solar charge controller (replaced blown fuse, tested under load)',
  quantity: { amount: 1, unit: 'service' },
  qualityChecked: true,
  quality: { test: 'charged battery 30 min, stable', warranty: '7 days' },
}

const flour: ItemLine = {
  description: 'Wheat flour, white, sealed bags',
  quantity: { amount: 5, unit: 'kg' },
  qualityChecked: true,
  quality: { packed: '2026-10-20', inspection: 'opened one bag, dry, no grit' },
}

async function fixture() {
  const ravi = await createIdentity()
  const karim = await createIdentity()
  const draft: ReceiptDraft = {
    v: 1,
    partyA: ravi.publicKey,
    partyB: karim.publicKey,
    aGave: [repair],
    bGave: [flour],
    handedOverAt: 1793000000000,
    placeHint: 'Market street',
    rulesPack: 'default-community-pack@1',
    nonce: 'k3J9WQ8rTn2bYf4m',
  }
  return { ravi, karim, draft }
}

export async function runSelfTest(): Promise<TestResult[]> {
  const out: TestResult[] = []
  const t = (name: string, pass: boolean, detail = '') => out.push({ name, pass, detail })

  // --- canonicalization
  {
    const a = canonicalize({ b: 1, a: [true, null, 'x'], c: { z: 0, y: -0 } })
    const b = canonicalize({ c: { y: 0, z: 0 }, a: [true, null, 'x'], b: 1 })
    t('JCS: key order independent', a === b && a === '{"a":[true,null,"x"],"b":1,"c":{"y":0,"z":0}}', a)
  }
  {
    let threw = false
    try {
      canonicalize({ n: Number.NaN })
    } catch {
      threw = true
    }
    t('JCS: rejects NaN', threw)
  }

  const { ravi, karim, draft } = await fixture()

  // --- happy path
  const { id } = await draftReceipt(draft)
  const signedByA = await signReceiptAsA(ravi, draft)
  t('A drafts and signs', signedByA.body.id === id, 'id=' + id.slice(0, 16) + '…')
  t('A-only receipt is pending, not trusted', (await verifyReceipt(signedByA)).ok === false, 'sigB missing → pending')

  const full = await signReceiptAsB(karim, signedByA)
  const verdict = await verifyReceipt(full)
  t('A→B→A handshake verifies', verdict.ok === true, verdict.reason ?? 'both signatures valid')

  // --- tampering
  {
    const tampered = structuredClone(full)
    tampered.body.bGave[0].quantity.amount = 50 // 5 kg became 50 kg
    const v = await verifyReceipt(tampered)
    t('Altered body rejected', v.ok === false && (await verifyReceiptA(tampered)) === false, v.reason ?? '')
  }

  // --- id is derived, not asserted
  {
    const forged = structuredClone(full)
    forged.body.id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    t('Forged id rejected', (await verifyReceiptA(forged)) === false)
  }

  // --- mis-addressed
  {
    const eve = await createIdentity()
    let refused = false
    try {
      await signReceiptAsB(eve, signedByA)
    } catch {
      refused = true
    }
    t('Receipt for someone else refused', refused, 'counterparty key did not match partyB')
  }

  // --- swapping A's signature after B countersigned
  {
    const other = await signReceiptAsA(ravi, { ...draft, nonce: 'different-nonce-1234' })
    const swapped = { ...full, sigA: other.sigA }
    t('Swapped sigA after countersign rejected', (await verifyReceiptB(swapped)) === false)
  }

  // --- duplicate scan idempotency
  {
    const first = await draftReceipt(draft)
    const second = await draftReceipt(structuredClone(draft))
    t('Duplicate scan is idempotent', first.id === second.id, 'same body → same id')
  }

  // --- domain separation
  {
    const listingLike = { v: 1, id: 'x', authorKey: ravi.publicKey, kind: 'OFFER', title: 'fuse' }
    const listingSig = await signObject(ravi, DOMAIN.listing, listingLike)
    const reusedAsReceipt = await verifyObject(ravi.publicKey, DOMAIN.receiptA, listingLike, listingSig)
    t('Domain separation holds', reusedAsReceipt === false, 'listing signature is not valid as receipt.v1/A')
  }

  // --- canonical id stability across key order
  {
    const shuffled: ReceiptDraft = {
      nonce: draft.nonce,
      rulesPack: draft.rulesPack,
      placeHint: draft.placeHint,
      handedOverAt: draft.handedOverAt,
      bGave: draft.bGave,
      aGave: draft.aGave,
      partyB: draft.partyB,
      partyA: draft.partyA,
      v: draft.v,
    }
    t('Id independent of property order', (await draftReceipt(shuffled)).id === id)
  }

  return out
}
