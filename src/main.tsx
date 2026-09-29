import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { IdentityProvider, SignInWall } from './components/identity'
import { UNAVAILABLE, identityReady } from './lib/identity'
import type { IdentityState } from './lib/identity'
import { IS_DEMO, storageKey } from './lib/site'
import './styles.css'

// resolve the theme before first paint so there's no light-mode flash
document.documentElement.dataset.theme =
  localStorage.getItem(storageKey('theme')) ??
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

// Resolve identity before mounting, for the same reason as the theme above.
// The dataset is synchronous, so if identity landed after the first render,
// every personalized view would paint once with the wrong answer and then snap.
// The timeout means a hung auth service costs a moment and then degrades to an
// unpersonalized (but fully working) site, rather than a blank page.
// (An async bootstrap rather than top-level await, which the build target
// doesn't allow — raising it just for this would narrow browser support.)
const IDENTITY_TIMEOUT_MS = 1200

Promise.race<IdentityState>([
  identityReady,
  new Promise<IdentityState>((resolve) => setTimeout(() => resolve(UNAVAILABLE), IDENTITY_TIMEOUT_MS)),
]).then((initial) => {
  // In a production build, render nothing but a sign-in prompt without a
  // session. Dev keeps working with no auth service running at all, which is
  // the whole point of being able to develop offline.
  const gated = import.meta.env.PROD && !IS_DEMO && initial.status !== 'authed'

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {gated ? (
        <SignInWall status={initial.status} />
      ) : (
        <IdentityProvider initial={initial}>
          <HashRouter>
            <App />
          </HashRouter>
        </IdentityProvider>
      )}
    </React.StrictMode>,
  )
})
