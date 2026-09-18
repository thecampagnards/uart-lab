/**
 * Owns the live link to one LD2420: transport, driver, config draft and the
 * measurement ring buffer. Everything the UI needs is derived from here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MeasurementHistory } from '../core/history'
import { RawSerialLog } from '../core/rawLog'
import { isWebSerialSupported, type Transport } from '../core/transport'
import { WebSerialTransport } from '../core/webserial'
import { deviceCan, LD2420, type DeviceDescriptor } from '../devices/registry'
import {
  DEFAULT_BAUD_RATE,
  OperatingMode,
  type OperatingModeValue,
} from '../devices/ld2420/constants'
import {
  cloneConfig,
  configsEqual,
  factoryConfig,
  validateConfig,
  type Ld2420Config,
} from '../devices/ld2420/config'
import {
  Ld2420Driver,
  validateFirmwareImage,
  type DeviceIdentity,
  type FirmwareInfo,
  type FirmwareProgress,
  type TraceEntry,
} from '../devices/ld2420/driver'
import { LD2420_FIRMWARE } from '../devices/ld2420/firmwareProfile'
import type { FirmwareProtocol } from '../core/firmware'
import { Ld2420Simulator } from '../devices/ld2420/simulator'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'busy'

export interface SessionNotice {
  id: number
  level: 'info' | 'warning' | 'error'
  message: string
}

export interface SessionState {
  status: ConnectionStatus
  transportKind: 'webserial' | 'simulated' | null
  portLabel: string | null
  baudRate: number
  identity: DeviceIdentity
  mode: OperatingModeValue
  /** What the module currently holds, as last read. */
  deviceConfig: Ld2420Config | null
  /** What the user is editing. */
  draftConfig: Ld2420Config
  dirty: boolean
  /** A long-running operation is in flight; the config form is locked. */
  pendingOperation: string | null
  notices: SessionNotice[]
  traceVersion: number
  /** Null until the firmware tab asks for it. */
  firmwareInfo: FirmwareInfo | null
  /** Non-null only while an image is being written. */
  firmwareProgress: FirmwareProgress | null
}

let noticeId = 0

export function useLd2420Session() {
  const historyRef = useRef(new MeasurementHistory(3000))
  /**
   * The unframed stream, tapped straight off the transport. Kept beside the
   * decoded history rather than derived from it: when you do not know what is
   * on the wire, the decoder's assumptions are what hide the answer.
   */
  const rawRef = useRef(new RawSerialLog())
  const openedAtRef = useRef(0)
  /** Latest state, readable from callbacks without adding it as a dependency. */
  const stateRef = useRef<SessionState | null>(null)
  const driverRef = useRef<Ld2420Driver | null>(null)
  const transportRef = useRef<Transport | null>(null)

  const [state, setState] = useState<SessionState>(() => ({
    status: 'disconnected',
    transportKind: null,
    portLabel: null,
    baudRate: DEFAULT_BAUD_RATE,
    identity: {},
    mode: OperatingMode.Simple,
    deviceConfig: null,
    draftConfig: factoryConfig(),
    dirty: false,
    pendingOperation: null,
    notices: [],
    traceVersion: 0,
    firmwareInfo: null,
    firmwareProgress: null,
  }))

  const patch = useCallback((update: Partial<SessionState>) => {
    setState((previous) => ({ ...previous, ...update }))
  }, [])

  const notify = useCallback((level: SessionNotice['level'], message: string) => {
    setState((previous) => ({
      ...previous,
      // Keep the last few; a burst of identical errors should not fill the page.
      notices: [
        ...previous.notices.filter((n) => n.message !== message),
        { id: ++noticeId, level, message },
      ].slice(-4),
    }))
  }, [])

  const dismissNotice = useCallback((id: number) => {
    setState((previous) => ({ ...previous, notices: previous.notices.filter((n) => n.id !== id) }))
  }, [])

  const teardown = useCallback(() => {
    driverRef.current?.detach()
    driverRef.current = null
    const transport = transportRef.current
    transportRef.current = null
    void transport?.close()
  }, [])

  useEffect(() => teardown, [teardown])

  /** Wire a freshly opened transport up to a driver and read the device. */
  const attach = useCallback(
    async (transport: Transport, device: DeviceDescriptor) => {
      const driver = new Ld2420Driver(transport)
      driverRef.current = driver
      transportRef.current = transport
      driver.attach()

      openedAtRef.current = performance.now()
      transport.onData((chunk) =>
        rawRef.current.push('rx', chunk, performance.now() - openedAtRef.current),
      )
      driver.onMeasurement((measurement) => historyRef.current.push(measurement))
      driver.onTrace(() => setState((p) => ({ ...p, traceVersion: p.traceVersion + 1 })))
      driver.onIdentity((identity) => patch({ identity }))
      driver.onError((error) => notify('error', error.message))

      transport.onClose((reason) => {
        if (reason) notify('error', `Lien interrompu : ${reason.message}`)
        driverRef.current = null
        transportRef.current = null
        patch({ status: 'disconnected', transportKind: null, portLabel: null })
      })

      patch({
        status: 'connected',
        transportKind: transport.kind,
        portLabel: transport.info.label,
        baudRate: transport.baudRate,
      })

      try {
        await driver.readIdentity()
      } catch (error) {
        notify(
          'warning',
          `Could not read the firmware version (${describe(error)}). Check the RX/TX wiring and the baud rate.`,
        )
      }

      // A device the tool only knows how to flash has no configuration to read
      // and no report mode to enter; probing anyway would just produce errors
      // that say nothing useful.
      if (!deviceCan(device, 'configure')) return

      try {
        const config = await driver.readConfig()
        patch({ deviceConfig: config, draftConfig: cloneConfig(config), dirty: false })
      } catch (error) {
        notify('error', `Could not read the configuration: ${describe(error)}`)
      }
      try {
        await driver.setMode(OperatingMode.Report)
        patch({ mode: OperatingMode.Report })
      } catch (error) {
        notify('warning', `Could not switch to report mode: ${describe(error)}`)
      }
    },
    [notify, patch],
  )

  const connectSerial = useCallback(
    async (baudRate: number, device: DeviceDescriptor = LD2420) => {
      if (!isWebSerialSupported()) {
        notify(
          'error',
          'The Web Serial API is not available in this browser. Try the simulated demo instead.',
        )
        return
      }
      patch({ status: 'connecting' })
      try {
        const transport = await WebSerialTransport.request(device.portFilters)
        historyRef.current.clear()
        rawRef.current.clear()
        await transport.open(baudRate)
        await attach(transport, device)
      } catch (error) {
        patch({ status: 'disconnected' })
        if (isUserCancellation(error)) return
        notify('error', `Could not connect: ${describe(error)}`)
      }
    },
    [attach, notify, patch],
  )

  const connectSimulator = useCallback(
    async (device: DeviceDescriptor = LD2420) => {
      patch({ status: 'connecting' })
      try {
        const simulator = new Ld2420Simulator()
        historyRef.current.clear()
        await simulator.open(DEFAULT_BAUD_RATE)
        await attach(simulator, device)
        notify('info', 'Simulated demo: no hardware is connected, the data is generated.')
      } catch (error) {
        patch({ status: 'disconnected' })
        notify('error', `Could not start the demo: ${describe(error)}`)
      }
    },
    [attach, notify, patch],
  )

  const disconnect = useCallback(async () => {
    const driver = driverRef.current
    if (driver) {
      // Leave the module streaming ASCII, which is what it does after a reboot.
      try {
        await driver.setMode(OperatingMode.Simple)
      } catch {
        /* the port may already be gone */
      }
    }
    teardown()
    patch({
      status: 'disconnected',
      transportKind: null,
      portLabel: null,
      identity: {},
      deviceConfig: null,
      dirty: false,
      pendingOperation: null,
    })
  }, [patch, teardown])

  /** Run a driver operation with the UI locked and errors surfaced as notices. */
  const run = useCallback(
    async <T>(label: string, task: (driver: Ld2420Driver) => Promise<T>): Promise<T | null> => {
      const driver = driverRef.current
      if (!driver) {
        notify('error', 'No device connected.')
        return null
      }
      patch({ pendingOperation: label, status: 'busy' })
      try {
        return await task(driver)
      } catch (error) {
        notify('error', `${label} : ${describe(error)}`)
        return null
      } finally {
        patch({ pendingOperation: null, status: driverRef.current ? 'connected' : 'disconnected' })
      }
    },
    [notify, patch],
  )

  const setDraft = useCallback((update: (draft: Ld2420Config) => Ld2420Config) => {
    setState((previous) => {
      const draftConfig = update(previous.draftConfig)
      return {
        ...previous,
        draftConfig,
        dirty: previous.deviceConfig ? !configsEqual(previous.deviceConfig, draftConfig) : true,
      }
    })
  }, [])

  const revertDraft = useCallback(() => {
    setState((previous) => ({
      ...previous,
      draftConfig: previous.deviceConfig ? cloneConfig(previous.deviceConfig) : factoryConfig(),
      dirty: false,
    }))
  }, [])

  const applyConfig = useCallback(async () => {
    const current = stateRef.current
    const deviceConfig = current?.deviceConfig
    const draftConfig = current?.draftConfig
    if (!deviceConfig || !draftConfig) return
    const problems = validateConfig(draftConfig)
    if (problems.length > 0) {
      notify('error', problems.map((p) => p.message).join(' '))
      return
    }
    const written = await run('Writing configuration', (driver) =>
      driver.writeConfig(deviceConfig, draftConfig),
    )
    if (written === null) return
    const readBack = await run('Reading configuration back', (driver) => driver.readConfig())
    if (readBack) {
      patch({ deviceConfig: readBack, draftConfig: cloneConfig(readBack), dirty: false })
      notify(
        'info',
        written === 0
          ? 'Nothing to write.'
          : `${written} parameter${written > 1 ? 's' : ''} written and read back.`,
      )
    }
  }, [notify, patch, run])

  const resetToFactory = useCallback(async () => {
    const deviceConfig = stateRef.current?.deviceConfig
    if (!deviceConfig) return
    const written = await run('Restoring factory defaults', (driver) =>
      driver.factoryReset(deviceConfig),
    )
    if (written === null) return
    const readBack = await run('Reading configuration back', (driver) => driver.readConfig())
    if (readBack) {
      patch({ deviceConfig: readBack, draftConfig: cloneConfig(readBack), dirty: false })
      notify('info', 'Factory defaults restored.')
    }
  }, [notify, patch, run])

  const reloadConfig = useCallback(async () => {
    const config = await run('Reading configuration', (driver) => driver.readConfig())
    if (config) patch({ deviceConfig: config, draftConfig: cloneConfig(config), dirty: false })
  }, [patch, run])

  const setMode = useCallback(
    async (mode: OperatingModeValue) => {
      const result = await run('Changing mode', async (driver) => {
        await driver.setMode(mode)
        return mode
      })
      if (result !== null) {
        historyRef.current.clear()
        patch({ mode })
      }
    },
    [patch, run],
  )

  /**
   * Write bytes with no framing and no queueing, for talking to something the
   * tool has no driver for. Recorded in the raw log so the exchange reads back
   * in order.
   */
  const sendRaw = useCallback(
    async (bytes: Uint8Array) => {
      const transport = transportRef.current
      if (!transport) {
        notify('error', 'No device connected.')
        return
      }
      try {
        await transport.write(bytes)
        rawRef.current.push('tx', bytes, performance.now() - openedAtRef.current)
      } catch (error) {
        notify('error', `Could not send: ${describe(error)}`)
      }
    },
    [notify],
  )

  const readFirmwareInfo = useCallback(async () => {
    const info = await run('Reading firmware information', (driver) => driver.readFirmwareInfo())
    if (info) patch({ firmwareInfo: info })
  }, [patch, run])

  /**
   * Write a firmware image. Irreversible once started — the caller is expected
   * to have taken explicit confirmation first.
   */
  const uploadFirmware = useCallback(
    async (image: Uint8Array, protocol: FirmwareProtocol = LD2420_FIRMWARE) => {
      const driver = driverRef.current
      if (!driver) {
        notify('error', 'No device connected.')
        return
      }
      const problems = validateFirmwareImage(image, protocol)
      if (problems.length > 0) {
        notify('error', problems.join(' '))
        return
      }

      patch({ pendingOperation: 'Writing firmware', status: 'busy' })
      try {
        await driver.uploadFirmwareWith(image, protocol, {
          onProgress: (firmwareProgress) => patch({ firmwareProgress }),
        })
        historyRef.current.clear()
        patch({
          mode: OperatingMode.Simple,
          identity: {},
          deviceConfig: null,
          firmwareInfo: null,
        })
        notify(
          'info',
          'Firmware written and the module restarted. Re-read its configuration before using it.',
        )
      } catch (error) {
        notify(
          'error',
          `Firmware update failed: ${describe(error)} The module may be left in upgrade mode; ` +
            'power-cycle it and retry the transfer before assuming it is lost.',
        )
      } finally {
        patch({
          pendingOperation: null,
          firmwareProgress: null,
          status: driverRef.current ? 'connected' : 'disconnected',
        })
      }
    },
    [notify, patch],
  )

  const reboot = useCallback(async () => {
    const result = await run('Restarting', async (driver) => {
      await driver.reboot()
      return true
    })
    if (result) {
      historyRef.current.clear()
      patch({ mode: OperatingMode.Simple })
      notify('info', 'Module restarted. It comes back in simple (ASCII) mode.')
    }
  }, [notify, patch, run])

  stateRef.current = state
  const trace: readonly TraceEntry[] = driverRef.current?.trace ?? []

  const actions = useMemo(
    () => ({
      connectSerial,
      connectSimulator,
      disconnect,
      setDraft,
      revertDraft,
      applyConfig,
      resetToFactory,
      reloadConfig,
      setMode,
      reboot,
      readFirmwareInfo,
      uploadFirmware,
      dismissNotice,
      notify,
      sendRaw,
      clearRaw: () => rawRef.current.clear(),
      clearTrace: () => {
        driverRef.current?.clearTrace()
        setState((p) => ({ ...p, traceVersion: p.traceVersion + 1 }))
      },
      clearHistory: () => historyRef.current.clear(),
    }),
    [
      applyConfig,
      connectSerial,
      connectSimulator,
      disconnect,
      dismissNotice,
      notify,
      readFirmwareInfo,
      reboot,
      reloadConfig,
      resetToFactory,
      revertDraft,
      sendRaw,
      setDraft,
      setMode,
      uploadFirmware,
    ],
  )

  return { state, actions, history: historyRef.current, raw: rawRef.current, trace }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** The port picker throws NotFoundError when the user dismisses it. */
function isUserCancellation(error: unknown): boolean {
  return (
    error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'AbortError')
  )
}
