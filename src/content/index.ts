import { twitchVideoAdMarkers } from '../shared/constants'
import { activeCosmeticGroups } from '../shared/cosmetic'
import type { ActiveCosmeticGroup, CosmeticContext } from '../shared/cosmetic'
import { hostnameFromUrl, siteMatches } from '../shared/domain'
import { estimateBytesSaved, estimateVideoSecondsSaved } from '../shared/metrics'
import { defaultSettings } from '../shared/storage'
import type { BlockEvent, BlockSource, ExtensionSettings, ResourceCategory, RuntimeResponse } from '../shared/types'

const hostname = hostnameFromUrl(location.href)
const seen = new WeakSet<Element>()
const videoMarkersSeen = new WeakSet<Element>()
const pending = new Map<string, BlockEvent>()
const selectorHits = new Map<string, number>()
const pendingRoots = new Set<Element>()
const styleId = 'very-good-adblock-cosmetics'
const mutationSweepDelayMs = 150
const eventFlushDelayMs = 1_000
const maxPendingRoots = 80
let cosmeticGroups: ActiveCosmeticGroup[] = []
let observer: MutationObserver | undefined
let sweepTimer: number | undefined
let eventFlushTimer: number | undefined
let scanDocumentOnNextSweep = false

void boot()

async function boot(): Promise<void> {
  const settings = await loadSettings()
  if (!settings.enabled || siteMatches(hostname, settings.allowedSites)) return

  if (settings.cosmeticFiltering) {
    cosmeticGroups = activeCosmeticGroups(cosmeticContext(settings))
    injectCosmeticStyle(cosmeticGroups)
  }

  sweep(settings, [document])
  observer = new MutationObserver(mutations => scheduleSweep(settings, mutations))
  observer.observe(document.documentElement, { childList: true, subtree: true })

  window.addEventListener('pagehide', () => {
    observer?.disconnect()
    flushEvents()
  }, { once: true })
}

async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get-dashboard' }) as RuntimeResponse<{ settings: ExtensionSettings }>
    return response.ok && response.data ? { ...defaultSettings, ...response.data.settings } : defaultSettings
  }
  catch {
    return defaultSettings
  }
}

function cosmeticContext(settings: ExtensionSettings): CosmeticContext {
  return {
    isYouTube: isYouTube(),
    isTwitch: isTwitch(),
    isX: isX(),
    youtubeEnhancements: settings.youtubeEnhancements,
    twitchEnhancements: settings.twitchEnhancements,
    aggressive: settings.aggressiveCosmetic,
  }
}

/**
 * Hide matched placements up front with a single stylesheet. CSS applies to
 * elements added later by YouTube's SPA without waiting for a mutation sweep,
 * so feed ads never flash in. The sweep below only counts what the CSS hides.
 */
function injectCosmeticStyle(groups: readonly ActiveCosmeticGroup[]): void {
  const selectors = [...new Set(groups.flatMap(group => group.selectors))]
  if (!selectors.length || document.getElementById(styleId)) return

  const style = document.createElement('style')
  style.id = styleId
  style.textContent = `${selectors.join(',\n')} { display: none !important; }`
  ;(document.head ?? document.documentElement).append(style)
}

function scheduleSweep(settings: ExtensionSettings, mutations: MutationRecord[]): void {
  if (!collectMutationRoots(mutations)) return
  if (sweepTimer) return

  sweepTimer = window.setTimeout(() => {
    sweepTimer = undefined
    sweep(settings, drainScanRoots())
  }, mutationSweepDelayMs)
}

function sweep(settings: ExtensionSettings, roots: readonly SelectorRoot[]): void {
  if (!roots.length) return

  if (settings.cosmeticFiltering && cosmeticGroups.length) countHiddenPlacements(roots)

  if (settings.youtubeEnhancements && isYouTube()) {
    clickYouTubeSkip(roots)
  }

  if (settings.twitchEnhancements && isTwitch()) {
    recordTwitchVideoAds(roots)
  }

  scheduleEventFlush()
}

type SelectorRoot = Document | Element

/**
 * Tag and count elements the cosmetic stylesheet is hiding. Hiding already
 * happened via CSS; this only attributes each newly-matched node to its
 * selector for per-page diagnostics and the blocked-count metric.
 */
function countHiddenPlacements(roots: readonly SelectorRoot[]): void {
  for (const group of cosmeticGroups) {
    for (const selector of group.selectors) {
      for (const root of roots) {
        for (const element of queryAllSafe(root, selector)) {
          if (seen.has(element)) continue
          seen.add(element)
          element.setAttribute('data-adblock-hidden', 'true')
          selectorHits.set(selector, (selectorHits.get(selector) ?? 0) + 1)
          queueEvent(group.source, group.category)
        }
      }
    }
  }
}

function clickYouTubeSkip(roots: readonly SelectorRoot[]): void {
  for (const root of roots) {
    for (const button of queryAllSafe(root, '.ytp-ad-skip-button, .ytp-skip-ad-button, button[class*="ytp-ad-skip"]')) {
      if (!(button instanceof HTMLButtonElement) || button.offsetParent === null || seen.has(button)) continue
      seen.add(button)
      button.click()
      queueEvent('video', 'media', 1, estimateBytesSaved('media'), estimateVideoSecondsSaved())
    }
  }
}

function recordTwitchVideoAds(roots: readonly SelectorRoot[]): void {
  for (const selector of twitchVideoAdMarkers) {
    for (const root of roots) {
      for (const marker of queryAllSafe(root, selector)) {
        if (videoMarkersSeen.has(marker)) continue
        videoMarkersSeen.add(marker)
        queueEvent('video', 'media', 1, estimateBytesSaved('media'), estimateVideoSecondsSaved())
      }
    }
  }
}

function queryAllSafe(root: SelectorRoot, selector: string): Element[] {
  try {
    const matches: Element[] = []
    if (root instanceof Element && root.matches(selector)) matches.push(root)
    matches.push(...root.querySelectorAll(selector))
    return matches
  }
  catch {
    return []
  }
}

function queueEvent(source: BlockSource, category: ResourceCategory, count = 1, bytesSaved = estimateBytesSaved(category, count), videoSecondsSaved = 0): void {
  const key = `${source}:${category}`
  const existing = pending.get(key)
  if (existing) {
    existing.count += count
    existing.bytesSaved = (existing.bytesSaved ?? 0) + bytesSaved
    existing.videoSecondsSaved = (existing.videoSecondsSaved ?? 0) + videoSecondsSaved
    existing.occurredAt = new Date().toISOString()
    return
  }

  pending.set(key, {
    hostname,
    source,
    category,
    count,
    bytesSaved,
    videoSecondsSaved,
    occurredAt: new Date().toISOString(),
  })
}

function collectMutationRoots(mutations: MutationRecord[]): boolean {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element) || seen.has(node)) continue

      pendingRoots.add(node)
      if (pendingRoots.size > maxPendingRoots) {
        pendingRoots.clear()
        scanDocumentOnNextSweep = true
        return true
      }
    }
  }

  return scanDocumentOnNextSweep || pendingRoots.size > 0
}

function drainScanRoots(): SelectorRoot[] {
  if (scanDocumentOnNextSweep) {
    scanDocumentOnNextSweep = false
    pendingRoots.clear()
    return [document]
  }

  const roots = [...pendingRoots].filter(root => root.isConnected)
  pendingRoots.clear()
  return roots
}

function scheduleEventFlush(): void {
  if (eventFlushTimer) return
  if (!pending.size && !selectorHits.size) return
  eventFlushTimer = window.setTimeout(() => {
    eventFlushTimer = undefined
    flushEvents()
  }, eventFlushDelayMs)
}

function flushEvents(): void {
  if (eventFlushTimer) {
    window.clearTimeout(eventFlushTimer)
    eventFlushTimer = undefined
  }

  if (pending.size) {
    const events = [...pending.values()]
    pending.clear()
    void chrome.runtime.sendMessage({ type: 'record-blocks', events })
  }

  if (selectorHits.size) {
    const hits = [...selectorHits.entries()].map(([selector, count]) => ({ selector, count }))
    selectorHits.clear()
    void chrome.runtime.sendMessage({ type: 'record-cosmetic', hostname, hits })
  }
}

function isYouTube(): boolean {
  return hostname === 'youtube.com' || hostname.endsWith('.youtube.com')
}

function isTwitch(): boolean {
  return hostname === 'twitch.tv' || hostname.endsWith('.twitch.tv')
}

function isX(): boolean {
  return hostname === 'x.com' || hostname.endsWith('.x.com') || hostname === 'twitter.com' || hostname.endsWith('.twitter.com')
}
