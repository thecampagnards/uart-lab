import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  List,
  Progress,
  Slider,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core'
import type { MeasurementHistory } from '../../core/history'
import { GATE_SIZE_M, OperatingMode, TOTAL_GATES } from '../../devices/ld2420/constants'
import {
  emptyStats,
  multipliers,
  proposeConfig,
  summarise,
  type GateStats,
} from '../../devices/ld2420/calibration'
import type { Ld2420Config } from '../../devices/ld2420/config'
import { useLiveSnapshot } from '../../hooks/useLiveSnapshot'
import type { SessionState } from '../../hooks/useLd2420Session'
import { GateEnergyChart } from '../charts/GateEnergyChart'
import { formatNumber, gateRangeLabel } from '../charts/format'

const RECORD_SECONDS = 20

type Stage = 'baseline' | 'presence'

/**
 * Guided threshold setting.
 *
 * Two recordings — the area empty, then the area occupied — and the thresholds
 * go between. The second one is what makes this more than a formula: it says
 * whether the threshold just proposed can actually be crossed, which is the
 * question you are really asking when you tune a presence sensor.
 */
export function PresenceAssistant({
  state,
  history,
  onApply,
  onSetReportMode,
}: {
  state: SessionState
  history: MeasurementHistory
  onApply: (config: Ld2420Config) => void
  onSetReportMode: () => void
}) {
  const [sensitivity, setSensitivity] = useState(0.5)
  const [baseline, setBaseline] = useState<GateStats>(emptyStats)
  const [presence, setPresence] = useState<GateStats | null>(null)
  const [recording, setRecording] = useState<{ stage: Stage; endsAt: number } | null>(null)

  const live = state.status === 'connected' || state.status === 'busy'
  const snapshot = useLiveSnapshot(history, RECORD_SECONDS * 1000, live || recording !== null, 5)
  const reportMode = state.mode === OperatingMode.Report

  const remaining = recording ? Math.max(0, recording.endsAt - Date.now()) : 0

  useEffect(() => {
    if (!recording) return
    const timer = setTimeout(
      () => {
        const frames = history.window(RECORD_SECONDS * 1000).map((m) => m.energy)
        const stats = summarise(frames)
        if (recording.stage === 'baseline') setBaseline(stats)
        else setPresence(stats)
        setRecording(null)
      },
      Math.max(0, recording.endsAt - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [history, recording])

  const start = (stage: Stage): void => {
    // Only the window that follows counts, so anything already buffered is
    // irrelevant — clearing makes the countdown mean what it says.
    history.clear()
    setRecording({ stage, endsAt: Date.now() + RECORD_SECONDS * 1000 })
  }

  const proposal = useMemo(
    () =>
      proposeConfig({
        baseline,
        presence,
        sensitivity,
        current: state.deviceConfig ?? state.draftConfig,
      }),
    [baseline, presence, sensitivity, state.deviceConfig, state.draftConfig],
  )

  const chartEnergy =
    presence && presence.samples > 0 ? presence.peak : baseline.samples > 0 ? baseline.peak : null

  return (
    <>
      {!reportMode ? (
        <Alert color="yellow" variant="light">
          <Group justify="space-between" wrap="wrap" gap="sm">
            <Text size="sm">
              Per-gate energy only arrives in report mode; simple mode sends presence and distance
              alone.
            </Text>
            <Button size="xs" onClick={onSetReportMode} disabled={state.pendingOperation !== null}>
              Switch to report mode
            </Button>
          </Group>
        </Alert>
      ) : null}

      <Card>
        <Title order={2}>Two recordings</Title>
        <Text size="xs" c="dimmed" mb="sm">
          A threshold has to sit above what the empty room reflects and below what a person puts
          into the same gate. Measuring both beats guessing at either.
        </Text>

        <Stack gap="md">
          <RecordStep
            index={1}
            title="Empty area"
            instruction="Leave the area the sensor covers, and keep still outside it. This measures what the room reflects on its own — furniture, walls, a moving curtain."
            stats={baseline}
            stage="baseline"
            recording={recording}
            remaining={remaining}
            disabled={!reportMode || !live || state.pendingOperation !== null}
            onStart={start}
          />
          <RecordStep
            index={2}
            title="Someone present"
            instruction="Move around the whole area you want covered, at the distances that matter. Walk to the far edge and back rather than standing in one spot."
            stats={presence}
            stage="presence"
            recording={recording}
            remaining={remaining}
            disabled={!reportMode || !live || state.pendingOperation !== null}
            optional
            onStart={start}
          />
        </Stack>

        {recording ? (
          <Text size="xs" c="dimmed" mt="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatNumber(snapshot.samples.length)} frames captured so far ·{' '}
            {snapshot.rateHz.toFixed(1)} Hz
          </Text>
        ) : null}
      </Card>

      <Card>
        <Title order={2}>Sensitivity</Title>
        <Text size="xs" c="dimmed" mb="lg">
          How far above the room's own clutter the thresholds sit. At the middle setting they land
          at {multipliers(sensitivity).move.toFixed(2)}× the measured peak, which is what the
          ESPHome component uses by default.
        </Text>
        <Slider
          value={sensitivity}
          onChange={setSensitivity}
          min={0}
          max={1}
          step={0.05}
          label={(value) => `${multipliers(value).move.toFixed(2)}× peak`}
          marks={[
            { value: 0, label: 'fewer false positives' },
            { value: 0.5, label: 'default' },
            { value: 1, label: 'catches less movement missed' },
          ]}
          mb="xl"
          aria-label="Detection sensitivity"
        />
      </Card>

      {proposal.usable ? (
        <>
          <Card>
            <Title order={2}>Proposal</Title>
            <Text size="xs" c="dimmed" mb="sm">
              Bars are the peak energy recorded{' '}
              {presence && presence.samples > 0 ? 'with someone present' : 'in the empty area'}; the
              ticks are the thresholds being proposed. A bar has to clear its motion tick for that
              gate to detect anything.
            </Text>
            {chartEnergy ? (
              <GateEnergyChart
                energy={chartEnergy}
                moveThresholds={proposal.config.moveThresholds}
                stillThresholds={proposal.config.stillThresholds}
                minGate={proposal.config.minGate}
                maxGate={proposal.config.maxGate}
              />
            ) : null}

            {proposal.warnings.length > 0 ? (
              <Alert color="yellow" variant="light" mt="sm">
                <List size="sm" spacing={4}>
                  {proposal.warnings.map((warning) => (
                    <List.Item key={warning}>{warning}</List.Item>
                  ))}
                </List>
              </Alert>
            ) : null}

            <Group mt="md" gap="sm">
              <Button
                disabled={state.pendingOperation !== null}
                onClick={() => onApply(proposal.config)}
              >
                Load into the configuration form
              </Button>
              <Text size="xs" c="dimmed">
                Fills the form only — nothing reaches the module until you write it there.
              </Text>
            </Group>
          </Card>

          <Card>
            <Title order={2}>Per gate</Title>
            <Text size="xs" c="dimmed" mb="sm">
              The same numbers, in full.
            </Text>
            <Table.ScrollContainer minWidth={640}>
              <Table withTableBorder highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Gate</Table.Th>
                    <Table.Th>Distance</Table.Th>
                    <Table.Th ta="right">Empty peak</Table.Th>
                    <Table.Th ta="right">Present peak</Table.Th>
                    <Table.Th ta="right">Motion</Table.Th>
                    <Table.Th ta="right">Still</Table.Th>
                    <Table.Th>Verdict</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {proposal.gates.map((gate) => {
                    const inRange =
                      gate.gate >= proposal.config.minGate && gate.gate <= proposal.config.maxGate
                    return (
                      <Table.Tr key={gate.gate} opacity={inRange ? 1 : 0.55}>
                        <Table.Th scope="row">{gate.gate}</Table.Th>
                        <Table.Td>{gateRangeLabel(gate.gate, GATE_SIZE_M)}</Table.Td>
                        <Table.Td ta="right">{formatNumber(gate.baselinePeak)}</Table.Td>
                        <Table.Td ta="right">
                          {gate.presencePeak === null ? '—' : formatNumber(gate.presencePeak)}
                        </Table.Td>
                        <Table.Td ta="right">{formatNumber(gate.move)}</Table.Td>
                        <Table.Td ta="right">{formatNumber(gate.still)}</Table.Td>
                        <Table.Td>
                          {gate.canFire === null ? (
                            <Text size="xs" c="dimmed">
                              not measured
                            </Text>
                          ) : gate.canFire ? (
                            <Badge size="xs" variant="light" color="green">
                              detects
                            </Badge>
                          ) : (
                            <Badge size="xs" variant="light" color="gray">
                              never crossed
                            </Badge>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    )
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Card>
        </>
      ) : (
        <Alert variant="light">{proposal.warnings[0]}</Alert>
      )}
    </>
  )
}

function RecordStep({
  index,
  title,
  instruction,
  stats,
  stage,
  recording,
  remaining,
  disabled,
  optional,
  onStart,
}: {
  index: number
  title: string
  instruction: string
  stats: GateStats | null
  stage: Stage
  recording: { stage: Stage; endsAt: number } | null
  remaining: number
  disabled: boolean
  optional?: boolean
  onStart: (stage: Stage) => void
}) {
  const busy = recording?.stage === stage
  const done = stats !== null && stats.samples > 0

  return (
    <Group align="flex-start" wrap="nowrap" gap="md">
      <Badge
        size="lg"
        circle
        variant={done ? 'filled' : 'light'}
        color={done ? 'green' : 'gray'}
        aria-hidden="true"
      >
        {index}
      </Badge>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Group gap="xs">
          <Text fw={650} size="sm">
            {title}
          </Text>
          {optional ? (
            <Text size="xs" c="dimmed">
              recommended
            </Text>
          ) : null}
          {done ? (
            <Text size="xs" c="dimmed">
              {formatNumber(stats.samples)} frames, peak{' '}
              {formatNumber(Math.max(...stats.peak.slice(0, TOTAL_GATES)))}
            </Text>
          ) : null}
        </Group>
        <Text size="xs" c="dimmed" mb="xs">
          {instruction}
        </Text>
        {busy ? (
          <Stack gap={4}>
            <Progress
              value={100 - (remaining / (RECORD_SECONDS * 1000)) * 100}
              animated
              aria-label={`Recording ${title}`}
            />
            <Text size="xs" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {Math.ceil(remaining / 1000)} s left — {title.toLowerCase()}
            </Text>
          </Stack>
        ) : (
          <Button
            size="xs"
            variant={done ? 'default' : 'filled'}
            disabled={disabled || recording !== null}
            onClick={() => onStart(stage)}
          >
            {done ? `Record ${title.toLowerCase()} again` : `Record ${RECORD_SECONDS} s`}
          </Button>
        )}
      </div>
    </Group>
  )
}
