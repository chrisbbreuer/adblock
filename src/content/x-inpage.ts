/**
 * MAIN-world content script for X / Twitter.
 *
 * Runs in the page's own JavaScript context (manifest `world: "MAIN"`) at
 * document_start, before X's bundle, and wraps `fetch` so promoted tweets are
 * pruned out of GraphQL timeline responses before the app ever sees them. This
 * is the same source-level approach uBlock Origin uses — locale-independent and
 * flash-free, unlike hiding rendered ad nodes.
 *
 * It cannot use chrome.* (wrong world), so it talks to the isolated content
 * script over window.postMessage: it receives an enable flag (so it honors the
 * global off switch and the allowlist) and reports how many ads it removed.
 */
import { xConfigMessageSource, xPruneMessageSource } from '../shared/constants'
import { isXGraphqlUrl, prunePromotedFromTimeline } from '../shared/x-prune'

installFetchPruner()

function installFetchPruner(): void {
  const original = window.fetch
  if (typeof original !== 'function') return

  // Default on: protection ships enabled, so early timeline requests are pruned
  // before settings arrive. The isolated script flips this off if disabled.
  let enabled = true

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data as { source?: string, enabled?: unknown } | null
    if (!data || data.source !== xConfigMessageSource) return
    if (typeof data.enabled === 'boolean') enabled = data.enabled
  })

  const patched = async function patchedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const response = await original.call(this as typeof globalThis, input, init)
    if (!enabled) return response

    try {
      const url = requestUrl(input)
      if (!isXGraphqlUrl(url)) return response
      if (!(response.headers.get('content-type') ?? '').includes('json')) return response

      const text = await response.clone().text()
      const data = JSON.parse(text) as unknown
      const removed = prunePromotedFromTimeline(data)
      if (removed <= 0) return response

      reportRemoved(removed)
      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    }
    catch {
      // Never break a response over ad pruning — hand back the untouched original.
      return response
    }
  }

  // Preserve any static members (e.g. fetch.preconnect) before swapping in.
  window.fetch = Object.assign(patched, original) as typeof window.fetch
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input instanceof Request) return input.url
  return String(input)
}

function reportRemoved(count: number): void {
  try {
    window.postMessage({ source: xPruneMessageSource, count }, window.location.origin)
  }
  catch {
    // postMessage can throw on exotic origins; the prune already happened.
  }
}
