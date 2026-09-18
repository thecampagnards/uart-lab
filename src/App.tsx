import { useState } from 'react'
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
import { LD2420 } from './devices/registry'
import { OperatingMode, type OperatingModeValue } from './devices/ld2420/constants'
import { useLd2420Session } from './hooks/useLd2420Session'
import { theme } from './theme'
import { ConfigPanel } from './ui/components/ConfigPanel'
import { ConnectionPanel } from './ui/components/ConnectionPanel'
import { DeviceList } from './ui/components/DeviceList'
import { LivePanel } from './ui/components/LivePanel'
import { TracePanel } from './ui/components/TracePanel'

export default function App() {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Shell />
    </MantineProvider>
  )
}

function Shell() {
  const [tab, setTab] = useState<string>('live')
  const [selectedDevice, setSelectedDevice] = useState(LD2420.id)
  const [navOpened, nav] = useDisclosure(false)
  const { state, actions, history, trace } = useLd2420Session()

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
          selectedId={selectedDevice}
          onSelect={(id) => {
            setSelectedDevice(id)
            nav.close()
          }}
          connectedId={connected ? LD2420.id : null}
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
            device={LD2420}
            state={state}
            onConnectSerial={(baudRate) => void actions.connectSerial(baudRate, LD2420.portFilters)}
            onConnectSimulator={() => void actions.connectSimulator()}
            onDisconnect={() => void actions.disconnect()}
          />

          <Tabs value={tab} onChange={(value) => setTab(value ?? 'live')} keepMounted={false}>
            <Tabs.List>
              <Tabs.Tab value="live">Monitor</Tabs.Tab>
              <Tabs.Tab value="config">Configuration</Tabs.Tab>
              <Tabs.Tab value="trace">Serial trace</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="live" pt="md">
              <Stack gap="md">
                <LivePanel
                  state={state}
                  history={history}
                  config={state.deviceConfig ?? state.draftConfig}
                  onSetMode={(mode: OperatingModeValue) => void actions.setMode(mode)}
                />
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="config" pt="md">
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

            <Tabs.Panel value="trace" pt="md">
              <TracePanel trace={trace} onClear={actions.clearTrace} />
            </Tabs.Panel>
          </Tabs>

          <Text size="xs" c="dimmed" pb="sm">
            {LD2420.vendor} {LD2420.name} ·{' '}
            {state.mode === OperatingMode.Report ? 'report' : 'simple'} mode ·{' '}
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
