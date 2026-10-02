# Authentication UI integration

## Design Source Inspected

`login form/` contains `Design Aringay Login Page.zip`, a Figma Make export with
React 19, Vite, Tailwind CSS 4, and Lucide React. The main source is
`src/app/App.tsx`; it contains the login, farmer registration, and inline SVG
farm illustration. The CSS files specify DM Sans and the green palette. There
are no separate bundled images, logos, font binaries, or SVG files.

The source uses a white form panel and green overview panel on desktop, hides
the overview below 768px, and changes registration field columns by breakpoint.
Both submission handlers are explicitly mock previews. Root routes, validation,
security middleware, sessions, shared templates, styles, scripts, and tests were
inspected before adapting this design.

## Files Changed

Modified:

- `views/auth.ejs`: redesigned login/registration, retaining hectare setup.
- `views/partials/head.ejs`: conditional auth CSS and scoped body class.
- `src/app.ts`: auth stylesheet cache revision and auth-only error rendering.
- `public/vendor/lucide.svg`: seven additional icons from the same Lucide version.
- `scripts/build-icons.mjs`: includes those icons for future sprite rebuilds.

Added:

- `views/partials/auth-overview.ejs`: shared agricultural illustration panel.
- `public/css/auth.css`: scoped design and responsive styling.
- `public/images/auth-farm.svg`: extracted/adapted original illustration.
- `public/fonts/dm-sans-latin.woff2`: locally served variable font.
- `public/fonts/dm-sans-OFL.txt`: font license.
- `src/auth-presentation.ts`: friendly errors and whitelisted retained values.
- `tests/auth-ui.test.ts`: real Express authentication route regression tests.
- `scripts/verify-auth-ui.mjs`: reproducible offline browser verification.
- `docs/AUTH_UI_INTEGRATION.md`: this report.

No package dependencies or lockfiles changed. `management-typescript/` and the
original design archive were untouched. Compiled output was refreshed through
the existing build script.

## Assets Added

The inline React farm scene was converted to a standalone SVG, preserving its
paths and expanding the generated field rows. DM Sans was downloaded from
Google Fonts and included with its SIL Open Font License. The existing Lucide
1.49.0 sprite was extended with mail, lock-keyhole, shield-check, map-pin, tractor,
leaf, and chevron-right. The existing `/assets/logo.png` was reused.

All assets load through the normal `/assets` Express static mount. There are no
runtime dependencies on the design archive, external fonts, React, or Tailwind.

## Login Integration

The form posts normally to `/login`, using the unchanged `email`, `password`,
and `_csrf` field names. Email autocomplete, current-password autocomplete,
input icons, and the existing accessible password-toggle script are retained.
Validation and invalid-credential errors render within the new design; retained
email values are escaped, and passwords are never repopulated.

## Registration Integration

The form posts to `/register` and includes every field required by the existing
registration schema: fullname, contact_number, birthdate, age, gender,
civil_status, place_of_birth, address, email, and password. It retains the exact
backend field names and enumerated options, includes CSRF, and explains the
actual password policy. Duplicate emails and validation failures use friendly
messages, invalid-field styling, and associated error descriptions. Personal
details are retained within their existing length limits; passwords are cleared.

## Unsupported Template Features Removed

- Mock login and registration handlers, artificial delays, and preview notices.
- The unsupported Remember me checkbox.
- The preview's confirmPassword field, which the root registration schema does
  not support.

Google login and Forgot password were not present in this export and were not
introduced. Registration is available only for farmers.

## Backend Preservation

`src/routes/auth.ts`, validation schemas, security middleware, password helpers,
database queries, and the PostgreSQL session store are unchanged. CSRF and
origin checks, shared rate limits, bcrypt/PHP hash compatibility, session
regeneration, eight-hour sessions, role checks, transaction-based farmer
creation, duplicate-email handling, and queued registration emails remain intact.

Admins and farmers with registered hectares still redirect to `/dashboard`.
Farmers without hectares still redirect to `/setup-hectares`. Registration still
redirects to `/login` with the existing success flash. Role-specific dashboard
behavior is unchanged. Backend changes are limited to presenting auth errors
and versioning the additional stylesheet.

## Responsive Improvements

The desktop split screen fills the viewport. Below 768px, the illustration hides
and the form takes priority. Registration uses two columns where space permits,
and one column on narrow phones and narrower desktop/tablet form panels. Inputs
use 16px text on mobile; buttons and password toggles have usable touch targets.
Labels, autocomplete, focus states, reduced-motion handling, and readable error
contrast are included.

### Viewport scrolling revision

The desktop body, main element, and two-column grid now use `100vh`/`100dvh`
with hidden overflow and a grid row that can shrink below its content height.
Both columns fill that row. Login has no page or internal form scrolling;
height-aware spacing keeps its controls visible on shorter laptops, including
validation errors. The illustration is centered and sized within the available
height; its decorative cards scale with the farm scene.

Only `.auth-shell-register .auth-form-panel` uses `overflow-y: auto`.
`scrollbar-width: none`, `-ms-overflow-style: none`, and the WebKit scrollbar
pseudo-element hide its scrollbar. Wheel, native touch scrolling, keyboard
navigation, Page Up/Down, and End still operate on that panel. Its `tabindex="0"`
and existing accessible name allow keyboard users to focus the scroll area.
The artwork and document remain stationary. Top and bottom padding are retained.

Split-screen mode applies at widths of at least 1024px with heights of at least
640px, or tablet widths of at least 768px with heights of at least 701px.
Smaller/shorter windows use the single-column layout with normal page scrolling,
so zoom and limited screen space do not cut off essential controls. Authentication
routes, handlers, sessions, field names, CSRF, and database behavior were not
changed during this layout revision.

The browser script now accepts `chrome` or `firefox` as its optional final
argument. It checks 16 viewport sizes per browser, document and panel scroll
ownership, scrollbar hiding, wheel/keyboard navigation, final-field reachability,
stationary artwork, login error layouts, and an emulated Chrome touch swipe.
Reports and screenshots are saved under `storage/verification/auth-ui/chrome/`
and `storage/verification/auth-ui/firefox/`.

## Verification

Passed:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm test -- tests/auth-ui.test.ts tests/frontend.test.ts tests/security.test.ts`
  with `RUN_DB_TESTS=0`: 85 tests passed, including 13 new auth route tests.
- Targeted Prettier check on the changed TypeScript, JavaScript, and CSS files.
- `git diff --check`
- Startup of `src/server.ts` using Node/tsx on a temporary port, followed by
  `/health`: HTTP 200, `{ "status": "ok" }`; the temporary process was stopped.
- `node --import tsx scripts/verify-auth-ui.mjs <browser-tools package.json>`
  using Playwright Chrome and axe-core installed outside the repository.

Route tests exercise the actual Express handlers, schemas, bcrypt, CSRF, session
regeneration, role redirects, successful farmer INSERT parameters, registration
email event, success flash, duplicate errors, and escaping. Database calls and
email events are mocked; a query guard prevents live database access.

Browser verification covers login and registration at 1440×1000, 1366×768,
1024×768, 768×1024, 640×900, 390×844, and 320×740. Both forms have no horizontal
overflow. Keyboard Enter/Space toggle password visibility without submitting.
Native POST submissions contain the expected field names and CSRF, and the
registration payload passes the root schema. Both forms remain usable without
JavaScript. No missing assets, console errors, or page errors were found.

WCAG A/AA axe audits found zero violations at 1440px, 768px, 390px, and 320px for
both forms, and zero violations in the registration server-error state.
Desktop/mobile screenshots were inspected. Screenshots and the browser report
are in `storage/verification/auth-ui/`, which is already ignored by Git.

## Remaining Limitations

No destructive integration tests were run against the configured working
database. Actual account persistence and successful login with live database
credentials have not been exercised; route behavior is verified with mocked
database calls, and normal application startup was verified separately.

Visual approval against the original Figma preview and checks on physical
devices and Safari remain manual. Chrome and Firefox scrolling checks passed.
The registration form is longer
than the preview because all required root backend fields are retained.

The original `login form/` archive remains as design source. Its scaffold,
React components, Tailwind imports, and Figma tooling are not needed at runtime;
nothing was deleted from it.
