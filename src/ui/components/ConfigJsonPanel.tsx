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
import { parseConfigFile, toConfigFile, type Ld2420Config } from '../../devices/ld2420/config'

type Mode = 'view' | 'edit'

/**
 * The configuration as JSON, in the page.
 *
 * Exporting and re-importing a file is the right shape for keeping a profile
 * around, but it is heavy for reading a value, diffing two setups, or pasting a
 * configuration someone sent you. This shows the same document inline and takes
 * it back the same way.
 */
export function ConfigJsonPanel({
  config,
  device,
  disabled,
  onApply,
  onError,
}: {
  config: Ld2420Config
  device: { firmware?: string; serial?: string }
  disabled: boolean
  onApply: (config: Ld2420Config) => void
  onError: (message: string) => void
}) {
  const [mode, setMode] = useState<Mode>('view')
  /**
   * Null means "not editing". An empty string is a real state — the box the
   * user has just cleared — so it cannot double as the absent case.
   */
  const [draft, setDraft] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const current = JSON.stringify(toConfigFile(config, device), null, 2)
  const text = mode === 'view' ? current : (draft ?? current)

  const enterMode = (next: Mode): void => {
    setMode(next)
    // Entering edit seeds the buffer with what is on screen; leaving drops it,
    // so the box never shows a stale document beside live values.
    setDraft(next === 'edit' ? current : null)
    setProblem(null)
  }

  const handleApply = (): void => {
    try {
      const parsed = parseConfigFile(text)
      setProblem(null)
      onApply(parsed)
      enterMode('view')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setProblem(message)
      onError(message)
    }
  }

  return (
    <Card>
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm" mb="sm">
        <div>
          <Title order={2}>Configuration as JSON</Title>
          <Text size="xs" c="dimmed">
            The same document the export produces. Paste one here to load it without going through a
            file.
          </Text>
        </div>
        <Group gap="xs">
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(value) => enterMode(value === 'edit' ? 'edit' : 'view')}
            data={[
              { value: 'view', label: 'View' },
              { value: 'edit', label: 'Paste' },
            ]}
          />
          <CopyButton value={current} timeout={1500}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Copied' : 'Copy to clipboard'}>
                <ActionIcon
                  variant="default"
                  size="lg"
                  aria-label="Copy the configuration"
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
        aria-label="Configuration as JSON"
        value={text}
        readOnly={mode === 'view'}
        onChange={setDraft}
        autosize
        minRows={12}
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
          <Button size="xs" disabled={disabled} onClick={handleApply}>
            Load into the form
          </Button>
          <Button variant="default" size="xs" onClick={() => setMode('view')}>
            Cancel
          </Button>
          <Text size="xs" c="dimmed">
            Loading only fills the form — nothing reaches the module until you press “Write to
            module”.
          </Text>
        </Group>
      ) : null}
    </Card>
  )
}
