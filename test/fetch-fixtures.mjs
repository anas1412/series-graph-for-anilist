// Pulls real data for a handful of AniList entries through the same resolution the
// extension performs — mapping lookup, trim(), pickSeason() — so test/preview.html
// renders exactly what the panel would render in the browser.
//
// Run: node test/fetch-fixtures.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { trim } from '../src/shape.js'
import { pickSeason, isEpisodic } from '../src/season.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const mapping = JSON.parse(readFileSync(resolve(HERE, '..', 'data', 'anilist-tmdb.json'), 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const ENTRIES = [
  { anilistId: 154587, label: 'Frieren — single cour, 28 episodes' },
  { anilistId: 182255, label: 'Frieren 2nd Season — the mapping says season 1, it is season 2' },
  { anilistId: 145064, label: 'Jujutsu Kaisen 2nd Season — multi-season show' },
  { anilistId: 142329, label: 'Demon Slayer: Entertainment District — split cour, starts mid-season' },
  { anilistId: 21, label: 'One Piece — 1176 episodes in one TMDB season, tests scrolling' },
  { anilistId: 21087, label: 'One Punch Man — sparse community ratings' },
]

async function anilistMedia(id) {
  const query = `{ Media(id: ${id}, type: ANIME) {
    format episodes title { romaji } startDate { year month day }
  } }`
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`AniList returned ${res.status}`)
  const m = (await res.json())?.data?.Media
  if (!m) return null
  const d = m.startDate
  return {
    title: m.title?.romaji ?? String(id),
    format: m.format ?? null,
    episodes: typeof m.episodes === 'number' ? m.episodes : null,
    start:
      d?.year && d?.month && d?.day
        ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
        : null,
  }
}

const out = []
for (const { anilistId, label } of ENTRIES) {
  const entry = mapping[String(anilistId)]
  if (!entry) {
    console.log(`${anilistId} — no mapping, skipped`)
    continue
  }
  const [tmdbId, mappedSeason] = entry

  const media = await anilistMedia(anilistId)
  await sleep(1200) // AniList allows 30 requests a minute

  const res = await fetch(`https://seriesgraph.com/api/shows/${tmdbId}/season-ratings`)
  const raw = res.ok ? await res.json() : []
  const seasons = trim(Array.isArray(raw) ? raw : []).filter((s) =>
    s.episodes.some((e) => e.imdb != null || e.community != null)
  )
  await sleep(400)

  if (!isEpisodic(media) || seasons.length === 0) {
    console.log(`${anilistId} ${media?.title ?? ''} — nothing to chart, skipped`)
    continue
  }

  const season = pickSeason(seasons, {
    mappedSeason,
    episodes: media?.episodes ?? null,
    start: media?.start ?? null,
  })

  out.push({ label, anilistId, tmdbId, season, seasons })
  console.log(
    `${anilistId} ${media?.title ?? ''} — ${seasons.length} seasons, ` +
      `picked S${season} (mapping said S${mappedSeason})`
  )
}

const path = resolve(HERE, 'fixtures.json')
writeFileSync(path, JSON.stringify(out))
console.log(`\nwrote ${path} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`)
