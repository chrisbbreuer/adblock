import { dynamicRuleEndId, dynamicRuleStartId } from '../shared/constants'
import { normalizeHostname } from '../shared/domain'
import type { ExtensionSettings } from '../shared/types'

function ruleId(offset: number): number {
  return dynamicRuleStartId + offset
}

export function buildDynamicRules(settings: ExtensionSettings): chrome.declarativeNetRequest.Rule[] {
  const allowedRules = settings.allowedSites.slice(0, 200).map((hostname, index) => ({
    id: ruleId(index),
    priority: 10,
    action: { type: 'allowAllRequests' as const },
    condition: {
      initiatorDomains: [normalizeHostname(hostname)],
      resourceTypes: [
        resourceType('main_frame'),
        resourceType('sub_frame'),
      ],
    },
  }))

  const blockedRules = settings.blockedSites.slice(0, 200).map((hostname, index) => ({
    id: ruleId(300 + index),
    priority: 20,
    action: { type: 'block' as const },
    condition: {
      requestDomains: [normalizeHostname(hostname)],
      resourceTypes: [
        resourceType('main_frame'),
        resourceType('sub_frame'),
        resourceType('script'),
        resourceType('image'),
        resourceType('xmlhttprequest'),
        resourceType('media'),
      ],
    },
  }))

  return [...allowedRules, ...blockedRules]
}

function resourceType(value: string): chrome.declarativeNetRequest.ResourceType {
  return value as chrome.declarativeNetRequest.ResourceType
}

export async function syncDynamicRules(settings: ExtensionSettings): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getDynamicRules()
  const removeRuleIds = existing
    .map(rule => rule.id)
    .filter(id => id >= dynamicRuleStartId && id <= dynamicRuleEndId)

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: buildDynamicRules(settings),
  })
}
