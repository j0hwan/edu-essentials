export const profileFields = ["display_name", "last_name", "university", "major", "academic_year", "study_goal", "academic_structure", "gpa_system", "current_term", "week_starts_on", "timezone"] as const;
export type ProfileDetails = Record<(typeof profileFields)[number], string> & { age: number | null };
export type Preferences = {
  theme: "light" | "dark" | "system";
  reducedMotion: boolean;
  highContrast: boolean;
  deadlineReminders: boolean;
  dailyStudyPlan: boolean;
  streakNudges: boolean;
};
export type Profile = ProfileDetails & {
  id: string;
  auth_user_id: string;
  email: string;
  avatar_url: string | null;
  onboarding_completed_at: string | null;
  initialized: boolean;
  preferences: Preferences;
};
export const defaultPreferences: Preferences = {
  theme: "light", reducedMotion: false, highContrast: true,
  deadlineReminders: true, dailyStudyPlan: true, streakNudges: false,
};

export function validateProfile(value: unknown): ProfileDetails & { preferences: Preferences } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid profile.");
  const input = value as Record<string, unknown>;
  const details = {} as ProfileDetails;
  for (const key of profileFields) {
    const field = input[key] ?? "";
    if (typeof field !== "string" || field.length > (key === "study_goal" ? 500 : 160)) throw new Error(`Invalid ${key.replaceAll("_", " ")}.`);
    details[key] = field.trim();
  }
  if (!details.display_name) throw new Error("Please enter your name.");
  const choices = {
    academic_year: ["", "Freshman", "Sophomore", "Junior", "Senior", "Graduate", "Other"],
    academic_structure: ["", "Quarter", "Semester", "Trimester", "Other"],
    gpa_system: ["", "4.0 scale", "Percentage", "Custom"],
    week_starts_on: ["", "Monday", "Sunday"],
  };
  for (const [key, options] of Object.entries(choices)) {
    if (!options.includes(details[key as keyof typeof choices])) throw new Error(`Invalid ${key.replaceAll("_", " ")}.`);
  }
  if (details.timezone) {
    try { new Intl.DateTimeFormat("en", { timeZone: details.timezone }); }
    catch { throw new Error("Please enter a valid time zone."); }
  }
  const age = input.age ?? null;
  if (age !== null && (typeof age !== "number" || !Number.isInteger(age) || age < 1 || age > 120)) throw new Error("Age must be between 1 and 120, or left blank.");
  details.age = age as number | null;
  const preferences = { ...defaultPreferences };
  if (input.preferences !== undefined) {
    if (!input.preferences || typeof input.preferences !== "object" || Array.isArray(input.preferences)) throw new Error("Invalid preferences.");
    const candidate = input.preferences as Record<string, unknown>;
    if (!["light", "dark", "system"].includes(candidate.theme as string)) throw new Error("Invalid theme.");
    preferences.theme = candidate.theme as Preferences["theme"];
    for (const key of ["reducedMotion", "highContrast", "deadlineReminders", "dailyStudyPlan", "streakNudges"] as const) {
      if (typeof candidate[key] !== "boolean") throw new Error("Invalid preference.");
      preferences[key] = candidate[key];
    }
  }
  return { ...details, preferences };
}
