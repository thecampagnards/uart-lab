import { useMemo, useState } from 'react'
import { Alert, Card, Code, Group, NativeSelect, NumberInput, Text, Title } from '@mantine/core'
import type { FirmwareProtocol } from '../../core/firmware'
import {
  FIRMWARE_PROFILES,
  findFirmwareProfile,
  withOverrides,
} from '../../devices/ld2420/firmwareProfile'
import type { SessionState } from '../../hooks/useLd2420Session'
import { DefinitionList } from './primitives'
import { FirmwareDangerNotice, FirmwareTransferForm } from './FirmwareTransferForm'

/**
 * The same transfer, against a descriptor the user chooses.
 *
 * Kept as its own tab rather than folded into the device firmware tab, so the
 * unverified path stays visibly separate from the supported one.
 */
export function GenericFlashPanel({
  state,
  onUpload,
  onError,
}: {
  state: SessionState
  onUpload: (image: Uint8Array, protocol: FirmwareProtocol) => void
  onError: (message: string) => void
}) {
  const [profileId, setProfileId] = useState(FIRMWARE_PROFILES[1]?.id ?? FIRMWARE_PROFILES[0]!.id)
  const base = findFirmwareProfile(profileId) ?? FIRMWARE_PROFILES[0]!
  const [blockSize, setBlockSize] = useState(base.blockSize)
  const [flashSize, setFlashSize] = useState(base.flashSize)
  const [alignment, setAlignment] = useState(base.alignment)

  const protocol = useMemo(
    () => withOverrides(base, { blockSize, flashSize, alignment }),
    [alignment, base, blockSize, flashSize],
  )

  const selectProfile = (id: string): void => {
    const next = findFirmwareProfile(id)
    if (!next) return
    setProfileId(id)
    setBlockSize(next.blockSize)
    setFlashSize(next.flashSize)
    setAlignment(next.alignment)
  }

  return (
    <>
      <FirmwareDangerNotice />

      <Card>
        <Title order={2}>Target descriptor</Title>
        <Text size="xs" c="dimmed" mb="sm">
          The frame envelope is shared across Hi-Link&rsquo;s LD family, so the same transfer
          sequence can drive another module — provided its command bytes and sizes match. Choose or
          adjust the descriptor here.
        </Text>

        <Group align="flex-start" gap="md" wrap="wrap">
          <NativeSelect
            label="Profile"
            size="sm"
            w={260}
            value={profileId}
            onChange={(event) => selectProfile(event.currentTarget.value)}
            data={FIRMWARE_PROFILES.map((profile) => ({
              value: profile.id,
              label: profile.verified ? `${profile.label} (verified)` : profile.label,
            }))}
          />
          <NumberInput
            label="Block size (bytes)"
            size="sm"
            w={160}
            min={4}
            max={1024}
            step={4}
            allowDecimal={false}
            allowNegative={false}
            value={blockSize}
            onChange={(value) => setBlockSize(toInt(value, base.blockSize))}
          />
          <NumberInput
            label="Flash size (bytes)"
            size="sm"
            w={170}
            min={1024}
            max={4 * 1024 * 1024}
            step={1024}
            allowDecimal={false}
            allowNegative={false}
            value={flashSize}
            onChange={(value) => setFlashSize(toInt(value, base.flashSize))}
          />
          <NumberInput
            label="Alignment"
            size="sm"
            w={120}
            min={1}
            max={16}
            allowDecimal={false}
            allowNegative={false}
            value={alignment}
            onChange={(value) => setAlignment(toInt(value, base.alignment))}
          />
        </Group>

        {base.caveat ? (
          <Alert color="red" variant="light" mt="md" role="alert">
            {base.caveat}
          </Alert>
        ) : null}

        <DefinitionList
          mt="md"
          items={[
            {
              term: 'Commands',
              value: Object.entries(protocol.commands)
                .map(([name, code]) => `${name} 0x${code.toString(16).padStart(2, '0')}`)
                .join(' · '),
              mono: true,
            },
            {
              term: 'Block frame',
              value: `${protocol.maxBlockFrameLength} bytes end to end`,
            },
          ]}
        />
        <Text size="xs" c="dimmed" mt="xs">
          Command bytes are fixed: changing them without a capture of the vendor tool&rsquo;s
          traffic would be guessing. If your module answers <Code>NACK</Code> to{' '}
          <Code>get_upgrade_partition</Code>, the transfer stops before anything irreversible
          happens.
        </Text>
      </Card>

      <FirmwareTransferForm
        protocol={protocol}
        state={state}
        onUpload={onUpload}
        onError={onError}
        {...(base.verified
          ? {}
          : {
              extraAcknowledgement:
                'I have confirmed these command bytes against my own module, or I accept that it may be left unusable.',
            })}
      />
    </>
  )
}

function toInt(value: string | number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback
}
