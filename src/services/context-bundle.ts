/**
 * Assembles FAQ + optional vector context + product docs + keyword codebase for Gemini user turns.
 */
import { buildRelevantContext } from './codebase.ts'
import { buildVectorContextAsync } from './embeddings.ts'
import { getFaqText } from './faq.ts'
import { buildProductDocsContext } from './product-docs.ts'

export async function buildAugmentedUserContentAsync(
  displayPrompt: string,
  keywordSource: string,
  promptLabel: 'User message' | 'Question' = 'User message',
): Promise<string> {
  const faq = getFaqText()
  const vector = await buildVectorContextAsync(keywordSource)
  const products = buildProductDocsContext(keywordSource)
  const code = buildRelevantContext(keywordSource)
  const parts: string[] = []
  if (faq) parts.push(faq)
  if (vector) parts.push(vector)
  if (products) parts.push(products)
  if (code) parts.push(code)
  if (parts.length > 0) {
    return parts.join('\n\n') + `\n\n---\n${promptLabel}:\n` + displayPrompt
  }
  return displayPrompt
}
