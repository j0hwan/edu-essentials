import { defaultPreferences, profileFields, type Profile } from "./profile";

export { birthdayAge } from "./profile";

const academicLabels = ["Freshman", "Sophomore", "Junior", "Senior"] as const;
const programLengths = ["2", "3", "4", "5", "6"] as const;

function calculateAcademicYear(startYear: number, entryYear: number, duration: number): string {
  const yearInProgram = startYear - entryYear + 1;
  if (yearInProgram < 1) return "Other: Incoming student";
  if (yearInProgram > duration) return "Other: Graduated";

  let label: string;
  if (duration <= 4) label = academicLabels[yearInProgram - 1];
  else label = yearInProgram === duration ? "Senior" : `Year ${yearInProgram}`;
  return academicLabels.includes(label as (typeof academicLabels)[number]) ? label : `Other: ${label}`;
}

/**
 * Returns the current standing for an expected graduation year. Academic
 * years roll over locally on August 1, while `birthdayAge` uses UTC dates.
 */
export function getAcademicStanding(
  graduationYear: string,
  programLength: string = "4",
  now: Date = new Date(),
): { academicYearStart: number; entryYear: number; label: string; academicYear: string } | null {
  if (!/^\d{4}$/.test(graduationYear) || !programLengths.includes(programLength as (typeof programLengths)[number]) || Number.isNaN(now.getTime())) return null;
  const graduation = Number(graduationYear);
  if (graduation < 1900) return null;

  const academicYearStart = now.getFullYear() - (now.getMonth() < 7 ? 1 : 0);
  const duration = Number(programLength);
  const entryYear = graduation - duration;
  const academicYear = calculateAcademicYear(academicYearStart, entryYear, duration);
  const label = academicYear.startsWith("Other: ") ? academicYear.slice("Other: ".length) : academicYear;
  return { academicYearStart, entryYear, label, academicYear };
}

/**
 * Creates the profile draft used by onboarding. Preview keeps account identity
 * but uses blank details; a real profile keeps its saved values and normalizes
 * a provider's full display name into first and last names when needed.
 */
export function createOnboardingDraft(profile: Profile, preview: boolean): Profile {
  const details = Object.fromEntries(profileFields.map((key) => [key, profile[key] ?? ""])) as Pick<Profile, (typeof profileFields)[number]>;
  const draft: Profile = {
    ...profile,
    ...details,
    age: profile.age ?? null,
    preferences: { ...(profile.preferences ?? defaultPreferences) },
  };

  if (preview) {
    for (const key of profileFields) draft[key] = "";
    draft.age = null;
    draft.preferences = { ...defaultPreferences };
    return draft;
  }

  if (!draft.last_name.trim()) {
    const nameParts = draft.display_name.trim().split(/\s+/).filter(Boolean);
    if (nameParts.length > 1) {
      draft.display_name = nameParts.shift() ?? "";
      draft.last_name = nameParts.join(" ");
    }
  }
  return draft;
}
