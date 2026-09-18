import { useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Code,
  FileButton,
  Group,
  List,
  Modal,
  Progress,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import {
  firmwareChecksum,
  splitFirmwareBlocks,
  validateFirmwareImage,
  type FirmwareProtocol,
} from '../../core/firmware'
import type { SessionState } from '../../hooks/useLd2420Session'
import { formatNumber } from '../charts/format'
import { DefinitionList } from './primitives'

const PHASE_LABELS: Record<string, string> = {
  preparing: 'Preparing',
  erasing: 'Erasing the target partition',
  writing: 'Writing blocks',
  verifying: 'Verifying',
  restarting: 'Restarting the module',
  done: 'Done',
}

/**
 * Pick an image, check it, and write it — shared by the device-specific
 * firmware tab and the generic one, which differ only in how the protocol
 * descriptor is chosen.
 */
export function FirmwareTransferForm({
  protocol,
  state,
  onUpload,
  onError,
  extraAcknowledgement,
}: {
  protocol: FirmwareProtocol
  state: SessionState
  onUpload: (image: Uint8Array, protocol: FirmwareProtocol) => void
  onError: (message: string) => void
  /** A second, profile-specific confirmation, for unverified descriptors. */
  extraAcknowledgement?: string
}) {
  const [image, setImage] = useState<{ name: string; bytes: Uint8Array } | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [extraAcknowledged, setExtraAcknowledged] = useState(false)
  const [confirmOpen, confirm] = useDisclosure(false)
  const resetFile = useRef<() => void>(null)

  const busy = state.pendingOperation !== null
  const progress = state.firmwareProgress
  const problems = image ? validateFirmwareImage(image.bytes, protocol) : []
  const blocks = image ? splitFirmwareBlocks(image.bytes, protocol.blockSize).length : 0
  const ready =
    image !== null &&
    problems.length === 0 &&
    acknowledged &&
    (extraAcknowledgement === undefined || extraAcknowledged) &&
    !busy

  const handleFile = async (file: File | null): Promise<void> => {
    resetFile.current?.()
    setAcknowledged(false)
    setExtraAcknowledged(false)
    setImage(null)
    if (!file) return
    try {
      setImage({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
    } catch (error) {
      onError(
        `Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return (
    <>
      <Card>
        <Title order={2}>Write an image</Title>
        <Text size="xs" c="dimmed" mb="sm">
          The image is sent in {formatNumber(protocol.blockSize)}-byte blocks, each with its own
          checksum, after the module has erased the target partition.
        </Text>

        <Group gap="sm" align="center">
          <FileButton
            resetRef={resetFile}
            accept=".bin,application/octet-stream"
            onChange={(file) => void handleFile(file)}
          >
            {(props) => (
              <Button variant="default" size="xs" disabled={busy} {...props}>
                Choose a .bin file…
              </Button>
            )}
          </FileButton>
          {image ? (
            <Text size="sm" ff="monospace">
              {image.name}
            </Text>
          ) : (
            <Text size="sm" c="dimmed">
              No file selected.
            </Text>
          )}
        </Group>

        {image ? (
          <DefinitionList
            mt="sm"
            items={[
              { term: 'Size', value: `${formatNumber(image.bytes.length)} bytes` },
              { term: 'Blocks', value: formatNumber(blocks) },
              {
                term: 'Checksum',
                value: `0x${firmwareChecksum(image.bytes).toString(16).padStart(8, '0')}`,
                mono: true,
              },
            ]}
          />
        ) : null}

        {problems.length > 0 ? (
          <Alert color="red" variant="light" mt="sm" role="alert">
            <List size="sm" spacing={2}>
              {problems.map((problem) => (
                <List.Item key={problem}>{problem}</List.Item>
              ))}
            </List>
          </Alert>
        ) : null}

        {image && problems.length === 0 ? (
          <Stack gap="xs" mt="md">
            <Checkbox
              checked={acknowledged}
              disabled={busy}
              onChange={(event) => setAcknowledged(event.currentTarget.checked)}
              label="I understand this overwrites the module's firmware and cannot be undone."
            />
            {extraAcknowledgement ? (
              <Checkbox
                color="red"
                checked={extraAcknowledged}
                disabled={busy}
                onChange={(event) => setExtraAcknowledged(event.currentTarget.checked)}
                label={extraAcknowledgement}
              />
            ) : null}
          </Stack>
        ) : null}

        <Group mt="md">
          <Button color="red" disabled={!ready} onClick={confirm.open}>
            Write firmware to module
          </Button>
        </Group>

        {progress ? (
          <Stack gap={6} mt="md">
            <Group justify="space-between">
              <Text size="sm">{PHASE_LABELS[progress.phase] ?? progress.phase}</Text>
              <Text size="sm" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatNumber(progress.blocksSent)} / {formatNumber(progress.totalBlocks)} blocks ·{' '}
                {formatNumber(progress.bytesSent)} / {formatNumber(progress.totalBytes)} bytes
              </Text>
            </Group>
            <Progress
              value={progress.totalBytes > 0 ? (progress.bytesSent / progress.totalBytes) * 100 : 0}
              animated={progress.phase !== 'done'}
              aria-label="Firmware transfer progress"
            />
            {progress.message ? (
              <Text size="xs" c="dimmed">
                {progress.message}
              </Text>
            ) : null}
          </Stack>
        ) : null}
      </Card>

      <Modal opened={confirmOpen} onClose={confirm.close} title="Write firmware?" centered>
        <Text size="sm">
          {image ? (
            <>
              <Code>{image.name}</Code> — {formatNumber(image.bytes.length)} bytes in{' '}
              {formatNumber(blocks)} blocks — will be written using the{' '}
              <strong>{protocol.label}</strong> descriptor.
            </>
          ) : null}
        </Text>
        <Text size="sm" mt="sm">
          The module enters upgrade mode first. From that point it will not respond to anything else
          until a transfer completes, so an interruption leaves it waiting for another attempt
          rather than working.
        </Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={confirm.close}>
            Cancel
          </Button>
          <Button
            color="red"
            onClick={() => {
              confirm.close()
              if (image) onUpload(image.bytes, protocol)
            }}
          >
            Write it
          </Button>
        </Group>
      </Modal>
    </>
  )
}

export function FirmwareDangerNotice() {
  return (
    <Alert color="red" variant="light" title="This can leave the module unusable">
      <Text size="sm">
        Writing firmware is the one operation here that cannot be undone. The{' '}
        <Code>set_upgrade_mode</Code> command stops the module answering almost everything else, and
        the protocol documentation records no way back out except completing a transfer. If the link
        drops mid-write, the module stays in upgrade mode until a transfer succeeds.
      </Text>
      <List size="sm" mt="xs" spacing={2}>
        <List.Item>Use a firmware image meant for this exact module and nothing else.</List.Item>
        <List.Item>Keep the USB bridge plugged in and the module powered throughout.</List.Item>
        <List.Item>Do not close this tab or navigate away while the transfer is running.</List.Item>
      </List>
    </Alert>
  )
}
