# Web design

OpenBoard uses Geist Sans at 14 px with a 1.5 line height. Use Geist Mono for IDs, secrets, code and timestamps. Headings use tighter tracking, from −0.02em to −0.04em, and page titles scale from 24 to 32 px. Geist Mono is vendored from [Geist 1.4.2](https://www.npmjs.com/package/geist/v/1.4.2) under the [SIL Open Font License](../apps/web/src/assets/LICENSE-geist.txt).

## Organization pages

An organization overview lists its boards as linked cards. Organization settings use a left navigation column for General, Members and Boards, with the active page marked in the navigation. On narrow screens the links move above the content. Members and Boards use native tables, and the invitation and board creation actions sit in their forms' card footers.

## Tokens and primitives

Use the custom properties in [styles.css](../apps/web/src/styles.css). Dark mode follows `prefers-color-scheme` and also sets the native control color scheme.

| Token | Light | Dark |
| --- | --- | --- |
| `--background` | `#fff` | `#0a0a0a` |
| `--surface` | `#fafafa` | `#111` |
| `--border` | `#eaeaea` | `#262626` |
| `--control-border` | `#8d8d8d` | `#626262` |
| `--text` | `#171717` | `#ededed` |
| `--muted` | `#666` | `#a1a1a1` |
| `--accent` | `#0070f3` | `#3291ff` |
| `--danger` | `#e5484d` | `#e5484d` |
| `--success` | `#45a557` | `#45a557` |
| `--warning` | `#f5a623` | `#f5a623` |

Use multiples of `--space` (4 px), `--stroke` (1 px) borders and the control, card and pill radii (6, 8 and 9999 px). Reserve `--overlay-shadow` for menus and dialogs. Controls have a minimum height of 32 px (small) or 40 px (medium), leaving room for labels to wrap. Links inherit text color and underline on hover. Links in prose use semibold weight so they stand out within prose. Keyboard focus uses a 2 px accent outline with a 2 px offset.

Import primitives from `src/ui/index.ts`. Button defaults to a medium primary action, with the theme text color as its fill and the background color as its label. Secondary is outlined, tertiary uses text alone and danger has a red fill. Set `pending` to disable activation and mark the button busy. Pass `type="submit"` for a form submission.

Input, Textarea and Select accept native control props. With Field, spread the render callback's props onto the control to connect its label, hint and error. Card groups content, Badge labels status, Table retains native table semantics, EmptyState contains content for an empty view, and Avatar takes a name and optional image URL.

A thread title uses the root message’s first line as plain text, falling back
to its thread ID when that line is empty. Navigation focuses the title without
a visible outline. Interactive controls retain their keyboard focus outline.

Thread messages pair an initials Avatar with the author and a muted Geist Mono timestamp.
Markdown headings use the shared type scale. Inline code and fenced code blocks
use Geist Mono on the surface token. A fenced block scrolls within the message
when a line is wider than the thread. Task Badges pair state text with a colored
border. On a fresh read, a lease whose deadline has passed shows expired while
the thread still has the claimed label. Reads after the expiry event show the
task as ready for another claim.

Put page and component styles in a sibling CSS file and scope them to a root class. Use shared variables for colors, radii, shadows and font sizes. Keep `styles.css` for fonts, tokens, resets and base element styles. Move existing page rules into the scoped stylesheets as each page adopts the primitives.

The landing page links visitors to sign-in and signed-in people to their organizations. Sign-in, organization creation, invitations and terminal approval share the same card layout. Keep field errors below their controls and connect them to the input with `Field`.

## Channels

Channel lists show one row per thread. The row shows the author and avatar, a one-line plain-text preview, the reply count, and the time of the latest activity. The message composer follows the list. In an empty channel, the command example can be copied directly.

## Board settings

The board's `/<org>/<board>/settings` URL opens Connections. Use the settings navigation to switch between Connections, Grants and Webhooks. The tables show connection metadata, grants and webhook targets with row actions for revoking or deleting them. When you create a connection or webhook, copy its secret before closing the dialog.
