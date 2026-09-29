import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { INAUGURAL_YEAR, IS_DEMO, SITE, storageKey } from './lib/site'
import { dataset as fullDataset } from './lib/data'
import { QuickSearch } from './components/bits'
import { Avatar, useIdentity, useScopePref, useScopedDataset } from './components/identity'
import { displayName } from './lib/names'
import Overview from './pages/Overview'
import Songs from './pages/Songs'
import Artists from './pages/Artists'
import Participants from './pages/Participants'
import Profile from './pages/Profile'
import Awards from './pages/Awards'
import Taste from './pages/Taste'
import Nominations from './pages/Nominations'
import Year from './pages/Year'
import Artist from './pages/Artist'
import Compare from './pages/Compare'
import Lab from './pages/Lab'
import Recap from './pages/Recap'
import SongPage from './pages/SongPage'
import Present from './pages/Present'
import Credits from './pages/Credits'

const TABS = [
  { to: '/', label: 'Front Page', end: true },
  { to: '/songs', label: 'Songs' },
  { to: '/artists', label: 'Artists' },
  { to: '/participants', label: 'Participants' },
  { to: '/compare', label: 'Head to Head' },
  { to: '/awards', label: 'Awards' },
  { to: '/taste', label: 'Taste' },
  { to: '/nominations', label: 'Nominations' },
  { to: '/lab', label: 'The Lab' },
  { to: '/recap', label: 'Recap' },
]

/**
 * Who you're signed in as. Mostly this is quiet, but it's the only place that
 * can explain why personalization is doing nothing for someone whose Discord
 * account isn't in data/identities.json — otherwise the site just silently
 * behaves as though they never ranked.
 */
function IdentityChip() {
  const { status, me } = useIdentity()
  if (IS_DEMO) return <PersonaPicker />
  // No auth service (local dev, or it's down) — say nothing rather than
  // implying the viewer is logged out of something.
  if (status !== 'authed' || !me) return null
  return (
    <div className="identity-chip">
      {me.participant ? (
        <>
          <Avatar participant={me.participant} size={18} />
          <Link to={`/participant/${encodeURIComponent(me.participant)}`}>{displayName(me.participant)}</Link>
        </>
      ) : (
        <span title="Ask an organizer to link your Discord account in data/identities.json">
          {me.username} · not linked to a ranker
        </span>
      )}
      <a href="/auth/logout">log out</a>
    </div>
  )
}

/**
 * The demo's stand-in for a login: pick any ranker and the personalized views
 * (My editions, Head to Head's side A, the Recap) follow. Sorted by display
 * name so it reads like the participants page.
 */
function PersonaPicker() {
  const { me, switchPersona } = useIdentity()
  const everyone = useMemo(
    () => [...fullDataset.allTime.participants].sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [],
  )
  return (
    <div className="identity-chip persona-picker">
      {me?.participant && <Avatar participant={me.participant} size={18} />}
      <label>
        <span className="note">viewing as</span>{' '}
        <select value={me?.participant ?? ''} onChange={(e) => switchPersona(e.target.value)}>
          {everyone.map((p) => (
            <option key={p} value={p}>
              {displayName(p)}
            </option>
          ))}
        </select>
      </label>
      {me?.participant && <Link to={`/participant/${encodeURIComponent(me.participant)}`}>profile</Link>}
    </div>
  )
}

/**
 * Switches year-scoped views between the viewer's own editions and all of them.
 * Renders nothing when it wouldn't do anything — a viewer we can't match to a
 * ranker, or one who took part in every year — so it never appears as a control
 * that does nothing when clicked.
 */
function EditionToggle() {
  const { scopeMine, setScopeMine, canScope, myYears } = useScopePref()
  if (!canScope) return null
  return (
    <div className="seg edition-toggle">
      <button
        className={scopeMine ? 'on' : ''}
        onClick={() => setScopeMine(true)}
        title={`Only ${myYears.join(', ')}`}
      >
        My editions
      </button>
      <button className={!scopeMine ? 'on' : ''} onClick={() => setScopeMine(false)}>
        All editions
      </button>
    </div>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'light')
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    localStorage.setItem(storageKey('theme'), next)
    setTheme(next)
  }
  return (
    <button className="theme-toggle" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  )
}

export default function App() {
  // The nav's Years menu and the quick search follow the edition preference, so
  // "my editions" doesn't leave years you were never in sitting in the chrome.
  const dataset = useScopedDataset()
  const firstYear = dataset.years[0]?.year
  const location = useLocation()
  const isPresenting = location.pathname.startsWith('/present')
  const [menuOpen, setMenuOpen] = useState(false)
  const [yearsOpen, setYearsOpen] = useState(false)
  const navRef = useRef<HTMLDivElement>(null)
  const yearsTimer = useRef<number | null>(null)

  // Pointer devices open the Years menu on hover; touch and the stacked mobile
  // menu keep click-to-open, where hover events are unreliable or absent.
  const canHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches
  const cancelYearsClose = () => {
    if (yearsTimer.current !== null) {
      clearTimeout(yearsTimer.current)
      yearsTimer.current = null
    }
  }
  const hoverOpenYears = () => {
    if (!canHover()) return
    cancelYearsClose()
    setYearsOpen(true)
  }
  const hoverCloseYears = () => {
    if (!canHover()) return
    // brief grace period so a fast diagonal move button → panel doesn't drop it
    cancelYearsClose()
    yearsTimer.current = window.setTimeout(() => setYearsOpen(false), 120)
  }
  useEffect(() => cancelYearsClose, [])

  // route changes close both menus and start the new page from the top —
  // without this the browser keeps the old scroll position, so following a
  // link could land you mid-page.
  useEffect(() => {
    cancelYearsClose()
    setMenuOpen(false)
    setYearsOpen(false)
    window.scrollTo(0, 0)
  }, [location.pathname])

  // outside click / Escape closes the open menus
  useEffect(() => {
    if (!menuOpen && !yearsOpen) return
    const onDown = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setYearsOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        setYearsOpen(false)
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen, yearsOpen])

  // The presentation is its own full-viewport overlay; render it bare, without
  // the site header or the .page column, so it can go edge to edge.
  if (isPresenting) {
    return (
      <Routes>
        <Route path="/present/:year" element={<Present />} />
      </Routes>
    )
  }

  return (
    <>
      <header className="app-nav">
        <div className="brand">
          <Link to="/" className="brand-link">
            {SITE.brand[0]} <span>{SITE.brand[1]}</span>
          </Link>
        </div>
        <ThemeToggle />
        <div className="tagline">
          {SITE.subject}, ranked annually by {dataset.allTime.participants.length} friends ·{' '}
          {SITE.organizer && <>organized by {SITE.organizer} · </>}est. {INAUGURAL_YEAR}
          {IS_DEMO && (
            <>
              {' '}
              · a demo with stand-in names · <Link to="/credits">photo credits</Link>
            </>
          )}
        </div>
        <div className="nav-wrap" ref={navRef}>
          <button
            className="nav-toggle"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            ☰ Menu
          </button>
          <nav className={`tabs${menuOpen ? ' open' : ''}`}>
            {TABS.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) => `tab${isActive ? ' active' : ''}`}
                onClick={() => setMenuOpen(false)}
              >
                {t.label}
              </NavLink>
            ))}
            <div
              className={`year-menu${location.pathname.startsWith('/year/') ? ' active' : ''}`}
              onMouseEnter={hoverOpenYears}
              onMouseLeave={hoverCloseYears}
            >
              <button
                className="year-menu-btn"
                aria-expanded={yearsOpen}
                onClick={() => {
                  cancelYearsClose()
                  setYearsOpen((o) => !o)
                }}
              >
                Years ▾
              </button>
              {yearsOpen && (
                <div className="year-drop">
                  {dataset.years.map((y) => (
                    <NavLink
                      key={y.year}
                      to={`/year/${y.year}`}
                      className={({ isActive }) => (isActive ? 'active' : '')}
                      onClick={() => {
                        cancelYearsClose()
                        setYearsOpen(false)
                        setMenuOpen(false)
                      }}
                    >
                      {y.year}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          </nav>
        </div>
        <EditionToggle />
        <IdentityChip />
        <QuickSearch
          songs={dataset.allTime.songs}
          artists={Object.keys(dataset.allTime.artists)}
          participants={dataset.allTime.participants}
        />
      </header>
      <main className="page">
        {/* keyed by pathname so route changes get a gentle fade-in (not query changes) */}
        <div key={location.pathname} className="route-fade">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/songs" element={<Songs />} />
          <Route path="/artists" element={<Artists />} />
          <Route path="/participants" element={<Participants />} />
          <Route path="/participant/:name" element={<Profile />} />
          <Route path="/awards" element={<Awards />} />
          <Route path="/taste" element={<Taste />} />
          <Route path="/nominations" element={<Nominations />} />
          <Route path="/year/:year" element={<Year />} />
          <Route path="/artist/:name" element={<Artist />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/lab" element={<Lab />} />
          <Route path="/song/:year/:id" element={<SongPage />} />
          {IS_DEMO && <Route path="/credits" element={<Credits />} />}
          <Route path="/recap" element={<Recap />} />
          <Route path="/recap/:scope" element={<Recap />} />
          <Route path="/recap/:scope/:name" element={<Recap />} />
        </Routes>
        </div>
      </main>
    </>
  )
}
