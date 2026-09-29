import { useRef, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { dataset } from '../lib/data'
import { buildRecap, kindnessPhrase, ordinal, type RecapScope } from '../lib/recap'
import { fmt, pct } from '../lib/format'
import { displayName } from '../lib/names'
import { ArtistLink, Name, ScoreChip, SongTitle, Thumb, VertHistogram } from '../components/bits'
import { RecapShareCard } from '../components/RecapShareCard'
import { useIdentity } from '../components/identity'
import { DotStrip } from '../components/charts'

function Card({ kicker, image, children, note }: { kicker: string; image?: ReactNode; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="recap-card">
      <div className="kicker">{kicker}</div>
      {image && <div className="img">{image}</div>}
      <div className="statement">{children}</div>
      {note && <div className="note">{note}</div>}
    </section>
  )
}

export default function Recap() {
  const params = useParams()
  const navigate = useNavigate()
  const railRef = useRef<HTMLDivElement>(null)
  const { years } = dataset

  const scope: RecapScope = params.scope === 'all' || params.scope === undefined ? 'all' : Number(params.scope)
  const cohort = scope === 'all' ? dataset.allTime.participants : (dataset.perYear[scope as number]?.participants ?? [])

  // The recap is yours by default. An explicit /recap/:scope/:name still
  // renders anyone's, so links pasted in Discord keep working — we just don't
  // offer a picker for browsing other people's.
  const { me, isMe } = useIdentity()
  const requested = params.name?.toLowerCase()
  const mine = me?.participant && cohort.includes(me.participant) ? me.participant : null
  const name = requested && cohort.includes(requested) ? requested : mine
  const r = name ? buildRecap(dataset, scope, name) : null
  // Only your own card is downloadable. Note this is a convention among an
  // already-authenticated guild, not an enforcement boundary: the same SVG is
  // in the DOM for any recap you can open, and screenshots exist.
  const ownRecap = name !== null && isMe(name)
  const kind = r ? kindnessPhrase(r) : null

  const scroll = (dir: 1 | -1) => {
    const rail = railRef.current
    if (rail) rail.scrollBy({ left: dir * ((rail.querySelector('.recap-card')?.clientWidth ?? 380) + 16), behavior: 'smooth' })
  }

  // click-and-drag scrolling on the rail; a real drag swallows the click
  const dragState = useRef<{ x: number; sl: number; moved: boolean } | null>(null)
  const railHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      const rail = railRef.current
      // touch/pen use native horizontal scrolling (touch-action: pan-x); only
      // the mouse gets click-and-drag, so we don't fight the browser on phones
      if (!rail || e.pointerType !== 'mouse') return
      dragState.current = { x: e.clientX, sl: rail.scrollLeft, moved: false }
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragState.current
      const rail = railRef.current
      if (!d || !rail) return
      const dx = e.clientX - d.x
      if (!d.moved && Math.abs(dx) > 6) {
        d.moved = true
        // capture only once it's a real drag — capturing on pointer-down would
        // retarget the click at the rail and swallow every link in the cards
        rail.setPointerCapture?.(e.pointerId)
      }
      if (d.moved) rail.scrollLeft = d.sl - dx
    },
    onPointerUp: () => {
      const d = dragState.current
      if (d?.moved) {
        // let onClickCapture swallow the click this drag produced, then clear
        window.setTimeout(() => {
          if (dragState.current === d) dragState.current = null
        }, 0)
      } else {
        dragState.current = null
      }
    },
    onPointerCancel: () => (dragState.current = null),
    onClickCapture: (e: React.MouseEvent) => {
      if (dragState.current?.moved) {
        e.preventDefault()
        e.stopPropagation()
      }
      dragState.current = null
    },
  }

  const goto = (s: RecapScope, n: string | null) =>
    navigate(n ? `/recap/${s}/${encodeURIComponent(n)}` : `/recap${s === 'all' ? '' : `/${s}`}`)

  return (
    <>
      <h1>The Recap</h1>
      <p className="subtitle">
        {ownRecap
          ? 'Your career (or a single year) in the party rank. Swipe through, download the card.'
          : 'A career (or a single year) in the party rank, one ranker at a time.'}
      </p>

      <div className="controls">
        <div className="seg">
          <button className={scope === 'all' ? 'on' : ''} onClick={() => goto('all', name)}>
            All-time
          </button>
          {years.map((y) => (
            <button
              key={y.year}
              className={scope === y.year ? 'on' : ''}
              onClick={() => goto(y.year, name && dataset.perYear[y.year].participants.includes(name) ? name : null)}
            >
              {y.year}
            </button>
          ))}
        </div>
        {name && !ownRecap && mine && (
          <button className="showmore" style={{ margin: 0 }} onClick={() => goto(scope, mine)}>
            ← Back to my recap
          </button>
        )}
      </div>

      {!r || !kind ? (
        <p className="note">
          {me?.participant
            ? `You didn't take part in ${scope === 'all' ? 'the party rank' : scope} — nothing to recap. Try another year.`
            : 'No ranker matched your Discord account. Open any profile from the participants page.'}
        </p>
      ) : (
        <>
          <div className="recap-nav">
            <button onClick={() => scroll(-1)}>←</button>
            <span className="note" style={{ margin: 0 }}>
              {displayName(r.name)} · {r.scope === 'all' ? `all-time (${r.years.join(' · ')})` : r.scope} — swipe or use the
              arrows
            </span>
            <button onClick={() => scroll(1)}>→</button>
          </div>
          <div className="recap-rail" ref={railRef} {...railHandlers}>
            <Card
              kicker="the opening"
              note={
                <>
                  <ScoreChip v={10} /> ×{r.tens} {r.tens === 1 ? 'ten' : 'tens'} handed out · <ScoreChip v={1} /> ×{r.ones}{' '}
                  rock-bottom {r.ones === 1 ? 'one' : 'ones'}. Their whole range, below.
                </>
              }
            >
              <em>{r.songsScored}</em> songs scored
              {r.scope === 'all' ? (
                <>
                  {' '}across <em>{r.years.length}</em> {r.years.length === 1 ? 'year' : 'years'}
                </>
              ) : (
                ''
              )}
              .
              <div style={{ marginTop: 12 }}>
                <VertHistogram values={r.scores} height={190} />
              </div>
            </Card>

            <Card
              kicker="generosity"
              note={`The room's songs averaged ${fmt(r.roomAvg)}. ${r.reds ? `${r.reds}× the harshest voice on a song.` : 'Never once the harshest voice.'}`}
            >
              Average given: <em>{fmt(r.avgGiven)}</em> — {kind.word} than <em>{kind.pct}%</em> of the room.
              {r.cohortAvgs.length > 2 && (
                <div style={{ marginTop: 14 }}>
                  {(() => {
                    const avgs = r.cohortAvgs.map((c) => c.avg)
                    const lo = Math.min(...avgs)
                    const hi = Math.max(...avgs)
                    const span = hi - lo || 1
                    // self drawn last so the big dot sits on top of the crowd
                    const dots = [...r.cohortAvgs]
                      .sort((a, b) => (a.name === r.name ? 1 : b.name === r.name ? -1 : 0))
                      .map((c) => ({
                        at: (c.avg - lo) / span,
                        label: `${displayName(c.name)} — ${fmt(c.avg)}`,
                        color: c.name === r.name ? 'var(--vermillion)' : undefined,
                        big: c.name === r.name,
                      }))
                    return <DotStrip dots={dots} />
                  })()}
                  <div className="note" style={{ marginTop: 0, fontSize: 12 }}>
                    harshest grader ← every ranker → kindest
                  </div>
                </div>
              )}
            </Card>

            {r.elevens.length ? (
              <Card
                kicker={r.elevens.length > 1 ? `the super votes (${r.elevens.length})` : 'the super vote'}
                image={<Thumb s={r.elevens[0]} size="large" />}
                note="One 11 per year — spent here."
              >
                <div className="recap-list">
                  {r.elevens.map((s) => (
                    <div key={`${s.year}-${s.id}`}>
                      <em>“<SongTitle s={s} />”</em>
                      <span className="note" style={{ marginLeft: 8 }}>
                        {s.year} · finished {ordinal(s.rank)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            ) : (
              <Card kicker="the super vote" note="Saving it for a song that deserves it, no doubt.">
                Never spent the <em>11</em>.
              </Card>
            )}

            {r.hotTake && (
              <Card
                kicker="the hot take"
                image={<Thumb s={r.hotTake.song} size="large" />}
                note={
                  <>
                    <ScoreChip v={r.hotTake.score} /> against a {fmt(r.hotTake.song.average)} consensus — a{' '}
                    {fmt(Math.abs(r.hotTake.dev), 1)}-point stand.
                  </>
                }
              >
                On <em>“<SongTitle s={r.hotTake.song} />”</em>, {r.hotTake.dev > 0 ? 'nobody believed like they did' : 'they stood alone against the room'}.
                {r.hotTake.song.comments?.[r.name] && (
                  <p className="voice-quote" style={{ marginTop: 8 }}>
                    {r.hotTake.song.comments[r.name]}
                  </p>
                )}
              </Card>
            )}

            {r.scopeHasComments && r.notes.length > 0 && (
              <Card
                kicker="in their own words"
                note={`${r.notes.length} note${r.notes.length === 1 ? '' : 's'} left while ranking — ${pct(r.commentRate)} of what they scored.`}
              >
                {r.notes.slice(0, 3).map((n) => (
                  <div key={`${n.song.year}-${n.song.id}`} style={{ marginBottom: 10 }}>
                    <p className="voice-quote" style={{ marginBottom: 2 }}>
                      {n.text}
                    </p>
                    <span className="note">
                      <ScoreChip v={n.score} /> on <em><SongTitle s={n.song} /></em>
                    </span>
                  </div>
                ))}
              </Card>
            )}

            {r.twins.length > 0 && (
              <Card
                kicker="kindred spirits"
                note={
                  r.nemesis ? (
                    <>
                      And the nemesis: <Name n={r.nemesis.other} /> ({fmt(r.nemesis.corr, 2)}).{' '}
                      <Link to={`/compare?a=${encodeURIComponent(r.name)}&b=${encodeURIComponent(r.nemesis.other)}`}>
                        See the feud →
                      </Link>
                    </>
                  ) : undefined
                }
              >
                <div className="recap-list">
                  {r.twins.map((t, i) => (
                    <div key={t.other} className={i === 0 ? '' : 'minor'}>
                      {i === 0 ? (
                        <>
                          Taste twin: <em><Name n={t.other} /></em> ({fmt(t.corr, 2)})
                        </>
                      ) : (
                        <>
                          {i + 1}. <Name n={t.other} /> <span className="note">({fmt(t.corr, 2)})</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {r.topArtists.length > 0 && (
              <Card
                kicker={r.scope === 'all' ? 'artist of all time' : 'artist of the year'}
                image={
                  r.topArtistFav ? (
                    <Thumb s={r.topArtistFav} size="large" />
                  ) : dataset.allTime.artists[r.topArtists[0].artist] ? (
                    <Thumb s={dataset.allTime.artists[r.topArtists[0].artist].best} size="large" />
                  ) : undefined
                }
                note={
                  // A single year counts artists with only one song, so "1 songs"
                  // is now a common case rather than an unreachable one.
                  r.topArtists[0].n === 1
                    ? `#1 by their own scores: one song, scored ${fmt(r.topArtists[0].avg)}.`
                    : `#1 by their own scores: ${r.topArtists[0].n} songs, a ${fmt(r.topArtists[0].avg)} average.`
                }
              >
                <div className="recap-list">
                  <div>
                    <em><ArtistLink a={r.topArtists[0].artist} /></em>, above everyone.
                  </div>
                  {r.topArtists.slice(1).map((a, i) => (
                    <div key={a.artist} className="minor">
                      {i + 2}. <ArtistLink a={a.artist} /> <span className="note">({fmt(a.avg)} over {a.n})</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {r.noms && (
              <Card
                kicker="the nominations"
                image={<Thumb s={r.noms.best.song} size="large" />}
                note={
                  <>
                    Best pick: “{r.noms.best.song.title}” — #{r.noms.best.song.rank} of {r.noms.best.fieldSize} (
                    {r.noms.best.song.year}).
                    {r.noms.favArtist && <> Favorite well to draw from: {r.noms.favArtist.artist} ({r.noms.favArtist.n} picks).</>}
                  </>
                }
              >
                <em>{r.noms.count}</em> nomination{r.noms.count === 1 ? '' : 's'}, finishing in the top{' '}
                <em>{pct(r.noms.avgPercentile)}</em> of the field on average
                {r.noms.top10Count > 0 ? (
                  <>
                    {' '}
                    — <em>{r.noms.top10Count}</em> made a top 10.
                  </>
                ) : (
                  '.'
                )}
              </Card>
            )}

            {r.awardFinishes.length > 0 && (
              <Card kicker="the trophy shelf">
                {r.awardFinishes.slice(0, 4).map((f) => (
                  <div key={f.award.key + (f.year ?? '')} style={{ fontSize: '0.85em' }}>
                    {f.award.emoji} {f.place === 1 ? <em>👑 {f.award.title}</em> : `${ordinal(f.place)} — ${f.award.title}`}
                    {f.year ? <span className="note" style={{ marginLeft: 6 }}>{f.year}</span> : ''}
                  </div>
                ))}
              </Card>
            )}

            <Card kicker="the closing line">{r.closing}</Card>
          </div>

          <h2>The card</h2>
          <p className="note">
            {ownRecap
              ? 'A vector summary you can download.'
              : `A vector summary of ${displayName(r.name)}’s year. Only they can download their own card.`}
          </p>
          <div className="two-col" style={{ alignItems: 'start' }}>
            <RecapShareCard r={r} downloadable={ownRecap} />
            <p className="note">
              1080×1350, Discord-ready. Full profile: <Name n={r.name} />.
            </p>
          </div>
        </>
      )}
    </>
  )
}
