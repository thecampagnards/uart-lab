import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Button,
  Card,
  Code,
  Group,
  NativeSelect,
  ScrollArea,
  SegmentedControl,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { fromHex } from '../../core/bytes'
import type { RawSerialLog, RawViewMode } from '../../core/rawLog'
import { useRawSnapshot } from '../../hooks/useRawSnapshot'
import { formatNumber } from '../charts/format'

type SendMode = 'text' | 'hex'

const LINE_ENDINGS: Record<string, string> = {
  none: '',
  cr: '\r',
  lf: '\n',
  crlf: '\r\n',
}

/**
 * The wire, undecoded.
 *
 * Every other view here assumes a framing. This one assumes nothing, which is
 * what you need when the question is "is anything coming out of this at all,
 * and at what bit rate" — a decoder answers that with silence either way.
 */
export function TerminalPanel({
  log,
  connected,
  onSend,
  onClear,
}: {
  log: RawSerialLog
  connected: boolean
  onSend: (bytes: Uint8Array) => void
  onClear: () => void
}) {
  const [mode, setMode] = useState<RawViewMode>('text')
  const [follow, setFollow] = useState(true)
  const [paused, setPaused] = useState(false)
  const [sendMode, setSendMode] = useState<SendMode>('text')
  const [ending, setEnding] = useState('crlf')
  const [input, setInput] = useState('')
  const viewport = useRef<HTMLDivElement>(null)

  // Pausing stops the sampling, which is what freezes the view; the log keeps
  // recording underneath.
  const { lines, rate, totals } = useRawSnapshot(log, mode, connected && !paused, 8)

  useEffect(() => {
    if (!follow) return
    const node = viewport.current
    if (!node) return
    // Assigning scrollTop rather than calling scrollTo: same effect, and it does
    // not depend on a method jsdom leaves unimplemented.
    node.scrollTop = node.scrollHeight
  }, [follow, lines.length])

  const outgoing = useMemo(() => {
    if (input === '') return null
    try {
      return sendMode === 'hex'
        ? fromHex(input)
        : new TextEncoder().encode(input + (LINE_ENDINGS[ending] ?? ''))
    } catch {
      return null
    }
  }, [ending, input, sendMode])

  const send = (): void => {
    if (!outgoing) return
    onSend(outgoing)
    setInput('')
  }

  return (
    <Card>
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm" mb="sm">
        <div style={{ maxWidth: 520 }}>
          <Title order={2}>Serial monitor</Title>
          <Text size="xs" c="dimmed">
            Everything on the wire, in both directions, with no framing assumed. If a device is
            sending anything at the selected bit rate, it shows up here.
          </Text>
        </div>
        <Group gap="xs">
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(value) => setMode(value === 'hex' ? 'hex' : 'text')}
            data={[
              { value: 'text', label: 'Text' },
              { value: 'hex', label: 'Hex' },
            ]}
          />
          <Switch
            size="sm"
            label="Follow"
            checked={follow}
            onChange={(event) => setFollow(event.currentTarget.checked)}
          />
          <Tooltip label={paused ? 'Resume the view' : 'Freeze the view; bytes keep arriving'}>
            <ActionIcon
              variant="default"
              size="lg"
              aria-label={paused ? 'Resume' : 'Pause'}
              onClick={() => setPaused((value) => !value)}
            >
              {paused ? '▶' : '❙❙'}
            </ActionIcon>
          </Tooltip>
          <Button variant="default" size="xs" onClick={onClear}>
            Clear
          </Button>
        </Group>
      </Group>

      <Group gap="lg" mb={6}>
        <Text size="xs" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatNumber(totals.received)} B received · {formatNumber(totals.sent)} B sent ·{' '}
          {rate > 0 ? `${formatNumber(rate)} B/s` : 'idle'}
        </Text>
        {paused ? (
          <Text size="xs" c="yellow">
            View frozen — bytes are still being recorded.
          </Text>
        ) : null}
      </Group>

      <ScrollArea.Autosize mah={420} type="auto" viewportRef={viewport}>
        {lines.length === 0 ? (
          <Text size="sm" c="dimmed" py="md">
            {connected
              ? 'Nothing received yet. If the device should be talking, the bit rate or the RX wire is the usual cause.'
              : 'Not connected.'}
          </Text>
        ) : (
          <Code block style={{ fontSize: 11.5, lineHeight: 1.6 }}>
            {lines.slice(-600).map((line) => (
              <div className="trace-line" key={`${line.direction}-${line.offset}-${line.key}`}>
                <span style={{ color: 'var(--mantine-color-dimmed)' }}>
                  {(line.t / 1000).toFixed(3)}
                </span>
                <span
                  style={{
                    color: line.direction === 'tx' ? 'var(--series-2)' : 'var(--series-1)',
                    fontWeight: 700,
                  }}
                >
                  {line.direction === 'tx' ? '→' : '←'}
                </span>
                <span>{line.text}</span>
              </div>
            ))}
          </Code>
        )}
      </ScrollArea.Autosize>

      <Group mt="md" gap="xs" align="flex-end" wrap="wrap">
        {/*
          Distinct labels from the view control above: two radio groups whose
          options are both "Text" and "Hex" are indistinguishable by name.
        */}
        <SegmentedControl
          size="xs"
          value={sendMode}
          onChange={(value) => setSendMode(value === 'hex' ? 'hex' : 'text')}
          data={[
            { value: 'text', label: 'ASCII' },
            { value: 'hex', label: 'Raw hex' },
          ]}
        />
        <TextInput
          label="Send"
          placeholder={sendMode === 'hex' ? 'fd fc fb fa 02 00 00 00 04 03 02 01' : 'AT'}
          size="sm"
          style={{ flex: '1 1 260px' }}
          value={input}
          disabled={!connected}
          error={input !== '' && outgoing === null}
          spellCheck={false}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
          onChange={(event) => setInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') send()
          }}
        />
        {sendMode === 'text' ? (
          <NativeSelect
            label="Line ending"
            size="sm"
            w={130}
            value={ending}
            onChange={(event) => setEnding(event.currentTarget.value)}
            data={[
              { value: 'crlf', label: 'CR LF' },
              { value: 'lf', label: 'LF' },
              { value: 'cr', label: 'CR' },
              { value: 'none', label: 'none' },
            ]}
          />
        ) : null}
        <Button size="sm" disabled={!connected || outgoing === null} onClick={send}>
          Send
        </Button>
      </Group>
      <Text size="xs" c="dimmed" mt={6}>
        Bytes go out exactly as entered — no framing, no checksum. In hex mode, whitespace and{' '}
        <Code>:</Code> are ignored.
      </Text>
    </Card>
  )
}
