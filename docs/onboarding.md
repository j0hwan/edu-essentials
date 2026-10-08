# Onboarding

First-time authenticated accounts go directly to `/onboarding`. Completing or skipping setup saves the profile once through the existing revision-protected profile API, then opens `/home`.

The flow covers personal details, school, a location placeholder, college major, graduation, and a syllabus placeholder. Location does not request permission or coordinates. Its skip becomes available after two seconds. Syllabus upload is disabled until the integration is built.

## Database rollout

Apply `supabase/migrations/20261008000000_onboarding_details.sql` before deploying this version. It adds optional birthday, school type, graduation year, and program length fields without resetting existing accounts or their onboarding status.

## Test mode

Open **Experimental → Onboard test** after the workspace has finished saving. Each run starts with blank personal and school details. The flow never saves profile or workspace data; finishing stays in the test. The red X and Escape exit to the prior workspace. Restart creates another empty draft.

## Academic standing

Standing assumes spring graduation and an academic year starting August 1. For a four-year program, graduation in 2030 means entry in fall 2026: freshman in 2026–27, sophomore in 2027–28, junior in 2028–29, and senior in 2029–30. College program lengths can be changed; high school uses four years. This estimates cohort standing rather than calculating earned-credit classification. Summer retains the preceding academic year's standing until August.

## School search

Autocomplete queries the public Photon service from the server, using OpenStreetMap school, college, and university categories. It uses no location coordinates or API key. Searches are debounced in the UI, bounded, cached, and throttled. Users can enter their school manually during service failures or when the school is absent.

Photon's public service has no uptime guarantee. OpenStreetMap's `school` category includes primary and secondary schools, so results are not an authoritative high-school directory. For larger traffic volumes, use a hosted institution directory or a dedicated Photon deployment.

References: [Photon API](https://github.com/komoot/photon/blob/master/docs/api-v1.md), [public demo policy](https://github.com/komoot/photon#demo-server), [school category](https://wiki.openstreetmap.org/wiki/Tag:amenity%3Dschool).
