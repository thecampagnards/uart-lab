import { useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Collapse,
  Group,
  NativeSelect,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { isWebSerialSupported } from '../../core/transport'
import { OPERATING_MODE_LABELS } from '../../devices/ld2420/constants'
import type { DeviceDescriptor } from '../../devices/registry'
import type { SessionState } from '../../hooks/useLd2420Session'
import { DefinitionList } from './primitives'
import { WiringDiagram } from './WiringDiagram'

export function ConnectionPanel({
  device,
  state,
  onConnectSerial,
  onConnectSimulator,
  onDisconnect,
}: {
  device: DeviceDescriptor
  state: SessionState
  onConnectSerial: (baudRate: number) => void
  onConnectSimulator: () => void
  onDisconnect: () => void
}) {
  const [baudRate, setBaudRate] = useState(device.defaultBaudRate)
  const [wiringOpen, wiring] = useDisclosure(false)
  const supported = isWebSerialSupported()
  const connected = state.status === 'connected' || state.status === 'busy'

  return (
    <Card>
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb="sm">
        <div>
          <Title order={2}>Connection</Title>
          <Text size="xs" c="dimmed">
            The browser opens the serial port through the Web Serial API. No data leaves your
            machine.
          </Text>
        </div>
        <Badge
          variant="light"
          color={connected ? 'green' : state.status === 'connecting' ? 'yellow' : 'gray'}
        >
          {connected
            ? state.transportKind === 'simulated'
              ? 'Simulated demo'
              : 'Connected'
            : state.status === 'connecting'
              ? 'Connecting…'
              : 'Disconnected'}
        </Badge>
      </Group>

      {!supported ? (
        <Alert color="yellow" variant="light" mb="sm">
          This browser does not expose the Web Serial API. Use Chrome, Edge or Opera on desktop — or
          start the simulated demo below to explore the interface.
        </Alert>
      ) : null}

      <Group align="flex-end" gap="sm">
        <NativeSelect
          label="Baud rate"
          size="sm"
          value={String(baudRate)}
          disabled={connected}
          onChange={(event) => setBaudRate(Number(event.currentTarget.value))}
          data={device.supportedBaudRates.map((rate) => ({
            value: String(rate),
            label: `${rate.toLocaleString('en-US')} baud${
              rate === 115200
                ? ' (default on fw ≥ 1.5.8)'
                : rate === 256000
                  ? ' (default on fw < 1.5.8)'
                  : ''
            }`,
          }))}
        />

        {connected ? (
          <Button variant="default" onClick={onDisconnect}>
            Disconnect
          </Button>
        ) : (
          <>
            <Button
              disabled={!supported || state.status === 'connecting'}
              onClick={() => onConnectSerial(baudRate)}
            >
              Choose a serial port…
            </Button>
            <Button
              variant="default"
              disabled={state.status === 'connecting'}
              onClick={onConnectSimulator}
            >
              Simulated demo
            </Button>
          </>
        )}
      </Group>

      {connected ? (
        <DefinitionList
          mt="md"
          items={[
            { term: 'Port', value: state.portLabel ?? '—' },
            { term: 'Baud rate', value: `${state.baudRate.toLocaleString('en-US')} baud · 8N1` },
            { term: 'Firmware', value: state.identity.firmware ?? 'unknown' },
            { term: 'Serial number', value: state.identity.serial ?? '—', mono: true },
            { term: 'Mode', value: OPERATING_MODE_LABELS[state.mode] },
          ]}
        />
      ) : (
        <Stack gap="xs" mt="md">
          <Group gap="xs">
            <Text size="xs" c="dimmed">
              FT232RL wiring: <Code>TXD→RX</Code>, <Code>RXD←OT1</Code>, <Code>GND→GND</Code>,{' '}
              <Code>3V3→3V3</Code>.
            </Text>
            <Button variant="subtle" size="compact-xs" onClick={wiring.toggle}>
              {wiringOpen ? 'Hide the diagram' : 'Show the diagram'}
            </Button>
          </Group>
          <Collapse expanded={wiringOpen}>
            <WiringDiagram />
          </Collapse>
        </Stack>
      )}
    </Card>
  )
}
