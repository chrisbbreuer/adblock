import { maxRecentEvents } from './constants'
import { hostnameFromUrl, isHttpUrl, normalizeHostname, siteMatches } from './domain'
import { compactBuckets, eventTotals } from './metrics'
import type { ActiveTabState, BlockEvent, ExtensionSettings, LifetimeStats, LocalStats, SiteStats } from './types'

const syncKeys = {
  settings: 'settings',
  lifetime: 'lifetime',
} as const

const localKeys = {
  stats: 'stats',
} as const

export const defaultSettings: ExtensionSettings = {
  enabled: true,
  badgeEnabled: true,
  cosmeticFiltering: true,
  youtubeEnhancements: true,
  xEnhancements: true,
  allowedSites: [],
  blockedSites: [],
}

export function defaultLifetimeStats(now: Date = new Date()): LifetimeStats {
  const iso = now.toISOString()
  return {
    adsBlocked: 0,
    bytesSaved: 0,
    videoSecondsSaved: 0,
    since: iso,
    lastUpdated: iso,
  }
}

export function defaultLocalStats(): LocalStats {
  return {
    hourly: [],
    daily: [],
    sites: {},
    recentEvents: [],
  }
}

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.sync.get(syncKeys.settings)
  return { ...defaultSettings, ...(result[syncKeys.settings] as Partial<ExtensionSettings> | undefined) }
}

export async function setSettings(settings: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const next = { ...(await getSettings()), ...settings }
  next.allowedSites = uniqueSites(next.allowedSites)
  next.blockedSites = uniqueSites(next.blockedSites)
  await chrome.storage.sync.set({ [syncKeys.settings]: next })
  return next
}

export async function getLifetimeStats(): Promise<LifetimeStats> {
  const result = await chrome.storage.sync.get(syncKeys.lifetime)
  return { ...defaultLifetimeStats(), ...(result[syncKeys.lifetime] as Partial<LifetimeStats> | undefined) }
}

export async function setLifetimeStats(stats: LifetimeStats): Promise<void> {
  await chrome.storage.sync.set({ [syncKeys.lifetime]: stats })
}

export async function getLocalStats(): Promise<LocalStats> {
  const result = await chrome.storage.local.get(localKeys.stats)
  return { ...defaultLocalStats(), ...(result[localKeys.stats] as Partial<LocalStats> | undefined) }
}

export async function setLocalStats(stats: LocalStats): Promise<void> {
  await chrome.storage.local.set({ [localKeys.stats]: stats })
}

export async function initializeStorage(): Promise<void> {
  const sync = await chrome.storage.sync.get([syncKeys.settings, syncKeys.lifetime])
  const local = await chrome.storage.local.get(localKeys.stats)

  if (!sync[syncKeys.settings]) await chrome.storage.sync.set({ [syncKeys.settings]: defaultSettings })
  if (!sync[syncKeys.lifetime]) await chrome.storage.sync.set({ [syncKeys.lifetime]: defaultLifetimeStats() })
  if (!local[localKeys.stats]) await chrome.storage.local.set({ [localKeys.stats]: defaultLocalStats() })
}

export async function resetStats(): Promise<void> {
  await setLifetimeStats(defaultLifetimeStats())
  await setLocalStats(defaultLocalStats())
}

export async function recordBlockEvents(events: BlockEvent[]): Promise<void> {
  if (!events.length) return

  const now = new Date()
  const totals = eventTotals(events)
  const lifetime = await getLifetimeStats()
  const local = await getLocalStats()

  lifetime.adsBlocked += totals.adsBlocked
  lifetime.bytesSaved += totals.bytesSaved
  lifetime.videoSecondsSaved += totals.videoSecondsSaved
  lifetime.lastUpdated = now.toISOString()

  const hourKey = bucketKey(now, 'hour')
  const dayKey = bucketKey(now, 'day')
  mergeBucket(local.hourly, hourKey, totals)
  mergeBucket(local.daily, dayKey, totals)

  for (const event of events) {
    const hostname = normalizeHostname(event.hostname)
    if (!hostname) continue
    const existing: SiteStats = local.sites[hostname] ?? {
      hostname,
      adsBlocked: 0,
      bytesSaved: 0,
      videoSecondsSaved: 0,
      lastBlockedAt: event.occurredAt,
    }
    const eventBytes = event.bytesSaved ?? 0
    existing.adsBlocked += event.count
    existing.bytesSaved += eventBytes
    existing.videoSecondsSaved += event.videoSecondsSaved ?? 0
    existing.lastBlockedAt = event.occurredAt
    local.sites[hostname] = existing
  }

  local.hourly = compactBuckets(local.hourly, 72)
  local.daily = compactBuckets(local.daily, 60)
  local.recentEvents = [...local.recentEvents, ...events].slice(-maxRecentEvents)

  await Promise.all([setLifetimeStats(lifetime), setLocalStats(local)])
}

export async function getActiveTabState(settings?: ExtensionSettings): Promise<ActiveTabState | undefined> {
  settings ??= await getSettings()
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!isHttpUrl(tab?.url)) return undefined

  const hostname = hostnameFromUrl(tab.url)
  return {
    hostname,
    url: tab.url,
    allowed: siteMatches(hostname, settings.allowedSites),
    blocked: siteMatches(hostname, settings.blockedSites),
  }
}

function uniqueSites(sites: string[]): string[] {
  return [...new Set(sites.map(normalizeHostname).filter(Boolean))].sort()
}

function bucketKey(date: Date, type: 'hour' | 'day'): string {
  const iso = date.toISOString()
  return type === 'hour' ? iso.slice(0, 13) : iso.slice(0, 10)
}

function mergeBucket(target: LocalStats['hourly'], key: string, totals: { adsBlocked: number, bytesSaved: number, videoSecondsSaved: number }): void {
  const existing = target.find(bucket => bucket.key === key)
  if (existing) {
    existing.adsBlocked += totals.adsBlocked
    existing.bytesSaved += totals.bytesSaved
    existing.videoSecondsSaved += totals.videoSecondsSaved
    return
  }

  target.push({ key, ...totals })
}
