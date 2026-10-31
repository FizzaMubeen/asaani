/**
 * IndexedDB schema (spec §5.2), via Dexie.
 *
 * Phase 0 stores only what Phase 0 needs, but the table set is already the full
 * one so Phase 2/3 do not need a destructive migration.
 *
 * Deletion rule: shared rows are tombstoned (`deleted: true`), never hard-deleted,
 * otherwise a sync from a device that never saw the delete would resurrect them.
 */

import Dexie, { type Table } from 'dexie'
import type { Receipt } from './crypto'

export interface Profile {
  id: string
  publicKey: string
  /** Non-extractable. Structured-cloneable into IndexedDB, unusable if exfiltrated. */
  keyHandle: CryptoKey
  name: string
  neighborhoodCode: string
  createdAt: number
}

export interface Contact {
  id: string
  publicKey: string
  nickname: string
  firstSeenAt: number
  trustNote?: string
}

export interface Listing {
  v: 1
  id: string
  authorKey: string
  kind: 'OFFER' | 'NEED'
  category: 'GOODS' | 'FOOD' | 'SEEDS' | 'SKILL_SERVICE' | 'TOOLS' | 'MEDICAL_RESTRICTED'
  title: string
  quantity: { amount: number; unit: string }
  quality: Record<string, string>
  photoHash?: string
  exchangePreference: string
  rulesPack: string
  createdAt: number
  expiresAt: number
  revision: number
  deleted?: boolean
  sig: string
}

export interface Vouch {
  v: 1
  id: string
  issuer: string
  target: string
  basis: 'RECEIPT' | 'ANCHOR_INTRO'
  receiptId?: string
  createdAt: number
  expiresAt?: number
  sig: string
}

export interface Revocation {
  v: 1
  id: string
  issuer: string
  revokes: string
  reason?: string
  createdAt: number
  sig: string
}

export interface StoredReceipt extends Receipt {
  /** 'pending' until both signatures verify. Pending receipts never count for trust. */
  status: 'pending' | 'complete' | 'invalid'
  storedAt: number
}

export interface MetaRow {
  key: string
  value: unknown
}

class AsaaniDB extends Dexie {
  profile!: Table<Profile, string>
  contacts!: Table<Contact, string>
  listings!: Table<Listing, string>
  receipts!: Table<StoredReceipt, string>
  vouches!: Table<Vouch, string>
  revocations!: Table<Revocation, string>
  meta!: Table<MetaRow, string>

  constructor() {
    super('asaani')
    this.version(1).stores({
      profile: 'id, publicKey',
      contacts: 'id, publicKey, firstSeenAt',
      listings: 'id, authorKey, kind, category, createdAt, expiresAt, deleted',
      receipts: 'body.id, body.partyA, body.partyB, status, storedAt',
      vouches: 'id, issuer, target, receiptId',
      revocations: 'id, issuer, revokes',
      meta: 'key',
    })
  }
}

let instance: AsaaniDB | null = null

export function db(): AsaaniDB {
  if (!instance) instance = new AsaaniDB()
  return instance
}

export interface StorageStatus {
  supported: boolean
  persisted: boolean | null
  quotaBytes: number | null
  usageBytes: number | null
  /** file:// storage is one shared origin and cannot be persisted: library-only mode. */
  evictable: boolean
  error?: string
}

export async function storageStatus(): Promise<StorageStatus> {
  const status: StorageStatus = {
    supported: typeof indexedDB !== 'undefined',
    persisted: null,
    quotaBytes: null,
    usageBytes: null,
    evictable: true,
  }
  try {
    if (navigator.storage?.persisted) status.persisted = await navigator.storage.persisted()
    const estimate = await navigator.storage?.estimate?.()
    status.quotaBytes = estimate?.quota ?? null
    status.usageBytes = estimate?.usage ?? null
    status.evictable = status.persisted !== true
  } catch (err) {
    status.error = String(err)
  }
  return status
}

/** Ask for durable storage once; safe to call repeatedly. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
