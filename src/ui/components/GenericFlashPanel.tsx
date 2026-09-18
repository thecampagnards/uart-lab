import { useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Card,
  Divider,
  Group,
  List,
  NativeSelect,
  NumberInput,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import {
  parseFirmwareProtocol,
  validateFirmwareProtocol,
  type FirmwareProtocol,
} from '../../core/firmware'
import { FIRMWARE_PROFILES, findFirmwareProfile } from '../../devices/firmwareProfiles'
import type { SessionState } from '../../hooks/useLd2420Session'
import { FirmwareDangerNotice, FirmwareTransferForm } from './FirmwareTransferForm'
import { JsonDocumentCard } from './JsonDocumentCard'

const STORAGE_KEY = 'uart-lab.flash.descriptor'

/**
 * Firmware transfer against a descriptor the user writes.
 *
 * Every field is editable, command bytes included, because the point is to
 * reach a module this tool has never seen. Nothing here can tell you whether
 * the bytes are right — only the module can, and it answers by either working
 * or not. So the descriptor is checked for the things that are checkable
 * (ranges, collisions, arithmetic), the transfer stops at the first command
 * that is refused, and the write is behind two acknowledgements.
 */
export function GenericFlashPanel({
  defaultProfileId,
  state,
  onUpload,
  onError,
}: {
  /** The descriptor the selected device nominates, used as the starting point. */
  defaultProfileId: string
  state: SessionState
  onUpload: (image: Uint8Array, protocol: FirmwareProtocol) => void
  onError: (message: string) => void
}) {
  const fallback = findFirmwareProfile(defaultProfileId) ?? FIRMWARE_PROFILES[0]!
  // Persisted, so a descriptor worked out by trial does not die with a reload.
  const [protocol, setProtocol] = useLocalStorage<FirmwareProtocol>({
    key: STORAGE_KEY,
    defaultValue: fallback,
    getInitialValueInEffect: false,
  })
  const [presetId, setPresetId] = useState(protocol.id)

  const problems = useMemo(() => validateFirmwareProtocol(protocol), [protocol])
  const busy = state.pendingOperation !== null

  /** Any edit makes the descriptor the user's own, whatever it started from. */
  const edit = (patch: Partial<FirmwareProtocol>): void => {
    setProtocol((current) => ({
      ...current,
      ...patch,
      id: 'custom',
      label: current.verified ? `${current.label} (edited)` : current.label,
      verified: false,
    }))
  }

  const editCommand = (name: keyof FirmwareProtocol['commands'], value: number): void => {
    setProtocol((current) => ({
      ...current,
      commands: { ...current.commands, [name]: value },
      id: 'custom',
      label: current.verified ? `${current.label} (edited)` : current.label,
      verified: false,
    }))
  }

  const loadPreset = (id: string): void => {
    const preset = findFirmwareProfile(id)
    if (!preset) return
    setPresetId(id)
    setProtocol(preset)
  }

  return (
    <>
      <FirmwareDangerNotice />

      <Card>
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm" mb="sm">
          <div style={{ maxWidth: 560 }}>
            <Title order={2}>Target descriptor</Title>
            <Text size="xs" c="dimmed">
              The frame envelope is shared across Hi-Link&rsquo;s LD family, so the same transfer
              sequence can drive a module this tool knows nothing about — provided the descriptor
              below matches it. Start from a preset and edit, or paste one in.
            </Text>
          </div>
          <Badge variant="light" color={protocol.verified ? 'green' : 'red'}>
            {protocol.verified ? 'verified descriptor' : 'unverified descriptor'}
          </Badge>
        </Group>

        <NativeSelect
          label="Start from"
          size="sm"
          w={280}
          value={presetId}
          onChange={(event) => loadPreset(event.currentTarget.value)}
          data={[
            ...FIRMWARE_PROFILES.map((profile) => ({
              value: profile.id,
              label: profile.verified ? `${profile.label} (verified)` : profile.label,
            })),
            ...(protocol.id === 'custom' ? [{ value: 'custom', label: 'Custom (edited)' }] : []),
          ]}
        />

        <Divider my="md" label="Commands" labelPosition="left" />
        <Group gap="sm" wrap="wrap">
          <HexInput
            label="get_upgrade_partition"
            value={protocol.commands.getUpgradePartition}
            disabled={busy}
            onChange={(value) => editCommand('getUpgradePartition', value)}
          />
          <HexInput
            label="set_upgrade_mode"
            value={protocol.commands.setUpgradeMode}
            disabled={busy}
            onChange={(value) => editCommand('setUpgradeMode', value)}
          />
          <HexInput
            label="init_firmware_upgrade"
            value={protocol.commands.initUpgrade}
            disabled={busy}
            onChange={(value) => editCommand('initUpgrade', value)}
          />
          <HexInput
            label="send_firmware_block"
            value={protocol.commands.sendBlock}
            disabled={busy}
            onChange={(value) => editCommand('sendBlock', value)}
          />
          <HexInput
            label="reboot"
            value={protocol.commands.reboot}
            disabled={busy}
            onChange={(value) => editCommand('reboot', value)}
          />
        </Group>

        <Divider my="md" label="Geometry" labelPosition="left" />
        <Group gap="sm" wrap="wrap" align="flex-start">
          <NumberInput
            label="Block size (bytes)"
            size="sm"
            w={160}
            min={4}
            max={4096}
            step={4}
            allowDecimal={false}
            allowNegative={false}
            value={protocol.blockSize}
            disabled={busy}
            onChange={(value) => {
              const blockSize = toInt(value, protocol.blockSize)
              edit({ blockSize, maxBlockFrameLength: 16 + blockSize + 4 })
            }}
          />
          <NumberInput
            label="Flash size (bytes)"
            size="sm"
            w={170}
            min={1024}
            step={1024}
            allowDecimal={false}
            allowNegative={false}
            value={protocol.flashSize}
            disabled={busy}
            onChange={(value) => edit({ flashSize: toInt(value, protocol.flashSize) })}
          />
          <NumberInput
            label="Alignment"
            size="sm"
            w={110}
            min={1}
            max={16}
            allowDecimal={false}
            allowNegative={false}
            value={protocol.alignment}
            disabled={busy}
            onChange={(value) => edit({ alignment: toInt(value, protocol.alignment) })}
          />
          <NumberInput
            label="Erase timeout (ms)"
            size="sm"
            w={160}
            min={100}
            step={1000}
            allowDecimal={false}
            allowNegative={false}
            value={protocol.eraseTimeoutMs}
            disabled={busy}
            onChange={(value) => edit({ eraseTimeoutMs: toInt(value, protocol.eraseTimeoutMs) })}
          />
          <NumberInput
            label="Block timeout (ms)"
            size="sm"
            w={160}
            min={100}
            step={500}
            allowDecimal={false}
            allowNegative={false}
            value={protocol.blockTimeoutMs}
            disabled={busy}
            onChange={(value) => edit({ blockTimeoutMs: toInt(value, protocol.blockTimeoutMs) })}
          />
        </Group>

        <Divider my="md" label="Replies" labelPosition="left" />
        <Group gap="sm" wrap="wrap" align="flex-start">
          <HexInput
            label="status: block written"
            value={protocol.status.written}
            disabled={busy}
            onChange={(value) => edit({ status: { ...protocol.status, written: value } })}
          />
          <HexInput
            label="status: programming done"
            value={protocol.status.programmed}
            disabled={busy}
            onChange={(value) => edit({ status: { ...protocol.status, programmed: value } })}
          />
          <HexInput
            label="status: bad block counter"
            value={protocol.status.counterError}
            disabled={busy}
            onChange={(value) => edit({ status: { ...protocol.status, counterError: value } })}
          />
          <TextInput
            label="Accepted partitions"
            description="Values get_upgrade_partition may return"
            size="sm"
            w={220}
            value={Object.keys(protocol.partitions)
              .map((key) => `0x${Number(key).toString(16).padStart(2, '0')}`)
              .join(', ')}
            disabled={busy}
            onChange={(event) => {
              const partitions = parsePartitions(event.currentTarget.value)
              if (partitions) edit({ partitions })
            }}
          />
        </Group>

        {protocol.caveat ? (
          <Alert color="yellow" variant="light" mt="md">
            {protocol.caveat}
          </Alert>
        ) : null}

        {problems.length > 0 ? (
          <Alert color="red" variant="light" mt="md" role="alert">
            <List size="sm" spacing={2}>
              {problems.map((problem) => (
                <List.Item key={problem}>{problem}</List.Item>
              ))}
            </List>
          </Alert>
        ) : null}

        <Text size="xs" c="dimmed" mt="md">
          Nothing here can tell you whether these bytes are right for your module — only the module
          can. The transfer stops at the first command it refuses, which is before anything is
          erased, so a wrong <code>get_upgrade_partition</code> costs you nothing. A wrong{' '}
          <code>set_upgrade_mode</code> does not: if the module enters upgrade mode and then rejects
          the rest, it stays there.
        </Text>
      </Card>

      <JsonDocumentCard
        title="Descriptor as JSON"
        description="The whole descriptor, to keep, share, or paste in for a module that is not in the list."
        value={JSON.stringify(protocol, null, 2)}
        disabled={busy}
        loadLabel="Load descriptor"
        hint="Checked for ranges and collisions only; the command bytes themselves cannot be verified here."
        onLoad={(text) => {
          try {
            const parsed = parseFirmwareProtocol(text)
            setProtocol(parsed)
            setPresetId(findFirmwareProfile(parsed.id) ? parsed.id : 'custom')
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            onError(message)
            throw error instanceof Error ? error : new Error(message)
          }
        }}
      />

      {problems.length === 0 ? (
        <FirmwareTransferForm
          protocol={protocol}
          state={state}
          onUpload={onUpload}
          onError={onError}
          {...(protocol.verified
            ? {}
            : {
                extraAcknowledgement:
                  'I have confirmed this descriptor against my own module, or I accept that it may be left unusable.',
              })}
        />
      ) : (
        <Alert variant="light">Fix the descriptor above before choosing an image.</Alert>
      )}
    </>
  )
}

function HexInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  const [text, setText] = useState(`0x${value.toString(16).padStart(2, '0')}`)
  const [touched, setTouched] = useState(false)
  // While untouched the field follows the descriptor, so loading a preset or a
  // pasted document updates it; once edited it follows the keystrokes.
  const shown = touched ? text : `0x${value.toString(16).padStart(2, '0')}`
  const parsed = parseByte(shown)

  return (
    <TextInput
      label={label}
      size="sm"
      w={190}
      value={shown}
      disabled={disabled}
      error={parsed === null}
      spellCheck={false}
      styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
      onChange={(event) => {
        const next = event.currentTarget.value
        setTouched(true)
        setText(next)
        const byte = parseByte(next)
        if (byte !== null) onChange(byte)
      }}
      onBlur={() => setTouched(false)}
    />
  )
}

/** Accepts `0x71`, `71h`, `113` — anything that lands on a single byte. */
function parseByte(text: string): number | null {
  const clean = text.trim().replace(/h$/i, '')
  if (clean === '') return null
  const value = /^0x/i.test(clean) ? Number.parseInt(clean.slice(2), 16) : Number(clean)
  return Number.isInteger(value) && value >= 0 && value <= 0xff ? value : null
}

/** `"0x01, 0x02"` → `{1: 'partition 0x01', 2: 'partition 0x02'}`, or null if unparseable. */
function parsePartitions(text: string): Record<number, string> | null {
  const parts = text
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  const out: Record<number, string> = {}
  for (const part of parts) {
    const value = parseByte(part)
    if (value === null) return null
    out[value] = `partition 0x${value.toString(16).padStart(2, '0')}`
  }
  return out
}

function toInt(value: string | number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback
}
