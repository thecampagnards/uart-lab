import { useRef } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  FileButton,
  Group,
  LoadingOverlay,
  Modal,
  NumberInput,
  Table,
  Text,
  Title,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { GATE_SIZE_M, TOTAL_GATES } from '../../devices/ld2420/constants'
import {
  cloneConfig,
  FIELD_LIMITS,
  parseConfigFile,
  toConfigFile,
  validateConfig,
  type Ld2420Config,
} from '../../devices/ld2420/config'
import { linearToDb } from '../../devices/ld2420/frames'
import type { SessionState } from '../../hooks/useLd2420Session'
import { gateRangeLabel } from '../charts/format'
import { ConfigJsonPanel } from './ConfigJsonPanel'

export interface ConfigPanelProps {
  state: SessionState
  onChange: (update: (draft: Ld2420Config) => Ld2420Config) => void
  onApply: () => void
  onRevert: () => void
  onReload: () => void
  onFactoryReset: () => void
  onReboot: () => void
  onError: (message: string) => void
}

export function ConfigPanel({
  state,
  onChange,
  onApply,
  onRevert,
  onReload,
  onFactoryReset,
  onReboot,
  onError,
}: ConfigPanelProps) {
  const draft = state.draftConfig
  const resetFile = useRef<() => void>(null)
  const [confirmOpen, confirm] = useDisclosure(false)
  const problems = validateConfig(draft)
  const problemFields = new Set(problems.map((problem) => problem.field))
  const locked = state.pendingOperation !== null || state.deviceConfig === null

  const setField = <K extends keyof Ld2420Config>(key: K, value: Ld2420Config[K]): void => {
    onChange((current) => ({ ...cloneConfig(current), [key]: value }))
  }

  const setThreshold = (
    kind: 'moveThresholds' | 'stillThresholds',
    gate: number,
    value: number,
  ): void => {
    onChange((current) => {
      const next = cloneConfig(current)
      next[kind][gate] = value
      return next
    })
  }

  const handleExport = (): void => {
    const file = toConfigFile(draft, {
      ...(state.identity.firmware !== undefined ? { firmware: state.identity.firmware } : {}),
      ...(state.identity.serial !== undefined ? { serial: state.identity.serial } : {}),
    })
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `ld2420-config-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (file: File | null): Promise<void> => {
    resetFile.current?.()
    if (!file) return
    try {
      const config = parseConfigFile(await file.text())
      onChange(() => config)
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <>
      <Card pos="relative">
        <LoadingOverlay visible={state.pendingOperation !== null} zIndex={2} />
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm" mb="sm">
          <div>
            <Title order={2}>General parameters</Title>
            <Text size="xs" c="dimmed">
              Changes stay local until you press “Write to module”.
            </Text>
          </div>
          <Group gap="xs">
            {state.dirty ? (
              <Badge color="yellow" variant="light">
                Unwritten changes
              </Badge>
            ) : null}
            <Button variant="default" size="xs" disabled={locked} onClick={onReload}>
              Re-read from module
            </Button>
            <Button
              variant="default"
              size="xs"
              disabled={locked || !state.dirty}
              onClick={onRevert}
            >
              Discard
            </Button>
            <Button
              size="xs"
              disabled={locked || !state.dirty || problems.length > 0}
              onClick={onApply}
            >
              Write to module
            </Button>
          </Group>
        </Group>

        {state.pendingOperation ? (
          <Alert variant="light" mb="sm" role="status">
            {state.pendingOperation}…
          </Alert>
        ) : null}
        {problems.length > 0 ? (
          <Alert color="red" variant="light" mb="sm" role="alert">
            {problems.map((problem) => problem.message).join(' ')}
          </Alert>
        ) : null}

        <Group align="flex-start" gap="md" wrap="wrap">
          <NumberInput
            label="Minimum gate"
            size="sm"
            w={130}
            min={FIELD_LIMITS.gate.min}
            max={FIELD_LIMITS.gate.max}
            allowDecimal={false}
            allowNegative={false}
            value={draft.minGate}
            disabled={locked}
            error={problemFields.has('minGate')}
            onChange={(value) => setField('minGate', toInt(value))}
          />
          <NumberInput
            label="Maximum gate"
            size="sm"
            w={130}
            min={FIELD_LIMITS.gate.min}
            max={FIELD_LIMITS.gate.max}
            allowDecimal={false}
            allowNegative={false}
            value={draft.maxGate}
            disabled={locked}
            error={problemFields.has('maxGate')}
            onChange={(value) => setField('maxGate', toInt(value))}
          />
          <NumberInput
            label="Absence delay (s)"
            size="sm"
            w={150}
            min={FIELD_LIMITS.timeoutS.min}
            max={FIELD_LIMITS.timeoutS.max}
            allowDecimal={false}
            allowNegative={false}
            value={draft.timeoutS}
            disabled={locked}
            error={problemFields.has('timeoutS')}
            onChange={(value) => setField('timeoutS', toInt(value))}
          />
          <Text size="xs" c="dimmed" maw={320} mt="xl">
            Monitored range:{' '}
            <Text span fw={650} inherit>
              {(draft.minGate * GATE_SIZE_M).toFixed(1)} –{' '}
              {((draft.maxGate + 1) * GATE_SIZE_M).toFixed(1)} m
            </Text>
            . The delay holds the “present” state for that many seconds after the last detection.
          </Text>
        </Group>
      </Card>

      <Card pos="relative">
        <LoadingOverlay visible={state.pendingOperation !== null} zIndex={2} />
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm" mb="sm">
          <div style={{ maxWidth: 560 }}>
            <Title order={2}>Per-gate thresholds</Title>
            <Text size="xs" c="dimmed">
              Motion threshold: fires the detection. Still threshold: holds detection on a
              stationary target. Raw values are 0–65535; the dB column matches the scale used by the
              Hi-Link tool.
            </Text>
          </div>
          <Group gap="xs">
            <Button variant="default" size="xs" onClick={handleExport}>
              Export as JSON
            </Button>
            <FileButton
              resetRef={resetFile}
              accept="application/json,.json"
              onChange={(file) => void handleImport(file)}
            >
              {(props) => (
                <Button variant="default" size="xs" disabled={locked} {...props}>
                  Import…
                </Button>
              )}
            </FileButton>
          </Group>
        </Group>

        <Table.ScrollContainer minWidth={640}>
          <Table withTableBorder highlightOnHover>
            <Table.Caption>Detection thresholds per distance gate</Table.Caption>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Gate</Table.Th>
                <Table.Th>Distance</Table.Th>
                <Table.Th>Motion threshold</Table.Th>
                <Table.Th ta="right">dB</Table.Th>
                <Table.Th>Still threshold</Table.Th>
                <Table.Th ta="right">dB</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
              {Array.from({ length: TOTAL_GATES }, (_, gate) => {
                const inRange = gate >= draft.minGate && gate <= draft.maxGate
                const move = draft.moveThresholds[gate] ?? 0
                const still = draft.stillThresholds[gate] ?? 0
                return (
                  <Table.Tr key={gate} opacity={inRange ? 1 : 0.55}>
                    <Table.Th scope="row">{gate}</Table.Th>
                    <Table.Td>{gateRangeLabel(gate, GATE_SIZE_M)}</Table.Td>
                    <Table.Td>
                      <ThresholdInput
                        label={`Motion threshold, gate ${gate}`}
                        value={move}
                        disabled={locked}
                        invalid={problemFields.has(`moveThresholds.${gate}`)}
                        onChange={(value) => setThreshold('moveThresholds', gate, value)}
                      />
                    </Table.Td>
                    <Table.Td ta="right">{linearToDb(move).toFixed(1)}</Table.Td>
                    <Table.Td>
                      <ThresholdInput
                        label={`Still threshold, gate ${gate}`}
                        value={still}
                        disabled={locked}
                        invalid={problemFields.has(`stillThresholds.${gate}`)}
                        onChange={(value) => setThreshold('stillThresholds', gate, value)}
                      />
                    </Table.Td>
                    <Table.Td ta="right">{linearToDb(still).toFixed(1)}</Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      <ConfigJsonPanel
        config={draft}
        device={{
          ...(state.identity.firmware !== undefined ? { firmware: state.identity.firmware } : {}),
          ...(state.identity.serial !== undefined ? { serial: state.identity.serial } : {}),
        }}
        disabled={locked}
        onApply={(next) => onChange(() => next)}
        onError={onError}
      />

      <Card>
        <Title order={2}>Module actions</Title>
        <Text size="xs" c="dimmed" mb="sm">
          These act on the device immediately.
        </Text>
        <Group gap="xs">
          <Button variant="default" size="xs" disabled={locked} onClick={onReboot}>
            Restart module
          </Button>
          <Button color="red" variant="outline" size="xs" disabled={locked} onClick={confirm.open}>
            Factory defaults…
          </Button>
        </Group>
        <Text size="xs" c="dimmed" mt="sm">
          Baud rate changes and firmware updates are not exposed: the upgrade command{' '}
          <Code>0x74</Code> leaves the module unusable if the transfer does not complete.
        </Text>
      </Card>

      <Modal
        opened={confirmOpen}
        onClose={confirm.close}
        title="Restore factory defaults?"
        centered
      >
        <Text size="sm">
          Every threshold, the gate range and the absence delay will be replaced with the values
          from the factory table. The module keeps running; nothing is erased beyond these
          parameters.
        </Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={confirm.close}>
            Cancel
          </Button>
          <Button
            color="red"
            onClick={() => {
              confirm.close()
              onFactoryReset()
            }}
          >
            Restore
          </Button>
        </Group>
      </Modal>
    </>
  )
}

function ThresholdInput({
  label,
  value,
  disabled,
  invalid,
  onChange,
}: {
  label: string
  value: number
  disabled: boolean
  invalid: boolean
  onChange: (value: number) => void
}) {
  return (
    <NumberInput
      aria-label={label}
      size="xs"
      w={110}
      hideControls
      min={FIELD_LIMITS.threshold.min}
      max={FIELD_LIMITS.threshold.max}
      allowDecimal={false}
      allowNegative={false}
      thousandSeparator=","
      value={value}
      disabled={disabled}
      error={invalid}
      onChange={(next) => onChange(toInt(next))}
      styles={{ input: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }}
    />
  )
}

/** Keeps an emptied field from becoming NaN and poisoning the draft. */
function toInt(value: string | number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0
}
