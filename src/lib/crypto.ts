/**
 * Asaani signing primitives.
 *
 * Spec section 5.4 defines:
 *   signature = Sign(privateKey, UTF8(domainTag) || 0x00 || CanonicalJSON(payload))
 *
 * Two ambiguities in spec v2 are resolved here, on purpose:
 *
 *  1. ReceiptBody.id. The spec says "SHA-256 of canonical body (excluding sigs)",
 *     but `id` lives *inside* body, so hashing "body excluding sigs" is circular.
 *     The id is SHA-256 of JCS(body WITH id omitted). See receiptId() below.
 *
 *  2. sigB. The spec says sigB covers "body + sigA", but the signature rule only
 *     canonicalizes JSON, and (body + sigA) is not JSON. The second signer
 *     therefore signs JCS(body) || 0x00 || sigA_bytes. See receiptSigningInputB().
 *
 * Domain tags are bound to the product name, not to the generic word "resilience",
 * so a signature minted by this app can never be replayed in another.
 */

import { canonicalize, utf8, CanonicalError } from './jcs'

export const DOMAIN = {
  listing: 'asaani/listing/v1',
  receiptA: 'asaani/receipt/v1/A',
  receiptB: 'asaani/receipt/v1/B',
  vouch: 'asaani/vouch/v1',
  revoke: 'asaani/revoke/v1',
  anchor: 'asaani/anchor/v1',
  dispute: 'asaani/dispute/v1',
} as const

export type DomainTag = (typeof DOMAIN)[keyof typeof DOMAIN]

/** Hard ceilings so a hostile QR/bundle cannot exhaust memory before verification. */
export const LIMITS = {
  maxPayloadBytes: 64 * 1024,
  maxQrFrameBytes: 1024,
  maxItemsPerReceipt: 32,
  maxTextLength: 512,
} as const

// ---------------------------------------------------------------- encoding

/** A Uint8Array guaranteed to be ArrayBuffer-backed, which Web Crypto requires. */
export type Bytes = Uint8Array<ArrayBuffer>

export function toB64u(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64u(text: string): Bytes {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url')
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function concat(...chunks: Uint8Array[]): Bytes {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** UTF8(domainTag) || 0x00 || bytes */
export function domainBound(domain: DomainTag, bytes: Uint8Array): Bytes {
  return concat(utf8.encode(domain), new Uint8Array([0]), bytes)
}

export async function sha256(bytes: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

export async function sha256Hex(bytes: Bytes): Promise<string> {
  return [...(await sha256(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomBytes(length: number): Bytes {
  const out = new Uint8Array(length)
  crypto.getRandomValues(out)
  return out
}

// ---------------------------------------------------------------- keys

export interface Identity {
  /** non-extractable private key handle; never leaves the device */
  privateKey: CryptoKey
  /** SPKI, base64url — this is what travels in receipts and listings */
  publicKey: string
}

/**
 * Generate a fresh identity.
 *
 * The private key is created non-extractable. That means it can never be exported,
 * and therefore can never be passphrase-backed-up: recovery is circle re-vouch
 * (Phase 3). This is the Option A decision in docs/DECISIONS.md.
 */
export async function createIdentity(): Promise<Identity> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, // <- non-extractable
    ['sign', 'verify'],
  )
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey)
  return { privateKey: pair.privateKey, publicKey: toB64u(spki) }
}

export async function importPublicKey(spkiB64u: string): Promise<CryptoKey> {
  const raw = fromB64u(spkiB64u)
  if (raw.length < 60 || raw.length > 200) throw new Error('implausible public key length')
  return crypto.subtle.importKey(
    'spki',
    raw,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  )
}

// ---------------------------------------------------------------- sign / verify

export async function sign(identity: Identity, domain: DomainTag, bytes: Uint8Array): Promise<string> {
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identity.privateKey,
    domainBound(domain, bytes),
  )
  return toB64u(sig)
}

export async function verify(
  publicKeyB64u: string,
  domain: DomainTag,
  bytes: Uint8Array,
  sigB64u: string,
): Promise<boolean> {
  try {
    const key = await importPublicKey(publicKeyB64u)
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      fromB64u(sigB64u),
      domainBound(domain, bytes),
    )
  } catch {
    return false
  }
}

/** Sign an object using its canonical serialization. */
export async function signObject<T>(identity: Identity, domain: DomainTag, payload: T): Promise<string> {
  return sign(identity, domain, utf8.encode(canonicalize(payload)))
}

export async function verifyObject<T>(
  publicKeyB64u: string,
  domain: DomainTag,
  payload: T,
  sigB64u: string,
): Promise<boolean> {
  try {
    return await verify(publicKeyB64u, domain, utf8.encode(canonicalize(payload)), sigB64u)
  } catch (err) {
    if (err instanceof CanonicalError) return false
    throw err
  }
}

// ---------------------------------------------------------------- receipts

export interface Quantity {
  amount: number
  unit: string
}

export interface ItemLine {
  description: string
  quantity: Quantity
  qualityChecked: boolean
  quality: Record<string, string>
}

/** ReceiptBody as stored. `id` is derived, never supplied by a peer. */
export interface ReceiptBody {
  v: 1
  id: string
  partyA: string
  partyB: string
  aGave: ItemLine[]
  bGave: ItemLine[]
  handedOverAt: number
  placeHint?: string
  rulesPack: string
  nonce: string
}

export type ReceiptDraft = Omit<ReceiptBody, 'id'>

export interface Receipt {
  body: ReceiptBody
  sigA: string
  sigB?: string
}

/** SHA-256 over JCS(body without id). Fixes the circularity in spec v2 §5.5. */
export async function receiptId(draft: ReceiptDraft): Promise<string> {
  const bytes = utf8.encode(canonicalize(draft))
  if (bytes.length > LIMITS.maxPayloadBytes) throw new Error('receipt too large')
  return toB64u(await sha256(bytes))
}

/** What party A signs: the canonical draft, without the derived id. */
export function receiptSigningInputA(draft: ReceiptDraft): Bytes {
  return utf8.encode(canonicalize(draft))
}

/**
 * What party B signs: JCS(body) || 0x00 || sigA_bytes.
 * Binding sigA into the second signature is what stops a third party from
 * swapping A's signature after B has countersigned.
 */
export function receiptSigningInputB(body: ReceiptBody, sigAB64u: string): Bytes {
  // Defensive: A must not be able to get B to countersign a body whose id is wrong.
  return concat(utf8.encode(canonicalize(body)), new Uint8Array([0]), fromB64u(sigAB64u))
}

export async function draftReceipt(
  draft: ReceiptDraft,
): Promise<{ draft: ReceiptDraft; id: string }> {
  return { draft, id: await receiptId(draft) }
}

export async function signReceiptAsA(identity: Identity, draft: ReceiptDraft): Promise<Receipt> {
  const sigA = await sign(identity, DOMAIN.receiptA, receiptSigningInputA(draft))
  return { body: { ...draft, id: await receiptId(draft) }, sigA }
}

export async function verifyReceiptA(receipt: Receipt): Promise<boolean> {
  const expected = await receiptId(stripId(receipt.body))
  if (expected !== receipt.body.id) return false
  return verify(receipt.body.partyA, DOMAIN.receiptA, receiptSigningInputA(stripId(receipt.body)), receipt.sigA)
}

export async function signReceiptAsB(identity: Identity, receipt: Receipt): Promise<Receipt> {
  if (receipt.body.partyB !== identity.publicKey) throw new Error('receipt is not addressed to this key')
  const sigB = await sign(identity, DOMAIN.receiptB, receiptSigningInputB(receipt.body, receipt.sigA))
  return { ...receipt, sigB }
}

export async function verifyReceiptB(receipt: Receipt): Promise<boolean> {
  if (!receipt.sigB) return false
  return verify(
    receipt.body.partyB,
    DOMAIN.receiptB,
    receiptSigningInputB(receipt.body, receipt.sigA),
    receipt.sigB,
  )
}

/** Both signatures valid, and the id is genuinely derived from the body. */
export async function verifyReceipt(receipt: Receipt): Promise<{ ok: boolean; reason?: string }> {
  if (!(await verifyReceiptA(receipt))) return { ok: false, reason: 'signature A invalid or body tampered' }
  if (!receipt.sigB) return { ok: false, reason: 'pending: counterparty has not countersigned' }
  if (!(await verifyReceiptB(receipt))) return { ok: false, reason: 'signature B invalid' }
  return { ok: true }
}

export function stripId(body: ReceiptBody): ReceiptDraft {
  const { id: _id, ...rest } = body
  return rest
}
