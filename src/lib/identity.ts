/**
 * Who is looking at the site.
 *
 * The dataset is synchronous — it's compiled into the bundle and available at
 * import time (see data.ts). Identity is not: it needs a round trip to the auth
 * service. That asymmetry is the source of every potential flash of wrong
 * content, so we resolve identity *before* React mounts (see main.tsx), the
 * same way the theme is resolved before first paint.
 *
 * The fetch is deliberately kicked off at module-evaluation time rather than
 * inside a hook: React's StrictMode double-invokes effects in development, and
 * this way there is exactly one request regardless.
 */
import { IS_DEMO, SITE, storageKey } from './site'

export interface Identity {
  discordId: string
  username: string
  /** Lowercase participant key, already resolved server-side. Null if unmapped. */
  participant: string | null
  /** Same-origin proxied URL, or null when they have no Discord avatar. */
  avatarUrl: string | null
}

export type IdentityStatus = 'anonymous' | 'authed' | 'unavailable'

export interface IdentityState {
  status: IdentityStatus
  me: Identity | null
  /** participant key -> same-origin avatar URL, for everyone who has logged in. */
  avatars: Record<string, string>
}

/**
 * `unavailable` means we could not reach the auth service — a dead backend, or
 * a bare `vite dev` with nothing running on :8787. It must render exactly like
 * `anonymous`; the site stays fully usable without identity, it just isn't
 * personalized. Never surface it as an error.
 */
const UNAVAILABLE: IdentityState = { status: 'unavailable', me: null, avatars: {} }

let snapshot: IdentityState = UNAVAILABLE

async function fetchIdentity(): Promise<IdentityState> {
  const [meRes, avatarRes] = await Promise.allSettled([
    fetch('/auth/me', { credentials: 'same-origin' }),
    fetch('/auth/avatars', { credentials: 'same-origin' }),
  ])

  if (meRes.status !== 'fulfilled' || !meRes.value.ok) return UNAVAILABLE

  let body: { status?: string; me?: Identity | null }
  try {
    body = await meRes.value.json()
  } catch {
    return UNAVAILABLE
  }

  // Avatars are a nice-to-have; failing to load them must not cost us the
  // identity we did successfully resolve.
  let avatars: Record<string, string> = {}
  if (avatarRes.status === 'fulfilled' && avatarRes.value.ok) {
    try {
      avatars = await avatarRes.value.json()
    } catch {
      avatars = {}
    }
  }

  const status: IdentityStatus = body.status === 'authed' && body.me ? 'authed' : 'anonymous'
  return { status, me: status === 'authed' ? (body.me ?? null) : null, avatars }
}

// — The public demo —
//
// The demo is a static site with no auth service, and every visitor is a
// stranger. Rather than render the unpersonalized site (where half the
// features — My editions, Head to Head's default side, your own Recap — never
// show), the visitor picks a ranker to view the site as. It is a persona, not
// a login: nothing is gated on it.

/** Generated ranker portraits shipped with the demo data (none on the real site). */
const demoAvatarFiles = import.meta.glob('@data/avatars/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>

const DEMO_AVATARS: Record<string, string> = Object.fromEntries(
  // Named by participant key, with spaces as underscores (see demo/scripts/makeAvatars.ts).
  Object.entries(demoAvatarFiles).map(([path, url]) => [path.match(/([^/]+)\.svg$/)![1].replace(/_/g, ' '), url]),
)

const PERSONA_KEY = storageKey('persona')

/** The viewer state for browsing the demo as `participant`. */
export function demoIdentity(participant: string): IdentityState {
  try {
    localStorage.setItem(PERSONA_KEY, participant)
  } catch {
    // Storage blocked — the choice just won't survive a reload.
  }
  return {
    status: 'authed',
    me: { discordId: '', username: participant, participant, avatarUrl: DEMO_AVATARS[participant] ?? null },
    avatars: DEMO_AVATARS,
  }
}

function initialPersona(): string {
  try {
    return localStorage.getItem(PERSONA_KEY) ?? SITE.demoPersona ?? ''
  } catch {
    return SITE.demoPersona ?? ''
  }
}

async function run(): Promise<IdentityState> {
  if (IS_DEMO) {
    snapshot = demoIdentity(initialPersona())
    return snapshot
  }
  let next: IdentityState
  try {
    next = await fetchIdentity()
  } catch {
    next = UNAVAILABLE
  }
  snapshot = next
  return next
}

/** Resolves once the first identity fetch settles. Never rejects. */
export const identityReady: Promise<IdentityState> = run()

/** Synchronous snapshot. Safe to call at any time; never throws. */
export function currentIdentity(): IdentityState {
  return snapshot
}

/** Re-fetch after a login or logout. */
export async function refreshIdentity(): Promise<IdentityState> {
  return run()
}

export { UNAVAILABLE }
