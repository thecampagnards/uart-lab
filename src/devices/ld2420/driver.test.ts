import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OperatingMode } from './constants'
import { cloneConfig, factoryConfig } from './config'
import { CommandTimeoutError, Ld2420Driver, type Measurement } from './driver'
import { Ld2420Simulator } from './simulator'
import type { Transport, TransportInfo, Unsubscribe } from '../../core/transport'

/** A transport that answers nothing, to exercise the timeout path. */
class SilentTransport implements Transport {
  readonly kind = 'simulated' as const
  readonly info: TransportInfo = { label: 'silent' }
  isOpen = true
  baudRate = 115200
  written: Uint8Array[] = []
  open(): Promise<void> {
    return Promise.resolve()
  }
  reopen(): Promise<void> {
    return Promise.resolve()
  }
  close(): Promise<void> {
    return Promise.resolve()
  }
  write(bytes: Uint8Array): Promise<void> {
    this.written.push(bytes)
    return Promise.resolve()
  }
  onData(): Unsubscribe {
    return () => undefined
  }
  onClose(): Unsubscribe {
    return () => undefined
  }
}

describe('Ld2420Driver against the simulator', () => {
  let simulator: Ld2420Simulator
  let driver: Ld2420Driver

  beforeEach(async () => {
    simulator = new Ld2420Simulator({ autoRun: false, firmware: 'v1.6.1', serial: 'LD2420TEST' })
    driver = new Ld2420Driver(simulator)
    driver.attach()
    await simulator.open(115200)
  })

  afterEach(async () => {
    driver.detach()
    await simulator.close()
  })

  it('reads the firmware version and serial number', async () => {
    const identity = await driver.readIdentity()
    expect(identity.firmware).toBe('v1.6.1')
    expect(identity.serial).toBe('LD2420TEST')
    expect(driver.inCommandMode).toBe(false)
  })

  it('reads the full configuration in batches', async () => {
    const config = await driver.readConfig()
    expect(config).toEqual(factoryConfig())
  })

  it('writes only what changed and reads it back', async () => {
    const current = await driver.readConfig()
    const next = cloneConfig(current)
    next.timeoutS = 12
    next.maxGate = 8
    next.moveThresholds[5] = 777

    const writes = await driver.writeConfig(current, next)
    expect(writes).toBe(3)

    const readBack = await driver.readConfig()
    expect(readBack.timeoutS).toBe(12)
    expect(readBack.maxGate).toBe(8)
    expect(readBack.moveThresholds[5]).toBe(777)
    expect(readBack.moveThresholds[6]).toBe(current.moveThresholds[6])
  })

  it('skips the round trip entirely when nothing changed', async () => {
    const config = await driver.readConfig()
    const before = driver.trace.length
    expect(await driver.writeConfig(config, config)).toBe(0)
    expect(driver.trace.length).toBe(before)
  })

  it('refuses an invalid configuration before touching the wire', async () => {
    const config = await driver.readConfig()
    const broken = { ...cloneConfig(config), maxGate: 99 }
    const before = driver.trace.length
    await expect(driver.writeConfig(config, broken)).rejects.toThrow(/Maximum gate/)
    expect(driver.trace.length).toBe(before)
  })

  it('restores the factory configuration', async () => {
    const current = await driver.readConfig()
    const modified = cloneConfig(current)
    modified.timeoutS = 99
    await driver.writeConfig(current, modified)
    await driver.factoryReset(modified)
    expect(await driver.readConfig()).toEqual(factoryConfig())
  })

  it('streams energy reports once switched to report mode', async () => {
    const seen: Measurement[] = []
    driver.onMeasurement((m) => seen.push(m))

    await driver.setMode(OperatingMode.Report)
    expect(driver.mode).toBe(OperatingMode.Report)
    for (let i = 0; i < 5; i++) simulator.tick(100)

    expect(seen).toHaveLength(5)
    expect(seen[0]!.energy).toHaveLength(16)
    expect(seen[0]!.distanceCm).toBeGreaterThan(0)
  })

  it('streams ASCII lines in simple mode', async () => {
    const seen: Measurement[] = []
    driver.onMeasurement((m) => seen.push(m))
    await driver.setMode(OperatingMode.Simple)
    for (let i = 0; i < 3; i++) simulator.tick(100)
    // A detection is two lines — `Range N` then `ON` — so three ticks yield six.
    expect(seen).toHaveLength(6)
    expect(seen[0]!.energy).toEqual([])
    expect(seen[0]!.distanceCm).toBeGreaterThan(0)
  })

  it('carries the last distance across the bare ON line', async () => {
    const seen: Measurement[] = []
    driver.onMeasurement((m) => seen.push(m))
    await driver.setMode(OperatingMode.Simple)
    simulator.tick(100)
    // Both lines of one detection report the same distance, not `Range` then 0.
    expect(seen).toHaveLength(2)
    expect(seen[1]!.distanceCm).toBe(seen[0]!.distanceCm)
  })

  it('goes quiet in command mode and resumes after', async () => {
    const seen: Measurement[] = []
    await driver.setMode(OperatingMode.Report)
    driver.onMeasurement((m) => seen.push(m))

    await driver.openCommandMode()
    simulator.tick(100)
    simulator.tick(100)
    expect(seen).toHaveLength(0)

    await driver.closeCommandMode()
    simulator.tick(100)
    expect(seen).toHaveLength(1)
  })

  it('comes back in simple mode after a reboot', async () => {
    await driver.setMode(OperatingMode.Report)
    await driver.reboot()
    expect(driver.mode).toBe(OperatingMode.Simple)
    const seen: Measurement[] = []
    driver.onMeasurement((m) => seen.push(m))
    simulator.tick(100)
    expect(seen[0]!.energy).toEqual([])
  })

  it('records both directions in the trace', async () => {
    await driver.readIdentity()
    const directions = new Set(driver.trace.map((entry) => entry.direction))
    expect(directions).toEqual(new Set(['tx', 'rx']))
    expect(driver.trace.some((e) => e.note?.includes('ACK'))).toBe(true)
    driver.clearTrace()
    expect(driver.trace).toHaveLength(0)
  })

  it('caps the trace so a long session does not leak memory', async () => {
    const small = new Ld2420Driver(simulator, { maxTraceEntries: 10 })
    small.attach()
    for (let i = 0; i < 20; i++) await small.readIdentity()
    expect(small.trace.length).toBe(10)
    small.detach()
  })
})

describe('Ld2420Driver error handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('times out instead of hanging when the device says nothing', async () => {
    const driver = new Ld2420Driver(new SilentTransport(), { commandTimeoutMs: 50 })
    driver.attach()
    const promise = driver.openCommandMode()
    const assertion = expect(promise).rejects.toBeInstanceOf(CommandTimeoutError)
    await vi.advanceTimersByTimeAsync(100)
    await assertion
  })

  it('stays usable after a timeout', async () => {
    const transport = new SilentTransport()
    const driver = new Ld2420Driver(transport, { commandTimeoutMs: 50 })
    driver.attach()
    const first = driver.openCommandMode().catch(() => 'failed')
    await vi.advanceTimersByTimeAsync(100)
    expect(await first).toBe('failed')

    const second = driver.openCommandMode().catch(() => 'failed again')
    await vi.advanceTimersByTimeAsync(100)
    expect(await second).toBe('failed again')
    expect(transport.written.length).toBe(2)
  })
})
