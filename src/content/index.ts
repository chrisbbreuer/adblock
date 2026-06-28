import { defaultCosmeticSelectors, xSelectors, youtubeSelectors } from '../shared/constants'
import { hostnameFromUrl, siteMatches } from '../shared/domain'
import { estimateBytesSaved, estimateVideoSecondsSaved } from '../shared/metrics'
import { defaultSettings } from '../shared/storage'
import type { BlockEvent, BlockSource, ExtensionSettings, ResourceCategory, RuntimeResponse } from '../shared/types'

const hostname = hostnameFromUrl(location.href)
const seen = new WeakSet<Element>()
const pending = new Map<string, BlockEvent>()
let observer: MutationObserver | undefined
let flushTimer: number | undefined

void boot()

async function boot(): Promise<void> {
  const settings = await loadSettings()
  if (!settings.enabled || siteMatches(hostname, settings.allowedSites)) return

  sweep(settings)
  observer = new MutationObserver(() => scheduleSweep(settings))
  observer.observe(document.documentElement, { childList: true, subtree: true })

  window.addEventListener('pagehide', () => observer?.disconnect(), { once: true })
}

async function loadSettings(): Promise<ExtensionSettings> {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get-dashboard' }) as RuntimeResponse<{ settings: ExtensionSettings }>
    return response.ok && response.data ? response.data.settings : defaultSettings
  }
  catch {
    return defaultSettings
  }
}

function scheduleSweep(settings: ExtensionSettings): void {
  if (flushTimer) return
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined
    sweep(settings)
  }, 250)
}

function sweep(settings: ExtensionSettings): void {
  if (settings.cosmeticFiltering) hideSelectors(defaultCosmeticSelectors, 'cosmetic', 'other')

  if (settings.youtubeEnhancements && isYouTube()) {
    clickYouTubeSkip()
    hideSelectors(youtubeSelectors, 'youtube', 'media')
  }

  if (settings.xEnhancements && isX()) {
    hidePromotedArticles()
    hideSelectors(xSelectors, 'x', 'xhr')
  }

  flushEvents()
}

function hideSelectors(selectors: readonly string[], source: BlockSource, category: ResourceCategory): void {
  for (const selector of selectors) {
    for (const element of queryAllSafe(selector)) {
      hideElement(element, source, category)
    }
  }
}

function hidePromotedArticles(): void {
  for (const article of document.querySelectorAll('article')) {
    if (seen.has(article)) continue
    const text = article.textContent?.toLowerCase() ?? ''
    if (text.includes('promoted')) hideElement(article, 'x', 'xhr')
  }
}

function clickYouTubeSkip(): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.ytp-ad-skip-button, .ytp-skip-ad-button, button[class*="ytp-ad-skip"]'))
  for (const button of buttons) {
    if (button.offsetParent === null) continue
    button.click()
    queueEvent('video', 'media', 1, estimateBytesSaved('media'), estimateVideoSecondsSaved())
  }
}

function hideElement(element: Element, source: BlockSource, category: ResourceCategory): void {
  if (seen.has(element)) return
  seen.add(element)
  element.setAttribute('data-adblock-hidden', 'true')
  if (element instanceof HTMLElement) {
    element.style.setProperty('display', 'none', 'important')
    element.style.setProperty('visibility', 'hidden', 'important')
  }
  queueEvent(source, category)
}

function queryAllSafe(selector: string): Element[] {
  try {
    return Array.from(document.querySelectorAll(selector))
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

function flushEvents(): void {
  if (!pending.size) return
  const events = [...pending.values()]
  pending.clear()
  void chrome.runtime.sendMessage({ type: 'record-blocks', events })
}

function isYouTube(): boolean {
  return hostname === 'youtube.com' || hostname.endsWith('.youtube.com')
}

function isX(): boolean {
  return hostname === 'x.com' || hostname.endsWith('.x.com') || hostname === 'twitter.com' || hostname.endsWith('.twitter.com')
}
