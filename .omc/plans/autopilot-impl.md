# Implementation Plan: SiliconBeest Feature Gap

## Execution Groups (parallelizable)

### Group A: Database Migrations (must run first)
- [ ] Create migration `0023_feature_gaps.sql` with all new tables

### Group B: Backend API Endpoints (parallel after Group A)
- [ ] B1: Followed tags listing (`GET /api/v1/followed_tags`)
- [ ] B2: Status edit history + source (`GET /api/v1/statuses/:id/history`, `GET /api/v1/statuses/:id/source`)
- [ ] B3: Featured tags CRUD (`GET/POST/DELETE /api/v1/featured_tags`, `GET suggestions`)
- [ ] B4: Account notes (`POST /api/v1/accounts/:id/note`)
- [ ] B5: Remove from followers (`POST /api/v1/accounts/:id/remove_from_followers`)
- [ ] B6: Familiar followers (`GET /api/v1/accounts/familiar_followers`)
- [ ] B7: User domain blocks (`GET/POST/DELETE /api/v1/domain_blocks`)
- [ ] B8: Profile directory (`GET /api/v1/directory`)
- [ ] B9: Trending links (`GET /api/v1/trends/links`)
- [ ] B10: Endorsements/Account pins (`GET /api/v1/endorsements`, pin/unpin on accounts)

### Group C: Fedify Improvements (parallel with Group B)
- [ ] C1: Real featured tags in collection dispatcher
- [ ] C2: Liked collection dispatcher
- [ ] C3: WebFinger subscribe link
- [ ] C4: Inbox idempotency

### Group D: Frontend + i18n (after Group B)
- [ ] D1: Followed tags page + nav
- [ ] D2: Profile directory page
- [ ] D3: Status edit history modal
- [ ] D4: Account notes UI
- [ ] D5: Trending links in explore
- [ ] D6: i18n strings (en.json + ko.json)

## File Changes Summary

### New Files
- `migrations/0023_feature_gaps.sql`
- `server/worker/endpoints/api/v1/followedTags.ts`
- `server/worker/endpoints/api/v1/statuses/history.ts`
- `server/worker/endpoints/api/v1/statuses/source.ts`
- `server/worker/endpoints/api/v1/featuredTags.ts`
- `server/worker/endpoints/api/v1/directory.ts`
- `server/worker/endpoints/api/v1/domainBlocks.ts`
- `server/worker/endpoints/api/v1/endorsements.ts`
- `src/views/FollowedTagsView.vue`
- `src/views/DirectoryView.vue`

### Modified Files
- `server/worker/index.ts` — mount new routes
- `server/worker/endpoints/api/v1/accounts/index.ts` — add note, remove_from_followers, pin, unpin
- `server/worker/endpoints/api/v1/trends/index.ts` — add links route
- `server/worker/federation/dispatchers/collections.ts` — real featured tags, liked collection
- `server/worker/federation/fedify.ts` — WebFinger links, idempotency
- `server/worker/federation/listeners/inbox.ts` — idempotency
- `src/router/index.ts` — new routes
- `src/i18n/locales/en.json` — new strings
- `src/i18n/locales/ko.json` — new strings
