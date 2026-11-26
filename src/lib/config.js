const env = import.meta.env || {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const RECAPTCHA_SITE_KEY = env.VITE_RECAPTCHA_SITE_KEY || '';
export const GEMINI_MODEL = env.VITE_GEMINI_MODEL || 'gemini-2.5-flash';
export const APP_NAME = env.VITE_APP_NAME || 'Shopping List';

// With no Firebase keys (or ?demo in the URL) the app runs on this device only,
// with sample data. That lets the preview branch be reviewed before Firebase exists.
export const DEMO_MODE =
  !firebaseConfig.apiKey ||
  (typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo'));

// Everyone with access is trusted: there is no approval step. Owners also manage people.
// 'requester' is kept only so members invited under the old role keep full access.
export const ROLES = {
  owner: { label: 'Owner', can: ['edit', 'spend', 'members'] },
  editor: { label: 'Editor', can: ['edit', 'spend'] },
  requester: { label: 'Editor', can: ['edit', 'spend'], legacy: true },
};

export const can = (role, action) => !!ROLES[role]?.can.includes(action);
