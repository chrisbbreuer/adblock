import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const extensionPath = resolve('dist')
const userDataDir = await mkdtemp(join(tmpdir(), 'adblock-smoke-'))
const errors: string[] = []

const server = Bun.serve({
  port: 0,
  fetch() {
    return new Response(`<!doctype html>
<html>
  <head>
    <title>Adblock smoke fixture</title>
    <script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"></script>
  </head>
  <body>
    <h1>Fixture</h1>
    <div id="google_ads_iframe_1">network ad</div>
    <div class="ad-container">cosmetic ad</div>
    <div data-ad-slot="fixture">slot ad</div>
  </body>
</html>`, {
      headers: { 'content-type': 'text/html' },
    })
  },
})

try {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--disable-features=DialMediaRouteProvider',
    ],
  })

  context.on('page', (page) => {
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('net::ERR_BLOCKED_BY_CLIENT')) {
        errors.push(message.text())
      }
    })
  })

  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 })
  const extensionId = new URL(worker.url()).host
  assert(extensionId.length > 10, 'Extension id was not discovered from service worker')

  const fixture = await context.newPage()
  await fixture.goto(`http://127.0.0.1:${server.port}/`, { waitUntil: 'domcontentloaded' })
  await fixture.waitForFunction(() => document.querySelectorAll('[data-adblock-hidden="true"]').length >= 2, undefined, { timeout: 10_000 })
  const hiddenCount = await fixture.locator('[data-adblock-hidden="true"]').count()
  assert(hiddenCount >= 2, `Expected cosmetic filtering to hide at least 2 elements, saw ${hiddenCount}`)

  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' })
  await popup.waitForSelector('#today-blocked', { timeout: 10_000 })
  await popup.waitForFunction(() => document.querySelector('#status-message')?.textContent !== 'Loading protection state...')
  const todayBlocked = Number.parseInt((await popup.locator('#today-blocked').textContent())?.replace(/\D/g, '') || '0', 10)
  assert(todayBlocked >= 2, `Expected popup blocked count to include fixture events, saw ${todayBlocked}`)

  const options = await context.newPage()
  await options.goto(`chrome-extension://${extensionId}/options.html`, { waitUntil: 'domcontentloaded' })
  await options.waitForSelector('#dashboard-blocked', { timeout: 10_000 })
  await options.waitForFunction(() => document.querySelector('#options-status')?.textContent !== 'Loading dashboard...')
  const dashboardBlocked = Number.parseInt((await options.locator('#dashboard-blocked').textContent())?.replace(/\D/g, '') || '0', 10)
  assert(dashboardBlocked >= 2, `Expected dashboard blocked count to include fixture events, saw ${dashboardBlocked}`)

  if (errors.length) throw new Error(`Browser console/page errors:\n${errors.join('\n')}`)

  await context.close()
  console.log(`Smoke tested extension ${extensionId}: hidden=${hiddenCount}, popup=${todayBlocked}, dashboard=${dashboardBlocked}`)
}
finally {
  server.stop(true)
  await rm(userDataDir, { recursive: true, force: true })
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
