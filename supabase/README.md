# Managed dashboard migration — preparation branch

Status: database foundation prepared; **not deployed and not a working replacement for the Node API yet**. Existing pages and local accounts remain unchanged. Do not switch the public website to Supabase until the Edge API and end-to-end checks are complete.

The goal is GitHub Pages for the website and Supabase Auth, Postgres, and Edge Functions for shared state. The owner does not maintain a server process or persistent disk.

## Prepared

- Postgres storage for staff profiles, client intake, appointments, cleaning progress, account activity, and connection status.
- Row-level security: anonymous visitors cannot read private data; active owners see jobs and their own profile; active administrators also see all staff profiles and activity; disabled staff cannot read records.
- Browser users cannot directly edit roles, profiles, job progress, or audit records. Validated updates will go through the Edge API.
- A service-only atomic job-save function checks the revision and records activity in the same transaction.
- Passwords will stay in Supabase Auth, and Square credentials will stay in function secrets. Neither belongs in a SQL migration or public JavaScript.

## Connection needed before provisioning

Install/connect the Supabase integration and select the dedicated project/account. Inspect any existing schema before applying migrations. Do not create a paid project or accept an unexpected charge without the user's approval.

## Remaining implementation and activation

1. Provision or select a project after connection and confirm its settings.
2. Apply the migration and verify live policies using anonymous, owner, administrator, and disabled identities.
3. Implement the managed Edge API for the current dashboard routes, using Supabase Auth for passwords, a private username lookup, and explicit active-role checks for every request. Public intake must retain validation, throttling, and duplicate prevention. Preserve server-side cleaning-plan validation before invoking the save function.
4. Implement credential changes/session invalidation and provision the two requested staff accounts privately. Local account credentials are not automatically copied into Supabase Auth. No real credentials are in this branch.
5. Move Square reads into the Edge API and a managed schedule, with private tokens, pagination, failure handling, and preservation of checklist progress. The Square token is a separate connection requirement.
6. Wire the existing dashboard and intake to the managed API using the project's public endpoint only. Keep secrets out of browser code. Resolve the custom domain's HTTPS configuration before entering credentials publicly.
7. Test intake → owner plan approval → checkmarks → admin visibility, cross-device persistence, and all authorization boundaries. Then publish the frontend configuration.

The current SQLite data must be inspected and migrated explicitly before cutover; never drop it or reset existing accounts as part of deployment. This branch does not migrate or expose that data.
