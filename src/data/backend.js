// Picks the real Firebase backend, or the on-device demo when Firebase isn't configured.
import { DEMO_MODE } from '../lib/config.js';
import * as fb from './firebaseBackend.js';
import * as local from './localBackend.js';

import { registerPriceProvider, samplePriceProvider, serverPriceProvider } from '../lib/prices.js';

const backend = DEMO_MODE ? local : fb;
registerPriceProvider(DEMO_MODE ? samplePriceProvider : serverPriceProvider(fb.idToken));
export default backend;
