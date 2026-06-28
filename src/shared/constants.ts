export const extensionName = 'Adblock'
export const extensionDescription = 'A polished STX-powered Chrome MV3 ad blocker.'
export const staticRulesetId = 'adblock_static_rules'
export const dynamicRuleStartId = 50000
export const dynamicRuleEndId = 50999
export const maxRecentEvents = 240

export const protectedHosts = {
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com'],
  x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
} as const

export const defaultCosmeticSelectors = [
  '[id^="google_ads_"]',
  '[id*="ad-container"]',
  '[class*="ad-container"]',
  '[class*="adsbygoogle"]',
  '[data-ad]',
  '[data-ad-slot]',
  '[aria-label="Advertisement"]',
] as const

export const youtubeSelectors = [
  '.ytp-ad-module',
  '.video-ads',
  '.ytp-ad-overlay-container',
  'ytd-display-ad-renderer',
  'ytd-promoted-sparkles-web-renderer',
  'ytd-companion-slot-renderer',
  'ytd-ad-slot-renderer',
  'ytd-rich-item-renderer:has(ytd-ad-slot-renderer)',
] as const

export const xSelectors = [
  '[data-testid="placementTracking"]',
  'article:has([data-testid="promotedIndicator"])',
] as const
