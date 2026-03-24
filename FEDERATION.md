# Federation

This document describes the federation capabilities and standards supported by SiliconBeest, in accordance with [FEP-67ff](https://codeberg.org/fediverse/fep/src/branch/main/fep/67ff/fep-67ff.md).

## Supported Protocols

- [ActivityPub](https://www.w3.org/TR/activitypub/) (Server-to-Server)
- [WebFinger](https://www.rfc-editor.org/rfc/rfc7033) (Account discovery)
- [NodeInfo 2.1](https://nodeinfo.diaspora.software/) (Instance metadata)

## Supported Activities

### Outbound (Activities we send)

| Activity | Object Type | Description |
|----------|-------------|-------------|
| `Create` | `Note` | Publishing a new status |
| `Update` | `Note` | Editing a published status |
| `Delete` | `Note`, `Tombstone` | Deleting a status |
| `Follow` | `Actor` | Following a remote account |
| `Accept` | `Follow` | Accepting a follow request |
| `Reject` | `Follow` | Rejecting a follow request |
| `Like` | `Note` | Favouriting a status |
| `Announce` | `Note` | Boosting/reblogging a status |
| `Undo` | `Follow`, `Like`, `Announce`, `Block` | Reversing a previous activity |
| `Block` | `Actor` | Blocking a remote account |
| `Move` | `Actor` | Account migration |
| `Flag` | `Actor`, `Note` | Reporting a user or content |
| `EmojiReact` | `Note` | Misskey-compatible emoji reaction |

### Inbound (Activities we process)

All activities listed above are accepted and processed when received from remote servers, plus:

- `Add` / `Remove` for featured collection management
- `EmojiReact` (Misskey/Calckey emoji reactions on statuses)

## Supported Object Types

| Type | Description |
|------|-------------|
| `Note` | Text posts, replies, and direct messages |
| `Person` | User accounts |
| `Service` | Bot accounts |
| `Application` | Instance actor |

## HTTP Signatures

SiliconBeest supports the following HTTP signature methods for authenticating federation requests:

| Method | Support | Description |
|--------|---------|-------------|
| `draft-cavage-http-signatures` | Full | Legacy HTTP Signatures (draft-cavage-http-signatures-12). Used by most Mastodon-compatible software. RSA-SHA256 signing. |
| RFC 9421 (HTTP Message Signatures) | Planned | Modern HTTP signature standard. |
| Linked Data Signatures | Verification only | LD Signatures on activities are verified when present, used for relay forwarding. |
| Object Integrity Proofs (FEP-8b32) | Verification only | Ed25519-based `DataIntegrityProof` with `ed25519-jcs-2022` cryptosuite. Verified on incoming activities when `proof` is present. |

### Key Types

- **RSA (RSASSA-PKCS1-v1_5, 2048-bit)**: Primary signing key, referenced via `publicKey` on Actor documents.
- **Ed25519**: Used for Object Integrity Proofs, referenced via `assertionMethod` using the `Multikey` type with `publicKeyMultibase` encoding.

## Extensions

### Misskey Emoji Reactions

SiliconBeest supports receiving and sending emoji reactions using the `EmojiReact` activity type, compatible with Misskey, Calckey, Firefish, and other implementations.

### Conversation Field

The `conversation` field on `Note` objects is supported for threading compatibility with OStatus-era software. Conversations use `tag:` URIs for locally-originated threads and preserve remote `conversation` values for federated threads.

### Sensitive Flag

The `sensitive` boolean on `Note` objects is supported. When set, media attachments are hidden behind a content warning.

### Content Warnings

The `summary` field on `Note` objects is used as a content warning (spoiler text), following the Mastodon convention.

### Quote Posts (FEP-e232)

SiliconBeest supports quote posts using the `quoteUri` property on `Note` objects for interoperability with Misskey, Akkoma, and Pleroma. The `_misskey_quote` field is also recognized for backward compatibility.

### Content Map

The `contentMap` property is supported on `Note` objects for specifying content language.

## WebFinger

SiliconBeest implements [RFC 7033 WebFinger](https://www.rfc-editor.org/rfc/rfc7033) at `/.well-known/webfinger`.

- Supports `acct:` URI scheme for user lookups
- Returns `application/jrd+json` responses
- Links include `self` (ActivityPub actor URI) and `http://webfinger.net/rel/profile-page`
- Aliases include both the actor URI and the profile page URL

## NodeInfo

SiliconBeest implements [NodeInfo 2.1](https://nodeinfo.diaspora.software/protocol) at `/.well-known/nodeinfo` and `/nodeinfo/2.1`.

Exposed metadata includes:
- Software name and version
- Supported protocols (ActivityPub)
- User count, status count, and domain count
- Registration status

## Instance Actor

SiliconBeest exposes an instance-level actor at `/actor` with type `Application`. This actor:

- Has its own RSA keypair for signing relay and instance-level activities
- Uses the instance domain as `preferredUsername`
- Sets `manuallyApprovesFollowers: true`
- Provides shared inbox at `/inbox`

## Relay Support

SiliconBeest supports ActivityPub relays for broader content distribution. Relay subscriptions are managed through the admin API and use the instance actor for authentication.

## Collection Pagination

All collection endpoints (followers, following, outbox) support pagination using `OrderedCollection` and `OrderedCollectionPage` with `next`/`prev` links, following the ActivityPub specification.

- Followers and following collections are paginated with a configurable page size
- The outbox collection includes `Create(Note)` activities

## Addressing Model

SiliconBeest follows the Mastodon addressing convention:

| Visibility | `to` | `cc` |
|-----------|------|------|
| Public | `as:Public` | Followers collection, mentioned actors |
| Unlisted | Followers collection | `as:Public`, mentioned actors |
| Followers-only | Followers collection | Mentioned actors |
| Direct | Mentioned actors | (empty) |

## FEP Compliance

| FEP | Title | Status |
|-----|-------|--------|
| FEP-8fcf | Followers Collection Synchronization | Supported (paginated followers collection, `alsoKnownAs` on actors) |
| FEP-67ff | FEDERATION.md | This document |
| FEP-e232 | Object Links (Quote Posts) | Supported (`quoteUri`, `_misskey_quote`) |
| FEP-8b32 | Object Integrity Proofs | Verification supported |
