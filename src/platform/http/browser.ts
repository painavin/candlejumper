import type { HttpGetOptions, HttpTransport } from '@shared/contracts/index.js'
import { HttpRequestError } from '@shared/contracts/index.js'

/**
 * The browser implementation of the HTTP port: plain `fetch`.
 *
 * In `platform/` rather than beside its caller for the usual two reasons. It's the
 * zone allowed to touch platform capability, so the Tauri and Capacitor transports
 * slot in beside this file later without moving anything — and neither of those is a
 * cosmetic difference, because both perform the request in native code, where CORS
 * does not apply. And keeping it out of `data/` means the source under it is tested
 * against a fake transport rather than a stubbed global.
 *
 * ## What this cannot do
 *
 * It cannot reach an endpoint that doesn't send `Access-Control-Allow-Origin`. The
 * request goes out and the server answers, but the browser withholds the response
 * from script, which is the one place that rule genuinely protects the user rather
 * than the API. Yahoo's chart endpoint is such an endpoint, so in the browser build
 * this needs either the dev proxy (see vite.config.ts) or an extension that adds the
 * header. `docs/data-sources.md` records that, and `classify` below makes sure the
 * failure says so rather than reading as "offline".
 */

const DEFAULT_TIMEOUT_MS = 15_000

export function createBrowserTransport(): HttpTransport {
  return {
    async get(url: string, options: HttpGetOptions = {}): Promise<string> {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      let response: Response
      try {
        response = await fetch(url, {
          // Never send this app's cookies to a third-party price API. Also the only
          // configuration a wildcard `Access-Control-Allow-Origin` permits at all.
          credentials: 'omit',
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (cause) {
        throw classify(cause, url, timeoutMs)
      }

      if (!response.ok) {
        throw new HttpRequestError(
          'status',
          `${url} returned HTTP ${response.status} ${response.statusText}`.trim(),
          response.status
        )
      }
      return response.text()
    },
  }
}

/**
 * Turn whatever `fetch` rejected with into something a player can act on.
 *
 * This function is the whole reason the transport isn't three lines. A CORS block
 * arrives as `TypeError: Failed to fetch` and nothing else — identical to a DNS
 * failure, to being offline, and to the extension being switched off. Left as-is,
 * every future networking problem in this app looks like the same problem, so the
 * message names both possibilities and the fix for the likely one.
 */
function classify(cause: unknown, url: string, timeoutMs: number): HttpRequestError {
  const name = cause instanceof Error ? cause.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new HttpRequestError('timeout', `${url} did not answer within ${timeoutMs / 1000}s.`)
  }
  return new HttpRequestError(
    'unreachable',
    `Could not read ${host(url)}. The browser refuses to say why — it reports a blocked ` +
      `cross-origin response and a dead network identically. In order of likelihood: the ` +
      `endpoint sent no Access-Control-Allow-Origin header and this build has no proxy or ` +
      `CORS extension active; you're offline; or the host is down.`
  )
}

function host(url: string): string {
  try {
    return new URL(url, 'http://localhost').host || url
  } catch {
    return url
  }
}
