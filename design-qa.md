# Design QA: auth split layout

- Source visual truth: user-provided auth layout reference (`codex-clipboard-e43112b6-4ca9-4803-b012-e48aaf6c91b5.png`, 2048 × 1536 px) plus the user-provided chair image (`codex-clipboard-515dacda-e37c-4651-b386-5c9bada8db6d.png`, 784 × 1168 px).
- Implementation: `http://localhost:57563/`, captured inline in the Codex in-app Browser because this Browser surface does not expose a persistent screenshot file path.
- Viewports: desktop 1274 × 934 CSS px during annotation review; final desktop verification at 1012 × 934 CSS px; responsive verification at 390 × 844 CSS px.
- Density normalization: device scale factor 1 for final responsive capture. The source was used as composition guidance rather than a pixel-identical product skin.
- States: login and registration.

## Full-view comparison evidence

- The desktop result preserves the requested split composition: the supplied image owns the left side and the form owns the right side.
- The user-directed final pass removes the outer page padding, outer shell radius, image overlays, visible brand labels, explanatory subtitle, and top mode switch.
- The supplied image keeps the chair as the focal point without stretching. The right column remains visually centered and readable.

## Focused comparison evidence

- The form region was inspected separately in both login and registration states. Labels, fields, primary actions, and the bottom mode-switch link remain aligned and usable.
- The image region was inspected at desktop and mobile widths. Cropping keeps the chair visible and does not introduce distortion.

## Required fidelity surfaces

- Typography: existing Inter family retained for Tommma; heading and field hierarchy remain clear after secondary copy removal.
- Spacing and layout: full-bleed page and square outer shell match the final annotations; internal image radius and form spacing remain intentional.
- Colors and tokens: white form surface and charcoal action preserve the reference's restrained UI treatment while the user-selected photo supplies color.
- Image quality: supplied 784 × 1168 source is delivered as a 156 KB JPEG with no visible compression artifacts at the rendered size.
- Copy and content: only the state heading, field labels, primary action, validation messages, and account-mode link remain.
- Accessibility and behavior: labels wrap their inputs, status messages use `aria-live`, both modes are keyboard-operable, and no browser console warnings or errors were observed.

## Comparison history

1. Initial pass added a top segmented switch, brand labels, a subtitle, and a text overlay on the image. Desktop and mobile captures were functional, but those elements did not match the user's preferred minimal result.
2. The user annotated each extra element and the outer frame. All requested elements were removed, outer padding and radius were set to zero, and new desktop/mobile captures confirmed the simplified layout.

## Findings

No actionable P0, P1, or P2 findings remain. The responsive screen stacks the image above the form at 390 px without overlap or clipped controls.

final result: passed
