import { useMemo } from 'react'
import { Button, Card, Code, Group, ScrollArea, Switch, Text, Title } from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import type { TraceEntry } from '../../devices/ld2420/driver'

const KIND_LABELS: Record<TraceEntry['kind'], string> = {
  command: 'command',
  response: 'response',
  energy: 'report',
  simple: 'ascii',
  debug: 'debug',
  unknown: 'unknown',
}

export function TracePanel({
  trace,
  onClear,
}: {
  trace: readonly TraceEntry[]
  onClear: () => void
}) {
  const [hideStream, setHideStream] = useLocalStorage({
    key: 'uart-lab.trace.hide-stream',
    defaultValue: true,
  })

  const visible = useMemo(
    () => (hideStream ? trace.filter((e) => e.kind === 'command' || e.kind === 'response') : trace),
    [hideStream, trace],
  )

  return (
    <Card>
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm" mb="sm">
        <div>
          <Title order={2}>Serial trace</Title>
          <Text size="xs" c="dimmed">
            Every frame exchanged, in hex. Useful for cross-checking against the protocol document.
          </Text>
        </div>
        <Group gap="sm">
          <Switch
            size="sm"
            label="Hide measurement stream"
            checked={hideStream}
            onChange={(event) => setHideStream(event.currentTarget.checked)}
          />
          <Button variant="default" size="xs" onClick={onClear}>
            Clear
          </Button>
        </Group>
      </Group>

      {visible.length === 0 ? (
        <Text size="sm" c="dimmed">
          No frames yet.
        </Text>
      ) : (
        <ScrollArea.Autosize mah={460} type="auto">
          <Code block style={{ fontSize: 11.5, lineHeight: 1.6 }}>
            {visible.slice(-250).map((entry, index) => (
              <div className="trace-line" key={`${entry.t}-${index}`}>
                <span style={{ color: 'var(--mantine-color-dimmed)' }}>
                  {(entry.t / 1000).toFixed(3)}
                </span>
                <span
                  style={{
                    color: entry.direction === 'tx' ? 'var(--series-2)' : 'var(--series-1)',
                    fontWeight: 700,
                  }}
                >
                  {entry.direction === 'tx' ? '→' : '←'}
                </span>
                <span>
                  {entry.hex}
                  <span style={{ color: 'var(--mantine-color-dimmed)' }}>
                    {'  '}
                    {KIND_LABELS[entry.kind]}
                    {entry.note ? ` · ${entry.note}` : ''}
                  </span>
                </span>
              </div>
            ))}
          </Code>
        </ScrollArea.Autosize>
      )}
    </Card>
  )
}
