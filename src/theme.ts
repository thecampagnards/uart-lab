import { createTheme, type MantineColorsTuple } from '@mantine/core'

/**
 * The blue ramp from the project's data-visualisation palette, expressed as a
 * Mantine colour tuple. Shade 6 is the light-mode series-1 blue and shade 5 the
 * dark-mode one, which is exactly what `primaryShade` below selects — so
 * buttons and chart marks stay the same hue in both schemes.
 */
const blue: MantineColorsTuple = [
  '#eaf3fe',
  '#cde2fb',
  '#9ec5f4',
  '#6da7ec',
  '#5598e7',
  '#3987e5',
  '#2a78d6',
  '#256abf',
  '#184f95',
  '#0d366b',
]

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 6, dark: 5 },
  colors: { brand: blue },
  defaultRadius: 'md',
  fontSizes: { sm: '13px', md: '14px' },
  headings: { sizes: { h1: { fontSize: '20px' }, h2: { fontSize: '15px' } } },
  components: {
    Card: { defaultProps: { withBorder: true, padding: 'md', radius: 'md' } },
    Table: { defaultProps: { horizontalSpacing: 'sm', verticalSpacing: 4, fontSize: 'xs' } },
  },
})
