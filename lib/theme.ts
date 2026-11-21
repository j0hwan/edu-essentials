export const themeGroups = [
  { heading: "Light mode", themes: [
    { id: "white-green", label: "White & Green" },
    { id: "white-blue", label: "White & Blue" },
  ] },
  { heading: "Dark mode", themes: [
    { id: "midnight", label: "Midnight" },
    { id: "charcoal-orange", label: "Charcoal & Orange" },
  ] },
  { heading: "Default", themes: [
    { id: "classic-blue", label: "Classic Blue" },
  ] },
] as const;

export const defaultTheme = "classic-blue";
export type Theme = (typeof themeGroups)[number]["themes"][number]["id"];
export type ThemePreference = Theme | "system" | "light" | "dark";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark"
    || themeGroups.some(({ themes }) => themes.some(({ id }) => id === value));
}

export function themePalette(theme: unknown): Theme | "system" {
  if (!isThemePreference(theme) || theme === "light") return defaultTheme;
  return theme === "dark" ? "midnight" : theme;
}
