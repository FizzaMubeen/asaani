import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { readFileSync } from 'node:fs'

/**
 * Two artifacts come out of this config:
 *   npm run build         -> dist/         installable app payload (PWA shell / APK webroot)
 *   npm run build:single  -> dist-single/  one self-contained .html for day-zero sharing
 *
 * Findings from the Phase 0 spike (docs/SPIKE-RESULTS.md):
 *  - file:// IS a secure context in Chromium, so crypto.subtle works in the single-file build.
 *  - a service worker CANNOT register on file:// ("protocol of the current origin ('null')").
 *  - Cache Storage rejects file:// requests.
 *  - storage.persist() is false on file://, so that storage is evictable.
 * => single-file build = the library. Installed build = library + identity + trades.
 */

function policyFor(inlineScripts: boolean): string {
  return [
    "default-src 'none'",
    inlineScripts ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/** Inject the production CSP only into built HTML, so `vite dev` keeps HMR working. */
function cspPlugin(inlineScripts: boolean) {
  return {
    name: 'asaani-csp',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policyFor(inlineScripts)}">`,
      )
    },
  }
}

/**
 * In single-file mode the deliverable must be exactly one .html that can travel by
 * Bluetooth. So: drop the manifest link (a manifest is meaningless on file://) and
 * inline the icon as a data URI.
 */
function singleFileAssetsPlugin() {
  return {
    name: 'asaani-single-file-assets',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      const icon = readFileSync('public/icon.svg', 'utf8')
      const dataUri = `data:image/svg+xml,${encodeURIComponent(icon)}`
      return html
        .replace(/\n?\s*<link rel="manifest"[^>]*>/, '')
        .replace(/(<link rel="icon"[^>]*href=")([^"]*)(")/, (_m, open: string, _old: string, close: string) => open + dataUri + close)
    },
  }
}

export default defineConfig(({ mode }) => {
  const single = mode === 'single'
  return {
    base: './',
    plugins: [
      svelte(),
      tailwindcss(),
      cspPlugin(single),
      ...(single ? [singleFileAssetsPlugin(), viteSingleFile()] : []),
    ],
    build: {
      target: 'es2022',
      outDir: single ? 'dist-single' : 'dist',
      // Single-file mode must inline everything; nothing may be left as a sibling file.
      assetsInlineLimit: single ? 100_000_000 : 4096,
      cssCodeSplit: !single,
      copyPublicDir: !single,
    },
  }
})
