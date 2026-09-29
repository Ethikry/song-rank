import { Link, useParams } from 'react-router-dom'
import { dataset } from '../lib/data'
import { AWARDS, nominatorRemorse, yearBoard } from '../lib/awards'
import { allScores, elevensOfYear } from '../lib/insights'
import { averageInfluence, voterInfluence } from '../lib/whatif'
import { BRANCH_LABELS, branchStats } from '../lib/branches'
import {
  commentKeyness,
  commentRateByExtremity,
  commentWordCounts,
  hardestNotes,
  type ExtremityBucket,
} from '../lib/wordcloud'
import { median } from '../lib/stats'
import { fmt, pct, plural } from '../lib/format'
import { displayName } from '../lib/names'
import { ArtistCredit, HBar, Histogram, Name, RankBadge, ScoreBreakdown, ScoreChip, ShowMore, SongCell, SongNote, SongTitle, WordCloud, Tile, VideoFacade, useSort } from '../components/bits'
import { videoId } from '../lib/youtube'
import { COMPILATION_URLS, INAUGURAL_YEAR, SITE } from '../lib/site'
import { Fragment, useState, useMemo } from 'react'
import type { Song } from '../lib/types'

type Tier = 'all' | 'top' | 'bottom'

const TIER_LABELS: Record<Tier, string> = { all: 'All notes', top: 'Top third', bottom: 'Bottom third' }

type InfluenceKey = 'ranker' | 'totalRanks' | 'songsMoved' | 'perVote' | 'biggest'

/**
 * The extremity chart's verdict, stated only when the bars actually separate.
 * The alternative — always printing a comparison — would read as a finding on a
 * year where the rate barely moves, which is itself the interesting answer.
 */
function extremitySentence(buckets: ExtremityBucket[]): string {
  if (buckets.length < 2) return ''
  const calm = buckets[0]
  const wild = buckets[buckets.length - 1]
  const ratio = calm.rate ? wild.rate / calm.rate : 0
  if (!Number.isFinite(ratio) || ratio < 1.25) {
    return 'Barely a difference: people annotated a score they shared with the room about as often as one nobody else gave. The notes are reviews, not defences.'
  }
  return `A score ${wild.from}+ away from the final average was ${ratio.toFixed(1)}× as likely to come with a note as one in line with the room (${pct(wild.rate, 1)} vs ${pct(calm.rate, 1)}).`
}

export default function Year() {
  const { year: raw } = useParams()
  const year = Number(raw)
  const stats = dataset.perYear[year]
  const [open, setOpen] = useState<string | null>(null)

  if (!stats) {
    return (
      <>
        <h1>No such year</h1>
        <p className="subtitle">
          There's no {raw} edition on record. <Link to="/">Front page</Link>
        </p>
      </>
    )
  }

  const compilationId = videoId(COMPILATION_URLS[year] ?? '')
  const idx = dataset.years.findIndex((y) => y.year === year)
  const prev = dataset.years[idx - 1]
  const next = dataset.years[idx + 1]
  const songs = [...stats.songs].sort((a, b) => a.rank - b.rank)
  const scores = allScores(stats.songs)
  const meanScore = scores.reduce((a, b) => a + b, 0) / scores.length
  const divisive = [...stats.songs].sort((a, b) => b.stddev - a.stddev)[0]
  const consensus = [...stats.songs].sort((a, b) => a.stddev - b.stddev)[0]
  const elevens = elevensOfYear(dataset, year)
  // The same figures the slideshow's "How the room scored" panel quotes. 11s are
  // the super vote and counted apart from the 10s, as they are there.
  const mid = median(scores)
  const medianCount = scores.filter((v) => v === mid).length
  const tensCount = scores.filter((v) => v === 10).length
  const elevenCount = scores.filter((v) => v === 11).length
  const lowest = scores.length ? Math.min(...scores) : NaN
  const lowestCount = scores.filter((v) => v === lowest).length
  const remorse = nominatorRemorse(stats.songs)
  const rallied = [...stats.songs]
    .filter((s) => !s.autoIncluded && s.nominators.length >= 2)
    .sort((a, b) => b.nominators.length - a.nominators.length || a.rank - b.rank)
    .slice(0, 6)
  const spicy = hardestNotes(stats.songs)
  const [tier, setTier] = useState<Tier>('all')
  // One alternate ranking per participant; cheap enough per year, but not per
  // keystroke on the word cloud controls above.
  const influence = useMemo(() => voterInfluence(dataset, year), [year])
  const avgInfluence = averageInfluence(influence)
  const infSort = useSort<InfluenceKey>('totalRanks')
  const sortedInfluence = useMemo(() => {
    const dir = infSort.dir
    return [...influence].sort((a, b) => {
      switch (infSort.key) {
        case 'ranker':
          return dir * displayName(a.participant).localeCompare(displayName(b.participant))
        case 'biggest':
          return dir * ((a.top?.shift ?? 0) - (b.top?.shift ?? 0))
        default:
          return dir * (a[infSort.key] - b[infSort.key])
      }
    })
  }, [influence, infSort.key, infSort.dir])
  const branches = branchStats(dataset)
    .flatMap((b) => {
      const ty = b.byYear.find((y) => y.year === year)
      // `b.avg` spans every year, so the delta says whether this year treated
      // the branch better or worse than the room usually does.
      return ty && ty.n > 0 ? [{ branch: b.branch, value: ty.value, n: ty.n, allTime: b.avg }] : []
    })
    .sort((a, b) => b.value - a.value)
  // Terciles, not deciles: a tenth of a year's field is a handful of songs and
  // the few dozen notes on them say nothing you could trust.
  const tierSongs = useMemo(() => {
    if (!stats) return []
    const byScore = [...stats.songs].sort((a, b) => b.average - a.average)
    const cut = Math.ceil(byScore.length / 3)
    if (tier === 'top') return byScore.slice(0, cut)
    if (tier === 'bottom') return byScore.slice(-cut)
    return stats.songs
  }, [stats, tier])
  const cloud = useMemo(() => {
    if (!stats) return []
    // The all-notes view is a plain frequency count — there's nothing to be
    // distinctive against. A tier is scored on how it differs from the year.
    return tier === 'all' ? commentWordCounts(stats.songs) : commentKeyness(tierSongs, stats.songs)
  }, [stats, tier, tierSongs])
  const noteCount = stats ? stats.songs.reduce((a, s) => a + Object.keys(s.comments ?? {}).length, 0) : 0
  const tierNoteCount = tierSongs.reduce((a, s) => a + Object.keys(s.comments ?? {}).length, 0)
  const extremity = useMemo(() => (stats ? commentRateByExtremity(stats.songs) : []), [stats])
  const [picked, setPicked] = useState<string | null>(null)
  // Whole-word match so picking "song" doesn't also pull in "songs" — the counts
  // beside each word already fold plurals, but the quotes should be literal.
  // Scoped to the visible tier, so a word picked out of the bottom third leads
  // to the notes that put it there rather than to the whole year.
  const pickedNotes = useMemo(() => {
    if (!picked) return []
    const re = new RegExp(`\\b${picked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i')
    return tierSongs.flatMap((song) =>
      Object.entries(song.comments ?? {})
        .filter(([, text]) => re.test(text))
        .map(([who, text]) => ({ song, who, text })),
    )
  }, [picked, tierSongs])
  const newcomers = stats.participants.filter(
    (p) => !dataset.years.slice(0, idx).some((y) => y.participants.includes(p)),
  )

  const infTh = (k: InfluenceKey, label: string, cls = '', d: 1 | -1 = -1) => (
    <th className={`sortable ${cls}`} onClick={() => infSort.toggle(k, d)}>
      {label}
      {infSort.arrow(k)}
    </th>
  )

  const songRow = (s: Song) => {
    const rowKey = s.id
    return (
      <Fragment key={rowKey}>
        <tr onClick={() => setOpen(open === rowKey ? null : rowKey)} style={{ cursor: 'pointer' }}>
          <td className="num">
            <RankBadge rank={s.rank} />
          </td>
          <td>
            <SongCell s={s} />
          </td>
          <td onClick={(e) => e.stopPropagation()}>
            <ArtistCredit s={s} />
          </td>
          <td>
            {s.autoIncluded ? (
              <span className="pill">auto</span>
            ) : (
              s.nominators.map((n, i) => (
                <span key={n}>
                  {i > 0 && ', '}
                  <Name n={n} />
                </span>
              ))
            )}
          </td>
          <td className="num">{fmt(s.average)}</td>
          <td className="num">{fmt(s.stddev)}</td>
          <td className="num note">#{s.overallRank}</td>
        </tr>
        {open === rowKey && (
          <tr>
            <td colSpan={7}>
              <ScoreBreakdown s={s} />
            </td>
          </tr>
        )}
      </Fragment>
    )
  }

  return (
    <>
      <div className="year-head">
        <div className="year-head-text">
          <h1>The {year} Edition</h1>
          <p className="subtitle">
            {year === INAUGURAL_YEAR && 'The inaugural edition · '}
            {stats.songs.length} songs · {stats.participants.length} rankers
            {prev && (
              <>
                {' '}
                · <Link to={`/year/${prev.year}`}>← {prev.year}</Link>
              </>
            )}
            {next && (
              <>
                {' '}
                · <Link to={`/year/${next.year}`}>{next.year} →</Link>
              </>
            )}{' '}
            · <Link to={`/recap/${year}`}>get your {year} recap →</Link>
          </p>
          <p style={{ margin: '2px 0 0' }}>
            <Link className="present-launch" to={`/present/${year}`}>
              ▶ Present the {year} results
            </Link>
          </p>
        </div>
        {compilationId && (
          <div className="year-head-video">
            <VideoFacade ids={[compilationId]} title={`The ${year} compilation`} />
            <p className="note" style={{ margin: '6px 0 0' }}>
              ▶ The {year} compilation
            </p>
          </div>
        )}
      </div>

      <div className="tiles">
        <Tile value={stats.songs.length} label="Songs in the field" />
        <Tile
          value={stats.participants.length}
          label="Rankers"
          detail={idx === 0 ? 'the founding class' : newcomers.length ? `${newcomers.length} new this year` : 'all returning faces'}
        />
        <Tile value={fmt(meanScore)} label="Mean score given" />
        <Tile value={<SongTitle s={songs[0]} />} label="Winner" detail={`${songs[0].artist} · avg ${fmt(songs[0].average)}`} />
      </div>

      <h2>The full rankings</h2>
      <p className="note">Click a row for the complete scorecard.</p>
      <ShowMore items={songs} initial={15} noun="songs">
        {(shown) => (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th className="num">Rank</th>
                  <th>Song</th>
                  <th>Artist</th>
                  <th>Nominated by</th>
                  <th className="num">Avg</th>
                  <th className="num">σ</th>
                  {/* Where each song sits against every song ever ranked — the
                      slideshow quotes this for the podium. */}
                  <th className="num">All-time</th>
                </tr>
              </thead>
              <tbody>{shown.map(songRow)}</tbody>
            </table>
          </div>
        )}
      </ShowMore>
      <p className="note">
        Out of {dataset.allTime.songs.length} songs ever ranked.
      </p>

      {/* Two short tables that each only ever filled half a column — paired so
          they read as one band rather than two stubs stacked down the page. */}
      {(rallied.length > 0 || branches.length >= 2) && (
        <div className="two-col">
          {rallied.length > 0 && (
            <div>
              <h3>Songs the room rallied behind</h3>
              <p className="note">Independent nominations of the same song.</p>
              {/* The one table on this page without the wrapper: an eight-name
                  co-nomination list holds the row open, and on a phone that was
                  pushing the whole document past the viewport. */}
              <div className="scroll-x">
                <table className="data">
                  <tbody>
                    {rallied.map((s) => (
                      <tr key={s.id}>
                        <td className="num">{s.nominators.length}×</td>
                        <td>
                          <SongCell s={s} sub={s.artist} />
                        </td>
                        <td>
                          {s.nominators.map((n, i) => (
                            <span key={n}>
                              {i > 0 && ', '}
                              <Name n={n} />
                            </span>
                          ))}
                        </td>
                        <td className="num">#{s.rank}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {branches.length >= 2 && (
            <div>
              <h3>How the {SITE.group.plural} scored</h3>
              <p className="note">
                Average by {SITE.group.singular} in {year} against its all-time average. Collabs count for every {SITE.group.singular}, so these
                total more than {stats.songs.length} songs.
              </p>
              <table className="data">
                <tbody>
                  {branches.map((b) => (
                    <tr key={b.branch}>
                      <td>{BRANCH_LABELS[b.branch]}</td>
                      <td className="num note">{plural(b.n, 'song')}</td>
                      <td className="num">{fmt(b.value)}</td>
                      <td className="num" style={{ color: b.value >= b.allTime ? 'var(--green)' : 'var(--vermillion)' }}>
                        {b.value >= b.allTime ? '▲' : '▼'} {fmt(Math.abs(b.value - b.allTime))}
                      </td>
                      <td className="num note">vs {fmt(b.allTime)} all-time</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="note">
                <Link to="/artists">every {SITE.group.singular}, year by year →</Link>
              </p>
            </div>
          )}
        </div>
      )}

      <h2>How the year scored</h2>
      <div className="two-col">
        <div>
          <h3>Every score handed out</h3>
          <Histogram values={scores} />
          <p className="note">
            {scores.length} scores · mean {fmt(meanScore)}
          </p>
        </div>
        <div>
          <h3>The extremes</h3>
          <table className="data">
            <tbody>
              <tr>
                <td>Most divisive</td>
                <td>
                  <SongTitle s={divisive} />
                  <div className="note">{divisive.artist}</div>
                </td>
                <td className="num">σ {fmt(divisive.stddev)}</td>
              </tr>
              <tr>
                <td>Strongest consensus</td>
                <td>
                  <SongTitle s={consensus} />
                  <div className="note">{consensus.artist}</div>
                </td>
                <td className="num">σ {fmt(consensus.stddev)}</td>
              </tr>
              <tr>
                <td>Median score</td>
                <td className="note">given {plural(medianCount, 'time')}</td>
                <td className="num">{fmt(mid)}</td>
              </tr>
              <tr>
                <td>Tens handed out</td>
                <td className="note">not counting the {elevenCount} 11s</td>
                <td className="num">{tensCount}</td>
              </tr>
              <tr>
                <td>Lowest score given</td>
                <td className="note">given {plural(lowestCount, 'time')}</td>
                <td className="num">{fmt(lowest, 1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <h2>The year's awards</h2>
      <div className="card-grid">
        {AWARDS.map((a) => {
          const board = yearBoard(stats, a.key).filter((e) => Number.isFinite(e.value))
          const digits = a.key === 'tasteRep' ? 3 : a.key === 'hater' || a.key === 'lover' ? 0 : 1
          return (
            <div className="card" key={a.key}>
              <h3 style={{ marginTop: 0 }}>
                {a.emoji} {a.title}
              </h3>
              <table className="data">
                <tbody>
                  {board.slice(0, 3).map((e, i) => (
                    <tr key={e.name}>
                      <td>{i === 0 ? '👑' : `${i + 1}.`}</td>
                      <td>
                        <Name n={e.name} />
                      </td>
                      <td className="num">{fmt(e.value, digits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="note" style={{ marginBottom: 0 }}>
                <Link to="/awards">full board →</Link>
              </p>
            </div>
          )
        })}
        {/* Another award, so it belongs in the same grid — on its own it was a
            lone half-width card hanging off the bottom of one. */}
        {remorse && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>🙃 {SITE.remorseAward}</h3>
            <p style={{ marginBottom: 0 }}>
              <Name n={remorse.who} /> nominated <SongTitle s={remorse.song} /> — then scored it{' '}
              <ScoreChip v={remorse.score} /> against the room's {fmt(remorse.song.average)}. The widest gap all year
              between a nomination and the person who made it.
            </p>
          </div>
        )}
      </div>

      <h2>Whose vote moved the board most</h2>
      <p className="note">
        The board recomputed without one ranker — every rank their songs shift is a rank their ballot was worth.
        Average: {fmt(avgInfluence.totalRanks, 1)} ranks over {fmt(avgInfluence.songsMoved, 1)} songs,{' '}
        {fmt(avgInfluence.perVote, 2)} per vote.
      </p>
      <ShowMore items={sortedInfluence} initial={10} noun="rankers">
        {(shown) => (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  {infTh('ranker', 'Ranker', '', 1)}
                  {infTh('totalRanks', 'Ranks moved', 'num')}
                  {infTh('songsMoved', 'Songs moved', 'num')}
                  {infTh('perVote', 'Per vote', 'num')}
                  {infTh('biggest', 'Their biggest move')}
                </tr>
              </thead>
              <tbody>
                {shown.map((v) => (
                  <tr key={v.participant}>
                    <td>
                      <Name n={v.participant} avatar />
                    </td>
                    <td className="num" style={{ fontWeight: 700 }}>{v.totalRanks}</td>
                    <td className="num">
                      {v.songsMoved} <span className="note">of {v.votes}</span>
                    </td>
                    <td className="num">{fmt(v.perVote, 2)}</td>
                    <td>
                      {v.top ? (
                        <>
                          <SongTitle s={v.top.song} />
                          <div className="note">
                            <ScoreChip v={v.top.score} /> #{v.top.from} → #{v.top.to} without them
                          </div>
                        </>
                      ) : (
                        <span className="note">moved nothing</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ShowMore>

      {noteCount > 0 && (
        <>
          <h2>What the room talked about</h2>
          <p className="note">
            {tier === 'all' ? (
              <>
                Every word used more than once across {plural(noteCount, 'note')} left while ranking {year}, sized by
                how often it came up.
              </>
            ) : (
              <>
                The most <em>distinctive</em> words in the {year} {tier === 'top' ? 'favourites' : 'also-rans'}, not
                the commonest — sized by how far each is over-used in the {plural(tierNoteCount, 'note')} on these{' '}
                {tierSongs.length} songs against the year as a whole.
              </>
            )}
          </p>
          <div className="controls">
            <div className="seg">
              {(['all', 'top', 'bottom'] as Tier[]).map((t) => (
                <button
                  key={t}
                  className={tier === t ? 'on' : ''}
                  onClick={() => {
                    setTier(t)
                    setPicked(null)
                  }}
                >
                  {TIER_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          {cloud.length === 0 ? (
            <p className="note">
              Too few notes on these songs to say anything distinctive about them.
            </p>
          ) : (
            <WordCloud words={cloud} onPick={(w) => setPicked((cur) => (cur === w ? null : w))} />
          )}
          {picked && (
            <div className="wc-picked">
              <p className="note">
                {plural(pickedNotes.length, 'note')} mentioning <strong>{picked}</strong>{' '}
                <button className="showmore" style={{ margin: 0 }} onClick={() => setPicked(null)}>
                  clear
                </button>
              </p>
              <div className="notes-list">
                {pickedNotes.map(({ song, who, text }) => (
                  <div className="voice" key={`${song.id}-${who}`}>
                    <ScoreChip v={song.scores[who]} />
                    <div className="voice-body">
                      <span className="voice-who">
                        <Name n={who} /> <span className="note">on</span> <SongTitle s={song} />
                      </span>
                      <p className="voice-quote">{text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="two-col">
            {spicy.length > 0 && (
              <div>
                <h3>The notes that went hardest against the room</h3>
                <p className="note">
                  The biggest breaks from consensus of the {plural(noteCount, 'note')} typed while ranking {year} —
                  each one's gap to where the song finished.
                </p>
                <div className="notes-list">
                  {spicy.map((q) => (
                    <div className="voice" key={`${q.song.id}-${q.who}`}>
                      <ScoreChip v={q.score} />
                      <div className="voice-body">
                        <span className="voice-who">
                          <Name n={q.who} /> <span className="note">on</span> <SongTitle s={q.song} />{' '}
                          <span className="note">
                            — {q.dev >= 0 ? '+' : ''}
                            {fmt(q.dev, 1)} against a {fmt(q.song.average)} room
                          </span>
                        </span>
                        <p className="voice-quote">{q.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3>Who bothers to explain themselves</h3>
              <p className="note">
                Every score in {year}, grouped by how far it sat from where the song finished, against how often it
                came with a note. Bars climbing to the right mean people write mostly to defend an unpopular number.
              </p>
              {/* `.bars` is what lays the HBar rows out as a grid — without it they
                  collapse to plain stacked text. */}
              <div className="bars">
                {extremity.map((b) => (
                  <HBar
                    key={b.label}
                    label={b.label}
                    value={b.rate}
                    max={Math.max(...extremity.map((x) => x.rate))}
                    display={`${pct(b.rate, 1)} of ${b.scores}`}
                  />
                ))}
              </div>
              <p className="note">{extremitySentence(extremity)}</p>
            </div>
          </div>
        </>
      )}

      <h2>Where the 11s went</h2>
      {elevens.length === 0 ? (
        <p className="note">No 11s were handed out in {year} — the super vote wasn't in play this year.</p>
      ) : (
        <>
      <p className="note">Each ranker gets a single 11 — the super vote.</p>
      <ShowMore items={elevens} initial={12} noun="elevens">
        {(shown) => (
          <div className="scroll-x">
            <table className="data">
              <thead>
                <tr>
                  <th>Ranker</th>
                  <th>Their 11</th>
                  <th className="num">Finished</th>
                  <th className="num">Consensus</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ who, song }) => (
                  <tr key={`${who}-${song.id}`}>
                    <td>
                      <Name n={who} avatar />
                    </td>
                    <td>
                      <SongTitle s={song} />
                      <div className="note">{song.artist}</div>
                      <SongNote s={song} who={who} />
                    </td>
                    <td className="num">#{song.rank}</td>
                    <td className="num">
                      <ScoreChip v={Math.round(song.average * 2) / 2} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ShowMore>
      {stats.participants.length > elevens.length && (
        <p className="note">
          {plural(stats.participants.length - elevens.length, 'ranker')} never spent theirs:{' '}
          {stats.participants
            .filter((p) => !elevens.some((e) => e.who === p))
            .map((p) => displayName(p))
            .join(', ')}
          .
        </p>
      )}
        </>
      )}

      {/* The rest of the slideshow's material, on the pages that own it —
          every link already scoped to this year so nothing lands on all-time. */}
      <h2>The rest of the {year} story</h2>
      <ul className="year-elsewhere">
        <li>
          <Link to={`/taste?scope=${year}`}>Taste twins, nemeses and the {year} taste web →</Link>
          <div className="note">Who ranked alike this year, what they agreed on, and who sat furthest out.</div>
        </li>
        <li>
          <Link to={`/lab?scope=${year}`}>Who could rewrite the {year} podium, and who carried or buried a song →</Link>
          <div className="note">The counterfactuals: the same ballots with one voice removed, or counted another way.</div>
        </li>
        <li>
          <Link to="/">How {year} compares with every other edition →</Link>
          <div className="note">The drift: mean score, spread and generosity, year by year.</div>
        </li>
        <li>
          <Link to={`/recap/${year}`}>Your own {year} recap card →</Link>
          <div className="note">The finale slide, personalised — download it and post it.</div>
        </li>
      </ul>
    </>
  )
}
