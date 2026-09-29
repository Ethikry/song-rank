/**
 * React surface over the identity/preference layer.
 *
 * The provider takes its initial value from a fetch that has already settled
 * before React mounted (see main.tsx), so every consumer gets a fully-resolved
 * identity on its very first render — there is no loading branch, and no page
 * needs to reserve space for something that arrives later.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { dataset } from '../lib/data'
import { devAvatar } from '../lib/devAvatar'
import { displayName, monogram } from '../lib/names'
import { subsetOfCached } from '../lib/subset'
import { readPrefs, writePrefs } from '../lib/prefs'
import { IS_DEMO, SITE_NAME } from '../lib/site'
import { demoIdentity } from '../lib/identity'
import type { Identity, IdentityState } from '../lib/identity'
import type { Dataset } from '../lib/types'

interface IdentityValue {
  status: IdentityState['status']
  /** Demo only: view the site as another ranker. A no-op on the real site. */
  switchPersona: (participant: string) => void
  me: Identity | null
  /** True when `key` is the viewer's own participant. False when unmapped. */
  isMe: (key: string) => boolean
  /** Years the viewer took part in. Empty when they never ranked. */
  myYears: number[]
  /** Same-origin avatar URL for a participant, if they've ever logged in. */
  avatarFor: (key: string) => string | undefined
  /**
   * The edition preference lives here rather than in each consumer's own
   * useState: the header toggle and the pages reading the scoped dataset are
   * different components, and with per-component state, flipping the toggle
   * updated only the toggle.
   */
  scopeMine: boolean
  setScopeMine: (v: boolean) => void
}

const Ctx = createContext<IdentityValue | null>(null)

export function IdentityProvider({
  initial,
  children,
}: {
  initial: IdentityState
  children: ReactNode
}) {
  const [scopeMine, setScopeMineState] = useState(() => readPrefs().scopeMine)
  const setScopeMine = useCallback((v: boolean) => {
    writePrefs({ scopeMine: v })
    setScopeMineState(v)
  }, [])

  // Only the demo's persona picker ever replaces this; the real site's identity
  // is fixed for the page's lifetime (logging in or out is a navigation).
  const [state, setState] = useState(initial)
  const switchPersona = useCallback((participant: string) => {
    if (IS_DEMO) setState(demoIdentity(participant))
  }, [])

  const value = useMemo<IdentityValue>(() => {
    const me = state.me

    // A Discord member who has never appeared in a sheet resolves to a
    // participant key that isn't in the dataset. Treat that as unmapped rather
    // than letting a bogus key leak into pages that would then render an
    // "Unknown participant" state.
    const known = me?.participant && dataset.allTime.participantStats[me.participant] ? me.participant : null

    return {
      status: state.status,
      switchPersona,
      me: me ? { ...me, participant: known } : null,
      isMe: (key: string) => known !== null && key.toLowerCase() === known,
      myYears: known ? (dataset.allTime.participantStats[known]?.years ?? []) : [],
      // devAvatar is a no-op outside dev, so this is the real map in production.
      avatarFor: (key: string) => state.avatars[key.toLowerCase()] ?? devAvatar(key),
      scopeMine,
      setScopeMine,
    }
  }, [state, switchPersona, scopeMine, setScopeMine])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useIdentity(): IdentityValue {
  const v = useContext(Ctx)
  if (!v) {
    // No provider (a test, or a stray render) behaves exactly like a logged-out
    // viewer rather than throwing — identity is never load-bearing for content.
    return {
      status: 'unavailable',
      switchPersona: () => {},
      me: null,
      isMe: () => false,
      myYears: [],
      avatarFor: () => undefined,
      scopeMine: false,
      setScopeMine: () => {},
    }
  }
  return v
}

/**
 * The "only my editions" preference. Inert for viewers who never ranked: with
 * no years to scope to, `active` is false and every consumer falls back to the
 * full dataset without needing its own special case.
 */
export function useScopePref() {
  const { myYears, scopeMine, setScopeMine } = useIdentity()

  // Scoping to "my years" when that's every year would be a no-op that costs a
  // full recompute, so don't consider it active.
  const canScope = myYears.length > 0 && myYears.length < dataset.years.length

  return { scopeMine, setScopeMine, canScope, active: scopeMine && canScope, myYears }
}

/**
 * The dataset a page should read, honouring the edition preference. Returns the
 * global singleton whenever scoping is off or would be a no-op, so pages that
 * memoize on it don't churn.
 */
export function useScopedDataset(): Dataset {
  const { active, myYears } = useScopePref()
  return useMemo(() => (active ? subsetOfCached(dataset, myYears) : dataset), [active, myYears])
}

/**
 * Shown instead of the site when there's no session.
 *
 * nginx is the real gate — it refuses to serve index.html or the bundle to an
 * unauthenticated request, and fails closed if this service is unreachable. But
 * the bundle contains every score, so it shouldn't render its contents on the
 * word of whoever happens to be holding it. If a request ever gets this far
 * without a session, that's a misconfiguration, and the right response is to
 * show nothing rather than to quietly serve the data.
 */
export function SignInWall({ status }: { status: IdentityState['status'] }) {
  const unreachable = status === 'unavailable'
  return (
    <main className="page signin-wall">
      <h1>{SITE_NAME}</h1>
      {unreachable ? (
        <>
          <p className="subtitle">Can’t reach the login service right now.</p>
          <p className="note">
            This is usually brief. Reload in a moment — if it persists, the auth service on the host may be down.
          </p>
          <p>
            <a className="showmore" href="/">
              Reload
            </a>
          </p>
        </>
      ) : (
        <>
          <p className="subtitle">Private to the party rank Discord. Sign in to continue.</p>
          <p>
            <a className="showmore" href="/auth/login">
              Sign in with Discord →
            </a>
          </p>
          <p className="note">You’ll need to be a member of the server.</p>
        </>
      )}
    </main>
  )
}

/**
 * A participant's Discord avatar. Renders nothing when we don't have one —
 * which is the normal case for anyone who hasn't logged in — so call sites
 * never need their own conditional.
 *
 * `fallback` swaps that empty for a monogram disc, for the few places where the
 * face is load-bearing rather than decoration: the Head to Head rails are a row
 * of round faces you pick from, and most of the room having no avatar left them
 * as a ragged line of bare names in chips of two different heights.
 */
export function Avatar({
  participant,
  size = 24,
  fallback = false,
}: {
  participant: string
  size?: number
  fallback?: boolean
}) {
  const { avatarFor } = useIdentity()
  const src = avatarFor(participant)
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    if (!fallback) return null
    return (
      <span
        className="avatar avatar-monogram"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
        title={displayName(participant)}
        aria-hidden="true"
      >
        {monogram(participant)}
      </span>
    )
  }
  return (
    <img
      className="avatar"
      src={src}
      // Intrinsic size prevents a one-frame jump while the image decodes.
      width={size}
      height={size}
      alt=""
      loading="lazy"
      decoding="async"
      // The proxy 404s for participants with no Discord avatar; drop the element
      // rather than showing a broken image.
      onError={() => setFailed(true)}
      title={displayName(participant)}
    />
  )
}
