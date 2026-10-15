# Software Karkhana --- Landing Page Visual Direction

> **Important interpretation of the reference:** the supplied image is a
> *composite of two separate website/page captures placed side by side*.
> The left half shows one website preview; the right half shows a
> different page with services, testimonial/partners, and pricing. They
> are not two columns belonging to one real page. Do not recreate the
> screenshot literally as a single page or place two unrelated website
> screenshots beside each other. Extract the visual language, then
> compose one coherent Software Karkhana landing page.

## 1. Purpose

Build a distinctive, premium, dark editorial landing page for **Software
Karkhana**, a provider-agnostic software factory that coordinates the
full software delivery lifecycle. It should feel cinematic and carefully
art-directed, while still making a complex technical product
understandable.

The landing page should communicate that Karkhana is an executable
software factory---not just a coding chatbot or a dashboard. Show the
lifecycle through intent, planning, coordinated workers, isolated
execution, verification/evidence, review, delivery, and learning.

### Desired visual qualities

-   Near-black canvas with a rich blue/indigo atmospheric glow.
-   Strong editorial typography: large sans-serif headlines, with
    selective italic serif contrast.
-   Asymmetric composition and purposeful negative space.
-   Clear visual hierarchy and a few high-impact modules instead of a
    wall of generic cards.
-   Restrained blue/purple highlights against dark surfaces.
-   Real product UI previews or reserved slots for future product GIFs.
-   Subtle motion that supports the story, not motion for its own sake.
-   Product credibility through workflow visuals, evidence, agent
    coordination, and real capabilities---not fabricated stats or
    testimonials.

## 2. Read the reference correctly

The source image combines two independent visual references:

1.  **Left reference:** an immersive, large website preview with a dark
    header, dramatic blue light, oversized headline, a compact
    supporting paragraph, large metrics, and a white layered card
    overlapping the lower section.
2.  **Right reference:** a separate editorial page with a services list,
    testimonial/partner panel, and pricing comparison.

Use them as *separate sources of inspiration*. The final Karkhana site
should not imitate their exact content, logos, or structure. Bring the
shared traits into one consistent page.

For Karkhana, the recommended page composition is: - One coherent global
header. - One strong hero section, with a large statement and a visual
product/workflow preview. - A clear lifecycle section explaining how the
factory works. - A product capabilities section using selected React
Bits cards/components. - A product UI/GIF showcase with reserved media
slots. - Trust/evidence/governance section. -
Integrations/provider-agnostic section. - Final CTA and footer.

A split hero or overlapping preview can be used if it helps the visual
story, but do not render two unrelated web pages side-by-side.

## 3. Official React Bits is the preferred component source

**When building the frontend, use official React Bits components for
landing-page background effects, cards, animations, and suitable UI
components.** Do not default to hand-writing custom effects or generic
cards when a suitable official component already exists.

Official references: - React Bits Pro component library:
https://pro.reactbits.dev/docs/components - React Bits Pro installation:
https://pro.reactbits.dev/docs/installation - React Bits Pro MCP setup:
https://pro.reactbits.dev/docs/mcp - React Bits Pro introduction /
library overview: https://pro.reactbits.dev/docs/introduction

The official library describes animated components, backgrounds, text
effects, 3D/shader effects, cursor effects, UI/cards, marketing blocks,
application UI blocks, templates, and an Agent Kit. Check the actual
plan/license and registry access for the project before assuming every
asset is available.

### Required workflow for the coding agent

1.  Inspect the existing React project, dependencies, styling approach,
    `components.json`, and available MCP configuration before changing
    setup.
2.  Use the **official React Bits Pro MCP integration** where available
    to search and inspect components and install the right component
    source. Follow the official MCP documentation, not an unofficial
    server by default.
3.  Search by intended role and visual effect before implementation.
    Check both CSS and Tailwind variants when applicable, and use the
    variant compatible with the existing project.
4.  Prefer installing/copying the component source into the project
    through the documented registry/CLI. Do not merely draw a
    screenshot-like imitation of a component.
5.  Read component props, dependencies, accessibility limitations,
    performance notes, and licensing/plan requirements. Configure the
    component to fit Karkhana's palette and motion direction.
6.  Compose components into a coherent experience; do not dump many
    unrelated demos onto one page.
7.  Keep semantic HTML, responsive behavior, keyboard accessibility,
    reduced-motion support, and performance under review.
8.  If MCP is not connected, troubleshoot/enable it using the official
    setup guide. If that is blocked, use the official docs and supported
    CLI flow. Do not silently substitute a third-party MCP server.
9.  Before building a custom effect, document why no suitable official
    React Bits component fits the need. Custom CSS is still appropriate
    for layout, typography, spacing, and small project-specific details.
10. Capture screenshots at desktop and mobile sizes, critique the
    result, and iterate on the largest mismatches.

### Installation and MCP expectations

The official docs describe registering the React Bits Starter and Pro
registries in `components.json`, configuring the license key through the
documented environment setup, and using the shadcn CLI/MCP integration.
Follow the latest official steps because CLI requirements and registry
details may change. Never commit license keys or other secrets. Verify
the MCP connection and actual registry access rather than assuming it is
active.

Official MCP documentation: https://pro.reactbits.dev/docs/mcp

### React Bits component selection guide

Use the library's current catalogue to select components that fit the
design; names below are examples of candidates, not a requirement to use
every one:

  -----------------------------------------------------------------------
  Design role             React Bits candidates   Guidance
                          to investigate          
  ----------------------- ----------------------- -----------------------
  Hero background         Shader Waves, Chroma    Choose one primary
                          Waves, Aurora Beam,     effect; tune it to
                          Glowing Wave, Horizon   blue/indigo and keep
                          Bloom, Spectral Drape,  text readable.
                          Liquid Lines            

  Subtle ambient backdrop Aurora Blur, Rising     Use low contrast and
                          Particles, Blinking     low motion behind
                          Dots, Neural Float,     content.
                          Glimmer Wrap            

  Feature/product cards   Shader Card, Frame      Pick only when the
                          Border, Modal Cards,    interaction supports
                          Credit Card, Draggable  the content.
                          Grid                    

  Product screenshots /   Gradient Carousel,      Useful for showing
  galleries               Circle Gallery,         product areas or future
                          Rotating Cards,         GIFs; keep controls
                          Comparison Slider,      understandable.
                          Hover Preview           

  Headline/text animation Staggered Text, Text    Animate a small amount
                          Scatter, Blur           of hero copy, not every
                          Highlight, Text Path    heading.

  Interactive product     Simple Graph, Animated  Use only where it helps
  storytelling            List, Device, Draggable explain workflow,
                          Grid                    evidence, or product
                                                  outcomes.

  Transition/reveal       Neon Reveal, Shader     Use sparingly and
                          Reveal, Pixelate Hover  respect reduced-motion
                                                  preferences.
  -----------------------------------------------------------------------

Component availability, names, props, and plan access must be confirmed
in the official library at implementation time. The reference image is
not a substitute for reading the real component documentation.

### Avoid React Bits misuse

-   Do not use an animated effect just because it looks impressive.
-   Do not put a high-motion shader behind dense body text or forms.
-   Do not apply glowing borders to every card.
-   Do not stack multiple GPU-heavy WebGL effects in the same viewport.
-   Do not make cursor effects required for navigation.
-   Do not let visual effects delay the first meaningful render.
-   Prefer one signature hero background and a small number of
    supporting components.
-   Keep important workflow/product information as real HTML content,
    not baked into a canvas or image.

## 4. Page composition

### Global canvas

-   Base: near-black, approximately `#050609` to `#0A0910`.
-   Accent family: vivid blue, indigo, and a restrained violet
    highlight.
-   Main text: soft white.
-   Supporting text: cool gray.
-   Hairline separators: low-opacity white.
-   Use a soft atmospheric glow concentrated behind the hero visual,
    fading naturally into black.
-   Preserve generous negative space. Do not fill every gap with cards
    or decorative lines.

### Suggested design tokens

  Token                Starting value            Purpose
  -------------------- ------------------------- --------------------------
  `--page-bg`          `#07070B`                 Main background
  `--surface-1`        `#101016`                 Primary dark surface
  `--surface-2`        `#17151D`                 Raised surface
  `--surface-3`        `#211B2A`                 Selected/hovered surface
  `--text-primary`     `#F6F5FA`                 Main text
  `--text-secondary`   `#B5B1C0`                 Supporting text
  `--text-muted`       `#827D8E`                 Metadata
  `--accent-blue`      `#245CFF`                 Primary accent
  `--accent-indigo`    `#5747D9`                 Glow blend
  `--accent-violet`    `#B04DFF`                 Rare highlight
  `--line`             `rgba(255,255,255,.12)`   Dividers
  `--radius-card`      `16px`                    Cards
  `--radius-panel`     `22px`                    Large panels

Adjust colors to the actual React Bits component props and make sure
contrast remains accessible.

### Typography

-   Use a strong neutral sans-serif such as Geist or Inter for the main
    type.
-   Use a tasteful italic serif for one or two short emphasis phrases
    only.
-   Hero headline: approximately 56--84 px on wide desktop, scaling down
    responsively.
-   Section headings: approximately 28--44 px.
-   Body: 15--18 px with comfortable line-height.
-   Labels and metadata: 10--12 px, but keep them legible.
-   Headlines should be short and intentional, not a long paragraph
    broken into arbitrary lines.
-   Avoid overly wide text columns.

## 5. Recommended landing-page structure

### A. Header

A compact header on the dark canvas: - Karkhana mark/name on the left. -
A small set of high-value navigation links (for example: Platform, How
it works, Integrations, Docs). - One clear primary CTA. - Fine bottom
divider or a subtle translucent surface. - Avoid turning the header into
a dense app navigation bar.

### B. Hero

Use a split editorial composition inside one page: - **Copy region:** a
strong, plain-language headline explaining the software factory; one
concise paragraph; primary CTA and a quieter secondary action. -
**Visual region:** a large, credible Karkhana product/workflow preview.
Use a product screenshot, a small workflow graph, or a composed preview
panel---not a fake dashboard full of unreadable placeholder text. -
Apply one official React Bits background effect behind or around the
visual. Keep the glow behind the copy and maintain contrast. - Optional:
a small set of real capability labels or a factual status indicator. -
Reserve a clear area for future product GIFs. Do not hard-code the
layout around temporary placeholder imagery.

### C. Workflow / lifecycle

Show the end-to-end lifecycle as a clear sequence: **Intent → Plan →
Execute → Verify → Review → Deliver → Learn**

Use restrained visual connectors, short descriptions, and evidence
markers. This section should make Karkhana's factory concept clear
without requiring the visitor to understand internal architecture
terminology.

### D. Capabilities

Use a small, curated set of official React Bits card components or
suitable official marketing blocks. Possible content themes: -
Coordinated agents and workflow orchestration. - Isolated workers and
repository execution. - Verification with evidence and acceptance
criteria. - Human approvals, governance, and escalation. - Shared
context and project memory. - Provider-agnostic execution and
integrations.

Do not make every feature card identical if the content hierarchy calls
for variety. Keep component use consistent with the overall visual
language.

### E. Product preview / GIF gallery

Reserve dedicated slots for the product GIFs the team will add later: -
Use a single large featured preview plus smaller supporting previews, or
a restrained carousel. - Provide descriptive captions and clear
framing. - Use official React Bits gallery/card components when they
fit. - Ensure media has defined dimensions/aspect ratios to prevent
layout shift. - Make sure the page remains complete when a GIF is not
yet supplied.

### F. Evidence, trust, and governance

Show how the factory earns confidence: - Acceptance criteria and
evidence ledger. - Verification results and review states. - Human
approvals for architectural, security, and high-risk production
decisions. - Traceability from intent to delivered changes.

Avoid fabricated testimonials, fake client logos, invented metrics, or
claims that integrations are already live. Use truthful product
capabilities and clearly marked examples.

### G. Integrations and provider independence

Explain that Karkhana coordinates workflows and workers while remaining
independent of a single model, IDE, or coding agent. Use a calm
logo/icon row only for integrations that are real or explicitly label
planned integrations. Do not imply every provider is production-ready
merely because an adapter interface exists.

### H. Final CTA and footer

-   Re-state the value proposition in a concise line.
-   One clear next action.
-   Minimal footer with documentation, product, and legal links.
-   Maintain the same spacing, color, and type rhythm as the rest of the
    page.

## 6. Cards and component usage rules

-   Use official React Bits components for suitable cards, backgrounds,
    text effects, galleries, and animations.
-   Customize the source component through supported props first; only
    fork or rewrite it when necessary.
-   Use custom CSS for layout and project-specific composition, not to
    rebuild existing library components without reason.
-   A card must communicate a meaningful idea or product capability.
    Avoid generic "icon + title + two lines" repetition across the whole
    page.
-   Limit the number of visual treatments: one primary card style, one
    highlighted/interactive style, and occasional special modules.
-   Avoid glassmorphism everywhere. Use it only if the selected
    component and page context benefit from it.
-   Use shadows sparingly. Let lighting and contrast create depth.
-   Keep interaction affordances consistent: hover, focus, pressed,
    disabled, and selected states should be recognizable.

## 7. Motion and performance

-   Hero background motion should be slow and atmospheric.
-   Keep text animation limited to the hero or one section entrance.
-   Prefer opacity and transform for UI transitions.
-   Respect `prefers-reduced-motion`.
-   Pause or reduce background rendering when the component is
    off-screen or the page is hidden where supported.
-   Use adaptive quality/resolution options when available.
-   Avoid several simultaneous shader/WebGL effects.
-   Provide a static fallback when WebGL is unavailable or reduced
    motion is requested.
-   Keep buttons, links, and content usable without pointer effects.
-   Test on mid-range mobile devices; visual quality is not an excuse
    for poor responsiveness.

## 8. Responsive behavior

### Desktop

-   Use an asymmetric hero with generous outer padding.
-   Keep the main message and visual preview in one cohesive
    composition.
-   Let the background effect span the hero, not the entire site
    indiscriminately.
-   Keep section widths and alignment intentional.

### Tablet

-   Reduce the hero gap and headline scale.
-   Keep the visual preview legible.
-   Simplify decorative elements before reducing content readability.

### Mobile

-   Stack copy before or after the preview based on the story; ensure
    the CTA appears early.
-   Reduce background effect complexity and intensity.
-   Use cards in a single column or a deliberate horizontal gallery.
-   Keep workflow steps readable and allow wrapping.
-   Never force a desktop split composition into a tiny viewport.
-   Ensure touch targets are comfortable and horizontal overflow is
    eliminated.

## 9. Accessibility and quality

-   Use semantic HTML and a logical heading hierarchy.
-   Keep all controls keyboard accessible and show `:focus-visible`.
-   Add accessible names to icon-only controls.
-   Never rely on color alone to show status or selection.
-   Keep body copy readable and test contrast.
-   Respect reduced motion.
-   Ensure content is available if canvas/WebGL effects fail.
-   Optimize images and define media aspect ratios.
-   Test at 320, 375, 768, 1024, 1440 px and a wide desktop viewport.

## 10. Screenshot critique loop

After implementation, take screenshots at fixed viewports and critique
them against the reference's *visual language*, not as a literal
pixel-copy exercise.

Fix mismatches in this order: 1. Overall composition and spacing. 2.
Hero headline scale, line breaks, and alignment. 3. Background glow
position, hue, and intensity. 4. Product preview size and depth. 5.
Section rhythm and card density. 6. Typography and subtle borders. 7.
Micro-interactions and motion polish.

At each pass, identify the three largest visual problems, fix those
first, and capture another screenshot. Avoid adding more effects to
compensate for weak composition.

## 11. Definition of done

-   [ ] The final page is one coherent Karkhana website, not two
    reference screenshots merged into one page.
-   [ ] It preserves the near-black, blue/indigo, editorial visual
    direction.
-   [ ] Official React Bits components have been searched and used for
    appropriate background/card/animation roles.
-   [ ] The official React Bits MCP setup has been checked and used
    where available.
-   [ ] No unofficial substitute was silently treated as the official
    MCP integration.
-   [ ] Components are configured to fit Karkhana rather than used as
    unrelated demos.
-   [ ] The hero makes the software-factory value proposition clear.
-   [ ] Workflow, evidence, governance, and provider independence are
    represented truthfully.
-   [ ] Product GIF/media slots are reserved and can be populated later.
-   [ ] Mobile, keyboard, reduced-motion, and fallback behavior have
    been tested.
-   [ ] No fake testimonials, fake customer logos, or invented
    performance metrics remain.
-   [ ] Screenshot critique iterations have been completed.

## 12. Official references

-   React Bits Pro components: https://pro.reactbits.dev/docs/components
-   React Bits Pro installation:
    https://pro.reactbits.dev/docs/installation
-   React Bits Pro MCP: https://pro.reactbits.dev/docs/mcp
-   React Bits Pro introduction:
    https://pro.reactbits.dev/docs/introduction
-   React Bits free library: https://www.reactbits.dev/

Use these official pages as the source of truth for current components,
supported props, installation steps, registry setup, and MCP behavior.

## 13. Platform-wide design consistency — every route and sub-screen

**This visual direction applies to the entire Software Karkhana product, not only the marketing landing page.** Before implementation, inventory the complete application surface and plan the design of every screen, nested route, modal, drawer, wizard step, empty state, error state, and responsive variant. Do not style only the screens that are easiest to see.

### Required screen inventory before building

Create and maintain a route-and-screen inventory from the actual product requirements, existing repository, navigation model, and role/permission rules. Count and account for all applicable screens, including (but not limited to):

- Public landing page and all marketing sections/pages.
- Documentation, product information, integrations, pricing, and other public routes that are in scope.
- Sign up, sign in, sign out, email verification, password reset, invitation acceptance, and multi-factor/authentication states where applicable.
- Onboarding: welcome, account/workspace creation, joining a workspace, invitations, profile/preferences, first product/project creation, provider setup, repository connection, permissions/consent, and completion.
- Workspace and portfolio views, lists, details, search, filters, and settings.
- Product and project dashboards, project overview, activity, roadmap, backlog, planning, tasks, dependencies, and milestones.
- Workflow builder, workflow runs, execution timeline, agent/worker activity, logs, retries, and escalation states.
- Repository/code changes, branch/worktree views, pull requests, code review, diffs, and approvals.
- Test plans, test runs, quality gates, evidence, acceptance criteria, security findings, and remediation.
- Architecture and design artifacts, decisions, diagrams, and review histories.
- Deployment, environments, CI/CD runs, release readiness, release approvals, rollback, and production feedback.
- Shared context, project memory, knowledge sources, provenance, conflicts, stale-context indicators, and memory promotion/review.
- Integrations, provider/model configuration, credentials and secret-management flows, webhooks, and connection status.
- Notifications, inbox, search, command palette, help, profile, preferences, audit logs, governance, roles, permissions, and administration.
- All modal/dialog, side panel, drawer, nested detail page, tab, multi-step form, confirmation, loading, empty, success, error, denied-access, offline, and retry states that belong to these features.
- Responsive variants for desktop, tablet, and mobile, plus keyboard focus and reduced-motion states.

This list is a coverage checklist, not a claim that every feature is already implemented. Use the actual scope and repository to establish the authoritative inventory, and clearly label planned versus implemented routes.

### Screen coverage matrix

Before coding the UI, produce a screen matrix with at least these fields:

| Field | Requirement |
|---|---|
| Screen/route ID | Stable identifier for the page or state |
| Route and parent | URL/path plus its parent screen |
| User/role | Who can access it and under what permissions |
| Purpose | The user task the screen supports |
| Entry/exit paths | How users reach it and where they can go next |
| Layout family | Marketing, authentication, onboarding, dashboard, detail, editor, table/list, monitoring, settings, or overlay |
| Shared visual elements | Header, sidebar, breadcrumb, tabs, page actions, cards, status, typography, and spacing |
| States | Initial, loading, empty, populated, success, error, disabled, permission-denied, and retry states as relevant |
| Responsive behavior | Desktop, tablet, mobile, and overflow strategy |
| Interactions | Forms, navigation, keyboard behavior, hover/focus/selected states |
| Data/evidence | Real data required, provenance, freshness, and any proof required for completion |
| Implementation status | Planned, in progress, implemented, verified, or blocked |
| Verification | Screenshot, route test, accessibility check, and functional test evidence |

Count the rows and identify missing routes/states before implementation. Reconcile the matrix with the navigation tree, role permissions, and product requirements. Do not assume that a page is complete just because its top-level route exists.

### Apply the theme consistently without making every screen identical

Use the same underlying visual language across the whole platform: near-black foundations, cool text, blue/indigo accents, restrained violet highlights, deliberate typography, consistent borders, carefully chosen radii, subtle transitions, and strong spacing hierarchy. However, **preserve each screen’s functional needs**:

- **Marketing/landing pages:** cinematic glow, oversized editorial type, strong composition, selected React Bits effects, and visual storytelling.
- **Authentication:** focused, low-distraction forms; the same palette and typography, but no distracting background effect behind critical inputs.
- **Onboarding:** clear steps, progress, helpful explanations, obvious primary actions, and graceful save/resume/error states.
- **Dashboards:** information hierarchy, useful density, readable tables, status indicators, filters, and actionable summaries. Avoid oversized marketing typography inside operational screens.
- **Execution/monitoring screens:** clear run states, logs, timelines, evidence, retries, and escalation actions. Make important status information legible without relying on animation.
- **Editors and workflow builders:** prioritize usable working space, stable controls, keyboard support, clear selection states, and understandable validation.
- **Settings and administration:** consistent navigation, grouped forms, clear permissions, safe defaults, and explicit confirmation for destructive/high-impact changes.
- **Modals, drawers, and nested pages:** inherit typography, colors, spacing, focus behavior, and action hierarchy from the parent surface.
- **Empty/loading/error states:** use the same visual language and explain what happened and what the user can do next.

Do not copy the landing page’s exact hero layout into every dashboard. The goal is one recognizable product identity with layout patterns suited to each job.

### Shared component and pattern inventory

Identify and reuse consistent implementations for:
- Global shell, public header, authenticated app shell, sidebar, mobile navigation, breadcrumbs, tabs, page header, and page actions.
- Buttons, links, form fields, selects, toggles, checkboxes, badges, tooltips, menus, dialogs, drawers, and notifications.
- Cards, tables, lists, filters, search, pagination, empty states, skeletons, alerts, status indicators, and timelines.
- Workflow/run status, worker activity, evidence and acceptance records, approvals, audit history, and escalation panels.
- Authentication fields, onboarding stepper, integration/provider status, repository connection, and secret/permission flows.
- Typography, spacing, responsive breakpoints, focus rings, motion rules, borders, surface levels, and color semantics.

Use official React Bits components where they genuinely fit—especially landing-page backgrounds, visual effects, marketing cards, galleries, and selected motion elements. Do not force a decorative React Bits component into dense operational tables, forms, security flows, or critical workflow controls when a simpler, more accessible UI pattern is better. For any suitable React Bits component, prefer the official component source and documented integration over an imitation.

### End-to-end visual and functional audit

Before declaring the platform complete:

1. Generate a route list from the router and compare it against the screen matrix.
2. Visit every in-scope route and nested screen under the relevant role/permission conditions.
3. Exercise every onboarding and authentication step, including validation, back/forward navigation, reload/resume, and error states where applicable.
4. Test navigation links, tabs, filters, pagination, dialogs, drawers, forms, and primary/secondary actions.
5. Capture screenshots for every major screen family at agreed desktop and mobile viewport sizes.
6. Check theme consistency: palette, type scale, spacing, borders, surface levels, icon style, focus states, and motion.
7. Check functional usability separately from visual similarity. A beautiful screen with dead controls is not done.
8. Check accessibility, keyboard navigation, reduced motion, contrast, overflow, and loading/error/empty states.
9. Record defects with route, role, viewport, reproduction steps, screenshot, and severity; fix the highest-impact issues and rerun the audit.
10. Report verified coverage honestly: total routes/states inventoried, implemented, tested, and still missing. Do not claim every screen is covered without evidence.

**Definition of done:** every in-scope landing page, authentication screen, onboarding step, dashboard, nested dashboard page, detail view, dialog, and meaningful state is represented in the inventory, follows the same Karkhana visual language appropriately, and has been functionally and visually verified.
