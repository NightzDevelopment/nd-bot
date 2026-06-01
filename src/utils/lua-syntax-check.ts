/**
 * High-Performance Lua Lexical and Syntax Balance Checker
 * Developed under strict Nightz Development proprietary standards (no emojis)
 */

export interface SyntaxCheckResult {
  valid: boolean
  error?: string
  line?: number
  context?: string
}

const LUA_KEYWORDS = new Set([
  'and',
  'break',
  'do',
  'else',
  'elseif',
  'end',
  'false',
  'for',
  'function',
  'goto',
  'if',
  'in',
  'local',
  'nil',
  'not',
  'or',
  'repeat',
  'return',
  'then',
  'true',
  'until',
  'while',
])

/**
 * Validates basic Lua syntax, token balances, and common coding mistakes.
 */
export function checkLuaSyntax(code: string): SyntaxCheckResult {
  const lines = code.split(/\r?\n/)

  // 1. Bracket and Parenthesis Balance Verification
  const stack: { char: string; line: number; col: number }[] = []
  const pairs: Record<string, string> = { ')': '(', '}': '{', ']': '[' }

  for (let lNum = 0; lNum < lines.length; lNum++) {
    const line = lines[lNum]!
    let inString: string | null = null
    let isComment = false

    for (let cNum = 0; cNum < line.length; cNum++) {
      const char = line[cNum]!

      // Handle comments
      if (!inString && char === '-' && line[cNum + 1] === '-') {
        isComment = true
        break
      }

      // Handle string literals
      if ((char === '"' || char === "'") && (cNum === 0 || line[cNum - 1] !== '\\')) {
        if (!inString) {
          inString = char
        } else if (inString === char) {
          inString = null
        }
      }

      if (inString || isComment) continue

      if (['(', '{', '['].includes(char)) {
        stack.push({ char, line: lNum + 1, col: cNum + 1 })
      } else if ([')', '}', ']'].includes(char)) {
        const expected = pairs[char]
        if (stack.length === 0) {
          return {
            valid: false,
            error: `Unmatched closing character "${char}"`,
            line: lNum + 1,
            context: line.trim(),
          }
        }
        const top = stack.pop()!
        if (top.char !== expected) {
          return {
            valid: false,
            error: `Mismatched characters: expected closing for "${top.char}" (line ${top.line}) but found "${char}"`,
            line: lNum + 1,
            context: line.trim(),
          }
        }
      }
    }
  }

  if (stack.length > 0) {
    const unclosed = stack.pop()!
    return {
      valid: false,
      error: `Unclosed opening character "${unclosed.char}"`,
      line: unclosed.line,
      context: lines[unclosed.line - 1]?.trim(),
    }
  }

  // 2. Control Structure Token Balance Verification (if-then-end, function-end, while-do-end, for-do-end)
  let blockCount = 0

  for (let lNum = 0; lNum < lines.length; lNum++) {
    const line = lines[lNum]!
    const cleanLine = line
      .replace(/--.*/g, '') // remove inline comments
      .replace(/"(\\.|[^"\\])*"/g, '""') // remove double quoted strings
      .replace(/'(\\.|[^'\\])*'/g, "''") // remove single quoted strings
      .trim()

    if (!cleanLine) continue

    // Lexical tokenization
    const tokens = cleanLine.split(/[^a-zA-Z0-9_]+/).filter(Boolean)

    for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
      const token = tokens[tIdx]!

      // Increment blocks
      if (token === 'function') {
        blockCount++
      } else if (token === 'then') {
        blockCount++
      } else if (token === 'do') {
        // do keywords inside while/for loops open blocks
        blockCount++
      } else if (token === 'repeat') {
        blockCount++
      }

      // Decrement blocks
      if (token === 'end') {
        blockCount--
        if (blockCount < 0) {
          return {
            valid: false,
            error: `Unmatched "end" block statement`,
            line: lNum + 1,
            context: line.trim(),
          }
        }
      } else if (token === 'until') {
        blockCount--
        if (blockCount < 0) {
          return {
            valid: false,
            error: `Unmatched "until" loop statement`,
            line: lNum + 1,
            context: line.trim(),
          }
        }
      }
    }
  }

  if (blockCount > 0) {
    return {
      valid: false,
      error: `Missing "end" statement. ${blockCount} unclosed block structures detected.`,
      line: lines.length,
      context: lines[lines.length - 1]?.trim(),
    }
  }

  return { valid: true }
}

/**
 * Parses and validates all Lua code blocks inside a Markdown content string.
 */
export function validateMarkdownLuaBlocks(content: string): SyntaxCheckResult {
  const regex = /```lua\s*([\s\S]*?)```/gi
  let match
  while ((match = regex.exec(content)) !== null) {
    const luaCode = match[1]
    if (luaCode) {
      const res = checkLuaSyntax(luaCode)
      if (!res.valid) {
        return res
      }
    }
  }
  return { valid: true }
}
