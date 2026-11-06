// The pane's shared building blocks, as in nanoflow: semantic colors and the small pieces every card repeats.
// Reach for these before writing a Box/Text/Button by hand. Plain functions taking the surface's element
// table, because the surface hands us its own elements.
import type { Elements } from 'claude-code'

export type PaneElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

type Child = ReturnType<Elements['terminal']['Text']> | false | null | undefined | 0 | ''

/** Theme keys, so the pane follows the person's light or dark theme. */
export const COLOR = {
  brand: 'claude',
  busy: 'warning',
  ok: 'success',
  bad: 'error',
  hold: 'permission',
  info: 'suggestion',
  muted: 'inactive',
} as const

/** A horizontal, wrapping line of parts; `indent` nests it that many levels (2 columns each). */
export const Row = (el: PaneElements, key: string, children: Child[], opts: { gap?: number; indent?: number; wrap?: boolean } = {}) => {
  const { Box } = el
  return (
    <Box key={key} flexDirection="row" gap={opts.gap ?? 1} flexWrap={opts.wrap === false ? 'nowrap' : 'wrap'} {...(opts.indent ? { paddingLeft: 2 * opts.indent } : {})}>
      {children.filter(c => c !== 0 && c !== '')}
    </Box>
  )
}

/** A status glyph in its color. */
export type Look = { icon: string; color: string }

export const Mark = (el: PaneElements, key: string, look: Look, text = '') => {
  const { Text } = el
  return <Text key={key} color={look.color}>{`${look.icon}${text}`}</Text>
}

/** A plain button that folds and unfolds what follows it: `▾ label` open, `▸ label` closed. */
export const Fold = (el: PaneElements, key: string, open: boolean, label: string, onPress: () => void) => {
  const { Button } = el
  return <Button key={key} plain label={`${open ? '▾' : '▸'} ${label}`} onPress={onPress} />
}
