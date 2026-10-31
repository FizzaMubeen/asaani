<script lang="ts">
  import { onMount } from 'svelte'
  import { detectCapabilities, MODE, type Capability } from './lib/capabilities'
  import { runSelfTest, type TestResult } from './lib/selftest'
  import { requestPersistence, storageStatus, type StorageStatus } from './lib/db'

  let caps = $state<Capability[]>([])
  let tests = $state<TestResult[]>([])
  let disk = $state<StorageStatus | null>(null)
  let busy = $state(true)
  let textScale = $state(1)

  const buildHash =
    document.querySelector<HTMLMetaElement>('meta[name="asaani-build"]')?.content ?? 'dev (unstamped)'

  const failedTests = $derived(tests.filter((t) => !t.pass))
  const missingRequired = $derived(caps.filter((c) => c.required && c.state !== 'ok'))
  const verdict = $derived(
    busy ? 'checking' : failedTests.length === 0 && missingRequired.length === 0 ? 'ready' : 'needs attention',
  )

  onMount(async () => {
    const [c, t, s] = await Promise.all([detectCapabilities(), runSelfTest(), storageStatus()])
    caps = c
    tests = t
    disk = s
    busy = false
    document.documentElement.style.setProperty('--asaani-scale', String(textScale))
  })

  function setScale(next: number) {
    textScale = next
    document.documentElement.style.setProperty('--asaani-scale', String(next))
  }

  async function askForPersistence() {
    const ok = await requestPersistence()
    disk = await storageStatus()
    if (!ok) {
      // Plain language, no jargon (spec §8.2).
      alert('This browser will not promise to keep the data. Please make a backup regularly.')
    }
  }

  const tone = {
    ok: 'text-emerald-700 dark:text-emerald-400',
    degraded: 'text-amber-700 dark:text-amber-400',
    missing: 'text-rose-700 dark:text-rose-400',
  } as const

  const glyph = { ok: '✓', degraded: '!', missing: '✕' } as const
</script>

<main class="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6 pb-16">
  <header class="flex flex-col gap-1">
    <div class="flex items-baseline justify-between gap-3">
      <h1 class="text-3xl font-bold tracking-tight">آسانی<span class="text-stone-400"> · </span>Asaani</h1>
      <span
        id="verdict"
        class="rounded-full px-3 py-1 text-sm font-semibold"
        class:bg-emerald-100={verdict === 'ready'}
        class:text-emerald-900={verdict === 'ready'}
        class:bg-amber-100={verdict === 'needs attention'}
        class:text-amber-900={verdict === 'needs attention'}
        class:bg-stone-200={verdict === 'checking'}
      >
        {verdict}
      </span>
    </div>
    <p class="text-stone-600 dark:text-stone-400">
      Phase 0 — environment and crypto readiness. Works with no network.
    </p>
  </header>

  {#if MODE.singleFile}
    <section class="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <h2 class="font-semibold">Library mode</h2>
      <p class="mt-1 text-sm">
        This copy was opened as a single file. Guides, search and print work. Trades and identity do
        not — they need the installed app, and this storage can be erased by the browser at any time.
      </p>
    </section>
  {/if}

  <!-- Accessibility controls: icon-first, large targets -->
  <section class="flex items-center gap-2" aria-label="Text size">
    <span class="text-sm text-stone-600 dark:text-stone-400">Text size</span>
    {#each [1, 1.15, 1.3] as scale, i (scale)}
      <button
        type="button"
        onclick={() => setScale(scale)}
        aria-pressed={textScale === scale}
        class="min-w-11 rounded-lg border px-3 text-sm font-semibold"
        class:border-brand-600={textScale === scale}
        class:bg-brand-50={textScale === scale}
        class:border-stone-300={textScale !== scale}
      >
        {['A', 'A', 'A'][i]}
      </button>
    {/each}
  </section>

  <!-- Build attestation (spec §3.3) -->
  <section class="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
    <h2 class="text-sm font-semibold uppercase tracking-wide text-stone-500">This build</h2>
    <p class="mt-2 break-all font-mono text-sm">{buildHash}</p>
    <p class="mt-2 text-sm text-stone-600 dark:text-stone-400">
      Compare this with the hash on the community poster or the anchor's copy. If it differs, this
      copy is not the one your community trusts.
    </p>
  </section>

  <!-- Storage -->
  <section class="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
    <h2 class="text-sm font-semibold uppercase tracking-wide text-stone-500">Storage</h2>
    {#if disk}
      <dl class="mt-2 grid grid-cols-2 gap-y-2 text-sm">
        <dt class="text-stone-600 dark:text-stone-400">Database</dt>
        <dd class={disk.supported ? tone.ok : tone.missing}>{disk.supported ? 'available' : 'missing'}</dd>
        <dt class="text-stone-600 dark:text-stone-400">Kept on this device</dt>
        <dd class={disk.persisted ? tone.ok : tone.degraded}>
          {disk.persisted ? 'yes, durable' : 'not guaranteed'}
        </dd>
        <dt class="text-stone-600 dark:text-stone-400">Used</dt>
        <dd>
          {disk.usageBytes != null ? (disk.usageBytes / 1024).toFixed(0) + ' KB' : '—'}
          {#if disk.quotaBytes}
            <span class="text-stone-500">of {(disk.quotaBytes / 1e9).toFixed(1)} GB</span>
          {/if}
        </dd>
      </dl>
      {#if disk.evictable && !MODE.singleFile}
        <button
          type="button"
          onclick={askForPersistence}
          class="mt-3 rounded-lg bg-brand-700 px-4 py-2 font-semibold text-white"
        >
          Ask the browser to keep my data
        </button>
      {/if}
    {/if}
  </section>

  <!-- Capabilities -->
  <section class="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
    <h2 class="text-sm font-semibold uppercase tracking-wide text-stone-500">Device</h2>
    <ul class="mt-2 divide-y divide-stone-100 dark:divide-stone-800">
      {#each caps as cap (cap.id)}
        <li class="flex items-start gap-3 py-2 text-sm">
          <span class="{tone[cap.state]} w-4 shrink-0 font-bold" aria-hidden="true">{glyph[cap.state]}</span>
          <span class="min-w-0">
            <span class="font-medium">{cap.label}</span>
            {#if cap.required && cap.state !== 'ok'}<span class="ml-1 text-rose-700">required</span>{/if}
            <span class="block break-words text-stone-500 dark:text-stone-400">{cap.detail}</span>
          </span>
        </li>
      {/each}
    </ul>
  </section>

  <!-- Crypto self test -->
  <section class="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-stone-500">Trade receipt self-test</h2>
      <span class="text-sm {failedTests.length === 0 && !busy ? tone.ok : tone.missing}">
        {busy ? 'running…' : `${tests.length - failedTests.length}/${tests.length} passed`}
      </span>
    </div>
    <ul class="mt-2 divide-y divide-stone-100 dark:divide-stone-800">
      {#each tests as test (test.name)}
        <li class="flex items-start gap-3 py-2 text-sm">
          <span class="{(test.pass ? tone.ok : tone.missing)} w-4 shrink-0 font-bold" aria-hidden="true">
            {test.pass ? '✓' : '✕'}
          </span>
          <span class="min-w-0">
            <span class="font-medium">{test.name}</span>
            {#if test.detail}
              <span class="block break-words text-stone-500 dark:text-stone-400">{test.detail}</span>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  </section>

  <footer class="text-xs text-stone-500">
    No server. No accounts. No network requests. Spec v2 · Phase 0.
  </footer>
</main>
