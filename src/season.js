// AniList files each cour as its own entry; TMDB files them as seasons of one show.
// Working out which TMDB season an AniList entry is, is the hard part of this extension.
//
// The bundled mapping carries a season number, and it is usually right, so it is the
// prior. But it is not reliable — Fribb has "Sousou no Frieren 2nd Season"
// (AniList 182255) on TMDB season 1, when Series Graph has it as season 2. AniList's
// own start date overrides the prior when it clearly points somewhere else.
//
// Air dates are the strongest signal when they exist, but Series Graph's older shows
// often carry dates on only one or two episodes (CLANNAD has exactly one dated episode
// per season, and it is a bonus OVA at the end of the run). A date drawn from that is
// worse than no date at all, so the signal is only used on seasons that are actually
// dated. Episode counts are the weaker signal: TMDB routinely folds recaps and
// specials into a season, so a 12-episode AniList entry often sits in a 13-episode
// TMDB season.

const DAY = 86400000
const MIN_DATED_EPISODES = 3

function airedRange(season) {
  const dates = season.episodes.map((e) => e.date).filter(Boolean).sort()
  if (dates.length < MIN_DATED_EPISODES) return null
  return { from: dates[0], to: dates[dates.length - 1] }
}

function score(season, { episodes, start }) {
  let points = 0

  const aired = airedRange(season)
  if (start && aired) {
    const days = Math.abs(Date.parse(aired.from) - Date.parse(start)) / DAY
    if (days <= 14) points += 6
    else if (days <= 45) points += 4
    else if (days <= 120) points += 2

    // Scored separately, not as another rung of that ladder. A split-cour second half
    // starts months into the TMDB season, so it matches neither the season's start nor
    // its episode count, and falling inside the broadcast run is the only signal left.
    // Demon Slayer's Entertainment District arc is the case that needs it to be
    // independent: it starts 56 days into TMDB season 2 — close enough to score on the
    // ladder — while TMDB season 3 happens to have exactly its episode count.
    if (start >= aired.from && start <= aired.to) points += 5
  }

  if (episodes != null) {
    const off = Math.abs(season.episodes.length - episodes)
    if (off === 0) points += 3
    else if (off <= 2) points += 2
    else if (off <= 4) points += 1
  }

  return points
}

// True when the entry's start date puts it nowhere near this season's broadcast run.
// Only decidable when we have both a start date and a season with real dates on it —
// otherwise we cannot judge, and the caller should go on trusting the mapping.
function contradicts(season, start) {
  const aired = airedRange(season)
  if (!start || !aired) return false
  if (start >= aired.from && start <= aired.to) return false
  return Math.abs(Date.parse(aired.from) - Date.parse(start)) / DAY > 120
}

// Returns the season number, or null when there is no honest answer.
export function pickSeason(seasons, { mappedSeason, episodes, start }) {
  if (!seasons.length) return null

  // Start from the mapping's own answer, so a tie leaves it in place and only
  // positive evidence for another season moves us off it.
  //
  // Unless the dates say it is wrong, in which case it is worse than having no answer
  // at all — its +3 would otherwise win by default and look deliberate. Fribb maps all
  // four parts of BLEACH: Thousand-Year Blood War to TMDB Bleach season 2, but TMDB's
  // Bleach ends in March 2012 and does not contain TYBW at all, so every one of those
  // pages was charting 2005 episodes under a 2026 anime.
  const named = seasons.find((s) => s.season === mappedSeason)
  const prior = named && !contradicts(named, start) ? named : undefined
  let best = prior ?? null
  let bestScore = prior ? score(prior, { episodes, start }) + 3 : -1

  for (const s of seasons) {
    if (s === prior) continue
    const points = score(s, { episodes, start })
    if (points > bestScore) {
      bestScore = points
      best = s
    }
  }

  // With no prior, only a date may confirm the guess — an episode count on its own
  // cannot. Two cases need this. 21% of the mapping's entries carry season hint 0,
  // TMDB's specials season, which Series Graph never returns, so `prior` is never found
  // for them. And the mapping sometimes names a season Series Graph does not have:
  // Kemono Friends 2 (AniList 99624, 12 episodes, starts 2019-01-15) is mapped to
  // season 2, but only season 1 exists — 12 episodes that finished in March 2017. A
  // bare count match scores +3 and would confirm that, silently, with no season picker
  // shown to hint otherwise. Better to show nothing than somebody else's episodes.
  if (!prior && score(best, { episodes: null, start }) === 0) return null

  return best.season
}

// A film, a one-shot special or a single-episode entry has no per-episode arc of its
// own. It still maps to the parent show's TMDB id, so without this check an AniList
// movie page would show the TV series' chart — someone else's episodes.
const NON_EPISODIC_FORMATS = new Set(['MOVIE', 'SPECIAL', 'MUSIC'])

export function isEpisodic(media) {
  if (!media) return true // AniList lookup failed; don't hide the chart over it
  if (NON_EPISODIC_FORMATS.has(media.format)) return false
  if (media.episodes === 1) return false
  return true
}
