import { useMemo, useState } from 'react'
import {
  Badge,
  Card,
  Group,
  SegmentedControl,
  SimpleGrid,
  Spoiler,
  Table,
  Text,
  Title,
} from '@mantine/core'
import type { MeasurementHistory } from '../../core/history'
import { GATE_SIZE_M, OperatingMode, TOTAL_GATES } from '../../devices/ld2420/constants'
import { linearToDb } from '../../devices/ld2420/frames'
import type { Ld2420Config } from '../../devices/ld2420/config'
import { useLiveSnapshot } from '../../hooks/useLiveSnapshot'
import type { SessionState } from '../../hooks/useLd2420Session'
import { DistanceTimeline } from '../charts/DistanceTimeline'
import { EnergyWaterfall } from '../charts/EnergyWaterfall'
import { GateEnergyChart } from '../charts/GateEnergyChart'
import { formatNumber, gateRangeLabel } from '../charts/format'
import { Stat } from './primitives'

const WINDOW_CHOICES = [
  { value: '15000', label: '15 s' },
  { value: '60000', label: '60 s' },
  { value: '180000', label: '180 s' },
]

export function LivePanel({
  state,
  history,
  config,
  onSetMode,
}: {
  state: SessionState
  history: MeasurementHistory
  config: Ld2420Config
  onSetMode: (mode: typeof OperatingMode.Report | typeof OperatingMode.Simple) => void
}) {
  const [windowMs, setWindowMs] = useState(60_000)
  const live = state.status === 'connected' || state.status === 'busy'
  const snapshot = useLiveSnapshot(history, windowMs, live, 10)
  const latest = snapshot.latest
  const energy = latest?.energy.length === TOTAL_GATES ? latest.energy : null
  const reportMode = state.mode === OperatingMode.Report

  // The heatmap buckets by time, so it only needs a new array twice a second.
  // Holding its input stable between buckets keeps 960 rects out of the 10 Hz
  // render path.
  const heatmapBucket = Math.floor((latest?.t ?? 0) / 500)
  const heatmapSamples = useMemo(
    () => snapshot.samples,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bucket is the intended cadence
    [heatmapBucket, windowMs],
  )

  return (
    <>
      {/* One filter row above everything it scopes, per the chart conventions. */}
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="xs">
          <Text size="xs" tt="uppercase" c="dimmed" fw={600}>
            Window
          </Text>
          <SegmentedControl
            size="xs"
            data={WINDOW_CHOICES}
            value={String(windowMs)}
            onChange={(value) => setWindowMs(Number(value))}
          />
        </Group>
        <Group gap="xs">
          <Text size="xs" tt="uppercase" c="dimmed" fw={600}>
            Mode
          </Text>
          <SegmentedControl
            size="xs"
            disabled={!live || state.pendingOperation !== null}
            value={reportMode ? 'report' : 'simple'}
            onChange={(value) =>
              onSetMode(value === 'report' ? OperatingMode.Report : OperatingMode.Simple)
            }
            data={[
              { value: 'report', label: 'Report (energy)' },
              { value: 'simple', label: 'Simple (ASCII)' },
            ]}
          />
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="sm">
        <Stat
          label="Presence"
          value={
            latest ? (
              <Badge size="lg" variant="light" color={latest.presence ? 'green' : 'gray'}>
                {latest.presence ? 'Detected' : 'None'}
              </Badge>
            ) : (
              '—'
            )
          }
          hint={`Absence delay: ${config.timeoutS} s`}
        />
        <Stat
          label="Distance"
          value={latest && latest.presence ? (latest.distanceCm / 100).toFixed(2) : '—'}
          unit={latest && latest.presence ? 'm' : undefined}
          hint={
            latest && latest.presence
              ? `gate ${Math.min(TOTAL_GATES - 1, Math.floor(latest.distanceCm / 100 / GATE_SIZE_M))}`
              : 'no target'
          }
        />
        <Stat
          label="Frame rate"
          value={snapshot.rateHz > 0 ? snapshot.rateHz.toFixed(1) : '—'}
          unit={snapshot.rateHz > 0 ? 'Hz' : undefined}
          hint={`${formatNumber(snapshot.totalSamples)} frames received`}
        />
        <Stat
          label="Active gates"
          value={`${config.minGate}–${config.maxGate}`}
          hint={`${(config.minGate * GATE_SIZE_M).toFixed(1)} – ${((config.maxGate + 1) * GATE_SIZE_M).toFixed(1)} m`}
        />
      </SimpleGrid>

      <Card>
        <Title order={2}>Energy per gate</Title>
        <Text size="xs" c="dimmed" mb="sm">
          Each bar is one 0.7 m gate. The ticks mark the configured thresholds: above a threshold,
          the gate fires.
        </Text>
        {energy ? (
          <GateEnergyChart
            energy={energy}
            moveThresholds={config.moveThresholds}
            stillThresholds={config.stillThresholds}
            minGate={config.minGate}
            maxGate={config.maxGate}
          />
        ) : (
          <Text size="sm" c="dimmed">
            {reportMode
              ? 'Waiting for the first report frame…'
              : 'Simple mode does not carry per-gate energy. Switch to report mode to feed this chart.'}
          </Text>
        )}
        {energy ? <GateTable energy={energy} config={config} /> : null}
      </Card>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Card>
          <Title order={2}>Distance over time</Title>
          <Text size="xs" c="dimmed" mb="sm">
            Grey bands are stretches with no reported presence.
          </Text>
          <DistanceTimeline samples={snapshot.samples} windowMs={windowMs} />
        </Card>
        <Card>
          <Title order={2}>Energy history</Title>
          <Text size="xs" c="dimmed" mb="sm">
            Time runs left to right, gates top to bottom: a target walking closer draws a diagonal.
          </Text>
          <EnergyWaterfall
            samples={heatmapSamples}
            windowMs={windowMs}
            minGate={config.minGate}
            maxGate={config.maxGate}
          />
        </Card>
      </SimpleGrid>
    </>
  )
}

/** The table view every chart needs: the same numbers, without colour. */
function GateTable({ energy, config }: { energy: readonly number[]; config: Ld2420Config }) {
  return (
    <Spoiler
      maxHeight={0}
      showLabel="Show the values as a table"
      hideLabel="Hide the table"
      mt="sm"
    >
      <Table.ScrollContainer minWidth={620} mt="xs">
        <Table striped highlightOnHover withTableBorder>
          <Table.Caption>
            Measured energy and configured thresholds, per distance gate
          </Table.Caption>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Gate</Table.Th>
              <Table.Th>Distance</Table.Th>
              <Table.Th ta="right">Energy</Table.Th>
              <Table.Th ta="right">Energy (dB)</Table.Th>
              <Table.Th ta="right">Motion threshold</Table.Th>
              <Table.Th ta="right">Still threshold</Table.Th>
              <Table.Th>State</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
            {energy.map((value, gate) => {
              const inRange = gate >= config.minGate && gate <= config.maxGate
              const move = config.moveThresholds[gate] ?? 0
              const still = config.stillThresholds[gate] ?? 0
              return (
                <Table.Tr key={gate} opacity={inRange ? 1 : 0.55}>
                  <Table.Th scope="row">{gate}</Table.Th>
                  <Table.Td>{gateRangeLabel(gate, GATE_SIZE_M)}</Table.Td>
                  <Table.Td ta="right">{formatNumber(value)}</Table.Td>
                  <Table.Td ta="right">{linearToDb(value).toFixed(1)}</Table.Td>
                  <Table.Td ta="right">{formatNumber(move)}</Table.Td>
                  <Table.Td ta="right">{formatNumber(still)}</Table.Td>
                  <Table.Td>
                    {!inRange
                      ? 'out of range'
                      : value > move
                        ? 'motion'
                        : value > still
                          ? 'still'
                          : '—'}
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Spoiler>
  )
}
