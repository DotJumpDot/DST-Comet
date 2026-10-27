/**
 * Transcript echo of "Send to Chat" staged contexts, derived from durable
 * user-message content. The submit path (`dsh-adapter/channel/attached-context.ts`)
 * appends an `<attached-context … title="…">` text block the channel itself
 * builds; parsing it back is channel-format knowledge, so it lives beside the
 * shared projector that needs it — the same contract as `selection-record.ts`
 * next door. The bubble never shows the block (the translator keeps only the
 * FIRST text block as user text), so without this indicator the human cannot
 * see that their reply carried the panel's context at all.
 */
import type { AttachedContextEcho } from '../adapter/ports/channel-view.js'

const OPEN_RE = /^<attached-context source="[^"]*" sourceId="[^"]*" title="([^"]*)">\n/

function unescapeAttr(value: string): string {
  // Reverse escapeSnippetAttr so the echoed title shows exactly what the
  // panel staged (`&` first so entities are not re-baked).
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

/**
 * Derive the echo entries from a user message's content blocks: every
 * `<attached-context …>` block contributes its title and body size. Works
 * identically live (the blocks ride the `user.message` event) and on replay
 * (the blocks are part of the persisted event), so the indicator never
 * depends on process-local state.
 */
export function replayAttachedContexts(
  content: readonly unknown[] | undefined,
): readonly AttachedContextEcho[] | undefined {
  if (content === undefined) return undefined
  const echoes: AttachedContextEcho[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const text = (block as { type?: unknown; text?: unknown }).text
    if ((block as { type?: unknown }).type !== 'text' || typeof text !== 'string') continue
    const opened = OPEN_RE.exec(text)
    if (opened === null) continue
    let body = text.slice(opened[0].length)
    if (body.endsWith('</attached-context>')) body = body.slice(0, -'</attached-context>'.length)
    if (body.endsWith('\n')) body = body.slice(0, -1)
    echoes.push({ title: unescapeAttr(opened[1]!), chars: body.length })
  }
  return echoes.length === 0 ? undefined : echoes
}
