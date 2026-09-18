/**
 * Device-independent firmware transfer.
 *
 * The Hi-Link LD modules share a frame envelope, and the vendor tools all drive
 * the same shape of transfer: read the target partition, enter upgrade mode,
 * announce the image, stream fixed-size blocks, reboot. What differs between
 * modules is the command bytes, the block and flash sizes, and the status
 * tables — so those live in a {@link FirmwareProtocol} descriptor and the
 * sequence below is written once.
 *
 * Only the LD2420 descriptor is backed by observation. See
 * `doc/protocol-notes.md`.
 */
import { u32le, readU32le } from './bytes'

export interface FirmwareProtocol {
  id: string
  label: string
  /**
   * True only where the command set has actually been observed on that
   * hardware. The UI refuses to treat an unverified profile as routine.
   */
  verified: boolean
  /** Shown beside the profile; say what is and is not known about it. */
  caveat?: string

  commands: {
    getUpgradePartition: number
    setUpgradeMode: number
    initUpgrade: number
    sendBlock: number
    reboot: number
  }

  /** Data bytes per block frame. */
  blockSize: number
  /** Total flash, for rejecting an obviously wrong image. */
  flashSize: number
  /** Image length must be a multiple of this. */
  alignment: number
  /** Frame ceiling for a block frame, which exceeds the ordinary command limit. */
  maxBlockFrameLength: number

  eraseTimeoutMs: number
  blockTimeoutMs: number
  /** Settle time after entering upgrade mode, which gets no reply. */
  upgradeModeSettleMs: number
  /** Settle time after the closing reboot. */
  rebootSettleMs: number

  status: {
    /** Init data-status values that mean failure. Anything else is a buffer size. */
    initErrors: Record<number, string>
    /** Block data-status bits that mean failure, in report order. */
    blockErrors: [number, string][]
    written: number
    programmed: number
    counterError: number
  }

  /** Partition values the module may report, and what they are called. */
  partitions: Record<number, string>
}

/** How the transfer talks to the device. The caller owns framing and queueing. */
export interface FirmwarePort {
  /** Send a command and resolve with the response payload after the status word. */
  exchange(
    command: number,
    payload: Uint8Array,
    timeoutMs: number,
    maxFrameLength: number,
  ): Promise<Uint8Array>
  /** Send a command the device does not answer. */
  send(command: number, payload: Uint8Array): Promise<void>
  wait(ms: number): Promise<void>
}

export type FirmwarePhase =
  'preparing' | 'erasing' | 'writing' | 'verifying' | 'restarting' | 'done'

export interface FirmwareProgress {
  phase: FirmwarePhase
  blocksSent: number
  totalBlocks: number
  bytesSent: number
  totalBytes: number
  message?: string
}

export class FirmwareError extends Error {
  constructor(
    message: string,
    /** Blocks written before the failure, so the UI can say how far it got. */
    readonly blocksSent: number,
  ) {
    super(message)
    this.name = 'FirmwareError'
  }
}

/** Sum of the bytes, truncated to 32 bits — what the init and block frames carry. */
export function firmwareChecksum(bytes: Uint8Array): number {
  let sum = 0
  for (const byte of bytes) sum = (sum + byte) >>> 0
  return sum >>> 0
}

/** Split an image into the fixed-size blocks the module accepts. */
export function splitFirmwareBlocks(image: Uint8Array, blockSize: number): Uint8Array[] {
  if (blockSize <= 0) throw new RangeError(`Block size must be positive, got ${blockSize}`)
  const blocks: Uint8Array[] = []
  for (let at = 0; at < image.length; at += blockSize) {
    blocks.push(image.slice(at, Math.min(at + blockSize, image.length)))
  }
  return blocks
}

/**
 * Check an image before anything irreversible happens.
 *
 * Alignment is the one the module enforces; the rest catches an obviously wrong
 * file — a .txt, a truncated download — while the module is still recoverable.
 */
export function validateFirmwareImage(
  image: Uint8Array,
  protocol: Pick<FirmwareProtocol, 'flashSize' | 'alignment'>,
): string[] {
  const problems: string[] = []
  if (image.length === 0) problems.push('The file is empty.')
  if (protocol.alignment > 1 && image.length % protocol.alignment !== 0) {
    problems.push(
      `The image is ${image.length} bytes, which is not a multiple of ${protocol.alignment}. ` +
        'The module rejects unaligned data.',
    )
  }
  if (image.length > protocol.flashSize) {
    problems.push(
      `The image is ${image.length} bytes but the target flash is ${protocol.flashSize} bytes.`,
    )
  }
  return problems
}

/** Human-readable reason for a rejected init, or null if it succeeded. */
export function describeInitStatus(
  dataStatus: number,
  protocol: Pick<FirmwareProtocol, 'status'>,
): string | null {
  return protocol.status.initErrors[dataStatus] ?? null
}

/** Reasons for a rejected block. The field is a bit set, so several can apply. */
export function describeBlockStatus(
  dataStatus: number,
  protocol: Pick<FirmwareProtocol, 'status'>,
): string[] {
  const { written, programmed, blockErrors } = protocol.status
  if (dataStatus === written || dataStatus === programmed) return []
  const reasons = blockErrors.filter(([bit]) => (dataStatus & bit) !== 0).map(([, text]) => text)
  return reasons.length > 0 ? reasons : [`Unknown block status 0x${dataStatus.toString(16)}.`]
}

/**
 * Run a complete firmware transfer.
 *
 * Irreversible from the moment `setUpgradeMode` is sent: the module stops
 * answering almost everything else and, per the protocol documentation, has no
 * known way back except completing a transfer. The caller is responsible for
 * taking informed consent first.
 */
export async function runFirmwareUpload(
  port: FirmwarePort,
  image: Uint8Array,
  protocol: FirmwareProtocol,
  onProgress: (progress: FirmwareProgress) => void = () => undefined,
): Promise<void> {
  const problems = validateFirmwareImage(image, protocol)
  if (problems.length > 0) throw new FirmwareError(problems.join(' '), 0)

  const blocks = splitFirmwareBlocks(image, protocol.blockSize)
  let blocksSent = 0

  const progress = (phase: FirmwarePhase, message?: string): void => {
    onProgress({
      phase,
      blocksSent,
      totalBlocks: blocks.length,
      bytesSent: Math.min(image.length, blocksSent * protocol.blockSize),
      totalBytes: image.length,
      ...(message === undefined ? {} : { message }),
    })
  }

  progress('preparing')

  const partitionReply = await port.exchange(
    protocol.commands.getUpgradePartition,
    new Uint8Array(0),
    protocol.blockTimeoutMs,
    Number.POSITIVE_INFINITY,
  )
  const partition = partitionReply.length >= 4 ? readU32le(partitionReply, 0) : 0
  if (protocol.partitions[partition] === undefined) {
    throw new FirmwareError(
      `The module reported an unusable upgrade partition (0x${partition.toString(16)}). ` +
        'Nothing has been written.',
      0,
    )
  }

  // Point of no return.
  progress('erasing', 'Entering upgrade mode')
  await port.send(protocol.commands.setUpgradeMode, new Uint8Array(0))
  await port.wait(protocol.upgradeModeSettleMs)

  const initReply = await port.exchange(
    protocol.commands.initUpgrade,
    Uint8Array.from([
      ...u32le(partition),
      ...u32le(image.length),
      ...u32le(firmwareChecksum(image)),
    ]),
    protocol.eraseTimeoutMs,
    Number.POSITIVE_INFINITY,
  )
  const initStatus = initReply.length >= 4 ? readU32le(initReply, 0) : 0
  const initProblem = describeInitStatus(initStatus, protocol)
  if (initProblem) throw new FirmwareError(initProblem, 0)

  /*
   * The LD2420 protocol document contradicts itself on the block counter: the
   * prose says the first block is 0, the worked example shows 1. Start at 0
   * and, if the module rejects the sequence number on the very first block,
   * switch to 1-based and retry rather than failing the transfer.
   */
  let counterBase = 0
  progress('writing')

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!
    let status = await sendBlock(port, protocol, counterBase + index, block)

    if (index === 0 && counterBase === 0 && (status & protocol.status.counterError) !== 0) {
      counterBase = 1
      status = await sendBlock(port, protocol, counterBase + index, block)
    }

    const blockProblems = describeBlockStatus(status, protocol)
    if (blockProblems.length > 0) {
      throw new FirmwareError(
        `Block ${index + 1} of ${blocks.length} rejected: ${blockProblems.join(' ')}`,
        blocksSent,
      )
    }

    blocksSent = index + 1
    if (status === protocol.status.programmed) {
      progress('verifying', 'Module reported programming complete')
      break
    }
    progress('writing')
  }

  progress('restarting')
  await port.send(protocol.commands.reboot, new Uint8Array(0))
  await port.wait(protocol.rebootSettleMs)
  progress('done')
}

async function sendBlock(
  port: FirmwarePort,
  protocol: FirmwareProtocol,
  counter: number,
  block: Uint8Array,
): Promise<number> {
  const payload = Uint8Array.from([...u32le(counter), ...u32le(firmwareChecksum(block)), ...block])
  const reply = await port.exchange(
    protocol.commands.sendBlock,
    payload,
    protocol.blockTimeoutMs,
    protocol.maxBlockFrameLength,
  )
  return reply.length >= 4 ? readU32le(reply, 0) : 0
}
