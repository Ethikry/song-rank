import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { dataset } from '../lib/data'
import type { Song } from '../lib/types'
import { AWARDS, nominatorRemorse, yearBoard } from '../lib/awards'
import type { AwardKey } from '../lib/types'
import { allScores, elevensOfYear, yearMeans } from '../lib/insights'
import { median } from '../lib/stats'
import { hardestNotes } from '../lib/wordcloud'
import { tasteMap } from '../lib/mds'
import { averageInfluence, carriedSongs, tierImpacts, voterInfluence } from '../lib/whatif'
import { branchStats, BRANCHES, BRANCH_LABELS, type Branch } from '../lib/branches'
import { buildRecap } from '../lib/recap'
import { namedPairs } from '../lib/affinity'
import { SharedArtists } from './Taste'

/** Which way a pairing's drivers went — see .agree-* in styles.css. */
const dirClass = { up: 'agree-up', down: 'agree-down', split: 'agree-split' } as const
import { corrColor, corrInk, fmt, medal, pct, plural } from '../lib/format'
import { displayName } from '../lib/names'
import { SITE, SITE_NAME } from '../lib/site'
import { HBar, Histogram, ScoreChip, SongNote, Thumb, Tile } from '../components/bits'
import { PieChart, TrendLine } from '../components/charts'
import { TasteWeb } from '../components/TasteWeb'
import { Avatar, useIdentity } from '../components/identity'
import { RecapShareCard } from '../components/RecapShareCard'

interface Slide {
  key: string
  label: string
  el: ReactNode
}

/**
 * Standard slide frame. Uses plain divs (not h1/h2/h3) so the global editorial
 * heading styles — section counters, top rules — don't leak into the deck.
 */
function Frame({ kicker, title, wide, children }: { kicker: string; title: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`present-inner${wide ? ' wide' : ''}`}>
      <div className="present-kicker">{kicker}</div>
      <div className="present-title">{title}</div>
      <div className="present-content">{children}</div>
    </div>
  )
}

/**
 * How a figure compares with the room's average, as a multiple. Says "the avg."
 * rather than a bare number so the caption reads without the label above it.
 */
function times(value: number, avg: number): string {
  if (!avg || !Number.isFinite(value / avg)) return 'no average to compare'
  return `${fmt(value / avg, 1)}× the avg.`
}

/** A person chip: avatar + display name, no navigation (links would leave the deck). */
function Person({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <span className="present-person">
      <Avatar participant={name} size={size} />
      {displayName(name)}
    </span>
  )
}

/**
 * Who put a song forward, as a line of prose.
 *
 * Shared by the podium and the Top 10 so the two slides credit a song the same
 * way. Auto-carried songs say so rather than going blank — "nominated by" with
 * nothing after it reads as missing data.
 */
function nominatorCredit(s: Song): string {
  if (s.autoIncluded || !s.nominators.length) return 'auto-included (top 10)'
  return `nom. ${s.nominators.map((n) => displayName(n)).join(', ')}`
}

function CorrChip({ v }: { v: number }) {
  return (
    <span className="present-corr" style={{ background: corrColor(v), color: corrInk(v) }}>
      {fmt(v, 2)}
    </span>
  )
}

export default function Present() {
  const { year: raw } = useParams()
  const navigate = useNavigate()
  const year = Number(raw)
  const stats = dataset.perYear[year]
  const { me } = useIdentity()
  const [i, setI] = useState(0)
  const [overview, setOverview] = useState(false)

  // Full-screen overlay: keep the page underneath from scrolling behind it.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const exit = () => navigate(`/year/${year}`)
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.()
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }

  const myName = me?.participant && stats?.participants.includes(me.participant) ? me.participant : null
  const myRecap = useMemo(() => (myName && stats ? buildRecap(dataset, year, myName) : null), [year, myName, stats])

  const slides = useMemo<Slide[]>(() => {
    if (!stats) return []
    const out: Slide[] = []
    const push = (key: string, label: string, el: ReactNode) => out.push({ key, label, el })

    const songs = [...stats.songs].sort((a, b) => a.rank - b.rank)
    const scores = allScores(stats.songs)
    const meanScore = scores.reduce((a, b) => a + b, 0) / (scores.length || 1)
    const sortedScores = [...scores].sort((a, b) => a - b)
    const mid = median(scores)
    // 11s are the super vote and counted separately — lumping them in would
    // overstate how freely the room handed out top marks.
    const tensCount = scores.filter((v) => v === 10).length
    const elevenCount = scores.filter((v) => v === 11).length
    const lowest = sortedScores.length ? sortedScores[0] : NaN
    const lowestCount = scores.filter((v) => v === lowest).length
    const medianCount = scores.filter((v) => v === mid).length
    const divisive = [...stats.songs].sort((a, b) => b.stddev - a.stddev)[0]
    const consensus = [...stats.songs].sort((a, b) => a.stddev - b.stddev)[0]
    const elevens = elevensOfYear(dataset, year)

    // — Title —
    push(
      'title',
      'Title',
      <Frame kicker={SITE_NAME} title={`The ${year} Edition`}>
        <p className="present-lead">
          {stats.songs.length} songs · {stats.participants.length} rankers · the year in data
        </p>
        {/* Both hints ship and CSS picks one on (pointer: coarse) — a phone was
            being told to press keys it doesn't have. */}
        <p className="note hint-fine">← → or space to move · F for fullscreen · Esc to exit</p>
        <p className="note hint-coarse">Swipe left or right to move · tap ☰ to jump to any slide</p>
      </Frame>,
    )

    // — Top 3 podium —
    push(
      'top3',
      'The podium',
      <Frame kicker="The results" title="The podium" wide>
        <div className="present-podium">
          {songs.slice(0, 3).map((s) => (
            <div key={s.id} className={`podium-card p${s.rank}`}>
              <div className="podium-medal">{medal(s.rank)}</div>
              <Thumb s={s} size="large" />
              <div className="podium-title">{s.title}</div>
              <div className="note">{s.artist}</div>
              <div className="podium-avg">{fmt(s.average)}</div>
              {/* Somebody put each of these three forward, and the podium is
                  where that's worth saying out loud. It was the one slide in the
                  nominations chapter that named nobody. */}
              <div className="note podium-nom">{nominatorCredit(s)}</div>
            </div>
          ))}
        </div>
      </Frame>,
    )

    // — Top 10 —
    push(
      'top10',
      'Top 10',
      <Frame kicker="The results" title="Top 10">
        <ol className="present-top10">
          {songs.slice(0, 10).map((s) => (
            <li key={s.id}>
              <span className="rk">{s.rank}</span>
              <Thumb s={s} />
              <span className="ti">
                {s.title}
                <span className="note"> — {s.artist}</span>
                {/* Phone copy of the credit. The column to the right of the
                    title has nowhere to go under 640px and is hidden there, so
                    the credit rides under the title instead of vanishing —
                    which is what the nominations chapter is for. */}
                <span className="nom-inline note">{nominatorCredit(s)}</span>
              </span>
              <span className="nom-col">{nominatorCredit(s)}</span>
              <span className="av">{fmt(s.average)}</span>
            </li>
          ))}
        </ol>
      </Frame>,
    )

    // — The field & distribution —
    push(
      'field',
      'The field',
      <Frame kicker="The field" title="How the room scored" wide>
        <div className="tiles">
          <Tile value={stats.songs.length} label="Songs" />
          <Tile value={stats.participants.length} label="Rankers" />
          <Tile value={fmt(meanScore)} label="Mean score" />
          <Tile value={scores.length} label="Scores cast" />
        </div>
        <div className="present-histo">
          <div>
            <Histogram values={scores} height={220} />
            <p className="note">Every score handed out this year, in half-point bins.</p>
          </div>
          <div className="present-sidestats">
            <div>
              <div className="present-h3">Median score</div>
              <div className="ss-val">
                {fmt(mid)} <span className="note">×{medianCount}</span>
              </div>
            </div>
            <div>
              <div className="present-h3">Tens handed out</div>
              <div className="ss-val">{tensCount}</div>
              <div className="note">not counting the {elevenCount} super votes</div>
            </div>
            <div>
              <div className="present-h3">Lowest score given</div>
              <div className="ss-val">
                {fmt(lowest, 1)} <span className="note">×{lowestCount}</span>
              </div>
            </div>
          </div>
        </div>
      </Frame>,
    )

    // — Awards & superlatives (Data Analysis) —
    // Three slides rather than one board of five: presented live, five
    // leaderboards at once is a wall nobody reads, and the pairs below each
    // answer one question — who read the room, who ran hot and cold, who
    // brought the songs.
    const awardBoards = AWARDS.flatMap((a) => {
      const board = yearBoard(stats, a.key).filter((e) => Number.isFinite(e.value))
      if (!board.length) return []
      const digits = a.key === 'tasteRep' ? 3 : a.key === 'hater' || a.key === 'lover' ? 0 : 1
      // Fewer boards per slide leaves room to show more of the field.
      const shown = board.slice(0, 8)
      const maxVal = Math.max(...shown.map((e) => Math.abs(e.value)), 0.0001)
      // Ties share the crown, as they do on the awards page.
      const eps = a.key === 'nominator' ? 0.05 : a.key === 'clairvoyant' ? 0.005 : 1e-9
      const winners = board.filter((e) => Math.abs(e.value - board[0].value) <= eps)
      return [{ award: a, shown, maxVal, digits, winners, best: board[0].value }]
    })

    const awardSlide = (keys: AwardKey[], kicker: string, title: string, footnote?: ReactNode) => {
      const boards = awardBoards.filter((b) => keys.includes(b.award.key))
      if (!boards.length) return
      push(
        `awards-${keys.join('-')}`,
        title,
        <Frame kicker={kicker} title={title} wide>
          <div className="present-awards few">
            {boards.map(({ award, shown, maxVal, digits, winners, best }) => (
              <div className="present-award" key={award.key}>
                <div className="present-h3">
                  {award.emoji} {award.title}
                </div>
                <div className="present-award-name">
                  <span className="crown">👑</span> {winners.map((w) => displayName(w.name)).join(' & ')}{' '}
                  <span className="present-award-val">{fmt(best, digits)}</span>
                </div>
                <div className="bars present-bars">
                  {shown.map((e, idx) => (
                    <HBar
                      key={e.name}
                      label={<Person name={e.name} size={16} />}
                      value={award.betterIs === 'low' ? maxVal - Math.abs(e.value) + maxVal * 0.05 : Math.max(0, e.value)}
                      max={maxVal * 1.05}
                      display={fmt(e.value, digits)}
                      color={idx === 0 ? 'var(--vermillion)' : undefined}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {footnote}
        </Frame>,
      )
    }

    awardSlide(['tasteRep', 'clairvoyant'], 'The results', 'Reading the room')
    awardSlide(['hater', 'lover'], 'The results', 'Running hot and cold')

    // The remorse footnote (SITE.remorseAward) — see nominatorRemorse; the same footnote appears on the
    // year page.
    const remorse = nominatorRemorse(stats.songs)

    awardSlide(
      ['nominator'],
      'The nominations',
      'Who brought the songs',
      remorse ? (
        <div className="present-nearmiss">
          <div className="present-h3">🙃 {SITE.remorseAward}</div>
          <p className="present-remorse">
            <strong>{displayName(remorse.who)}</strong> nominated “{remorse.song.title}” — then scored it{' '}
            <span className="present-award-val">{fmt(remorse.score, 1)}</span> against the room's{' '}
            {fmt(remorse.song.average)}. The widest gap all year between a nomination and the person who made it.
          </p>
        </div>
      ) : undefined,
    )

    /*
     * — Most-nominated songs, or who found the top ones —
     *
     * 2023 and 2024 record exactly one nominator per song, so the "rallied
     * behind" cut came back empty and those two decks simply had no slide
     * crediting anyone for a specific song: the nominations chapter went
     * straight from the award board to taste. Rather than leaving a hole, a
     * year with no co-nominations gets the same question answered the way its
     * data can answer it — who put the top ten forward.
     */
    const nominated = [...stats.songs]
      .filter((s) => !s.autoIncluded && s.nominators.length >= 2)
      .sort((a, b) => b.nominators.length - a.nominators.length)
      .slice(0, 6)
    if (!nominated.length) {
      const top10 = songs.slice(0, 10)
      const finds = new Map<string, Song[]>()
      for (const s of top10) {
        if (s.autoIncluded) continue
        for (const n of s.nominators) {
          if (!finds.has(n)) finds.set(n, [])
          finds.get(n)!.push(s)
        }
      }
      const finders = [...finds.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[1][0].rank - b[1][0].rank)
        .slice(0, 6)
      // With one nominator per song and no repeat finders, every count is 1 and
      // the tally column says nothing — the song's finish is the fact worth
      // leading each row with instead.
      const repeatFinders = finders.some(([, list]) => list.length > 1)
      if (finders.length) {
        push(
          'nominated',
          'Who found them',
          <Frame kicker="The nominations" title="Who found the top 10">
            <table className="present-table">
              <tbody>
                {finders.map(([who, list]) => (
                  <tr key={who}>
                    <td className="big">{repeatFinders ? `${list.length}×` : `#${list[0].rank}`}</td>
                    <td>
                      <Thumb s={list[0]} />
                    </td>
                    <td>
                      <Person name={who} size={30} />
                      <div className="note">
                        {list.map((s) => (repeatFinders ? `#${s.rank} ${s.title}` : s.title)).join(' · ')}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">
              Songs in this year&apos;s top 10 that each of them put forward.{' '}
              {top10.filter((s) => s.autoIncluded).length > 0 &&
                `${top10.filter((s) => s.autoIncluded).length} of the ten carried over automatically and are credited to nobody.`}
            </p>
          </Frame>,
        )
      }
    }
    if (nominated.length) {
      push(
        'nominated',
        'Most-nominated',
        <Frame kicker="The nominations" title="Songs the room rallied behind">
          <table className="present-table">
            <tbody>
              {nominated.map((s) => (
                <tr key={s.id}>
                  <td className="big">{s.nominators.length}×</td>
                  <td>
                    <Thumb s={s} />
                  </td>
                  <td>
                    {s.title}
                    <div className="note">{s.artist}</div>
                  </td>
                  <td className="num">#{s.rank}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">How many people independently nominated the same song.</p>
        </Frame>,
      )
    }

    // — Taste connections (Taste Comparison) —
    //
    // Three named pairings rather than two lists of five. A slide of ten rows of
    // "name × name, 55" is a table read aloud; the three below each carry the
    // reason they are on screen, and the titles are generated from that reason
    // so they cannot drift out of step with the numbers beside them.
    const named = namedPairs(stats.songs, stats.pairwise)
    if (named.length) {
      push(
        'taste-pairs',
        'Kindred & opposite',
        <Frame kicker="Taste connections" title="Who ranked alike, and why" wide>
          <div className="present-named-pairs">
            {named.map((n) => (
              <div className="np" key={`${n.a}|${n.b}`}>
                <div className="np-cat">{n.category}</div>
                <div className="present-pairline">
                  <Person name={n.a} size={26} />
                  <CorrChip v={n.corr} />
                  <Person name={n.b} size={26} />
                </div>
                {/* The reasons, with their weights. Percentages are each
                    artist's share of *this pairing's* correlation, so they are
                    comparable down a column but not across cards — a card's own
                    r is the denominator. */}
                <div className="np-drivers">
                  {n.drivers.map((d) => (
                    <div className="np-driver" key={d.artist}>
                      <span className={dirClass[d.direction]}>{d.artist}</span>
                      <span className="np-pct">{pct(d.fraction)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Frame>,
      )
    }

    // — In their own words (only years whose sheet collected notes) —
    if (stats.hasComments) {
      const noteCount = stats.songs.reduce((a, s) => a + Object.keys(s.comments ?? {}).length, 0)
      const picks = hardestNotes(stats.songs)
      if (picks.length) {
        push(
          'quotes',
          'In their own words',
          <Frame kicker="The commentary" title="In their own words">
            <p className="present-lead note">
              {plural(noteCount, 'note')} {noteCount === 1 ? 'was' : 'were'} typed while ranking {year}. These went hardest against the room.
            </p>
            <div className="present-quotes">
              {picks.map((q) => (
                <div className="present-quote" key={`${q.song.id}-${q.who}`}>
                  <Thumb s={q.song} />
                  <div className="pq-body">
                    <p className="quote-line">
                      {/* Attribution sits outside the quote marks, which the
                          .voice-quote pseudo-elements supply. */}
                      <span className="voice-quote">{q.text}</span>
                      <span className="quote-author"> — {displayName(q.who)}</span>
                    </p>
                    <div className="note">
                      <ScoreChip v={q.score} /> on “{q.song.title}” — {q.dev >= 0 ? '+' : ''}
                      {fmt(q.dev, 1)} against a {fmt(q.song.average)} room
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Frame>,
        )
      }
    }

    // — The taste web —
    const mapPts = tasteMap(stats.pairwise, stats.participants)
    if (stats.participants.length >= 4) {
      const edges = stats.pairwise
        .filter((p) => Number.isFinite(p.corr) && p.corr >= 0.4)
        .flatMap((p) => {
          const a = mapPts.findIndex((n) => n.name === p.a)
          const b = mapPts.findIndex((n) => n.name === p.b)
          return a >= 0 && b >= 0 ? [{ i: a, j: b, w: p.corr }] : []
        })
      if (edges.length) {
        // Most threads: how many people they correlate with above the 0.4 line
        // the web is drawn at, so the number matches what's on screen.
        const degree = new Map<string, number>()
        for (const e of edges) {
          for (const idx of [e.i, e.j]) {
            const n = mapPts[idx].name
            degree.set(n, (degree.get(n) ?? 0) + 1)
          }
        }
        const hub = [...degree.entries()].sort((a, b) => b[1] - a[1])[0]
        const closest = [...stats.pairwise]
          .filter((p) => Number.isFinite(p.corr))
          .sort((a, b) => b.corr - a.corr)[0]
        /**
         * Loneliest: furthest from the centre of the cloud. Measured in the same
         * embedding the web is drawn from, so the caption agrees with the picture
         * rather than with a separate correlation ranking.
         */
        const cx = mapPts.reduce((a, p) => a + p.x, 0) / mapPts.length
        const cy = mapPts.reduce((a, p) => a + p.y, 0) / mapPts.length
        const cz = mapPts.reduce((a, p) => a + p.z, 0) / mapPts.length
        const outlier = [...mapPts]
          .map((p) => ({ name: p.name, d: Math.hypot(p.x - cx, p.y - cy, p.z - cz) }))
          .sort((a, b) => b.d - a.d)[0]
        push(
          'web',
          'The taste web',
          <Frame kicker="Taste connections" title="The taste web" wide>
            <p className="present-lead note">
              Distance ≈ disagreement; threads link the closest tastes.
            </p>
            <div className="present-weblayout">
              <TasteWeb
                nodes={mapPts.map((p) => ({
                  name: p.name,
                  label: displayName(p.name),
                  x: p.x,
                  y: p.y,
                  z: p.z,
                  misfit: p.misfit,
                }))}
                edges={edges}
                height={430}
                marginOfError={false}
              />
              <div className="present-webstats">
                {hub && (
                  <div>
                    <div className="present-h3">🕸️ Most connected</div>
                    <Person name={hub[0]} size={30} />
                    <div className="note">{plural(hub[1], 'thread')} above 0.40</div>
                  </div>
                )}
                {closest && (
                  <div>
                    <div className="present-h3">🤝 Closest pair</div>
                    <div className="present-pairline">
                      <Person name={closest.a} size={30} />
                      <CorrChip v={closest.corr} />
                      <Person name={closest.b} size={30} />
                    </div>
                    {/* …and what that number is made of. The web says two people
                        track each other; this says on whom. */}
                    <div className="present-agree">
                      <SharedArtists songs={stats.songs} a={closest.a} b={closest.b} limit={3} />
                    </div>
                  </div>
                )}
                {outlier && (
                  <div>
                    <div className="present-h3">🛰️ Furthest out</div>
                    <Person name={outlier.name} size={30} />
                    <div className="note">off in their own world</div>
                  </div>
                )}
              </div>
            </div>
          </Frame>,
        )
      }
    }

    // — Divisive vs consensus —
    if (divisive && consensus) {
      push(
        'spread',
        'Agreement & discord',
        <Frame kicker="Song stats" title="Agreement & discord" wide>
          <div className="present-two">
            <div>
              <div className="present-h3">🔥 Most divisive</div>
              <Thumb s={divisive} size="large" />
              <div className="present-song">{divisive.title}</div>
              <div className="note">
                {divisive.artist} · σ {fmt(divisive.stddev)}
              </div>
              <Histogram values={Object.values(divisive.scores)} height={120} />
            </div>
            <div>
              <div className="present-h3">🤝 Strongest consensus</div>
              <Thumb s={consensus} size="large" />
              <div className="present-song">{consensus.title}</div>
              <div className="note">
                {consensus.artist} · σ {fmt(consensus.stddev)}
              </div>
              <Histogram values={Object.values(consensus.scores)} height={120} />
            </div>
          </div>
        </Frame>,
      )
    }

    // — Where the 11s went —
    if (elevens.length) {
      // Grouped by song rather than by voter: the interesting fact is which
      // songs drew the room's super votes, not who spent theirs where.
      const bySong = new Map<string, { song: Song; who: string[] }>()
      for (const { who, song } of elevens) {
        const entry = bySong.get(song.id) ?? { song, who: [] }
        entry.who.push(who)
        bySong.set(song.id, entry)
      }
      const topElevens = [...bySong.values()]
        .sort((a, b) => b.who.length - a.who.length || a.song.rank - b.song.rank)
        .slice(0, 3)
      /*
       * The mirror of the slide above it: the super vote that went furthest
       * wrong. Ranked on the finish, not the score — an 11 for a song the room
       * put 90th is the joke, and the room's average is only the setup.
       *
       * Suppressed when the worst-placed 11 still landed in the top half; there
       * is nothing doomed about backing a song everybody liked.
       */
      const doomed = [...elevens].sort((a, b) => b.song.rank - a.song.rank)[0]
      const doomedShown = doomed && doomed.song.rank > stats.songs.length / 2 ? doomed : null
      push(
        'elevens',
        'The super votes',
        <Frame kicker="Song stats" title="Where the 11s went" wide>
          <p className="present-lead note">
            Each ranker gets one 11 — the super vote. These three drew the most.
          </p>
          <div className="present-eleven-songs">
            {topElevens.map(({ song, who }) => (
              <div key={song.id} className="ele-song">
                <Thumb s={song} size="large" />
                <div className="present-song">{song.title}</div>
                <div className="note">
                  {song.artist} · #{song.rank}
                </div>
                <div className="ele-count">
                  <ScoreChip v={11} /> × {who.length}
                </div>
                <div className="ele-who">
                  {who.map((w) => (
                    <Person key={w} name={w} size={24} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {doomedShown && (
            <div className="present-nearmiss">
              <div className="present-h3">💀 The most doomed 11</div>
              <p className="present-remorse">
                <strong>{displayName(doomedShown.who)}</strong> spent their super vote on “
                {doomedShown.song.title}” — which finished <strong>#{doomedShown.song.rank}</strong> of{' '}
                {stats.songs.length}, on a {fmt(doomedShown.song.average)} average. Nobody backed a song the room
                wanted less.
              </p>
              <SongNote s={doomedShown.song} who={doomedShown.who} />
            </div>
          )}
        </Frame>,
      )
    }

    // — Carried & buried (Deep cuts) —
    // Ordered by the placings that one ballot was worth, not by the fraction of
    // a point behind them: `carriedSongs` ranks on the raw lift, but the slide
    // states "#52 → #42", so the biggest number on screen should be the reason
    // the song is on it. A 0.31-point lift worth two places was leading the
    // slide over a 0.09 worth ten. Lift only breaks ties now.
    const carried = carriedSongs(dataset)
      .filter((c) => c.song.year === year)
      .sort(
        (a, b) =>
          Math.abs(b.rankWithout - b.rankWith) - Math.abs(a.rankWithout - a.rankWith) ||
          Math.abs(b.lift) - Math.abs(a.lift),
      )
    // Prefer examples where the single voter actually moved the song's placing
    // (a lift that didn't change the rank reads as a non-event on screen), but
    // fall back to the biggest raw lift if none of them shifted a rank — with
    // every candidate at zero movement, the sort above is that lift order.
    const carriedUp = carried.find((c) => c.lift > 0 && c.rankWith < c.rankWithout) ?? carried.find((c) => c.lift > 0)
    const buried = carried.find((c) => c.lift < 0 && c.rankWith > c.rankWithout) ?? carried.find((c) => c.lift < 0)
    if (carriedUp || buried) {
      push(
        'carried',
        'Carried & buried',
        <Frame kicker="Deep cuts" title="Carried & buried" wide>
          <p className="present-lead note">The single voter whose score moved a song's average the most.</p>
          <div className="present-two">
            {carriedUp && (
              <div>
                <div className="present-h3">💪 Carried it</div>
                <div className="present-who">
                  <Person name={carriedUp.who} size={54} />
                </div>
                <Thumb s={carriedUp.song} size="large" />
                <div className="present-song">{carriedUp.song.title}</div>
                <div className="present-move up">
                  <ScoreChip v={carriedUp.withScore} />
                  <span className="tri">▲</span>
                  <span className="mv">
                    #{carriedUp.rankWithout} → #{carriedUp.rankWith}
                  </span>
                </div>
                <div className="note">their score lifted it {fmt(Math.abs(carriedUp.lift), 2)} of a point</div>
                <SongNote s={carriedUp.song} who={carriedUp.who} />
              </div>
            )}
            {buried && (
              <div>
                <div className="present-h3">🪦 Buried it</div>
                <div className="present-who">
                  <Person name={buried.who} size={54} />
                </div>
                <Thumb s={buried.song} size="large" />
                <div className="present-song">{buried.song.title}</div>
                <div className="present-move down">
                  <ScoreChip v={buried.withScore} />
                  <span className="tri">▼</span>
                  <span className="mv">
                    #{buried.rankWithout} → #{buried.rankWith}
                  </span>
                </div>
                <div className="note">their score cost it {fmt(Math.abs(buried.lift), 2)} of a point</div>
                <SongNote s={buried.song} who={buried.who} />
              </div>
            )}
          </div>
        </Frame>,
      )
    }

    // — The what-if podium —
    const impacts = tierImpacts(dataset, year).slice(0, 3)
    /**
     * A year can turn up a single podium-mover, which leaves the slide looking
     * thin. Widening to the top 10 finds the near-misses worth a footnote —
     * excluding anything already shown above so nothing appears twice.
     */
    const shown = new Set(impacts.flatMap((im) => im.changes.map((c) => `${im.participant}|${c.song.id}`)))
    const nearMisses =
      impacts.length === 1
        ? tierImpacts(dataset, year, 2, { top: 10, bottom: 0 })
            .flatMap((im) => im.changes.map((c) => ({ who: im.participant, c })))
            .filter((e) => !shown.has(`${e.who}|${e.c.song.id}`))
            .sort((a, b) => Math.abs(b.c.to - b.c.from) - Math.abs(a.c.to - a.c.from))
            // Four keeps the footnote to two tidy rows; more ran under the nav bar.
            .slice(0, 4)
        : []
    if (impacts.length) {
      push(
        'whatif',
        'Rewrite the podium',
        <Frame kicker="Deep cuts" title="Who could rewrite the podium" wide>
          <p className="present-lead note">If one person hadn't voted, the top or bottom 3 would have shuffled.</p>
          {/*
            Numbered the way the Lab numbers it (`lab-change`): the tier marker
            says which end of the board is at stake, the score is labelled as
            theirs, and only the destination rank is coloured.

            The slide used to print a bare "#4 → #7" under a ▲ that coloured
            both halves, which left three things ambiguous at once — whether the
            arrow was the song moving or the person pushing, which of the two
            numbers was the real finish, and whether green meant good for the
            song or good for the voter. The rank the song actually holds is now
            the plain one and the counterfactual is the coloured one, so the
            sentence reads "it finished #4; without them, #7".
          */}
          <div className="present-whatif">
            {impacts.map((im) => {
              const c = im.changes[0]
              return (
                <div key={im.participant} className="wi">
                  <div className="present-who">
                    <span className="wi-without">without</span>
                    <Person name={im.participant} size={44} />
                  </div>
                  <Thumb s={c.song} size="large" />
                  <div className="present-song">
                    <span className="wi-tier">{c.to <= 3 || c.from <= 3 ? '🏆' : '🥄'}</span> {c.song.title}
                  </div>
                  <div className="note">{c.song.artist}</div>
                  <div className="wi-score note">
                    their score: <ScoreChip v={c.score} />
                  </div>
                  <div className="present-move">
                    <span className="mv-from">#{c.from}</span>
                    <span className="tri">→</span>
                    <span className="mv" style={{ color: c.to < c.from ? 'var(--green)' : 'var(--vermillion)' }}>
                      #{c.to}
                    </span>
                  </div>
                  <div className="note">official finish · without them</div>
                  <SongNote s={c.song} who={im.participant} />
                </div>
              )
            })}
          </div>
          {nearMisses.length > 0 && (
            <div className="present-nearmiss">
              <div className="present-h3">Also shuffled the top 10</div>
              <div className="nm-rows">
                {nearMisses.map(({ who, c }) => (
                  <div className="nm-row" key={`${who}-${c.song.id}`}>
                    <span className="nm-who">{displayName(who)}</span>
                    <ScoreChip v={c.score} />
                    <span className="nm-song">{c.song.title}</span>
                    {/* Same numbering as the cards above: plain finish, coloured counterfactual. */}
                    <span className="nm-move">
                      #{c.from} →{' '}
                      <strong style={{ color: c.to < c.from ? 'var(--green)' : 'var(--vermillion)' }}>#{c.to}</strong>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Frame>,
      )
    }

    // — The most influential voter —
    //
    // Two crowns, because they answer different questions: one ballot can move
    // a single song a very long way (weight), another can nudge dozens (reach).
    // When the same person tops both they get one wider card rather than the
    // same face twice.
    const influence = voterInfluence(dataset, year)
    const byRanks = influence[0]
    const byBreadth = [...influence].sort((a, b) => b.songsMoved - a.songsMoved || b.totalRanks - a.totalRanks)[0]
    if (byRanks && byRanks.totalRanks > 0) {
      const sameFace = byBreadth.participant === byRanks.participant
      const avg = averageInfluence(influence)
      const crowns = sameFace ? [byRanks] : [byRanks, byBreadth]
      push(
        'influence',
        'Most influential voter',
        <Frame kicker="Deep cuts" title="The most influential voter" wide>
          <p className="present-lead note">
            Every rank their ballot was worth: pull them out of {year} and this is how far the board slides.
          </p>
          <div className="present-influence">
            <div className="inf-crowns">
              {crowns.map((v) => (
                <div className="inf-crown" key={v.participant}>
                  <div className="present-h3">
                    {sameFace ? '👑 Most ranks and most songs moved' : v === byRanks ? '👑 Most ranks moved' : '🎯 Most songs moved'}
                  </div>
                  <div className="present-who">
                    <Person name={v.participant} size={54} />
                  </div>
                  <div className="inf-figures">
                    {/* Each figure carries its own multiple of the room's
                        average — the number alone says nothing about whether
                        it's a lot until you know what normal looks like. */}
                    <div className="inf-fig">
                      <div className="inf-big">{v.totalRanks}</div>
                      <div className="note">ranks moved</div>
                      <div className="note">{times(v.totalRanks, avg.totalRanks)}</div>
                    </div>
                    <div className="inf-fig">
                      <div className="inf-big">{v.songsMoved}</div>
                      <div className="note">songs moved</div>
                      <div className="note">{times(v.songsMoved, avg.songsMoved)}</div>
                    </div>
                    <div className="inf-fig">
                      <div className="inf-big">{fmt(v.perVote, 2)}</div>
                      <div className="note">ranks per vote</div>
                      <div className="note">{times(v.perVote, avg.perVote)}</div>
                    </div>
                  </div>
                  {v.top && (
                    <div className="inf-top">
                      <Thumb s={v.top.song} size="large" />
                      <div>
                        <div className="note">Their biggest mover</div>
                        <div className="present-song">{v.top.song.title}</div>
                        <div className="note">{v.top.song.artist}</div>
                        {/* Framed as what their vote did, so the arrow points the
                            way the song moved *because of* them: the finish on
                            the right is the one their ballot produced. */}
                        <div className={`present-move ${v.top.to > v.top.from ? 'up' : 'down'}`}>
                          <ScoreChip v={v.top.score} />
                          <span className="tri">{v.top.to > v.top.from ? '▲' : '▼'}</span>
                          <span className="mv">
                            #{v.top.to} → #{v.top.from}
                          </span>
                        </div>
                        <div className="note">
                          without them → with them, {plural(v.top.shift, 'rank')}
                        </div>
                        <SongNote s={v.top.song} who={v.participant} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="present-webstats inf-average">
              <div className="present-h3">The average ranker</div>
              <div>
                <div className="ss-val">{fmt(avg.totalRanks, 1)}</div>
                <div className="note">ranks moved</div>
              </div>
              <div>
                <div className="ss-val">{fmt(avg.songsMoved, 1)}</div>
                <div className="note">songs moved</div>
              </div>
              <div>
                <div className="ss-val">{fmt(avg.perVote, 2)}</div>
                <div className="note">ranks per vote</div>
              </div>
              <p className="note">
                Across all {plural(influence.length, 'ranker')} in {year}.
              </p>
            </div>
          </div>
        </Frame>,
      )
    }

    // — Branch breakdown —
    const branches = branchStats(dataset)
      .map((b) => {
        const ty = b.byYear.find((y) => y.year === year)
        // `b.avg` spans every year, so the delta says whether this year treated
        // the branch better or worse than the room usually does.
        return ty && ty.n > 0 ? { branch: b.branch, value: ty.value, n: ty.n, allTime: b.avg } : null
      })
      .filter((b): b is { branch: Branch; value: number; n: number; allTime: number } => b !== null)
      .sort((a, b) => b.value - a.value)
    if (branches.length >= 2) {
      const maxAvg = Math.max(...branches.map((b) => b.value))
      // The hashed category palette put three branches on near-identical greens;
      // the fixed year palette is chosen to be distinguishable.
      const branchColor = (b: Branch) => `var(--year-${BRANCHES.indexOf(b) % 6})`
      push(
        'branches',
        `By ${SITE.group.singular}`,
        <Frame kicker="Deep cuts" title={`How the ${SITE.group.plural} scored`} wide>
          <div className="present-branchsplit">
            <div>
              <PieChart
                slices={branches.map((b) => ({
                  label: BRANCH_LABELS[b.branch],
                  value: b.n,
                  color: branchColor(b.branch),
                }))}
                size={240}
              />
              <p className="note">
                Share of {year}&apos;s songs. A collab counts for every {SITE.group.singular} on the track, so these total more than{' '}
                {stats.songs.length}.
              </p>
            </div>
            <div className="present-branchrows">
              {branches.map((b) => (
                <div className="br-row" key={b.branch}>
                  <span className="br-name">
                    <span className="br-swatch" style={{ background: branchColor(b.branch) }} />
                    {BRANCH_LABELS[b.branch]}
                  </span>
                  <span className="br-track">
                    <span
                      className="br-fill"
                      style={{
                        width: `${(b.value / (maxAvg * 1.02)) * 100}%`,
                        background: branchColor(b.branch),
                      }}
                    />
                  </span>
                  <span className="br-avg">{fmt(b.value)}</span>
                  <span className="br-delta" style={{ color: b.value >= b.allTime ? 'var(--green)' : 'var(--vermillion)' }}>
                    {b.value >= b.allTime ? '▲' : '▼'} {fmt(Math.abs(b.value - b.allTime))}
                  </span>
                  <span className="note br-vs">
                    {plural(b.n, 'song')} · vs {fmt(b.allTime)} all-time
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="note">
            Average score by {SITE.group.qualified} this year, against how that {SITE.group.singular} scores across every
            year.
          </p>
        </Frame>,
      )
    }

    // — How this year compares —
    const means = yearMeans(dataset)
    const thisMean = means.find((m) => m.year === year)
    if (means.length >= 2 && thisMean) {
      const kinder = means.filter((m) => m.mean > thisMean.mean).length
      const rankNote =
        kinder === 0
          ? 'the kindest year on record'
          : kinder === means.length - 1
            ? 'the toughest crowd on record'
            : `${kinder} year${kinder === 1 ? ' was' : 's were'} kinder`
      // Tens per year are counted per score cast, so a bigger field inflates the
      // raw count; the share of scores is shown alongside to keep it comparable.
      const perYear = dataset.years.map((y) => {
        const ys = allScores(y.songs)
        const tens = ys.filter((v) => v === 10).length
        return {
          year: y.year,
          mean: means.find((m) => m.year === y.year)!.mean,
          spread: means.find((m) => m.year === y.year)!.spread,
          tens,
          tenRate: ys.length ? tens / ys.length : 0,
        }
      })
      push(
        'compare',
        'Against other years',
        <Frame kicker="Song stats" title="How does it compare to previous years?" wide>
          <div className="present-two">
            <div>
              <TrendLine series={means.map((m) => ({ year: m.year, value: m.mean }))} height={200} format={(v) => fmt(v)} />
              <p className="note">
                {year} averaged {fmt(thisMean.mean)} across every song — {rankNote}.
              </p>
            </div>
            <div>
              <table className="present-table compare">
                <thead>
                  <tr>
                    <th />
                    <th className="num">Avg</th>
                    <th className="num">σ</th>
                    <th className="num">10s</th>
                  </tr>
                </thead>
                <tbody>
                  {perYear.map((p) => (
                    <tr key={p.year} className={p.year === year ? 'on' : undefined}>
                      <td>{p.year}</td>
                      <td className="num">{fmt(p.mean)}</td>
                      <td className="num">{fmt(p.spread)}</td>
                      <td className="num">
                        {p.tens} <span className="note">{pct(p.tenRate, 1)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="present-cumulative">
            <div className="present-h3">Where this year's podium sits all-time</div>
            <div className="pc-row">
              {songs.slice(0, 3).map((s) => (
                <div className="pc" key={s.id}>
                  <Thumb s={s} />
                  <div>
                    <div className="pc-title">{s.title}</div>
                    <div className="pc-move">
                      #{s.rank} <span className="pc-arrow">→</span> #{s.overallRank}
                      <span className="pc-suffix">all-time</span>
                    </div>
                    <div className="note">of {dataset.allTime.songs.length} songs ever ranked</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Frame>,
      )
    }

    // — Finale: the viewer's own card, shareable —
    if (myRecap) {
      push(
        'finale',
        'Your year',
        <Frame kicker="And finally" title="Your year">
          <p className="present-lead note">Your own {year} in the party rank — download it and post it.</p>
          <RecapShareCard r={myRecap} downloadable maxWidth={360} />
        </Frame>,
      )
    } else {
      push(
        'finale',
        "That's a wrap",
        <Frame kicker="That's a wrap" title={`The ${year} Edition`}>
          <p className="present-lead">Thanks for ranking.</p>
          <Thumb s={songs[0]} size="large" />
          <p className="note">
            Winner: {songs[0].title} — {fmt(songs[0].average)}
          </p>
        </Frame>,
      )
    }

    return out
  }, [year, stats, myRecap])

  /** Step the deck, clamped at both ends. Shared by keys, buttons and swipes. */
  const go = (d: number) => {
    setOverview(false)
    setI((x) => Math.min(slides.length - 1, Math.max(0, x + d)))
  }

  /*
   * Swipe navigation.
   *
   * The deck is watched on a phone at least as often as it is projected, and
   * there it had no gesture at all — the only way forward was a 32px arrow in
   * the floating bar, and the title slide told you to press keys the device
   * doesn't have. Horizontal flicks now page it.
   */
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null)

  // Keyboard navigation.
  useEffect(() => {
    if (!slides.length) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault()
        go(1)
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        go(-1)
      } else if (e.key === 'Home') {
        setI(0)
      } else if (e.key === 'End') {
        setI(slides.length - 1)
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen()
      } else if (e.key === 'Escape') {
        if (document.fullscreenElement) document.exitFullscreen?.()
        else if (overview) setOverview(false)
        else exit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length, overview, year])

  if (!stats) {
    return (
      <div className="present">
        <div className="present-slide">
          <Frame kicker={SITE_NAME} title="No such year">
            <p className="note">There's no {raw} edition to present.</p>
            <button className="showmore" onClick={() => navigate('/')}>
              ← Front page
            </button>
          </Frame>
        </div>
      </div>
    )
  }

  const idx = Math.min(i, slides.length - 1)

  return (
    <div
      className="present"
      onPointerDown={(e) => {
        // A mouse drag across a slide is text selection, not a swipe. The taste
        // web claims its own pointer stream to spin, and the overview is a
        // list to scroll — neither should page the deck out from under itself.
        const el = e.target as Element
        if (e.pointerType === 'mouse' || el.closest?.('.chart.web, .present-overview')) {
          swipe.current = null
          return
        }
        swipe.current = { x: e.clientX, y: e.clientY, t: Date.now() }
      }}
      onPointerUp={(e) => {
        const s = swipe.current
        swipe.current = null
        if (!s) return
        const dx = e.clientX - s.x
        const dy = e.clientY - s.y
        // Deliberately horizontal, far enough not to be a tap, and quick enough
        // to be a flick rather than a slow vertical scroll that drifted sideways.
        if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - s.t > 700) return
        go(dx < 0 ? 1 : -1)
      }}
      onPointerCancel={() => (swipe.current = null)}
    >
      <div key={idx} className="present-slide">
        {slides[idx]?.el}
      </div>

      {overview && (
        <div className="present-overview" onClick={() => setOverview(false)}>
          <div className="present-overview-grid" onClick={(e) => e.stopPropagation()}>
            {slides.map((s, n) => (
              <button key={s.key} className={n === idx ? 'on' : ''} onClick={() => { setI(n); setOverview(false) }}>
                <span className="num">{n + 1}</span> {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="present-nav">
        <button onClick={exit} title="Exit (Esc)" aria-label="Exit">✕</button>
        <button onClick={() => setOverview((o) => !o)} title="Overview" aria-label="Overview">☰</button>
        <button onClick={() => go(-1)} disabled={idx === 0} aria-label="Previous">←</button>
        <span className="present-count">
          {idx + 1} / {slides.length}
        </span>
        <button onClick={() => go(1)} disabled={idx === slides.length - 1} aria-label="Next">→</button>
        <button onClick={toggleFullscreen} title="Fullscreen (F)" aria-label="Fullscreen">⛶</button>
      </div>

      <div className="present-progress">
        <div style={{ width: `${((idx + 1) / slides.length) * 100}%` }} />
      </div>
    </div>
  )
}
