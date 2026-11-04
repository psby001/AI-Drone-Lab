import type { ChallengeDefinition } from './types';
/** Preserve existing result fingerprints so adding a best-score view does not reset records. */
export function challengeSettingsKey(definition:ChallengeDefinition){let hash=14695981039346656037n;for(const c of JSON.stringify(definition)){hash^=BigInt(c.charCodeAt(0));hash=BigInt.asUintN(64,hash*1099511628211n);}return hash.toString(16);}
