import { describe, expect, it } from 'bun:test'
import { hostnameFromUrl, normalizeHostname, siteMatches } from '../src/shared/domain'

describe('domain helpers', () => {
  it('normalizes hostnames', () => {
    expect(normalizeHostname('WWW.Example.COM')).toBe('example.com')
  })

  it('extracts hostnames from URLs', () => {
    expect(hostnameFromUrl('https://www.youtube.com/watch?v=1')).toBe('youtube.com')
  })

  it('matches subdomains against site rules', () => {
    expect(siteMatches('ads.example.com', ['example.com'])).toBe(true)
    expect(siteMatches('example.net', ['example.com'])).toBe(false)
  })
})
