/**
 * MAIN-world content script for YouTube.
 *
 * Runs in the page's own JavaScript context (manifest `world: "MAIN"`) at
 * document_start, before YouTube's app, and strips ad instructions
 * (`adPlacements` / `adSlots` / `playerAds`) out of player responses so the
 * player has nothing to schedule — the video starts immediately with no pre- or
 * mid-rolls, while `streamingData` and the rest of the response are untouched.
 * This is uBlock Origin's source-level approach; it replaces guessing in the DOM
 * and only supplements the existing skip/fast-forward safety net.
 *
 * Two entry points cover both loads:
 * - the inline `ytInitialPlayerResponse` used for the first video, and
 * - the `/youtubei/v1/player` fetch used for every subsequent video.
 */
import { ytConfigMessageSource, ytPruneMessageSource } from '../shared/constants'
import { isYouTubePlayerUrl, pruneYouTubeAds } from '../shared/yt-prune'
import { createPruneBridge, requestUrl } from './inpage-bridge'

const bridge = createPruneBridge(ytConfigMessageSource, ytPruneMessageSource)

interceptInlinePlayerResponse()
installFetchPruner()

/**
 * The first watch page ships its player response as `window.ytInitialPlayerResponse`.
 * Install an accessor before that assignment so we can prune ads out of it as it
 * is written; the getter hands back the cleaned object the app then reads.
 */
function interceptInlinePlayerResponse(): void {
  let current: unknown
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      enumerable: true,
      get() {
        return current
      },
      set(value: unknown) {
        try {
          if (bridge.isEnabled()) bridge.report(pruneYouTubeAds(value))
        }
        catch {
          // Leave the value as-is if pruning throws; never block playback.
        }
        current = value
      },
    })
  }
  catch {
    // A non-configurable definition already exists; the fetch path still applies.
  }
}

function installFetchPruner(): void {
  const original = window.fetch
  if (typeof original !== 'function') return

  const patched = async function patchedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const response = await original.call(this as typeof globalThis, input, init)
    if (!bridge.isEnabled()) return response

    try {
      if (!isYouTubePlayerUrl(requestUrl(input))) return response
      if (!(response.headers.get('content-type') ?? '').includes('json')) return response

      const data = JSON.parse(await response.clone().text()) as unknown
      const removed = pruneYouTubeAds(data)
      if (removed <= 0) return response

      bridge.report(removed)
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

  window.fetch = Object.assign(patched, original) as typeof window.fetch
}
