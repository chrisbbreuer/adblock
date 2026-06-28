import { buildStaticRules } from '../src/rules/static-rules'

const rules = buildStaticRules()
const ids = new Set<number>()

for (const rule of rules) {
  if (!Number.isInteger(rule.id) || rule.id < 1) throw new Error(`Invalid rule id: ${rule.id}`)
  if (ids.has(rule.id)) throw new Error(`Duplicate rule id: ${rule.id}`)
  ids.add(rule.id)
  if (!rule.condition.resourceTypes?.length) throw new Error(`Rule ${rule.id} has no resource types`)
  if (!rule.condition.urlFilter && !rule.condition.regexFilter) throw new Error(`Rule ${rule.id} has no URL matcher`)
}

console.log(`Validated ${rules.length} static DNR rules`)
