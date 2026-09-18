import { Box, Code, Text } from '@mantine/core'
// Authored once as a standalone file so the documentation and the app show the
// same picture. `?raw` inlines it rather than putting it behind an <img>, which
// keeps its `currentColor` strokes inheriting the page's foreground.
import wiringSvg from '../../../doc/wiring-ft232rl.svg?raw'

export function WiringDiagram() {
  return (
    <figure style={{ margin: 0 }}>
      <Box
        className="wiring-diagram"
        // Trusted build-time asset: our own file, never user input.
        dangerouslySetInnerHTML={{ __html: wiringSvg }}
      />
      <Text component="figcaption" size="xs" c="dimmed" mt={6}>
        <Code>OT1</Code> is the module&rsquo;s serial output — there is no pin called TX. The module
        is a 3.3 V part throughout; <Code>doc/hardware-ft232rl.md</Code> covers the rest, including
        how to check the port from a shell.
      </Text>
    </figure>
  )
}
