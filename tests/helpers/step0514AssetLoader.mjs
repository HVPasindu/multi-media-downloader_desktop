import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ASSET_EXTENSIONS = [
  '.css',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.woff',
  '.woff2'
]

const JS_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const RESERVED_IDENTIFIERS = new Set([
  'default',
  'class',
  'function',
  'var',
  'let',
  'const',
  'import',
  'export',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'new',
  'delete',
  'typeof',
  'void',
  'in',
  'of',
  'try',
  'catch',
  'finally',
  'throw',
  'enum',
  'await',
  'yield',
  'with',
  'debugger',
  'extends',
  'super',
  'this',
  'true',
  'false',
  'null'
])

/**
 * Test-only ESM load hook for renderer assets (.png, .css, .json) in Node/JSDOM suites.
 */
export async function load(url, context, nextLoad) {
  const cleanUrl = url.split('?')[0].split('#')[0]
  const lowerUrl = cleanUrl.toLowerCase()

  if (ASSET_EXTENSIONS.some((ext) => lowerUrl.endsWith(ext))) {
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(cleanUrl)};\n`
    }
  }

  if (lowerUrl.endsWith('.json')) {
    const filePath = fileURLToPath(cleanUrl)
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    const lines = [`const __jsonData = ${JSON.stringify(parsed)};`, 'export default __jsonData;']

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const key of Object.keys(parsed)) {
        if (JS_IDENTIFIER_RE.test(key) && !RESERVED_IDENTIFIERS.has(key)) {
          lines.push(`export const ${key} = __jsonData[${JSON.stringify(key)}];`)
        }
      }
    }

    return {
      format: 'module',
      shortCircuit: true,
      source: `${lines.join('\n')}\n`
    }
  }

  const loaded = await nextLoad(url, context)
  if (
    loaded &&
    loaded.source != null &&
    lowerUrl.includes('/src/renderer/') &&
    (lowerUrl.endsWith('.js') || lowerUrl.endsWith('.jsx'))
  ) {
    const srcText =
      typeof loaded.source === 'string'
        ? loaded.source
        : Buffer.from(loaded.source).toString('utf8')
    if (srcText.includes('import.meta.env')) {
      return {
        ...loaded,
        source: srcText.replace(
          /\bimport\.meta\.env\b/g,
          '(import.meta.env ?? { DEV: false, PROD: true, MODE: "test" })'
        )
      }
    }
  }

  return loaded
}
