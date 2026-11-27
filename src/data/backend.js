// Picks the real Firebase backend, or the on-device demo when Firebase isn't configured.
import { DEMO_MODE } from '../lib/config.js';
import * as fb from './firebaseBackend.js';
import * as local from './localBackend.js';

import { registerPriceProvider, serverPriceProvider } from '../lib/prices.js';

const backend = DEMO_MODE ? local : fb;
// The demo has no price lookup, so it never shows a made-up price.
if (!DEMO_MODE) registerPriceProvider(serverPriceProvider(fb.idToken));
export default backend;
