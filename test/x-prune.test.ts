import { describe, expect, it } from 'bun:test'
import { isXGraphqlUrl, prunePromotedFromTimeline } from '../src/shared/x-prune'

describe('isXGraphqlUrl', () => {
  it('matches X GraphQL timeline endpoints', () => {
    expect(isXGraphqlUrl('https://x.com/i/api/graphql/abc123/HomeTimeline')).toBe(true)
    expect(isXGraphqlUrl('https://twitter.com/i/api/graphql/def/SearchTimeline')).toBe(true)
    expect(isXGraphqlUrl('https://x.com/i/api/graphql/x/UserTweets?variables=%7B%7D')).toBe(true)
  })

  it('ignores unrelated URLs', () => {
    expect(isXGraphqlUrl('https://x.com/home')).toBe(false)
    expect(isXGraphqlUrl('https://x.com/i/api/1.1/jot/client_event.json')).toBe(false)
    expect(isXGraphqlUrl('https://pbs.twimg.com/media/abc.jpg')).toBe(false)
  })
})

describe('prunePromotedFromTimeline', () => {
  it('removes promoted entries and keeps organic ones', () => {
    const data = homeTimeline()
    const removed = prunePromotedFromTimeline(data)

    expect(removed).toBe(2)

    const entries = (data.data.home.home_timeline_urt.instructions[0] as { entries: Array<{ entryId: string }> }).entries
    const ids = entries.map(entry => entry.entryId)
    expect(ids).toEqual(['tweet-111', 'tweet-333', 'who-to-follow-1'])
    expect(ids).not.toContain('promoted-222')
    expect(ids).not.toContain('conversationthread-9')
  })

  it('detects promotion via promotedMetadata even without a promoted- entryId', () => {
    const data = {
      data: { x: { instructions: [{ entries: [
        { entryId: 'tweet-1', content: { itemContent: { promotedMetadata: { advertiser_results: {} } } } },
        { entryId: 'tweet-2', content: { itemContent: { tweet_results: {} } } },
      ] }] } },
    }

    expect(prunePromotedFromTimeline(data)).toBe(1)
    expect(data.data.x.instructions[0].entries.map(e => e.entryId)).toEqual(['tweet-2'])
  })

  it('removes a module entry when any of its items is promoted', () => {
    const data = {
      data: { y: { instructions: [{ entries: [
        { entryId: 'mod-1', content: { items: [{ item: { itemContent: { promotedMetadata: {} } } }] } },
        { entryId: 'mod-2', content: { items: [{ item: { itemContent: { tweet_results: {} } } }] } },
      ] }] } },
    }

    expect(prunePromotedFromTimeline(data)).toBe(1)
    expect(data.data.y.instructions[0].entries.map(e => e.entryId)).toEqual(['mod-2'])
  })

  it('leaves non-timeline entries arrays untouched', () => {
    const data = { settings: { entries: [{ entryId: 'a', value: 1 }, { key: 'b' }] } }
    expect(prunePromotedFromTimeline(data)).toBe(0)
    expect(data.settings.entries).toHaveLength(2)
  })

  it('returns 0 and does not throw on empty or malformed input', () => {
    expect(prunePromotedFromTimeline(null)).toBe(0)
    expect(prunePromotedFromTimeline({})).toBe(0)
    expect(prunePromotedFromTimeline({ data: { home: null } })).toBe(0)
  })
})

function homeTimeline() {
  return {
    data: {
      home: {
        home_timeline_urt: {
          instructions: [
            {
              type: 'TimelineAddEntries',
              entries: [
                { entryId: 'tweet-111', content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', tweet_results: { result: {} } } } },
                { entryId: 'promoted-222', content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', promotedMetadata: { advertiser_results: {} }, tweet_results: { result: {} } } } },
                { entryId: 'tweet-333', content: { entryType: 'TimelineTimelineItem', itemContent: { itemType: 'TimelineTweet', tweet_results: { result: {} } } } },
                { entryId: 'who-to-follow-1', content: { entryType: 'TimelineTimelineModule', items: [{ item: { itemContent: { itemType: 'TimelineUser' } } }] } },
                { entryId: 'conversationthread-9', content: { entryType: 'TimelineTimelineModule', items: [{ item: { itemContent: { promotedMetadata: {} } } }] } },
              ],
            },
            { type: 'TimelineTerminateTimeline', direction: 'Top' },
          ],
        },
      },
    },
  }
}
