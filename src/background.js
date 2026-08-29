// Service worker: resolves an AniList id to a Series Graph show and fetches its
// episode ratings.
//
// The content script cannot fetch seriesgraph.com itself — that endpoint sends no
// Access-Control-Allow-Origin header, and content script fetches are subject to CORS
// under MV3. Fetching here, with host_permissions, is what makes the request legal.

import { trim } from './shape.js'
import { pickSeason, isEpisodic } from './season.js'

const SERIES_GRAPH = 'https://seriesgraph.com/api/shows'
const ANILIST_GRAPHQL = 'https://graphql.anilist.co'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
// chrome.storage.local holds 10 MB and does no eviction of its own — writes past the
// quota just fail. A cap on entry *count* would not protect us: One Piece trims to
// 173 KB while a normal season is 5 KB, so the budget has to be in bytes.
const CACHE_MAX_BYTES = 4 * 1024 * 1024

// Parsed once per service worker lifetime, not once per page view.
let mappingPromise = null

function loadMapping() {
  if (!mappingPromise) {
    mappingPromise = fetch(chrome.runtime.getURL('data/anilist-tmdb.json'))
      .then((r) => r.json())
      .catch((err) => {
        mappingPromise = null // let the next request retry
        throw err
      })
  }
  return mappingPromise
}

// --- caching ---------------------------------------------------------------
// The worker is torn down after ~30s idle, so nothing survives in memory between
// page views. chrome.storage.local is what actually holds the cache.

const inFlight = new Map()
let pruning = null

async function cached(key, produce) {
  const store = await chrome.storage.local.get(key)
  const hit = store[key]
  if (hit && Date.now() - hit.t <= CACHE_TTL_MS) return hit.d

  // Two AniList tabs opening the same show should make one request, not two.
  if (inFlight.has(key)) return inFlight.get(key)
  const p = produce()
    .then(async (value) => {
      await write(key, value)
      return value
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, p)
  return p
}

async function write(key, value) {
  const entry = { [key]: { t: Date.now(), d: value } }
  try {
    await chrome.storage.local.set(entry)
  } catch {
    // Over quota. Halve the cache and try once more; if it still fails, serve uncached.
    await prune(CACHE_MAX_BYTES / 2)
    try {
      await chrome.storage.local.set(entry)
    } catch {
      return
    }
  }
  // The content script is blocked on this promise and prune() reads and re-stringifies
  // the whole cache. Reclaiming space is not something the caller needs to wait for, and
  // one scan covers several writes that land together.
  if (!pruning) {
    pruning = prune(CACHE_MAX_BYTES)
      .catch(() => {})
      .finally(() => {
        pruning = null
      })
  }
}

const sizeOf = (key, entry) => key.length + JSON.stringify(entry).length

// Drops least-recently-written entries until the cache fits in `budget` bytes.
async function prune(budget) {
  const all = await chrome.storage.local.get(null)
  const keys = Object.keys(all)
  let bytes = keys.reduce((n, k) => n + sizeOf(k, all[k]), 0)
  if (bytes <= budget) return

  keys.sort((a, b) => (all[a]?.t ?? 0) - (all[b]?.t ?? 0))
  const drop = []
  for (const k of keys) {
    if (bytes <= budget) break
    drop.push(k)
    bytes -= sizeOf(k, all[k])
  }
  if (drop.length) await chrome.storage.local.remove(drop)
}

// --- sources ---------------------------------------------------------------

async function fetchSeasons(tmdbId) {
  // Without a deadline a hung response can outlive the worker: sendResponse is never
  // called, the content script's sendMessage rejects after AniList has stopped mutating,
  // and the page stays blank instead of showing the "couldn't reach Series Graph" note.
  const res = await fetch(`${SERIES_GRAPH}/${tmdbId}/season-ratings`, {
    signal: AbortSignal.timeout(15000),
  })
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`Series Graph returned ${res.status}`)
  const body = await res.json()
  return Array.isArray(body) ? trim(body) : []
}

const MEDIA_QUERY = `query ($id: Int) {
  Media(id: $id, type: ANIME) { format episodes startDate { year month day } }
}`

// AniList's own format, episode count and start date are what let us tell which TMDB
// season this entry is, and whether it is episodic at all.
//
// This throws rather than returning null on failure, and that distinction matters: a
// null means "AniList has no such media", which is worth caching, while a throw means
// "the request failed", which must not be. cached() only writes on fulfilment, so a
// rejection here leaves no entry behind and the next page view tries again. Caching a
// failure would disable both season disambiguation and the movie guard for 24 hours.
async function fetchAniListMedia(anilistId) {
  const res = await fetch(ANILIST_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: MEDIA_QUERY, variables: { id: Number(anilistId) } }),
  })
  if (!res.ok) throw new Error(`AniList returned ${res.status}`)
  const media = (await res.json())?.data?.Media
  if (!media) return null
  const d = media.startDate
  const start =
    d?.year && d?.month && d?.day
      ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
      : null
  return {
    format: media.format ?? null,
    episodes: typeof media.episodes === 'number' ? media.episodes : null,
    start,
  }
}

// --- request handling ------------------------------------------------------

async function getRatings(anilistId) {
  const mapping = await loadMapping()
  const entry = mapping[String(anilistId)]
  if (!entry) return { ok: false, reason: 'no-mapping' }

  const [tmdbId, mappedSeason] = entry

  const [seasons, media] = await Promise.all([
    cached(`sg:${tmdbId}`, () => fetchSeasons(tmdbId)),
    // A failed lookup costs precision, not the whole panel — but it must not be cached.
    cached(`al:${anilistId}`, () => fetchAniListMedia(anilistId)).catch(() => null),
  ])

  if (!isEpisodic(media)) return { ok: false, reason: 'not-episodic', tmdbId }

  // Pick from every season that has episodes, including ones with no ratings yet. If a
  // currently-airing season were filtered out first, pickSeason would never see the
  // season this page is actually about and would confidently return the previous one.
  const withEpisodes = seasons.filter((s) => s.episodes.length > 0)
  const season = pickSeason(withEpisodes, {
    mappedSeason,
    episodes: media?.episodes ?? null,
    start: media?.start ?? null,
  })
  if (season === null) return { ok: false, reason: 'no-data', tmdbId }

  // Series Graph lists announced-but-unaired seasons as a single placeholder episode
  // ("Episode #3.1", no date, no ratings). Nothing to plot, so say so rather than
  // quietly showing a different season.
  const isRated = (s) => s.episodes.some((e) => e.imdb != null || e.community != null)
  if (!isRated(withEpisodes.find((s) => s.season === season))) {
    return { ok: false, reason: 'no-data', tmdbId }
  }

  return { ok: true, tmdbId, season, seasons: withEpisodes.filter(isRated) }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'episodeRatings') return
  getRatings(msg.anilistId).then(sendResponse, (err) =>
    sendResponse({ ok: false, reason: 'error', message: String(err?.message || err) })
  )
  return true // keep the message channel open for the async sendResponse
})
