/**
 * @vitest-environment jsdom
 *
 * End-to-end smoke test through the real UI: mount the app, connect to the
 * built-in simulator and drive a configuration change the way a user would.
 * Anything that throws on mount, or a panel wired to the wrong action, fails
 * here rather than in front of the person holding the sensor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { factoryConfig } from './devices/ld2420/config'

const factory = factoryConfig()

/** A .bin file of `size` bytes, as the file picker would hand it over. */
function bin(name: string, size: number): File {
  const bytes = Uint8Array.from({ length: size }, (_, i) => i & 0xff)
  return new File([bytes], name, { type: 'application/octet-stream' })
}

describe('App', () => {
  beforeEach(() => {
    // jsdom has no canvas backend; the waterfall guards against a null context,
    // and this keeps the "not implemented" noise out of the test output.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never
  })

  afterEach(cleanup)

  it('renders the shell without a device connected', () => {
    render(<App />)
    expect(screen.getByText('uart-lab')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /HLK-LD2420/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Monitor' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the wiring diagram on request, described for screen readers', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Show the diagram' }))
    const diagram = await screen.findByRole('img', { name: /Wiring between an FT232RL/ })
    // The claim the picture is there to make: the two data wires run one way each.
    expect(diagram.getAttribute('aria-label')).toMatch(/TXD to the module's RX/)
    expect(diagram.getAttribute('aria-label')).toMatch(/OT1 back to the bridge's RXD/)
    // And the mistake that destroys the module.
    expect(diagram.getAttribute('aria-label')).toMatch(/5V pin must never be connected/)
  })

  it('warns that configuration needs a connection', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: 'Configuration' }))
    expect(screen.getByText(/Connect a module/)).toBeInTheDocument()
  })

  it('connects to the simulator, then reads and writes a parameter', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Simulated demo' }))

    // Identity comes back from the simulated module.
    expect(await screen.findByText('v1.6.1')).toBeInTheDocument()
    // Once connected the "Simulated demo" button is replaced by "Disconnect",
    // so the only remaining occurrence is the status badge.
    expect(screen.getByText('Simulated demo')).toBeInTheDocument()

    // The live panel picks up the report stream.
    await waitFor(
      () => {
        expect(screen.getByText(/frames received/)).not.toHaveTextContent('0 frames')
      },
      { timeout: 4000 },
    )

    await user.click(screen.getByRole('tab', { name: 'Configuration' }))
    const timeout = screen.getByLabelText(/Absence delay/)
    expect(timeout).toHaveValue('30')

    await user.clear(timeout)
    await user.type(timeout, '45')
    expect(screen.getByText('Unwritten changes')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Write to module' }))

    // The write is followed by a read-back, so the badge clears only if the
    // module really holds the new value.
    await waitFor(() => {
      expect(screen.queryByText('Unwritten changes')).not.toBeInTheDocument()
    })
    expect(screen.getByLabelText(/Absence delay/)).toHaveValue('45')
  }, 20_000)

  it('refuses to write an out-of-range gate and says why', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Simulated demo' }))
    await screen.findByText('v1.6.1')

    await user.click(screen.getByRole('tab', { name: 'Configuration' }))
    const minGate = screen.getByLabelText('Minimum gate')
    await user.clear(minGate)
    await user.type(minGate, '14')

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.some((node) => /less than or equal/.test(node.textContent ?? ''))).toBe(true)
    expect(screen.getByRole('button', { name: 'Write to module' })).toBeDisabled()
  }, 20_000)

  it('guards the firmware write behind validation and an acknowledgement', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Simulated demo' }))
    await screen.findByText('v1.6.1')

    await user.click(screen.getByRole('tab', { name: 'Firmware' }))
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument()

    const write = screen.getByRole('button', { name: 'Write firmware to module' })
    expect(write).toBeDisabled()

    // An unaligned image is refused before anything irreversible can happen.
    const picker = document.querySelector('input[type="file"]')
    expect(picker).not.toBeNull()
    await user.upload(picker as HTMLInputElement, bin('bad.bin', 13))
    expect(await screen.findByText(/not a multiple of 4/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Write firmware to module' })).toBeDisabled()

    // A valid image still needs the acknowledgement before the button unlocks.
    await user.upload(picker as HTMLInputElement, bin('good.bin', 512))
    await screen.findByText('512 bytes')
    expect(screen.getByRole('button', { name: 'Write firmware to module' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /cannot be undone/i }))
    expect(screen.getByRole('button', { name: 'Write firmware to module' })).toBeEnabled()
  }, 20_000)

  it('reads the firmware information from the module', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Simulated demo' }))
    await screen.findByText('v1.6.1')

    await user.click(screen.getByRole('tab', { name: 'Firmware' }))
    await user.click(screen.getByRole('button', { name: 'Read firmware information' }))
    expect(await screen.findByText('Running image')).toBeInTheDocument()
    expect(screen.getAllByText('App 0').length).toBeGreaterThan(0)
  }, 20_000)

  it('shows the configuration as JSON and takes a pasted one back', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Simulated demo' }))
    await screen.findByText('v1.6.1')
    await user.click(screen.getByRole('tab', { name: 'Configuration' }))

    const json = await screen.findByLabelText('Configuration as JSON')
    expect(json).toHaveAttribute('readonly')
    expect((json as HTMLTextAreaElement).value).toContain('"uart-lab/ld2420-config"')
    expect((json as HTMLTextAreaElement).value).toContain('"timeoutS": 30')

    // Pasting loads the form without touching the module.
    await user.click(screen.getByRole('radio', { name: 'Paste' }))
    const editable = screen.getByLabelText('Configuration as JSON')
    await user.clear(editable)
    await user.paste(JSON.stringify({ ...factory, timeoutS: 77 }))
    await user.click(screen.getByRole('button', { name: 'Load into the form' }))

    await waitFor(() => {
      expect(screen.getByLabelText(/Absence delay/)).toHaveValue('77')
    })
    expect(screen.getByText('Unwritten changes')).toBeInTheDocument()
  }, 20_000)

  it('refuses a pasted configuration that is not valid', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Simulated demo' }))
    await screen.findByText('v1.6.1')
    await user.click(screen.getByRole('tab', { name: 'Configuration' }))

    await user.click(screen.getByRole('radio', { name: 'Paste' }))
    const editable = screen.getByLabelText('Configuration as JSON')
    await user.clear(editable)
    await user.paste(JSON.stringify({ ...factory, maxGate: 99 }))
    await user.click(screen.getByRole('button', { name: 'Load into the form' }))

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.some((node) => /Invalid configuration/.test(node.textContent ?? ''))).toBe(true)
    // The form is untouched.
    expect(screen.getByLabelText('Maximum gate')).toHaveValue('12')
  }, 20_000)

  it('shows only the tabs the selected device supports', async () => {
    const user = userEvent.setup()
    render(<App />)

    // The radar offers monitoring and configuration.
    expect(screen.getByRole('tab', { name: 'Monitor' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Generic flash' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Generic Hi-Link LD/ }))

    // The generic entry can only be flashed, so the rest is gone.
    expect(await screen.findByRole('tab', { name: 'Generic flash' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Monitor' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Configuration' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Serial trace' })).toBeInTheDocument()
  })

  it('keeps the generic flasher behind its own extra acknowledgement', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Simulated demo' }))
    await screen.findByText('v1.6.1')
    await user.click(screen.getByRole('button', { name: /Generic Hi-Link LD/ }))
    await user.click(await screen.findByRole('tab', { name: 'Generic flash' }))

    expect(await screen.findByText('unverified descriptor')).toBeInTheDocument()

    const picker = document.querySelector('input[type="file"]')
    await user.upload(picker as HTMLInputElement, bin('other.bin', 512))
    await screen.findByText('512 bytes')

    expect(screen.getByRole('button', { name: 'Write firmware to module' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /cannot be undone/i }))
    // Still disabled: the generic path asks for a second confirmation.
    expect(screen.getByRole('button', { name: 'Write firmware to module' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /confirmed this descriptor/i }))
    expect(screen.getByRole('button', { name: 'Write firmware to module' })).toBeEnabled()
  }, 20_000)

  it('refuses to flash with a descriptor that could not work', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Simulated demo' }))
    await screen.findByText('v1.6.1')
    await user.click(screen.getByRole('button', { name: /Generic Hi-Link LD/ }))
    await user.click(await screen.findByRole('tab', { name: 'Generic flash' }))

    // Two commands on the same byte: replies could not be told apart.
    const sendBlock = screen.getByLabelText('send_firmware_block')
    await user.clear(sendBlock)
    await user.type(sendBlock, '0x74')

    expect(await screen.findByText(/share the same byte/)).toBeInTheDocument()
    expect(screen.getByText(/Fix the descriptor above/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Write firmware to module' }),
    ).not.toBeInTheDocument()
  }, 20_000)

  it('exposes the serial trace', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Simulated demo' }))
    await screen.findByText('v1.6.1')

    await user.click(screen.getByRole('tab', { name: 'Serial trace' }))
    // `open_command_mode`, byte for byte as the protocol document spells it. It
    // appears once per operation, hence findAll.
    const opens = await screen.findAllByText(/fd fc fb fa 04 00 ff 00 01 00 04 03 02 01/)
    expect(opens.length).toBeGreaterThan(0)
    // And the module's ACK, carrying protocol version 2 and a 32-byte buffer.
    expect(screen.getAllByText(/fd fc fb fa 08 00 ff 01 00 00 02 00 20 00/).length).toBeGreaterThan(
      0,
    )
  }, 20_000)
})
