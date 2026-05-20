import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyAMz4uQe1xIjobrLIFm8cJ-wsMsakQcHno',
  appId: '1:835854810479:web:23815d1cc977bb507d3c9a',
  messagingSenderId: '835854810479',
  projectId: 'chatx-e24a8',
  authDomain: 'chatx-e24a8.firebaseapp.com',
  storageBucket: 'chatx-e24a8.firebasestorage.app',
  measurementId: 'G-JF1FHPM52H',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
