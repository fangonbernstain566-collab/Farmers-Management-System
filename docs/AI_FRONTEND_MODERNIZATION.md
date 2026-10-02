You are working directly inside my existing **Aringay Agriculture Management System** repository.

Your task is to perform a **complete frontend modernization and UI/UX enhancement of the existing system** while preserving all working backend functionality, routes, validation, database behavior, authentication, authorization, and business rules.

The goal is to make the application look and feel like a **modern professional web dashboard**, not like a traditional PHP/MySQL CRUD application.

The current application is NOT PHP. The primary project is:

- Node.js 22+
- TypeScript
- Express 5
- EJS templates
- PostgreSQL
- Supabase-compatible PostgreSQL
- PostgreSQL-backed sessions
- Vitest
- ESLint

There is also a nested `management-typescript/` MySQL/MariaDB project.

For this task, work ONLY on the **workspace-root Node.js/TypeScript/PostgreSQL application** unless explicitly required otherwise.

Do not modify the nested MySQL/MariaDB application.

---

# PRIMARY OBJECTIVE

Modernize the entire visible frontend.

Replace the old-fashioned CRUD/dashboard appearance with a polished, clean, responsive, modern administration interface.

The final UI should feel closer to a modern SaaS dashboard or contemporary management system.

The modernization should include:

- professional iconography
- modern navigation
- polished cards
- improved typography
- better spacing
- stronger visual hierarchy
- responsive layouts
- modern tables
- modern forms
- better buttons
- status badges
- improved empty states
- improved confirmation dialogs
- toast/alert styling
- loading states where appropriate
- polished dashboard statistics
- consistent page headers
- consistent color usage
- hover/focus states
- accessible interaction states
- mobile responsiveness

Do not turn this project into React, Vue, Angular, or another SPA framework.

Keep the existing:

Express + TypeScript + EJS architecture.

---

# VERY IMPORTANT: REMOVE THE "OLD PHP SYSTEM" FEEL

One of the primary goals is to eliminate visual characteristics commonly associated with older PHP CRUD systems.

Avoid:

- emojis used as interface icons
- plain text navigation with inconsistent symbols
- oversized colorful buttons everywhere
- heavy borders
- outdated Bootstrap-looking components
- unnecessary gradients
- excessive rounded rectangles
- inconsistent spacing
- plain HTML tables without styling
- generic browser-looking forms
- large empty white areas
- inconsistent typography
- bright random colors
- text such as "👤 Farmers", "📦 Resources", "🗑️ Trash", etc.

Replace emojis with a consistent professional icon system.

---

# ICON SYSTEM

Search the existing frontend dependencies first.

If an icon library already exists, reuse it.

Otherwise select ONE lightweight, professional icon system compatible with the current EJS architecture.

Preferred choices:

1. Lucide Icons
2. Bootstrap Icons
3. Font Awesome Free

Prefer **Lucide Icons** if it can be integrated safely and cleanly.

Do not mix several icon libraries.

Use one consistent icon language throughout the application.

Examples:

Dashboard → LayoutDashboard

Farmers → Users

Resources → Package / Boxes

Distribution → Truck / Send

Complaints → MessageSquareWarning

Notifications → Bell

Profile → UserCircle

History → History

Settings → Settings

Trash → Trash2

Restore → RotateCcw

Edit → Pencil

Delete → Trash2

View → Eye

Search → Search

Filter → SlidersHorizontal / Filter

Add → Plus

Logout → LogOut

Login → LogIn

Download → Download

Upload → Upload

Receipt → ReceiptText

Hectares / farmland → Sprout / Map

Inventory → Warehouse / Boxes

Activity → Activity

Do not use emojis where a proper UI icon should be used.

---

# FIRST STEP — AUDIT THE CURRENT FRONTEND

Before changing anything, inspect:

- `views/`
- shared layouts
- EJS partials
- header
- navbar
- sidebar
- footer
- CSS
- frontend JavaScript
- dashboard
- authentication pages
- farmer pages
- admin pages
- table pages
- forms
- dialogs
- alert messages
- empty states
- mobile layouts

Identify reusable components before editing individual pages.

Determine:

- what styles are global
- what styles are duplicated
- what pages use inconsistent layouts
- what pages contain emojis
- what pages use inline CSS
- what components can be standardized

Do not immediately rewrite every EJS file independently.

Create a consistent design system first.

---

# DESIGN DIRECTION

Create a clean agricultural administration dashboard.

The interface should look:

- professional
- modern
- trustworthy
- clean
- lightweight
- organized
- government/municipal-office appropriate
- agriculture-oriented without looking childish

Avoid making the design look like:

- a gaming dashboard
- crypto software
- neon UI
- futuristic sci-fi software
- a social media website
- an overly decorative landing page

The application is an operational agriculture management system.

---

# COLOR SYSTEM

Use a restrained agricultural color palette.

Prefer a professional primary green with neutral surfaces.

Example direction:

Primary:
deep agricultural green

Secondary:
medium green

Background:
very light gray / off-white

Cards:
white

Text:
dark slate / charcoal

Muted text:
gray

Success:
green

Warning:
amber

Danger:
red

Information:
blue

Use CSS variables so the palette is centralized.

For example:

```css
:root {
    --color-primary: ...;
    --color-primary-hover: ...;
    --color-primary-soft: ...;

    --color-bg: ...;
    --color-surface: ...;
    --color-border: ...;

    --color-text: ...;
    --color-text-muted: ...;

    --color-success: ...;
    --color-warning: ...;
    --color-danger: ...;
    --color-info: ...;
}
```

Do not scatter random hardcoded colors across templates.

---

# TYPOGRAPHY

Use a modern system font stack unless the project already includes a suitable font.

Prefer something similar to:

Inter
or
system-ui

Use clear hierarchy:

Page title
Section title
Card title
Body
Small/muted metadata

Avoid unnecessarily huge text.

Maintain readable line heights.

---

# MAIN APPLICATION LAYOUT

Create a consistent desktop layout consisting of:

Sidebar

Top navigation/header

Main content area

The layout should remain usable on tablets and mobile devices.

---

# SIDEBAR

Modernize the sidebar significantly.

It should contain:

- application branding
- grouped navigation
- consistent icons
- active-page indicator
- hover states
- accessible focus states
- administrator/farmer-specific navigation
- logout action
- responsive collapse behavior if practical

Replace any emoji navigation items.

Example structure:

Aringay Agriculture

Overview
- Dashboard

Management
- Farmers
- Resources
- Distributions
- Complaints

System
- Notifications
- Activity
- Trash

Account
- Profile
- Logout

Only show items that the current user's role is allowed to access.

Do not expose admin links to farmers.

Do not create routes just because a navigation item would look nice.

Navigation must reflect existing functionality.

---

# TOP HEADER

Create a modern header that may contain:

- page context
- notification shortcut
- current user information
- role indicator
- profile menu
- mobile sidebar trigger

Keep it clean.

Do not duplicate navigation unnecessarily.

---

# PAGE HEADERS

Standardize page headers.

Typical page:

Page title

Short description

Primary action on the right where appropriate

Example:

Farmers

Manage registered farmers and agricultural land information.

[+ Add Farmer]

Use icons where helpful but avoid clutter.

---

# DASHBOARD

Redesign dashboard statistic cards.

Examples:

Total Farmers

Registered Hectares

Available Resources

Active Distributions

Pending Complaints

Unread Notifications

Each card should have:

- relevant icon
- clear label
- prominent value
- optional supporting text
- subtle icon background

Do not use emoji.

Avoid excessive colors.

Cards should be visually consistent.

If statistics come from PostgreSQL, preserve their existing data bindings.

Do not replace database values with hardcoded mock numbers.

---

# TABLES

Modernize all tables.

Tables should support visually:

- clear headers
- proper row spacing
- subtle separators
- hover state
- status badges
- compact actions
- responsive overflow
- empty state
- search/filter controls where already implemented

Actions should preferably use icon buttons with tooltips or icon + short text.

Example:

Eye → View

Pencil → Edit

Trash2 → Delete

RotateCcw → Restore

Do not put several oversized colored buttons in every row.

Use appropriate danger styling only for destructive actions.

---

# STATUS BADGES

Create reusable status badge styles.

Examples:

Active

Inactive

Pending

Received

Distributed

Resolved

Unread

Deleted

Use subtle background colors rather than large saturated blocks.

Keep status semantics consistent across the application.

---

# FORMS

Modernize all forms.

Requirements:

- labels above fields
- consistent input heights
- clear focus states
- proper spacing
- help text
- inline validation feedback
- clear required indicators
- improved select elements
- textarea styling
- file upload styling
- disabled states

Do not remove server-side validation.

Do not rely only on client-side validation.

Preserve existing field names and form actions unless a functional bug requires otherwise.

---

# BUTTON SYSTEM

Create a consistent button system.

Recommended variants:

Primary

Secondary

Outline

Danger

Ghost / Icon

Sizes:

Small
Default

Examples:

Create Farmer → Primary

Save Changes → Primary

Cancel → Secondary or Ghost

Delete → Danger

Back → Secondary/Ghost

View → Ghost/Icon

Avoid every action having a different random color.

---

# MODALS / CONFIRMATION

If destructive actions currently use ugly browser dialogs or inconsistent confirmation behavior, improve them if it can be done safely without changing backend behavior.

For delete confirmations:

Clearly show what will happen.

Example:

Delete farmer?

This farmer will be moved to Trash and can be restored later.

Cancel
Move to Trash

For permanent or dangerous actions, use stronger wording.

Do not accidentally change soft-delete operations into hard deletes.

---

# TOASTS AND ALERTS

Improve flash messages / alerts.

Support:

Success

Error

Warning

Information

They should:

- use icons
- have clear colors
- be dismissible where appropriate
- fit the overall design system

Do not expose database errors or stack traces.

---

# EMPTY STATES

Replace plain messages such as:

"No data found"

with polished empty states.

Example:

[Users icon]

No farmers yet

Registered farmers will appear here.

[Add Farmer]

Only show an action if that action already exists and the current user has permission.

---

# SEARCH / FILTER TOOLBARS

Where search/filter functionality already exists, modernize the UI.

Recommended layout:

Search input

Filter dropdown

Optional reset button

Primary action aligned right

Do not implement fake filters that have no backend/frontend functionality.

---

# NOTIFICATIONS

Modernize notification pages.

Clearly distinguish:

Unread
Read

Use:

Bell icons
timestamps
clear notification titles
subtle unread indicator

Do not change notification business logic unnecessarily.

---

# COMPLAINTS

Modernize complaint cards/tables.

Provide clear visual distinction for:

status
sender
date
attachment availability

Do not add complaint rejection functionality unless it already exists.

---

# RESOURCE MANAGEMENT

Use suitable icons and visual hierarchy for resource information.

Possible visual elements:

Package
Boxes
Warehouse
Scale
Sprout

Show:

resource name
available stock
unit
status
last update where already available

Do not fabricate inventory information.

---

# DISTRIBUTIONS

Modernize distribution screens.

Make allocation information easy to understand.

Where data is available, present:

Resource

Farmer

Hectares

Allocated quantity

Status

Distribution date

Receipt confirmation

Do not modify allocation mathematics purely for visual changes.

---

# FARMER PROFILE

Modernize farmer profile pages.

Use structured sections such as:

Personal Information

Farm Information

Distribution Summary

Recent Activity

Use icons sparingly.

Do not expose private information unnecessarily.

---

# AUTHENTICATION SCREENS

Redesign:

Login

Registration

into clean modern authentication screens.

Avoid the admin-dashboard sidebar on authentication pages.

Use centered or split-card layouts.

Keep branding consistent with Aringay Agriculture.

Do not break authentication form actions, CSRF, validation, sessions, or error messages.

---

# RESPONSIVE DESIGN

The UI must remain usable on:

Desktop

Laptop

Tablet

Mobile

At minimum:

sidebar should not permanently cover mobile content

tables should scroll safely

forms should fit narrow screens

buttons should wrap logically

page headers should stack on small screens

dashboard cards should reflow responsively

Do not require horizontal scrolling for the entire page.

---

# ACCESSIBILITY

Improve accessibility where practical.

Ensure:

- sufficient contrast
- visible keyboard focus
- semantic buttons
- icon buttons have accessible labels or titles
- form inputs have labels
- errors are understandable
- color is not the sole indicator of status

Do not remove existing accessibility behavior.

---

# JAVASCRIPT

Use vanilla JavaScript unless the project already uses another frontend library.

Do not introduce a heavy frontend framework.

JavaScript may be used for:

sidebar toggling

dismissible alerts

modal interactions

dropdowns

small UI enhancements

Do not duplicate backend business logic in frontend JavaScript.

---

# CSS ARCHITECTURE

Prefer reusable classes instead of page-specific inline styling.

Organize styles logically.

Possible categories:

layout

navigation

cards

buttons

forms

tables

badges

alerts

modals

utilities

responsive rules

Avoid:

large quantities of inline `style=""`

duplicated CSS blocks

!important everywhere

random per-page styles

---

# PRESERVE BACKEND FUNCTIONALITY

This is critical.

Do not change working:

routes

controllers

services

database queries

PostgreSQL schema

Supabase configuration

session behavior

CSRF behavior

authentication

authorization

resource allocation

soft deletion

file ownership checks

email queue logic

unless a change is required specifically to support the frontend and is clearly safe.

This is primarily a frontend modernization task.

---

# DO NOT CHANGE BUSINESS LOGIC JUST FOR DESIGN

In particular, do not modify:

resource allocation formulas

transaction logic

stock conservation

farmer eligibility calculations

complaint status workflow

email sending semantics

session behavior

ownership checks

database constraints

unless there is an actual existing bug discovered during the work.

---

# DO NOT INVENT FEATURES

Do not add functionality such as:

complaint rejection

password reset

farmer profile-change approval

complete admin-account management

chat

AI assistant

analytics that do not exist

maps

unimplemented reports

new database modules

This phase is primarily about modernizing what already exists.

---

# REMOVE EMOJIS FROM THE INTERFACE

Search the frontend for Unicode emojis used as interface decoration.

Replace UI emojis with proper icons.

Examples:

❌

👤 Farmers

📦 Resources

📋 Complaints

🔔 Notifications

🗑️ Trash

⚙️ Settings

Replace with proper SVG/icon components.

Emojis may remain only if they are actual user-generated content and not part of the application interface.

---

# ICON IMPLEMENTATION

Prefer reusable icon helpers/partials where practical.

Do not duplicate huge SVG markup unnecessarily.

If using Lucide, initialize icons consistently.

Ensure icons:

inherit appropriate color

use consistent size

align with text

do not cause layout shifts

have accessible labels where needed

---

# VISUAL CONSISTENCY REVIEW

After modernization, inspect all important screens.

Look specifically for:

different button heights

different border radius values

different input spacing

different page widths

inconsistent table styles

remaining emojis

old components

misaligned icons

broken mobile layouts

overlapping sidebar

unreadable colors

inconsistent status badges

Fix these inconsistencies.

---

# NO "HALF MODERNIZED" UI

Do not modernize only the dashboard while leaving the rest of the system visually outdated.

Apply the design system across all major existing screens.

At minimum review:

Authentication

Admin Dashboard

Farmer Dashboard

Farmers

Resources

Distribution

Complaints

Notifications

Trash

Profile

History

Receipts

Error pages

Any other visible implemented module discovered in `views/`.

---

# SAFE IMPLEMENTATION PROCESS

Work progressively.

Recommended sequence:

1. Inspect frontend structure.
2. Identify shared layouts and partials.
3. Define design tokens.
4. Implement icon system.
5. Modernize global layout.
6. Modernize sidebar/header.
7. Modernize shared components.
8. Modernize dashboard.
9. Modernize tables.
10. Modernize forms.
11. Modernize individual modules.
12. Modernize authentication.
13. Apply responsive rules.
14. Remove remaining emojis.
15. Run verification.

Do not make one enormous uncontrolled rewrite if smaller systematic changes are possible.

---

# VERIFICATION

Inspect `package.json` and use only scripts that actually exist.

Run appropriate safe checks such as:

TypeScript typecheck

ESLint

Vitest unit tests

build/startup verification

template rendering checks where practical

Do NOT run destructive integration tests unless the configured database clearly ends with:

`_test`

Never run destructive tests against my working Supabase database.

---

# VISUAL REGRESSION REVIEW

After implementation, verify that:

- every major page still renders
- routes remain correct
- forms submit correctly
- CSRF tokens remain present
- tables still receive the expected data
- actions still point to correct endpoints
- administrator navigation remains role-restricted
- farmer navigation remains role-restricted
- flash messages still work
- file upload forms still work
- delete/restore controls still work
- no EJS syntax errors exist

---

# IMPORTANT SECURITY RULE

Never display or print secrets from:

`.env`

database URLs

Supabase credentials

SMTP credentials

session secrets

API keys

If `.env.example` contains real credentials, replace them with safe placeholders without exposing their previous values.

Do not print secret values in your final report.

---

# WORK AUTONOMOUSLY

Do not stop after modernizing one page.

Continue through all major visible existing modules.

Do not ask me to approve ordinary UI/CSS/EJS changes.

Only stop if:

an operation risks deleting important data

real secrets are required

the target project/environment is ambiguous

a requested change would require altering critical business logic

Otherwise continue.

---

# FINAL QUALITY STANDARD

The final interface should feel like a modern production web dashboard built in 2026.

It should NOT feel like:

an old school project

a generic PHP CRUD panel

an outdated Bootstrap admin template

a collection of unrelated forms

a prototype

Visual consistency is more important than excessive decoration.

Prioritize:

clarity

spacing

hierarchy

consistency

accessibility

responsiveness

professional iconography

---

# FINAL REPORT

When finished, provide:

## Frontend Audit

Summarize major visual issues found.

## Files Changed

List modified frontend files.

## Design System

Explain:

colors

typography

icons

spacing

buttons

cards

tables

forms

badges

## Pages Modernized

List each major page/module updated.

## Emoji Replacement

State where emoji UI elements were replaced with icons.

## Responsive Improvements

Summarize mobile/tablet improvements.

## Functional Preservation

State which critical backend workflows were checked to ensure the frontend changes did not break them.

## Verification

List commands actually run and their results.

## Remaining UI Limitations

List anything that remains intentionally unchanged or requires later work.

Do not claim something was verified if it was not actually checked.

Begin by inspecting the current frontend and identifying the shared EJS layout/components before making changes.