# SiliconBeest Feature Gap Implementation Spec

## Research Summary

After analyzing ActivityPub spec, Mastodon API, Misskey API, Fedify framework, and the existing SiliconBeest codebase, the following gaps were identified.

## Gap Analysis: Missing Mastodon API Endpoints

### Priority 1 — High Impact (API Completeness for Client Compatibility)

| # | Feature | Endpoints | Why |
|---|---------|-----------|-----|
| 1 | **Followed Tags List** | `GET /api/v1/followed_tags` | Tag follow exists but no listing endpoint |
| 2 | **Status Edit History** | `GET /api/v1/statuses/:id/history` | Clients expect edit history |
| 3 | **Status Source** | `GET /api/v1/statuses/:id/source` | Needed for re-editing statuses |
| 4 | **Featured Tags CRUD** | `GET/POST/DELETE /api/v1/featured_tags` | Profile featured tags management |
| 5 | **Account Notes** | `POST /api/v1/accounts/:id/note` | Personal notes on other accounts |
| 6 | **Remove from Followers** | `POST /api/v1/accounts/:id/remove_from_followers` | Safety: force-remove a follower |
| 7 | **Familiar Followers** | `GET /api/v1/accounts/familiar_followers` | Social discovery |
| 8 | **User Domain Blocks** | `GET/POST/DELETE /api/v1/domain_blocks` | User-level domain blocking |
| 9 | **Profile Directory** | `GET /api/v1/directory` | Account discovery |
| 10 | **Trending Links** | `GET /api/v1/trends/links` | Content discovery |
| 11 | **Endorsements** | `GET /api/v1/endorsements`, `POST accounts/:id/pin`, `POST accounts/:id/unpin` | Featured accounts on profile |

### Priority 2 — Fedify Improvements

| # | Feature | Details |
|---|---------|---------|
| 12 | **Featured Tags Collection** | Real data in `setupFeaturedTagsDispatcher` (currently empty) |
| 13 | **Liked Collection** | `setLikedDispatcher` — expose liked posts via AP |
| 14 | **WebFinger Subscribe Link** | `setWebFingerLinksDispatcher` — Mastodon remote follow template |
| 15 | **Inbox Idempotency** | `.withIdempotency()` on inbox listeners |

### Priority 3 — Frontend + i18n

| # | Feature | Details |
|---|---------|---------|
| 16 | **Followed Tags Page** | New view + sidebar link |
| 17 | **Profile Directory Page** | New view at /directory |
| 18 | **Featured Tags Settings** | Manage in settings |
| 19 | **Trending Links UI** | Display in explore view |
| 20 | **Status Edit History** | Modal/drawer for edit history |
| 21 | **Account Notes UI** | Note field in profile view |
| 22 | **i18n strings** | All new UI text in en.json and ko.json |

## DB Migrations Needed

1. `status_edits` table — store edit history snapshots
2. `account_notes` table — personal notes on accounts
3. `featured_tags` table — user featured tags
4. `user_domain_blocks` table — user-level domain blocks
5. `account_pins` table — endorsed/featured accounts
6. `preview_card_trends` table — trending links tracking

## Constraints

- All i18n changes in both `en.json` and `ko.json`
- Follow existing patterns: Hono routes, Zod validation, D1 queries, ULID PKs
- No new npm dependencies
- Must maintain Mastodon API response format compatibility
