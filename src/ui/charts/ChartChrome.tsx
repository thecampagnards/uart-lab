import { Group, Text } from '@mantine/core'
import type { ReactNode } from 'react'

export interface LegendItem {
  label: string
  color: string
  /** Draw the swatch as a rule rather than a block, matching a line mark. */
  line?: boolean
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <Group gap="lg" mb={6}>
      {items.map((item) => (
        <Group gap={6} key={item.label} wrap="nowrap">
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: item.line ? 3 : 10,
              borderRadius: item.line ? 1 : 2,
              background: item.color,
              flex: 'none',
            }}
          />
          <Text size="xs" c="dimmed">
            {item.label}
          </Text>
        </Group>
      ))}
    </Group>
  )
}

export interface TooltipRow {
  label: string
  value: string
  color?: string
}

export function TooltipRows({
  title,
  rows,
  footer,
}: {
  title: string
  rows: TooltipRow[]
  footer?: ReactNode
}) {
  return (
    <div style={{ minWidth: 150 }}>
      <Text size="xs" fw={650} mb={4}>
        {title}
      </Text>
      {rows.map((row) => (
        <Group key={row.label} justify="space-between" gap="sm" wrap="nowrap">
          <Group gap={6} wrap="nowrap">
            {row.color ? (
              <span
                aria-hidden="true"
                style={{ width: 8, height: 8, borderRadius: 2, background: row.color }}
              />
            ) : null}
            <Text size="xs" c="dimmed">
              {row.label}
            </Text>
          </Group>
          <Text size="xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {row.value}
          </Text>
        </Group>
      ))}
      {footer ? (
        <Text size="xs" c="dimmed" mt={4}>
          {footer}
        </Text>
      ) : null}
    </div>
  )
}
