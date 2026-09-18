import { Box, Card, Group, Text } from '@mantine/core'
import type { BoxProps } from '@mantine/core'
import type { ReactNode } from 'react'

export function Stat({
  label,
  value,
  unit,
  hint,
}: {
  label: string
  value: ReactNode
  unit?: string | undefined
  hint?: ReactNode | undefined
}) {
  return (
    <Card padding="sm">
      <Text size="xs" tt="uppercase" c="dimmed" fw={600} style={{ letterSpacing: '0.06em' }}>
        {label}
      </Text>
      <Group gap={4} align="baseline" mt={2}>
        <Text fz={26} fw={620} lh={1.2} style={{ letterSpacing: '-0.02em' }}>
          {value}
        </Text>
        {unit ? (
          <Text size="sm" c="dimmed">
            {unit}
          </Text>
        ) : null}
      </Group>
      {hint ? (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      ) : null}
    </Card>
  )
}

export interface DefinitionItem {
  term: string
  value: ReactNode
  mono?: boolean
}

export function DefinitionList({ items, ...box }: { items: DefinitionItem[] } & BoxProps) {
  return (
    <Box
      component="dl"
      {...box}
      style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px', margin: 0 }}
    >
      {items.map((item) => (
        <div key={item.term} style={{ display: 'contents' }}>
          <Text component="dt" size="sm" c="dimmed">
            {item.term}
          </Text>
          <Text
            component="dd"
            size="sm"
            {...(item.mono ? { ff: 'monospace' as const } : {})}
            style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}
          >
            {item.value}
          </Text>
        </div>
      ))}
    </Box>
  )
}
