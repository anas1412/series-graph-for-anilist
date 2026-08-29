// Checks that pickSeason() lands on the right TMDB season, over the anime people
// actually open: the most popular TV entries on AniList.
//
// Success criterion: the AniList entry's start date falls inside the chosen season's
// broadcast run (or within 21 days of its start). That is the real question — "does
// this TMDB season contain this entry's episodes?" It has to be a range rather than a
// start date because AniList splits a split-cour season into two entries while TMDB
// keeps one: Re:Zero season 2 part 2 starts ten months into TMDB's season 2, and that
// season is still the right answer. Episode counts are deliberately not the criterion,
// because TMDB folds recaps and specials into seasons, so a 12-episode AniList entry
// legitimately sits in a 13-episode TMDB season.
//
// Shows whose Series Graph data is too sparsely dated to answer the question are
// reported separately rather than counted as failures.
//
// Hits live APIs. Run: node test/season-alignment.mjs

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { trim } from '../src/shape.js'
import { pickSeason, isEpisodic } from '../src/season.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const mapping = JSON.parse(readFileSync(resolve(HERE, '..', 'data', 'anilist-tmdb.json'), 'utf8'))

const DAY = 86400000
const TOLERANCE_DAYS = 21
const PAGES = 4
const PER_PAGE = 50
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// AniList hands out the odd 429 or 504 under load; a couple of retries is enough.
async function retry(fn, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i >= attempts) throw err
      console.log(`  retry ${i}: ${err.message}`)
      await sleep(i * 4000)
    }
  }
}

async function popularTv(page) {
  const query = `query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      media(type: ANIME, format: TV, sort: POPULARITY_DESC) {
        id format episodes title { romaji } startDate { year month day }
      }
    }
  }`
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { page, perPage: PER_PAGE } }),
  })
  if (!res.ok) throw new Error(`AniList returned ${res.status}`)
  const list = (await res.json())?.data?.Page?.media ?? []
  return list.map((m) => {
    const d = m.startDate
    return {
      anilistId: m.id,
      title: m.title?.romaji ?? String(m.id),
      format: m.format ?? null,
      episodes: typeof m.episodes === 'number' ? m.episodes : null,
      start:
        d?.year && d?.month && d?.day
          ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
          : null,
    }
  })
}

const seasonCache = new Map()
async function seriesGraph(tmdbId) {
  if (seasonCache.has(tmdbId)) return seasonCache.get(tmdbId)
  const res = await fetch(`https://seriesgraph.com/api/shows/${tmdbId}/season-ratings`)
  const raw = res.ok ? await res.json() : []
  const seasons = trim(Array.isArray(raw) ? raw : []).filter((s) =>
    s.episodes.some((e) => e.imdb != null || e.community != null)
  )
  seasonCache.set(tmdbId, seasons)
  await sleep(250)
  return seasons
}

// Same rule pickSeason uses: a season dated on one or two episodes cannot be trusted.
function seasonRange(season) {
  const dates = season.episodes.map((e) => e.date).filter(Boolean).sort()
  if (dates.length < 3) return null
  return { from: dates[0], to: dates[dates.length - 1] }
}

const media = []
for (let p = 1; p <= PAGES; p++) {
  media.push(...(await retry(() => popularTv(p))))
  await sleep(2500) // AniList allows 30 requests a minute
}
console.log(`pulled ${media.length} popular TV entries from AniList\n`)

const results = { pass: 0, fail: 0, undatable: 0, single: 0, unmapped: 0 }
const rows = []

for (const m of media) {
  const entry = mapping[String(m.anilistId)]
  if (!entry) {
    results.unmapped++
    continue
  }
  const [tmdbId, mappedSeason] = entry
  const seasons = await seriesGraph(tmdbId)
  if (seasons.length === 0 || !isEpisodic(m) || !m.start) {
    results.unmapped++
    continue
  }
  if (seasons.length < 2) {
    results.single++ // nothing to get wrong
    continue
  }

  const chosen = pickSeason(seasons, { mappedSeason, episodes: m.episodes, start: m.start })
  if (chosen === null) {
    // pickSeason refused rather than guessed; the panel shows nothing. Not a wrong answer.
    results.refused = (results.refused ?? 0) + 1
    rows.push([m.title.slice(0, 36), m.start, 'refused', `mapping S${mappedSeason}`, 'NO CHART'])
    continue
  }
  const range = seasonRange(seasons.find((s) => s.season === chosen))
  if (!range) {
    results.undatable++
    rows.push([m.title.slice(0, 36), m.start, `S${chosen}`, `mapping S${mappedSeason}`, 'UNDATABLE'])
    continue
  }

  const gap = Math.round((Date.parse(range.from) - Date.parse(m.start)) / DAY)
  const inRun = m.start >= range.from && m.start <= range.to
  const ok = inRun || Math.abs(gap) <= TOLERANCE_DAYS
  results[ok ? 'pass' : 'fail']++
  rows.push([
    m.title.slice(0, 36),
    m.start,
    `S${chosen} ${range.from}..${range.to}`,
    `mapping S${mappedSeason}`,
    ok ? (inRun && Math.abs(gap) > TOLERANCE_DAYS ? 'PASS (split cour)' : 'PASS') : `FAIL (${gap}d)`,
  ])
}

const widths = rows.reduce((w, r) => r.map((cell, i) => Math.max(w[i] ?? 0, String(cell).length)), [])
for (const r of rows) console.log(r.map((cell, i) => String(cell).padEnd(widths[i])).join('  '))

const judged = results.pass + results.fail
console.log(`\nmulti-season shows judged: ${judged}`)
console.log(`  correct season: ${results.pass}`)
console.log(`  wrong season:   ${results.fail}`)
console.log(`not judged: ${results.single} single-season, ${results.undatable} too sparsely dated, ${results.refused ?? 0} refused as unresolvable, ${results.unmapped} no mapping or no Series Graph data`)

if (results.fail > 0) {
  console.log('\nFAILURES ABOVE — pickSeason did not land on the season starting when this entry starts.')
  process.exitCode = 1
}
