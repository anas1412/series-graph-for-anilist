// Builds the distributable zip into dist/, for attaching to a GitHub release.
// Only what the extension actually loads goes in — no tests, scripts, docs or README.
//
// Run: node scripts/package.mjs

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8'))

const SHIPPED = [
  'manifest.json',
  'src/background.js',
  'src/shape.js',
  'src/season.js',
  'src/content.js',
  'src/chart.js',
  'src/styles.css',
  'data/anilist-tmdb.json',
  'icons/icon-16.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
]

const missing = SHIPPED.filter((f) => !existsSync(resolve(ROOT, f)))
if (missing.length) throw new Error(`missing files: ${missing.join(', ')}`)

const dist = resolve(ROOT, 'dist')
mkdirSync(dist, { recursive: true })
// Deliberately unversioned: the download link on the site points at
// /releases/latest/download/<this name>, which only resolves if the asset name is
// stable across releases. The version lives in the release tag and in the manifest.
const zip = resolve(dist, 'episode-ratings-for-anilist.zip')
rmSync(zip, { force: true })

// bsdtar writes zips and is more commonly present than `zip`.
execFileSync('bsdtar', ['-a', '-c', '-f', zip, ...SHIPPED], { cwd: ROOT })

const listed = execFileSync('bsdtar', ['-tf', zip], { encoding: 'utf8' }).trim().split('\n')
const extra = listed.filter((f) => !SHIPPED.includes(f))
if (extra.length) throw new Error(`zip contains unexpected files: ${extra.join(', ')}`)

const size = execFileSync('stat', ['-c', '%s', zip], { encoding: 'utf8' }).trim()
console.log(`${zip}`)
console.log(`  ${listed.length} files, ${(size / 1024).toFixed(0)} KB`)
