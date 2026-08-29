// Exercises src/background.js end to end against the real APIs, with chrome.* stubbed.
// This is the only test that runs the service worker's actual code path: mapping
// lookup, both fetches, the cache, season picking, and the message response shape.
//
// Run: node test/service-worker.mjs

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXTENSION_ORIGIN = 'chrome-extension://test/'

// --- chrome.* stub ---------------------------------------------------------

const store = new Map()
let listener = null

globalThis.chrome = {
  runtime: {
    getURL: (path) => EXTENSION_ORIGIN + path,
    onMessage: { addListener: (fn) => (listener = fn) },
  },
  storage: {
    local: {
      get: async (keys) => {
        if (keys === null) return Object.fromEntries(store)
        const list = Array.isArray(keys) ? keys : [keys]
        return Object.fromEntries(list.filter((k) => store.has(k)).map((k) => [k, store.get(k)]))
      },
      set: async (entries) => {
        for (const [k, v] of Object.entries(entries)) {
          if (quotaBytes && bytesUsed() + k.length + JSON.stringify(v).length > quotaBytes) {
            throw new Error('QUOTA_BYTES quota exceeded')
          }
          store.set(k, v)
        }
      },
      remove: async (keys) => (Array.isArray(keys) ? keys : [keys]).forEach((k) => store.delete(k)),
    },
  },
}

const bytesUsed = () => [...store].reduce((n, [k, v]) => n + k.length + JSON.stringify(v).length, 0)
let quotaBytes = 0 // 0 = unlimited

// fetch: serve the bundled mapping from disk, count and optionally fail the rest.
const realFetch = globalThis.fetch
let networkCalls = []
let failNetwork = false
let failHosts = []

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  if (url.startsWith(EXTENSION_ORIGIN)) {
    const body = readFileSync(resolve(HERE, '..', url.slice(EXTENSION_ORIGIN.length)), 'utf8')
    return new Response(body, { headers: { 'Content-Type': 'application/json' } })
  }
  networkCalls.push(url)
  if (failNetwork || failHosts.some((h) => url.includes(h))) throw new TypeError('Failed to fetch')
  return realFetch(input, init)
}

await import('../src/background.js')
if (!listener) throw new Error('background.js registered no message listener')

const ask = (anilistId) =>
  new Promise((resolveResponse) => {
    const kept = listener({ type: 'episodeRatings', anilistId }, {}, resolveResponse)
    if (kept !== true) throw new Error('listener must return true to keep the channel open')
  })

// --- assertions ------------------------------------------------------------

let failures = 0
function check(name, condition, detail) {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${name}${condition ? '' : `\n        ${detail}`}`)
  if (!condition) failures++
}

// 1. a plain single-cour show
const frieren = await ask(154587)
check('Frieren resolves', frieren.ok, JSON.stringify(frieren).slice(0, 200))
check('Frieren picks season 1', frieren.season === 1, `got season ${frieren.season}`)
check('Frieren episodes are trimmed', Object.keys(frieren.seasons[0].episodes[0]).join() === 'n,name,date,imdb,imdbVotes,community,communityVotes',
  Object.keys(frieren.seasons[0].episodes[0]).join())
check('Frieren season 1 has 28 episodes', frieren.seasons.find((s) => s.season === 1)?.episodes.length === 28)

// 2. the case the bundled mapping gets wrong
const frieren2 = await ask(182255)
check('Frieren 2nd Season picks season 2, not the mapping\'s season 1', frieren2.ok && frieren2.season === 2,
  `got ${JSON.stringify({ ok: frieren2.ok, season: frieren2.season })}`)

// 3. split cour starting mid-season
const yuukaku = await ask(142329)
check('Demon Slayer Entertainment District picks season 2', yuukaku.ok && yuukaku.season === 2,
  `got ${JSON.stringify({ ok: yuukaku.ok, season: yuukaku.season })}`)

// 4. unaired placeholder seasons are dropped
check('unaired placeholder season is dropped', frieren.seasons.every((s) => s.episodes.some((e) => e.imdb != null || e.community != null)))

// 5. a film sharing the parent show's TMDB id must not show the series' chart
const evaMovie = await ask(31)
check('a movie is refused', !evaMovie.ok && evaMovie.reason === 'not-episodic', JSON.stringify(evaMovie))

// 6. an unmapped id
const unknown = await ask(999999999)
check('unmapped id reports no-mapping', !unknown.ok && unknown.reason === 'no-mapping', JSON.stringify(unknown))

// 7. multi-episode OVAs and specials share the parent TV show's TMDB id, and 21% of
//    mapping entries point at TMDB's specials season, which Series Graph never returns.
//    Without positive evidence for a season, showing the parent show's chart would be
//    showing somebody else's episodes.
for (const [id, label] of [
  [44, 'Rurouni Kenshin OVA (4 ep, parent TV season has 27)'],
  [49, 'Aa! Megami-sama! OVA (5 ep, parent TV season has 26)'],
  [91, 'Gundam Wing: Endless Waltz OVA (3 ep, parent TV season has 49)'],
]) {
  const r = await ask(id)
  check(`${label} shows no chart`, !r.ok, `got ok=${r.ok} season=${r.season}`)
}

//    And the mapping sometimes names a season Series Graph does not have, leaving only
//    a coincidental episode count to go on — which must not be enough.
const kemono = await ask(99624)
check('Kemono Friends 2 (2019, 12 ep) does not get season 1\'s 2017 chart', !kemono.ok,
  `got ok=${kemono.ok} season=${kemono.season}`)

//    A prior the dates actively contradict is worse than no prior: Fribb maps all four
//    parts of BLEACH: Thousand-Year Blood War to TMDB Bleach season 2, but that show
//    ends in March 2012 and has no TYBW in it, so each of these was charting 2005.
for (const [id, label] of [
  [116674, 'BLEACH: TYBW part 1 (2022)'],
  [159322, 'BLEACH: TYBW part 2 (2023)'],
  [169755, 'BLEACH: TYBW part 3 (2024)'],
  [185874, 'BLEACH: TYBW part 4 (2026)'],
]) {
  const r = await ask(id)
  check(`${label} does not get 2005 Bleach's chart`, !r.ok, `got ok=${r.ok} season=${r.season}`)
}

// 8. a failed AniList lookup must not be cached — caching it would disable season
//    disambiguation and the movie guard for a full 24 hours after one blip
store.clear()
failHosts = ['graphql.anilist.co']
await ask(31)
check('a failed AniList lookup is not cached', !store.has('al:31'),
  `store has: ${[...store.keys()]}`)
failHosts = []
const recovered = await ask(31)
check('the next view recovers and refuses the movie', !recovered.ok && recovered.reason === 'not-episodic',
  JSON.stringify(recovered))
check('the successful lookup is cached', store.has('al:31'), `store has: ${[...store.keys()]}`)

// 9. the cache actually prevents a second round trip
await ask(154587) // warm it — check 8 cleared the store
networkCalls = []
await ask(154587)
check('a cached show makes no network calls', networkCalls.length === 0, `made ${networkCalls.length}: ${networkCalls}`)

// 10. two AniList entries of one show share the cached Series Graph payload
networkCalls = []
await ask(182255)
check('a sibling entry reuses the cached show', !networkCalls.some((u) => u.includes('seriesgraph')),
  `hit ${networkCalls}`)

// 11. network failure surfaces as an error, not a crash or a silent hole
failNetwork = true
store.clear()
const broken = await ask(21)
failNetwork = false
check('network failure reports an error', !broken.ok && broken.reason === 'error', JSON.stringify(broken))

// 12. a failed fetch must not be cached as a success
failNetwork = false
networkCalls = []
const retried = await ask(21)
check('a failed fetch is retried, not cached', retried.ok && networkCalls.length > 0,
  `ok=${retried.ok} calls=${networkCalls.length}`)

// 13. byte-aware eviction under a tight quota
store.clear()
quotaBytes = 260 * 1024 // One Piece alone trims to ~173KB
const onePiece = await ask(21)
check('a 1176-episode show still resolves under a tight quota', onePiece.ok && onePiece.seasons[0].episodes.length > 1000,
  `ok=${onePiece.ok}`)
const jjk = await ask(145064)
check('a second show evicts rather than failing', jjk.ok, JSON.stringify(jjk).slice(0, 120))
check('cache stayed under quota', bytesUsed() <= quotaBytes, `${(bytesUsed() / 1024).toFixed(0)}KB > ${quotaBytes / 1024}KB`)
quotaBytes = 0

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exitCode = failures === 0 ? 0 : 1
