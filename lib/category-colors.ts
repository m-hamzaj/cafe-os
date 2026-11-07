// Tile colours for the counter, which is always on its dark theme. Chosen to
// stay readable as a tint behind light text and to differ from each other.
// The first is a muted caramel, darker than the counter's amber selection
// colour; none is close to its orange warning colour or its green background.
const PALETTE = ["#c69a5b", "#7ea6e0", "#d9849a", "#a993d9", "#9cc472", "#5fb6d0", "#8fa0b8", "#b98fb0"];

/**
 * One colour per category, assigned in alphabetical order, so every category
 * gets a different colour until there are more categories than colours.
 * Adding a category can shift the ones after it alphabetically.
 */
export function categoryColors(categories: string[]): Map<string, string> {
  const sorted = Array.from(new Set(categories)).sort((a, b) => a.localeCompare(b));
  return new Map(sorted.map((c, i) => [c, PALETTE[i % PALETTE.length]]));
}
