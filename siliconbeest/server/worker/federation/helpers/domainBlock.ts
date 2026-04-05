/**
 * Domain block checking for federation.
 *
 * Re-exports from the shared package. The implementation now lives in
 * packages/shared/domain-blocks/index.ts.
 */

export {
  isDomainBlocked,
  extractDomain,
  type DomainBlockResult,
} from '../../../../../packages/shared/domain-blocks';
