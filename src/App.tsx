import { useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Anchor,
  AppShell,
  Group,
  MantineProvider,
  Stack,
  Tabs,
  Text,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { DEVICES, LD2420, deviceCan, findDevice, type DeviceDescriptor } from './devices/registry'
import type { DeviceCapability } from './devices/types'
import { OperatingMode, type OperatingModeValue } from './devices/ld2420/constants'
import { useLd2420Session } from './hooks/useLd2420Session'
import { theme } from './theme'
import { ConfigPanel } from './ui/components/ConfigPanel'
import { ConnectionPanel } from './ui/components/ConnectionPanel'
import { DeviceList } from './ui/components/DeviceList'
import { FirmwarePanel } from './ui/components/FirmwarePanel'
import { GenericFlashPanel } from './ui/components/GenericFlashPanel'
import { LivePanel } from './ui/components/LivePanel'
import { PresenceAssistant } from './ui/components/PresenceAssistant'
import { initialCalibration, type CalibrationState } from './ui/components/calibrationState'
import { TerminalPanel } from './ui/components/TerminalPanel'
import { TracePanel } from './ui/components/TracePanel'

const TAB_LABELS: Record<DeviceCapability, string> = {
  monitor: 'Monitor',
  calibrate: 'Presence setup',
  configure: 'Configuration',
  firmware: 'Firmware',
  flash: 'Generic flash',
  terminal: 'Serial monitor',
  trace: 'Serial trace',
}

/** Tab order, independent of how a device happens to list its capabilities. */
const TAB_ORDER: DeviceCapability[] = [
  'monitor',
  'terminal',
  'calibrate',
  'configure',
  'firmware',
  'flash',
  'trace',
]

export default function App() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Shell />
    </MantineProvider>
  )
}

function Shell() {
  const [selectedId, setSelectedId] = useState(LD2420.id)
  const [navOpened, nav] = useDisclosure(false)
  // Held here, not in the panel: tab panels are unmounted when you leave them,
  // and the assistant's measurements must outlive a visit to another tab.
  const [calibration, setCalibration] = useState<CalibrationState>(initialCalibration)
  const { state, actions, history, raw, trace } = useLd2420Session()

  const device: DeviceDescriptor = findDevice(selectedId) ?? LD2420
  const tabs = useMemo(
    () => TAB_ORDER.filter((capability) => deviceCan(device, capability)),
    [device],
  )
  const [tab, setTab] = useState<DeviceCapability>(tabs[0] ?? 'trace')

  // Switching device can remove the tab that was open.
  useEffect(() => {
    if (!tabs.includes(tab)) setTab(tabs[0] ?? 'trace')
  }, [tab, tabs])

  const connected = state.status === 'connected' || state.status === 'busy'

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 280, breakpoint: 'sm', collapsed: { mobile: !navOpened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" gap="sm" wrap="nowrap">
          <Group gap={8} align="baseline" wrap="nowrap">
            <Text fw={650} style={{ letterSpacing: '-0.01em' }}>
              uart-lab
            </Text>
            <Text size="xs" c="dimmed" visibleFrom="sm">
              serial console for UART sensors
            </Text>
          </Group>
          <Group ml="auto" gap="xs" wrap="nowrap">
            <ColorSchemeToggle />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <DeviceList
          selectedId={device.id}
          onSelect={(id) => {
            setSelectedId(id)
            nav.close()
          }}
          connectedId={connected ? device.id : null}
        />
      </AppShell.Navbar>

      <AppShell.Main>
        <Stack gap="md">
          {state.notices.map((notice) => (
            <Alert
              key={notice.id}
              variant="light"
              color={
                notice.level === 'error' ? 'red' : notice.level === 'warning' ? 'yellow' : 'blue'
              }
              withCloseButton
              closeButtonLabel="Dismiss this message"
              role={notice.level === 'error' ? 'alert' : 'status'}
              onClose={() => actions.dismissNotice(notice.id)}
            >
              {notice.message}
            </Alert>
          ))}

          <ConnectionPanel
            device={device}
            state={state}
            onConnectSerial={(baudRate) => void actions.connectSerial(baudRate, device)}
            onConnectSimulator={() => void actions.connectSimulator(device)}
            onDisconnect={() => void actions.disconnect()}
          />

          <Tabs
            value={tab}
            onChange={(value) => setTab((value as DeviceCapability | null) ?? tabs[0] ?? 'trace')}
            keepMounted={false}
          >
            <Tabs.List>
              {tabs.map((capability) => (
                <Tabs.Tab key={capability} value={capability}>
                  {TAB_LABELS[capability]}
                </Tabs.Tab>
              ))}
            </Tabs.List>

            {deviceCan(device, 'monitor') ? (
              <Tabs.Panel value="monitor" pt="md">
                <Stack gap="md">
                  <LivePanel
                    state={state}
                    history={history}
                    config={state.deviceConfig ?? state.draftConfig}
                    onSetMode={(mode: OperatingModeValue) => void actions.setMode(mode)}
                  />
                </Stack>
              </Tabs.Panel>
            ) : null}

            {deviceCan(device, 'terminal') ? (
              <Tabs.Panel value="terminal" pt="md">
                <TerminalPanel
                  log={raw}
                  connected={connected}
                  onSend={(bytes) => void actions.sendRaw(bytes)}
                  onClear={actions.clearRaw}
                />
              </Tabs.Panel>
            ) : null}

            {deviceCan(device, 'calibrate') ? (
              <Tabs.Panel value="calibrate" pt="md">
                <Stack gap="md">
                  {connected ? (
                    <PresenceAssistant
                      state={state}
                      history={history}
                      calibration={calibration}
                      onCalibrationChange={setCalibration}
                      onApply={(config) => {
                        actions.setDraft(() => config)
                        setTab('configure')
                      }}
                      onSetReportMode={() => void actions.setMode(OperatingMode.Report)}
                    />
                  ) : (
                    <Alert variant="light">
                      Connect a module — or start the simulated demo — to measure the area and work
                      out its thresholds.
                    </Alert>
                  )}
                </Stack>
              </Tabs.Panel>
            ) : null}

            {deviceCan(device, 'configure') ? (
              <Tabs.Panel value="configure" pt="md">
                <Stack gap="md">
                  {connected ? (
                    <ConfigPanel
                      state={state}
                      onChange={actions.setDraft}
                      onApply={() => void actions.applyConfig()}
                      onRevert={actions.revertDraft}
                      onReload={() => void actions.reloadConfig()}
                      onFactoryReset={() => void actions.resetToFactory()}
                      onReboot={() => void actions.reboot()}
                      onError={(message) => actions.notify('error', message)}
                    />
                  ) : (
                    <Alert variant="light">
                      Connect a module — or start the simulated demo — to read and edit its
                      configuration.
                    </Alert>
                  )}
                </Stack>
              </Tabs.Panel>
            ) : null}

            {deviceCan(device, 'firmware') ? (
              <Tabs.Panel value="firmware" pt="md">
                <Stack gap="md">
                  {connected && device.firmware ? (
                    <FirmwarePanel
                      protocol={device.firmware}
                      state={state}
                      onReadInfo={() => void actions.readFirmwareInfo()}
                      onUpload={(image, protocol) => void actions.uploadFirmware(image, protocol)}
                      onError={(message) => actions.notify('error', message)}
                    />
                  ) : (
                    <Alert variant="light">
                      Connect a module to read its firmware information or write a new image.
                    </Alert>
                  )}
                </Stack>
              </Tabs.Panel>
            ) : null}

            {deviceCan(device, 'flash') ? (
              <Tabs.Panel value="flash" pt="md">
                <Stack gap="md">
                  {connected && device.firmware ? (
                    <GenericFlashPanel
                      defaultProfileId={device.firmware.id}
                      state={state}
                      onUpload={(image, protocol) => void actions.uploadFirmware(image, protocol)}
                      onError={(message) => actions.notify('error', message)}
                    />
                  ) : (
                    <Alert variant="light">
                      Connect a module to write an image with a descriptor of your choosing.
                    </Alert>
                  )}
                </Stack>
              </Tabs.Panel>
            ) : null}

            {deviceCan(device, 'trace') ? (
              <Tabs.Panel value="trace" pt="md">
                <TracePanel trace={trace} onClear={actions.clearTrace} />
              </Tabs.Panel>
            ) : null}
          </Tabs>

          <Text size="xs" c="dimmed" pb="sm">
            {device.vendor} {device.name}
            {deviceCan(device, 'monitor')
              ? ` · ${state.mode === OperatingMode.Report ? 'report' : 'simple'} mode`
              : ''}{' '}
            ·{' '}
            <Anchor
              inherit
              href="https://github.com/damianmichna/hi-link"
              target="_blank"
              rel="noreferrer"
            >
              protocol documentation
            </Anchor>{' '}
            by Damian Michna (CC BY-SA 4.0).
          </Text>
        </Stack>
      </AppShell.Main>
    </AppShell>
  )
}

function ColorSchemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const next = colorScheme === 'dark' ? 'light' : 'dark'
  return (
    <Tooltip label={`Switch to ${next} theme`}>
      <ActionIcon
        variant="default"
        size="lg"
        aria-label={`Switch to ${next} theme`}
        onClick={() => setColorScheme(next)}
      >
        {colorScheme === 'dark' ? '☀' : '☾'}
      </ActionIcon>
    </Tooltip>
  )
}

export { DEVICES }
