export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^www\./, '')
}

export function hostnameFromUrl(url: string): string {
  try {
    return normalizeHostname(new URL(url).hostname)
  }
  catch {
    return ''
  }
}

export function siteMatches(hostname: string, sites: string[]): boolean {
  const normalized = normalizeHostname(hostname)

  return sites.some((site) => {
    const candidate = normalizeHostname(site)
    return normalized === candidate || normalized.endsWith(`.${candidate}`)
  })
}

export function isHttpUrl(url?: string): url is string {
  return Boolean(url?.startsWith('http://') || url?.startsWith('https://'))
}
