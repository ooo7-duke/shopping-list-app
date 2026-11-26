// Picks the real Firebase backend, or the on-device demo when Firebase isn't configured.
import { DEMO_MODE } from '../lib/config.js';
import * as fb from './firebaseBackend.js';
import * as local from './localBackend.js';

const backend = DEMO_MODE ? local : fb;
export default backend;
