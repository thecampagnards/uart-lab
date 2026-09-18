const THEME_BLOCK = /\/\* standalone-theme:start[\s\S]*?standalone-theme:end \*\//

/**
 * Remove the standalone colour rules from the wiring diagram's source.
 *
 * On its own the file carries `prefers-color-scheme` rules so it reads in a
 * README or an editor. Inlined into the app those rules would win over the
 * page, and the diagram would follow the operating system while everything
 * around it followed the in-app theme toggle. Stripping them lets
 * `currentColor` and the `--power` / `--data` / `--muted` variables resolve
 * against the app's own scheme.
 */
export function stripStandaloneTheme(svg: string): string {
  return svg.replace(THEME_BLOCK, '')
}
