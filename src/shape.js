// Keep only the fields the chart renders. The raw Series Graph response carries
// episode overviews, still images and full vote distributions — for a long-running
// show that is megabytes we would otherwise cache and post between contexts.
export function trim(seasons) {
  return seasons.map((s) => ({
    season: s.season_number,
    episodes: (s.episodes || []).map((e) => ({
      n: e.episode_number,
      name: e.name || null,
      date: e.air_date || null,
      imdb: typeof e.imdb_rating === 'number' ? e.imdb_rating : null,
      imdbVotes: typeof e.imdb_votes === 'number' ? e.imdb_votes : null,
      community: typeof e.community_avg === 'number' ? e.community_avg : null,
      communityVotes: typeof e.community_count === 'number' ? e.community_count : null,
    })),
  }))
}
