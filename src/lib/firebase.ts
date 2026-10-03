import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';

const firebaseConfig = {
  projectId: "gen-lang-client-0038131539",
  appId: "1:684182667950:web:7098c332863e07d878233f",
  apiKey: "AIzaSyBUdWYdoea5glHBgbH7kC37edSl3_85wYo",
  authDomain: "gen-lang-client-0038131539.firebaseapp.com",
  storageBucket: "gen-lang-client-0038131539.firebasestorage.app",
  messagingSenderId: "684182667950",
};

const app = initializeApp(firebaseConfig);

// App Check is enabled as soon as the production site key is configured.
// Keeping this opt-in avoids blocking existing environments during migration.
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY;
if (appCheckSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const db = getFirestore(app, "ai-studio-docbrief-694b79f8-8d07-4aec-ab6b-3d02339ff834");
export const auth = getAuth(app);
