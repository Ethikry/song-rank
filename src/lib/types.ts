export interface Song {
  year: number
  id: string
  rank: number
  /** Canonical nominator names; empty if auto-included via "Top 10" */
  nominators: string[]
  autoIncluded: boolean
  title: string
  artist: string
  artists: string[]
  musicUrl: string
  videoUrl: string
  /** canonical participant name -> score (missing = didn't score) */
  scores: Record<string, number>
  /**
   * canonical participant name -> the note they typed while ranking.
   * Absent entirely for years whose master sheet has no Comments tab.
   */
  comments?: Record<string, string>
  average: number
  sheetAverage: number
  stddev: number
  /** Position across every year's songs when sorted by average (1 = best ever). */
  overallRank: number
}

export interface YearData {
  year: number
  participants: string[]
  songs: Song[]
  /** Whether this year's master sheet had a Comments tab at all. */
  hasComments?: boolean
}

export interface ParticipantYearStats {
  name: string
  year: number
  songsScored: number
  avgGiven: number
  stddevGiven: number
  minGiven: number
  maxGiven: number
  reds: number
  greens: number
  /** Songs this participant gave their 11 ("super vote") to */
  elevens: Song[]
  corrToAvg: number
  totalAbsDiff: number
  avgAbsDiff: number
  /** Notes written this year (0 for years with no Comments tab). */
  commentCount: number
  /** Share of the songs they scored that they also annotated. */
  commentRate: number
  /** Mean comment length in characters; NaN if they wrote none. */
  avgCommentLength: number
}

export interface ParticipantAllTime {
  name: string
  years: number[]
  songsScored: number
  avgGiven: number
  stddevGiven: number
  reds: number
  greens: number
  elevens: Song[]
  redsPerSong: number
  greensPerSong: number
  corrToAvg: number
  totalAbsDiff: number
  avgAbsDiff: number
  commentCount: number
  /**
   * Comments per song scored **in years that had a Comments tab** — scoring a
   * year that never collected comments must not read as staying silent.
   */
  commentRate: number
  avgCommentLength: number
}

export interface NominatorStats {
  name: string
  /** nominated songs with that year's field size for percentile math */
  noms: {
    song: Song
    fieldSize: number
    /**
     * Where the song finished once this nominator's own scores are struck from
     * every song in the year — how their pick did with the *rest* of the room.
     */
    neutralRank: number
    /**
     * The same recomputation with their ballot left in. The like-for-like
     * baseline for `neutralRank`: the published `song.rank` resolves ties by a
     * rule that varies between years (see README), so comparing against it
     * would attribute tie-breaking to the nominator's own vote.
     */
    includedRank: number
  }[]
  count: number
  avgRank: number
  /** 0 = always #1, 1 = always last; comparable across years */
  avgPercentile: number
  top10Count: number
  bottom10Count: number
  /**
   * The same four figures over `neutralRank` — the nominator's own ballot
   * removed. Kept alongside rather than replacing the published ones: the
   * Nominator Dominator award is measured on the board the party actually
   * published, and `npm run validate` checks it against that sheet.
   */
  neutralAvgRank: number
  neutralAvgPercentile: number
  neutralTop10Count: number
  neutralBottom10Count: number
}

export interface ArtistStats {
  name: string
  songs: Song[]
  count: number
  avgScore: number
  best: Song
  worst: Song
  firstPlaces: number
  podiums: number
  top10s: number
}

export interface PairwiseEntry {
  a: string
  b: string
  corr: number
  overlap: number
}

export interface YearStats {
  year: number
  participants: string[]
  songs: Song[]
  participantStats: Record<string, ParticipantYearStats>
  pairwise: PairwiseEntry[]
  nominators: Record<string, NominatorStats>
  hasComments: boolean
}

export interface AllTimeStats {
  years: number[]
  songs: Song[]
  participants: string[]
  participantStats: Record<string, ParticipantAllTime>
  pairwise: PairwiseEntry[]
  nominators: Record<string, NominatorStats>
  artists: Record<string, ArtistStats>
}

export type AwardKey = 'tasteRep' | 'clairvoyant' | 'hater' | 'lover' | 'nominator'

export interface Dataset {
  years: YearData[]
  perYear: Record<number, YearStats>
  allTime: AllTimeStats
}
