import { Button, Card, Group, Text, Title } from '@mantine/core'
import type { FirmwareProtocol } from '../../core/firmware'
import type { SessionState } from '../../hooks/useLd2420Session'
import { DefinitionList } from './primitives'
import { FirmwareDangerNotice, FirmwareTransferForm } from './FirmwareTransferForm'

export function FirmwarePanel({
  protocol,
  state,
  onReadInfo,
  onUpload,
  onError,
}: {
  protocol: FirmwareProtocol
  state: SessionState
  onReadInfo: () => void
  onUpload: (image: Uint8Array, protocol: FirmwareProtocol) => void
  onError: (message: string) => void
}) {
  const busy = state.pendingOperation !== null

  return (
    <>
      <FirmwareDangerNotice />

      <Card>
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm" mb="sm">
          <div>
            <Title order={2}>Module firmware</Title>
            <Text size="xs" c="dimmed">
              Which image is running, and which partition a transfer would be written into.
            </Text>
          </div>
          <Button variant="default" size="xs" disabled={busy} onClick={onReadInfo}>
            Read firmware information
          </Button>
        </Group>

        {state.firmwareInfo ? (
          <DefinitionList
            items={[
              { term: 'Version', value: state.identity.firmware ?? 'unknown' },
              { term: 'Running image', value: state.firmwareInfo.active },
              ...(state.firmwareInfo.buildId === undefined
                ? []
                : [{ term: 'Build', value: state.firmwareInfo.buildId, mono: true }]),
              { term: 'Target partition', value: state.firmwareInfo.partition },
            ]}
          />
        ) : (
          <Text size="sm" c="dimmed">
            Not read yet.
          </Text>
        )}
      </Card>

      <FirmwareTransferForm
        protocol={protocol}
        state={state}
        onUpload={onUpload}
        onError={onError}
      />
    </>
  )
}
