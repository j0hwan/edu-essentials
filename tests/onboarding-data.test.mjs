import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { clientModule } from "./helpers/client-modules.mjs";

const [{ birthdayAge, createOnboardingDraft, getAcademicStanding }, { defaultPreferences, editableProfile, profileFields, validateProfile }] = await Promise.all([
  import(await clientModule("lib/onboarding.ts")),
  import(await clientModule("lib/profile.ts")),
]);

test("profile validation defaults new onboarding fields and enforces their choices", () => {
  const profile = validateProfile({ display_name: "Alex" });
  assert.equal(profile.birthday, "");
  assert.equal(profile.school_type, "");
  assert.equal(profile.graduation_year, "");
  assert.equal(profile.program_length, "");

  const valid = validateProfile({ display_name: "Alex", birthday: "2004-02-29", school_type: "college", graduation_year: String(new Date().getUTCFullYear() + 30), program_length: "4" });
  assert.equal(valid.birthday, "2004-02-29");
  assert.equal(valid.school_type, "college");
  for (const patch of [
    { birthday: "2025-02-29" },
    { birthday: "2027-01-01" },
    { birthday: "1900-01-01" },
    { school_type: "university" },
    { graduation_year: "1899" },
    { graduation_year: String(new Date().getUTCFullYear() + 31) },
    { graduation_year: "not a year" },
    { program_length: "1" },
  ]) assert.throws(() => validateProfile({ display_name: "Alex", ...patch }));
});

test("editableProfile fills missing onboarding fields from legacy profile rows", () => {
  const legacy = { ...validateProfile({ display_name: "Alex" }), age: 22 };
  for (const field of ["birthday", "school_type", "graduation_year", "program_length"]) delete legacy[field];
  assert.deepEqual(editableProfile(legacy), {
    ...validateProfile({ display_name: "Alex" }),
    age: 22,
    preferences: defaultPreferences,
  });
});

test("birthday age uses UTC calendar dates and rejects invalid or unreasonable birthdays", () => {
  const now = new Date("2026-02-28T23:30:00-08:00");
  assert.equal(birthdayAge("2004-02-29", now), 22);
  assert.equal(birthdayAge("2004-03-01", now), 22);
  assert.equal(birthdayAge("2026-03-02", now), null);
  assert.equal(birthdayAge("1905-02-27", now), null);
  assert.equal(birthdayAge("2026-02-29", now), null);
  assert.equal(birthdayAge("", now), null);
});

test("onboarding migration preserves existing profiles and checks persisted fields", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("create table public.app_profiles (id integer primary key, display_name text not null); insert into public.app_profiles values (1, 'Existing student');");
    await pg.exec(await readFile(new URL("../supabase/migrations/20261008000000_onboarding_details.sql", import.meta.url), "utf8"));
    const row = (await pg.query("select display_name, birthday, school_type, graduation_year, program_length from public.app_profiles where id = 1")).rows[0];
    assert.deepEqual(row, { display_name: "Existing student", birthday: "", school_type: "", graduation_year: "", program_length: "" });

    await pg.exec("update public.app_profiles set birthday = '2004-02-29', school_type = 'college', graduation_year = '2030', program_length = '4' where id = 1");
    for (const update of [
      "update public.app_profiles set birthday = '2001-02-29' where id = 1",
      "update public.app_profiles set school_type = 'university' where id = 1",
      "update public.app_profiles set graduation_year = '1899' where id = 1",
      "update public.app_profiles set program_length = '1' where id = 1",
    ]) await assert.rejects(pg.exec(update));
  } finally {
    await pg.close();
  }
});

test("academic standing rolls over on August 1 and handles program lengths", () => {
  const standing = (graduation, length, date) => getAcademicStanding(graduation, length, new Date(`${date}T12:00:00`));
  assert.deepEqual(standing("2030", "4", "2026-08-01"), { academicYearStart: 2026, entryYear: 2026, label: "Freshman", academicYear: "Freshman" });
  assert.equal(standing("2030", "4", "2027-07-31").label, "Freshman");
  assert.equal(standing("2030", "4", "2027-08-01").academicYear, "Sophomore");
  assert.equal(standing("2028", "2", "2026-08-01").academicYear, "Freshman");
  assert.equal(standing("2028", "2", "2027-08-01").academicYear, "Sophomore");
  assert.equal(standing("2029", "3", "2028-08-01").academicYear, "Junior");
  assert.equal(standing("2032", "6", "2028-08-01").academicYear, "Other: Year 3");
  assert.equal(standing("2032", "6", "2031-08-01").academicYear, "Senior");
  assert.equal(standing("2030", "4", "2025-08-01").academicYear, "Other: Incoming student");
  assert.equal(standing("2030", "4", "2030-08-01").academicYear, "Other: Graduated");
  assert.equal(getAcademicStanding("2030", "7", new Date("2026-08-01T12:00:00")), null);
  assert.equal(getAcademicStanding("2030", "4", new Date(Number.NaN)), null);
});

test("onboarding draft preview blanks profile details while keeping identity", () => {
  const actual = {
    ...validateProfile({ display_name: "Alex Jordan Lee", university: "Example University", major: "History", age: 22, birthday: "2004-02-29" }),
    id: "profile-1", auth_user_id: "user-1", email: "alex@example.invalid", avatar_url: "avatar", onboarding_completed_at: null,
    initialized: false, updated_at: "2026-09-01T00:00:00Z",
  };
  const saved = createOnboardingDraft(actual, false);
  assert.equal(saved.display_name, "Alex");
  assert.equal(saved.last_name, "Jordan Lee");
  assert.equal(saved.university, "Example University");
  assert.equal(saved.birthday, "2004-02-29");

  const preview = createOnboardingDraft(actual, true);
  assert.equal(preview.id, actual.id);
  assert.equal(preview.auth_user_id, actual.auth_user_id);
  assert.equal(preview.email, actual.email);
  assert.equal(preview.avatar_url, actual.avatar_url);
  for (const field of profileFields) assert.equal(preview[field], "");
  assert.equal(preview.age, null);
  assert.deepEqual(preview.preferences, defaultPreferences);
});
