import { Badge, Card, Code, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { DEVICES, type DeviceDescriptor } from '../../devices/registry'

export function DeviceList({
  selectedId,
  onSelect,
  connectedId,
}: {
  selectedId: string
  onSelect: (id: string) => void
  connectedId: string | null
}) {
  return (
    <Stack gap="sm" component="nav" aria-label="Devices to configure">
      <Text size="xs" tt="uppercase" fw={600} c="dimmed" style={{ letterSpacing: '0.08em' }}>
        My devices
      </Text>
      {DEVICES.map((device) => (
        <DeviceCard
          key={device.id}
          device={device}
          selected={device.id === selectedId}
          connected={device.id === connectedId}
          onSelect={onSelect}
        />
      ))}
      <Text size="xs" c="dimmed">
        Only one device is supported for now. The catalogue lives in{' '}
        <Code>src/devices/registry.ts</Code>.
      </Text>
    </Stack>
  )
}

function DeviceCard({
  device,
  selected,
  connected,
  onSelect,
}: {
  device: DeviceDescriptor
  selected: boolean
  connected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <UnstyledButton
      onClick={() => onSelect(device.id)}
      disabled={!device.implemented}
      aria-current={selected}
      style={{ opacity: device.implemented ? 1 : 0.55 }}
    >
      <Card
        padding="sm"
        style={{
          borderColor: selected ? 'var(--mantine-primary-color-filled)' : undefined,
          boxShadow: selected ? 'inset 3px 0 0 var(--mantine-primary-color-filled)' : undefined,
        }}
      >
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <Text fw={650} size="sm">
            {device.name}
          </Text>
          {connected ? (
            <Badge size="xs" color="green" variant="light">
              connected
            </Badge>
          ) : null}
        </Group>
        <Text size="xs" c="dimmed">
          {device.vendor}
        </Text>
        <Text size="xs" mt={6}>
          {device.summary}
        </Text>
      </Card>
    </UnstyledButton>
  )
}
