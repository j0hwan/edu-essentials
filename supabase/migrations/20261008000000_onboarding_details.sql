-- New onboarding details stay optional so existing profiles remain valid.
alter table public.app_profiles
  add column if not exists birthday text not null default ''
    check (
      birthday = '' or (
        birthday ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        and to_char(birthday::date, 'YYYY-MM-DD') = birthday
        and birthday::date >= date '1900-01-01'
      )
    ),
  add column if not exists school_type text not null default ''
    check (school_type in ('', 'high-school', 'college')),
  add column if not exists graduation_year text not null default ''
    check (
      graduation_year = '' or (
        graduation_year ~ '^[0-9]{4}$'
        and graduation_year::integer between 1900 and 9999
      )
    ),
  add column if not exists program_length text not null default ''
    check (program_length in ('', '2', '3', '4', '5', '6'));
