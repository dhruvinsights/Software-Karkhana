# Dashboard theme pass

Statuses: `TODO` | `IN PROGRESS` | `DONE`. Keep the sidebar, topbar and react-bits backgrounds as they are.

| # | Task | Status | Note |
|---|------|--------|------|
| 1 | Default 100% zoom looks like the current 110% | DONE | `.app-zoom` on the AppShell root (`index.css`): `zoom: 1.1` at ≥1280px wide, with width/height divided back so it fills the viewport exactly. Landing page untouched. Checked: no scrollbars, WebGL backgrounds full size. |
| 2 | One button system everywhere, taken from the landing page | DONE | `.k-btn-primary` / `.k-btn-secondary` in `index.css` (14px-ish radius, white rim line, blue glow, light sweep on hover) on 33 primary + 8 secondary buttons. Overview New Product/New Project use the real `SpecularButton` with the landing settings. Sidebar and topbar untouched. Not every button uses SpecularButton: each one is a WebGL canvas, and browsers cap the number of WebGL contexts. |
| 3 | Calm the icon colors: one accent, neutral icons | DONE | Decorative purple/violet/indigo/cyan/teal/sky (+ hex #9b6dff/#514CE8/#7C3AED/#8B5CF6) mapped to one icon blue `#5B8FFF` or neutral; green/amber/red kept for real statuses; react-bits `color1/color2` untouched. |
| 4 | Screenshot check + build | DONE | Playwright screenshots of Overview, Project Hub, Reviews, Engineering; `tsc` clean apart from the existing ProductIdeaLab errors; vite build OK. |

## Round 2

| # | Task | Status | Note |
|---|------|--------|------|
| 5 | Remove "CIRQ" naming from IdeaQ (it was a reference product, not our feature) | DONE | Not in code: "CIRQ-Vishwa" is a product row in the dev DB. IdeaQ showed the product name as its title; header now reads "IdeaQ" with "… for <product>" underneath (`ProductIdeaLab.tsx`). |
| 6 | Role-based sidebar: each role sees only its own stations (developer sees most) | DONE | `AppShell.tsx` `ROLE_NAV`: shared spaces + per-role stations; workspace role (invite) wins over account role, with aliases pm/director/lead; owners/admins see everything; the rest sits under a collapsed "Other tools (n)"; the current screen always shows. Verified owner vs developer in Playwright. |
| 7 | Move AI Companion from the topbar into the sidebar | DONE | Button at the top of the sidebar nav (works collapsed too); removed from the topbar. |
