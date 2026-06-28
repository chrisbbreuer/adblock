import packageJson from '../../package.json'
import { syncDynamicRules } from '../rules/dynamic-rules'
import { hostnameFromUrl } from '../shared/domain'
import { formatBytes } from '../shared/metrics'
import {
  getActiveTabState,
  getLifetimeStats,
  getLocalStats,
  getSettings,
  initializeStorage,
  recordBlockEvents,
  resetStats,
  setSettings,
} from '../shared/storage'
import type { DashboardState, ExtensionSettings, RuntimeMessage, RuntimeResponse } from '../shared/types'

chrome.runtime.onInstalled.addListener(() => {
  void setup()
})

chrome.runtime.onStartup.addListener(() => {
  void setup()
})

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  void handleMessage(message, sender)
    .then(data => sendResponse({ ok: true, data } satisfies RuntimeResponse))
    .catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      sendResponse({ ok: false, error: reason } satisfies RuntimeResponse)
    })

  return true
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' || !changes.settings?.newValue) return
  void syncDynamicRules(changes.settings.newValue as ExtensionSettings)
  void updateBadge()
})

async function setup(): Promise<void> {
  await initializeStorage()
  await syncDynamicRules(await getSettings())
  await updateBadge()
}

async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (message.type) {
    case 'get-dashboard':
      return getDashboard()
    case 'set-settings': {
      const settings = await setSettings(message.settings)
      await syncDynamicRules(settings)
      await updateBadge()
      return getDashboard()
    }
    case 'toggle-site': {
      const settings = await toggleSite(message.hostname, message.allowed)
      await syncDynamicRules(settings)
      await updateBadge()
      return getDashboard()
    }
    case 'record-blocks': {
      await recordBlockEvents(message.events)
      await updateBadge(sender.tab?.url)
      return true
    }
    case 'reset-stats':
      await resetStats()
      await updateBadge()
      return getDashboard()
    case 'export-data':
      return getDashboard()
    default:
      throw new Error('Unknown runtime message')
  }
}

async function getDashboard(): Promise<DashboardState> {
  const settings = await getSettings()
  return {
    settings,
    lifetime: await getLifetimeStats(),
    local: await getLocalStats(),
    activeTab: await getActiveTabState(settings),
    manifestVersion: packageJson.version,
  }
}

async function toggleSite(hostname: string, allowed: boolean): Promise<ExtensionSettings> {
  const settings = await getSettings()
  const normalized = hostnameFromUrl(`https://${hostname}`)
  const allowedSites = new Set(settings.allowedSites)
  const blockedSites = new Set(settings.blockedSites)

  if (allowed) {
    allowedSites.add(normalized)
    blockedSites.delete(normalized)
  }
  else {
    allowedSites.delete(normalized)
  }

  return setSettings({
    allowedSites: [...allowedSites],
    blockedSites: [...blockedSites],
  })
}

async function updateBadge(tabUrl?: string): Promise<void> {
  const settings = await getSettings()
  if (!settings.badgeEnabled) {
    await chrome.action.setBadgeText({ text: '' })
    return
  }

  const hostname = tabUrl ? hostnameFromUrl(tabUrl) : (await getActiveTabState(settings))?.hostname
  const local = await getLocalStats()
  const site = hostname ? local.sites[hostname] : undefined

  await chrome.action.setBadgeBackgroundColor({ color: '#17c964' })
  await chrome.action.setBadgeText({ text: site?.adsBlocked ? compactBadge(site.adsBlocked) : '' })
  await chrome.action.setTitle({
    title: site ? `Adblock blocked ${site.adsBlocked} ads and saved about ${formatBytes(site.bytesSaved)} here.` : 'Adblock',
  })
}

function compactBadge(value: number): string {
  if (value > 9999) return '9k+'
  if (value > 999) return `${Math.floor(value / 1000)}k`
  return String(value)
}
