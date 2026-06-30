/**
 * Assembles FAQ + live store snapshot + optional vector context + product docs + keyword codebase for Gemini user turns.
 */
import { storePageSnapshotEnabled } from '../config.ts'
import { buildRelevantContext } from './codebase.ts'
import { getFaqText } from './faq.ts'
import { buildProductDocsContext } from './product-docs.ts'
import { buildStorePageContext } from './store-snapshot.ts'
import { buildHybridVectorContextAsync } from './universal-nd-expert.ts'

const NO_STORE_DATA_NOTICE =
  '**No live store snapshot is currently available** (the store page fetch returned no usable data, ' +
  'which can happen if the storefront renders its catalog client-side). Do NOT state specific prices, ' +
  'SKUs, discounts, "pre-order", or "in stock" status from memory or assumption: that information would ' +
  'be invented. If asked about products or pricing, say the live catalog is not cached right now and link ' +
  'to the store directly so the user can confirm current details themselves.'

export async function buildAugmentedUserContentAsync(
  displayPrompt: string,
  keywordSource: string,
  promptLabel: 'User message' | 'Question' = 'User message',
): Promise<string> {
  const faq = getFaqText()
  const store = buildStorePageContext()
  const vector = await buildHybridVectorContextAsync(keywordSource)
  const products = buildProductDocsContext(keywordSource)
  const code = buildRelevantContext(keywordSource)
  const parts: string[] = []
  if (faq) parts.push(faq)
  if (store) {
    parts.push(store)
  } else if (storePageSnapshotEnabled) {
    parts.push(NO_STORE_DATA_NOTICE)
  }
  if (vector) parts.push(vector)
  if (products) parts.push(products)
  if (code) parts.push(code)
  if (parts.length > 0) {
    return parts.join('\n\n') + `\n\n---\n${promptLabel}:\n` + displayPrompt
  }
  return displayPrompt
}
