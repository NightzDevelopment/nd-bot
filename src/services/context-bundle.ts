/**
 * Assembles FAQ + live store snapshot + optional vector context + product docs + keyword codebase for Gemini user turns.
 */
import { buildRelevantContext } from './codebase.ts'
import { getFaqText } from './faq.ts'
import { buildProductDocsContext } from './product-docs.ts'
import { buildStorePageContext } from './store-snapshot.ts'
import { buildHybridVectorContextAsync } from './universal-nd-expert.ts'

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
  if (store) parts.push(store)
  if (vector) parts.push(vector)
  if (products) parts.push(products)
  if (code) parts.push(code)
  if (parts.length > 0) {
    return parts.join('\n\n') + `\n\n---\n${promptLabel}:\n` + displayPrompt
  }
  return displayPrompt
}
