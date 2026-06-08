import type { RegexScript } from '@/types'

/**
 * Applies a list of regex scripts to a string.
 * @param text The input text to process.
 * @param scripts The array of regex scripts from the character card.
 * @returns The processed text after applying all enabled regex scripts.
 */
export function applyRegexScripts(text: string, scripts?: RegexScript[]): string {
  if (!scripts || !scripts.length) return text
  
  let result = text
  for (const script of scripts) {
    if (!script.enabled || !script.findRegex) continue
    
    try {
      // Parse findRegex. If it's in /pattern/flags format, extract pattern and flags.
      // Otherwise, default to global match.
      let pattern = script.findRegex
      let flags = 'g'
      
      const match = script.findRegex.match(/^\/(.*?)\/([gimy]*)$/)
      if (match) {
        pattern = match[1]
        flags = match[2]
        // Ensure global flag is present to prevent infinite loop or partial replaces
        if (!flags.includes('g')) flags += 'g'
      }
      
      const regex = new RegExp(pattern, flags)
      // Resolve escape sequences in replaceString (e.g. \n -> newline, \t -> tab)
      const formattedReplace = script.replaceString
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        
      result = result.replace(regex, formattedReplace)
    } catch (e) {
      console.error(`Error executing regex script "${script.scriptName}":`, e)
    }
  }
  
  return result
}
