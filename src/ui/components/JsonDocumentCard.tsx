import { useState } from 'react'
import {
  ActionIcon,
  Alert,
  Button,
  Card,
  CopyButton,
  Group,
  JsonInput,
  SegmentedControl,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'

type Mode = 'view' | 'edit'

/**
 * A JSON document shown in the page, with copy, and taken back by paste.
 *
 * A file round trip is the right shape for keeping something, but heavy for
 * reading one value or loading a document somebody pasted into a chat. Used for
 * both the device configuration and the firmware descriptor.
 */
export function JsonDocumentCard({
  title,
  description,
  value,
  disabled = false,
  loadLabel = 'Load into the form',
  hint,
  onLoad,
}: {
  title: string
  description: string
  /** The canonical document, re-serialised by the caller on every change. */
  value: string
  disabled?: boolean
  loadLabel?: string
  hint?: string
  /** Throw from here to reject the document; the message is shown in place. */
  onLoad: (text: string) => void
}) {
  const [mode, setMode] = useState<Mode>('view')
  /**
   * Null means "not editing". An empty string is a real state — the box the
   * user has just cleared — so it cannot double as the absent case.
   */
  const [draft, setDraft] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const text = mode === 'view' ? value : (draft ?? value)

  const enterMode = (next: Mode): void => {
    setMode(next)
    // Entering edit seeds the buffer with what is on screen; leaving drops it,
    // so the box never shows a stale document beside live values.
    setDraft(next === 'edit' ? value : null)
    setProblem(null)
  }

  const handleLoad = (): void => {
    try {
      onLoad(text)
      setProblem(null)
      enterMode('view')
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <Card>
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm" mb="sm">
        <div style={{ maxWidth: 520 }}>
          <Title order={2}>{title}</Title>
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        </div>
        <Group gap="xs">
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(next) => enterMode(next === 'edit' ? 'edit' : 'view')}
            data={[
              { value: 'view', label: 'View' },
              { value: 'edit', label: 'Paste' },
            ]}
          />
          <CopyButton value={value} timeout={1500}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Copied' : 'Copy to clipboard'}>
                <ActionIcon
                  variant="default"
                  size="lg"
                  aria-label={`Copy ${title.toLowerCase()}`}
                  onClick={copy}
                >
                  {copied ? '✓' : '⧉'}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        </Group>
      </Group>

      <JsonInput
        aria-label={title}
        value={text}
        readOnly={mode === 'view'}
        onChange={setDraft}
        autosize
        minRows={10}
        maxRows={24}
        formatOnBlur={mode === 'edit'}
        validationError={null}
        styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12 } }}
      />

      {problem ? (
        <Alert color="red" variant="light" mt="sm" role="alert">
          {problem}
        </Alert>
      ) : null}

      {mode === 'edit' ? (
        <Group mt="sm" gap="xs">
          <Button size="xs" disabled={disabled} onClick={handleLoad}>
            {loadLabel}
          </Button>
          <Button variant="default" size="xs" onClick={() => enterMode('view')}>
            Cancel
          </Button>
          {hint ? (
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          ) : null}
        </Group>
      ) : null}
    </Card>
  )
}
