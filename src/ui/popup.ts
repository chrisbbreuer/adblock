import { siteMatches } from '../shared/domain'
import { formatBytes, formatMinutes } from '../shared/metrics'
import type { DashboardState } from '../shared/types'
import { byId, renderBars, sendMessage } from './dom'

const elements = {
  root: document.querySelector<HTMLElement>('.popup-frame')!,
  siteTitle: byId('site-title'),
  protectionToggle: byId<HTMLButtonElement>('protection-toggle'),
  todayBlocked: byId('today-blocked'),
  dataSaved: byId('data-saved'),
  videoTime: byId('video-time'),
  lifetimeBlocked: byId('lifetime-blocked'),
  hourlyChart: byId('hourly-chart'),
  currentSite: byId('current-site'),
  siteToggle: byId<HTMLButtonElement>('site-toggle'),
  topCategories: byId('top-categories'),
  status: byId('status-message'),
  openOptions: byId<HTMLButtonElement>('open-options'),
}

let state: DashboardState | undefined

void refresh()

elements.protectionToggle.addEventListener('click', async () => {
  if (!state) return
  state = await sendMessage<DashboardState>({ type: 'set-settings', settings: { enabled: !state.settings.enabled } })
  render(state)
})

elements.siteToggle.addEventListener('click', async () => {
  if (!state?.activeTab) return
  const shouldAllow = !siteMatches(state.activeTab.hostname, state.settings.allowedSites)
  state = await sendMessage<DashboardState>({ type: 'toggle-site', hostname: state.activeTab.hostname, allowed: shouldAllow })
  render(state)
})

elements.openOptions.addEventListener('click', () => {
  chrome.runtime.openOptionsPage()
})

async function refresh(): Promise<void> {
  try {
    state = await sendMessage<DashboardState>({ type: 'get-dashboard' })
    render(state)
  }
  catch (error) {
    elements.status.textContent = error instanceof Error ? error.message : String(error)
    elements.root.dataset.view = 'error'
  }
}

function render(next: DashboardState): void {
  const today = next.local.daily.at(-1)?.adsBlocked ?? 0
  const active = next.activeTab
  const enabled = next.settings.enabled
  const allowed = active ? siteMatches(active.hostname, next.settings.allowedSites) : false

  elements.root.dataset.view = 'ready'
  elements.root.dataset.enabled = String(enabled && !allowed)
  elements.siteTitle.textContent = enabled && !allowed ? 'Protection active' : 'Protection paused'
  elements.todayBlocked.textContent = today.toLocaleString()
  elements.dataSaved.textContent = formatBytes(next.lifetime.bytesSaved)
  elements.videoTime.textContent = formatMinutes(next.lifetime.videoSecondsSaved)
  elements.lifetimeBlocked.textContent = `${next.lifetime.adsBlocked.toLocaleString()} lifetime`
  elements.currentSite.textContent = active?.hostname || 'No active tab'
  elements.siteToggle.textContent = allowed ? 'Protect' : 'Allow'
  elements.siteToggle.disabled = !active
  elements.protectionToggle.classList.toggle('off', !enabled)
  elements.status.textContent = allowed ? 'This site is allowed. Global protection remains available elsewhere.' : 'Estimated savings are computed locally.'

  renderBars(elements.hourlyChart, next.local.hourly.map(bucket => bucket.adsBlocked), 24)
  renderTopCategories(next)
}

function renderTopCategories(next: DashboardState): void {
  const categories = Object.entries(next.local.recentEvents.reduce<Record<string, number>>((totals, event) => {
    const key = event.source === 'video' ? 'video ads' : event.source
    totals[key] = (totals[key] ?? 0) + event.count
    return totals
  }, {}))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)

  if (!categories.length) {
    elements.topCategories.replaceChildren(emptyRow('No blocked ads yet'))
    return
  }

  elements.topCategories.replaceChildren(
    ...categories.map(([category, count]) => {
      const row = document.createElement('div')
      row.className = 'site-row'
      row.replaceChildren(label(category), strong(count.toLocaleString()))
      return row
    }),
  )
}

function emptyRow(text: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'muted site-row'
  row.textContent = text
  return row
}

function label(text: string): HTMLElement {
  const element = document.createElement('span')
  element.textContent = text
  return element
}

function strong(text: string): HTMLElement {
  const element = document.createElement('strong')
  element.textContent = text
  return element
}
