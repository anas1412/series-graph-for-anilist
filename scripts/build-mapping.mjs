// Builds data/anilist-tmdb.json from Fribb's anime-lists.
//
// Output shape: { "<anilist_id>": [tmdbTvId, tmdbSeasonNumber], ... }
// Run: node scripts/build-mapping.mjs

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json'
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'anilist-tmdb.json')

const res = await fetch(SOURCE)
if (!res.ok) throw new Error(`fetch ${SOURCE} failed: ${res.status}`)
const entries = await res.json()

const map = {}
let skippedNoTv = 0
let collisions = 0

for (const e of entries) {
  const anilistId = e.anilist_id
  const tv = e.themoviedb_id && typeof e.themoviedb_id === 'object' ? e.themoviedb_id.tv : null
  if (!anilistId || !tv) {
    if (anilistId) skippedNoTv++
    continue
  }
  const season = Number.isInteger(e.season?.tmdb) && e.season.tmdb >= 0 ? e.season.tmdb : 1
  const key = String(anilistId)
  if (key in map) {
    collisions++
    // Keep the first entry: the file is ordered by anidb_id and later duplicates are
    // usually specials pointing at the same show.
    continue
  }
  map[key] = [tv, season]
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(map))

const kb = (JSON.stringify(map).length / 1024).toFixed(0)
console.log(`wrote ${OUT}`)
console.log(`  ${Object.keys(map).length} anilist ids -> tmdb tv show + season (${kb} KB)`)
console.log(`  ${skippedNoTv} anilist ids skipped (no tmdb tv id)`)
console.log(`  ${collisions} duplicate anilist ids ignored`)
