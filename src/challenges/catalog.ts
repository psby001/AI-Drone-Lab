import { CHALLENGE_DEFINITIONS as RACING,createChallengeCatalog as createRacingCatalog } from './racingCatalog';
import { PRECISION_LANDING,precisionLandingPlugin,precisionLandingScene,precisionLandingScoring } from './precisionLanding';
import { PHOTO_HUNT } from './photoHunt/definition';
import { photoHuntPlugin,photoHuntScoring } from './photoHunt/rule';
import { photoHuntScene } from './photoHunt/scene';
export const CHALLENGE_DEFINITIONS=[...RACING,PRECISION_LANDING,PHOTO_HUNT];
/** Composition only: a new level adds plugins and data, never manager branches. */
export function createChallengeCatalog(){const c=createRacingCatalog();c.rules.register('precision-landing',precisionLandingPlugin);c.scoring.register('landing-accuracy',precisionLandingScoring);c.scenes.register('precision-landing-field',precisionLandingScene);c.registry.register(PRECISION_LANDING);c.rules.register('photo-hunt',photoHuntPlugin);c.scoring.register('photo-quality',photoHuntScoring);c.scenes.register('photo-hunt-town',photoHuntScene);c.registry.register(PHOTO_HUNT);return c;}
