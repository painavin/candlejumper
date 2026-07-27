/**
 * The HTTP port.
 *
 * `data/` needs to reach a price API, but it must not decide *how* the request is
 * made — that decision belongs to the platform. In a browser it's `fetch`, which
 * means CORS applies; in the Tauri or Capacitor shells the request can be handed to
 * native code, where it doesn't. Same source, same provider adapter, different
 * transport.
 *
 * One method, returning text rather than parsed JSON, so a CSV provider needs no
 * second entry point. Parsing belongs to the provider adapter, which is where the
 * shape is known.
 */

export interface HttpGetOptions {
  /** Abort after this long. Defaults to something sane in the implementation. */
  timeoutMs?: number
}

export interface HttpTransport {
  /** Resolves with the response body, or rejects with an `HttpRequestError`. */
  get(url: string, options?: HttpGetOptions): Promise<string>
}

/**
 * Why a request failed, in the only categories a caller can act on differently.
 *
 * `unreachable` is deliberately one bucket. A browser reports a CORS block, a DNS
 * failure, an offline adapter, and a blocked mixed-content request as the *same*
 * bare `TypeError` with no detail — the specification is explicit that the page
 * must not learn which. Pretending to distinguish them would be a lie; naming the
 * ambiguity in the message is not.
 */
export type HttpFailure = 'unreachable' | 'timeout' | 'status'

export class HttpRequestError extends Error {
  constructor(
    readonly failure: HttpFailure,
    message: string,
    /** Present only for `status`. */
    readonly status?: number
  ) {
    super(message)
    this.name = 'HttpRequestError'
  }
}
