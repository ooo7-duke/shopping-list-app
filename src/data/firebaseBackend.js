// Firestore + Google sign-in backend.
import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut as fbSignOut,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, updateDoc, deleteDoc, getDoc, onSnapshot, query, where,
  orderBy, limit, writeBatch, deleteField, arrayUnion,
} from 'firebase/firestore';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { firebaseConfig, RECAPTCHA_SITE_KEY } from '../lib/config.js';

let app;
let auth;
let db;

export function init() {
  if (app) return { app, auth, db };
  app = initializeApp(firebaseConfig);
  if (RECAPTCHA_SITE_KEY) {
    if (location.hostname === 'localhost') self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
  }
  auth = getAuth(app);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  getRedirectResult(auth).catch(() => {});
  return { app, auth, db };
}

export const getApp = () => init().app;

const userFrom = (u) => (u ? { uid: u.uid, name: u.displayName || u.email, email: (u.email || '').toLowerCase(), photo: u.photoURL || '' } : null);

export function onAuth(cb) {
  init();
  return onAuthStateChanged(auth, (u) => cb(userFrom(u)));
}

export async function signIn() {
  init();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' }); // always show the Google account picker
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
    } else if (e?.code !== 'auth/popup-closed-by-user' && e?.code !== 'auth/cancelled-popup-request') {
      throw e;
    }
  }
}

export const signOut = () => fbSignOut(auth);

const snapList = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

export function subscribeAccounts(user, cb) {
  const q = query(collection(db, 'accounts'), where('memberUids', 'array-contains', user.uid));
  return onSnapshot(q, (s) => cb(snapList(s)), () => cb([]));
}

export async function createAccount({ name, type, categories }, user) {
  const ref = await addDoc(collection(db, 'accounts'), {
    name, type, categories,
    members: { [user.uid]: { role: 'owner', name: user.name, email: user.email, photo: user.photo } },
    memberUids: [user.uid],
    settings: { lookaheadDays: 10 },
    createdAt: Date.now(),
    createdBy: user.uid,
  });
  return ref.id;
}

export const updateAccount = (id, patch) => updateDoc(doc(db, 'accounts', id), patch);

export async function removeMember(account, uid) {
  await updateDoc(doc(db, 'accounts', account.id), {
    [`members.${uid}`]: deleteField(),
    memberUids: account.memberUids.filter((u) => u !== uid),
  });
}

const LIMITS = { purchases: 5000, receipts: 300 };
const ORDER = { purchases: 'purchasedAt', receipts: 'date' };

export function subscribe(accountId, coll, cb, onError) {
  let q = collection(db, 'accounts', accountId, coll);
  if (ORDER[coll]) q = query(q, orderBy(ORDER[coll], 'desc'), limit(LIMITS[coll]));
  return onSnapshot(q, (s) => cb(snapList(s)), (e) => {
    cb([]);
    onError?.(e);
  });
}

export async function add(accountId, coll, data) {
  const ref = await addDoc(collection(db, 'accounts', accountId, coll), data);
  return ref.id;
}

export const update = (accountId, coll, id, patch) => updateDoc(doc(db, 'accounts', accountId, coll, id), patch);
export const remove = (accountId, coll, id) => deleteDoc(doc(db, 'accounts', accountId, coll, id));
export const newId = (accountId, coll) => doc(collection(db, 'accounts', accountId, coll)).id;

// ops: [{ type: 'set'|'update'|'remove', coll, id, data }]
export async function commit(accountId, ops) {
  for (let i = 0; i < ops.length; i += 450) {
    const b = writeBatch(db);
    for (const op of ops.slice(i, i + 450)) {
      const ref = doc(db, 'accounts', accountId, op.coll, op.id || newId(accountId, op.coll));
      if (op.type === 'remove') b.delete(ref);
      else if (op.type === 'update') b.update(ref, op.data);
      else b.set(ref, op.data);
    }
    await b.commit();
  }
}

export async function getDocData(accountId, coll, id) {
  const s = await getDoc(doc(db, 'accounts', accountId, coll, id));
  return s.exists() ? s.data() : null;
}

// Invites live in a top-level collection keyed by an auto id, holding the invitee's email.
export async function createInvite(account, email, role, user) {
  await addDoc(collection(db, 'invites'), {
    email: email.toLowerCase().trim(), role, accountId: account.id, accountName: account.name,
    invitedBy: user.name, invitedByUid: user.uid, createdAt: Date.now(),
  });
}

export function subscribeMyInvites(user, cb) {
  if (!user.email) return () => {};
  const q = query(collection(db, 'invites'), where('email', '==', user.email));
  return onSnapshot(q, (s) => cb(snapList(s)), () => cb([]));
}

export function subscribeAccountInvites(accountId, cb) {
  // Filtering on invitedByUid lets the security rules approve this query without extra lookups.
  const q = query(collection(db, 'invites'), where('accountId', '==', accountId), where('invitedByUid', '==', auth.currentUser?.uid || ''));
  return onSnapshot(q, (s) => cb(snapList(s)), () => cb([]));
}

export async function acceptInvite(invite, user) {
  // Security rules check that this invite exists, matches the signed-in email,
  // and that the role written matches the invited role.
  // The invitee can't read the account yet, so arrayUnion adds them without knowing the list.
  const ref = doc(db, 'accounts', invite.accountId);
  await updateDoc(ref, {
    [`members.${user.uid}`]: { role: invite.role, name: user.name, email: user.email, photo: user.photo },
    memberUids: arrayUnion(user.uid),
    lastInvite: invite.id,
  });
  await deleteDoc(doc(db, 'invites', invite.id));
}

export const cancelInvite = (inviteId) => deleteDoc(doc(db, 'invites', inviteId));
