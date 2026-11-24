---
id: 294
title: Create a private channel only its grant opens
milestone: M10-access
package: server
writes:
  - packages/contract/src/operations/channels.ts
  - packages/core/src/channels/create.ts
  - packages/core/test/channels/create.test.ts
  - packages/server/src/operations/channels.ts
  - packages/server/test/channels-private.test.ts
conformance: []
modes: [local, hosted]
depends_on: [283]
status: draft
claimed_by: null
issue: 469
---

## What the user does
As a connection with `manage`, I create a channel only I can use, `ob channels create ops/secret --private`.

## Done when
- [ ] as a direct connection whose grant is `*=all`, `ob channels create ops/secret --private` makes the channel and two grants, which `ob grants` shows: `--everyone ops/secret=none` and one naming the connection with `ops/secret=all`; another connection whose grant is `*=read,post` can then neither read nor post in `ops/secret`
- [ ] a caller without `manage` at the path prints `error: forbidden: …` and nothing is made

## Out of scope
- Making an existing channel private: upstream's `POST /channels` creates once.

## Notes
docs/protocol.md ("`private` makes two grants and the channel, as upstream"); the channel and both `ob.grant.created` in one write, under the grant-change rules (283); the maker's grant names its principal, a connection or a person.
