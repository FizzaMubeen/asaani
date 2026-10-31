// Reproducible build identity (spec §3.3).
//
// Hashes the built bundle deterministically, writes build.json next to it, and
// stamps a <meta name="asaani-build"> tag into index.html so the running app can
// display its own hash without any network request (connect-src 'none').
//
// The stamp line is excluded from the hash, so re-running this script on the same
// output always produces the same digest.
import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const dir = process.argv[2] ?? 'dist'
const STAMP = /^\s*<meta name="asaani-build"[^>]*>\s*$/gm
// Written as a sibling (dist.build.json) so the output directory contains only
// shippable artifacts — in single-file mode, exactly one .html.
const BUILD_JSON = `${dir}.build.json`

async function walk(root, current = root, out = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const full = join(current, entry.name)
    if (entry.isDirectory()) await walk(root, full, out)
    else out.push(full)
  }
  return out
}

const files = (await walk(dir))
  .map((f) => relative(dir, f).split(sep).join('/'))
  .sort()

const digest = createHash('sha256')
let bytes = 0

for (const rel of files) {
  const raw = await readFile(join(dir, rel))
  const content = rel === 'index.html' ? Buffer.from(raw.toString('utf8').replace(STAMP, '')) : raw
  bytes += raw.length
  digest.update(`${rel}\n${createHash('sha256').update(content).digest('hex')}\n`)
}

const hash = digest.digest('hex')
const short = hash.slice(0, 16)

await writeFile(
  BUILD_JSON,
  JSON.stringify({ hash: `sha256:${hash}`, short, bytes, files }, null, 2) + '\n',
)

const indexPath = join(dir, 'index.html')
const html = (await readFile(indexPath, 'utf8')).replace(STAMP, '')
await writeFile(
  indexPath,
  html.replace(
    '<head>',
    `<head>\n    <meta name="asaani-build" content="sha256:${hash}" />`,
  ),
)

// The inlined size is the number the pilot cares about: can this travel by Bluetooth?
const size = (await stat(indexPath)).size
console.log(`build ${short}  bundle ${(bytes / 1024).toFixed(1)} KB  index.html ${(size / 1024).toFixed(1)} KB  files ${files.length}`)
