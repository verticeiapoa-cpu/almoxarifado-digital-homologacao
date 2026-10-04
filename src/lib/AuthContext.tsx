import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { auth, db } from './firebase';
import { doc, getDoc, getDocFromServer, getDocsFromServer, setDoc, updateDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { UserProfile, UserInvitation, Obra } from '../types';
import { ensureDemoData } from './demoData';
import { ensureStockAlertSettings } from './stockAlerts';
import { logError, logWarning } from './logger';

export const ADMIN_EMAIL = 'verticeiapoa@gmail.com';
export const DEFAULT_COMPANY_ID = 'wselent-default';

const transientFirestoreCodes = new Set(['aborted', 'cancelled', 'deadline-exceeded', 'internal', 'resource-exhausted', 'unavailable', 'unknown']);

const errorCode = (error: unknown) => {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  return String(error.code).replace('firestore/', '');
};

const googleAuthErrorMessage = (error: unknown) => {
  const code = errorCode(error);
  const messages: Record<string, string> = {
    'auth/unauthorized-domain': `O endereço ${window.location.hostname} ainda não está autorizado no Firebase Authentication.`,
    'auth/operation-not-allowed': 'O login com Google ainda não está habilitado no Firebase Authentication.',
    'auth/popup-blocked': 'O navegador bloqueou a janela do Google. Permita pop-ups para este site ou tente novamente.',
    'auth/popup-closed-by-user': 'A janela do Google foi fechada antes de concluir o login. Tente novamente.',
    'auth/network-request-failed': 'Não foi possível conectar ao Google. Verifique sua conexão e tente novamente.',
    'auth/cancelled-popup-request': 'Outra tentativa de login está aberta. Conclua o acesso nessa janela.',
    'auth/web-storage-unsupported': 'O navegador está bloqueando o armazenamento necessário para o login. Tente pelo Chrome sem modo anônimo.',
  };
  return messages[code] || `Não foi possível concluir o login com Google (${code || 'erro desconhecido'}).`;
};


async function withFirestoreRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!transientFirestoreCodes.has(errorCode(error)) || attempt === attempts - 1) throw error;
      await new Promise(resolve => window.setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  accessError: string;
  obras: Obra[];
  userObras: Obra[];
  activeObraId: string;
  activeObra: Obra | null;
  isAdmin: boolean;
  isStorekeeper: boolean;
  setActiveObraId: (id: string) => void;
  refreshProfile: () => Promise<void>;
  refreshObras: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  accessError: '',
  obras: [],
  userObras: [],
  activeObraId: 'ALL',
  activeObra: null,
  isAdmin: false,
  isStorekeeper: false,
  setActiveObraId: () => {},
  refreshProfile: async () => {},
  refreshObras: async () => {},
  signIn: async () => {},
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [accessError, setAccessError] = useState('');
  const [obras, setObras] = useState<Obra[]>([]);
  const [activeObraId, setActiveObraIdState] = useState<string>(() => {
    return localStorage.getItem('wselent_active_obra_id') || 'ALL';
  });
  const [loading, setLoading] = useState(true);

  const loadUserData = useCallback(async (currentUser: User) => {
    let profileWasValidated = false;
    try {
      setAccessError('');
      const userDocRef = doc(db, 'users', currentUser.uid);
      const userSnap = await withFirestoreRetry(() => getDoc(userDocRef));

      let currentProfile: UserProfile;

      if (userSnap.exists()) {
        const savedProfile = userSnap.data() as UserProfile;
        currentProfile = {
          ...savedProfile,
          assignedObraIds: Array.isArray(savedProfile.assignedObraIds) ? savedProfile.assignedObraIds : [],
        };
        if (currentUser.email?.trim().toLowerCase() === ADMIN_EMAIL && currentProfile.role !== 'admin') {
          currentProfile = {
            ...currentProfile,
            email: ADMIN_EMAIL,
            companyId: DEFAULT_COMPANY_ID,
            role: 'admin',
            assignedObraIds: ['ALL'],
            updatedAt: new Date().toISOString(),
          };
          await setDoc(userDocRef, currentProfile);
        }
      } else {
        const normalizedEmail = currentUser.email?.trim().toLowerCase() || '';
        const now = new Date().toISOString();
        if (normalizedEmail === ADMIN_EMAIL) {
          currentProfile = {
            uid: currentUser.uid,
            email: normalizedEmail,
            name: currentUser.displayName || 'Administrador',
            companyId: DEFAULT_COMPANY_ID,
            companyName: 'Wselent Empreendimentos',
            role: 'admin',
            assignedObraIds: ['ALL'],
            createdAt: now,
            updatedAt: now,
          };
        } else {
          const invitationSnap = await getDoc(doc(db, 'invitations', normalizedEmail));
          if (!invitationSnap.exists()) {
            setProfile(null);
            setObras([]);
            setAccessError('Seu e-mail ainda não foi autorizado pelo administrador.');
            return;
          }

          const invitation = invitationSnap.data() as UserInvitation;
          if (invitation.status !== 'pending') {
            setProfile(null);
            setObras([]);
            setAccessError('Este convite não está mais ativo. Solicite um novo acesso ao administrador.');
            return;
          }

          currentProfile = {
            uid: currentUser.uid,
            email: normalizedEmail,
            name: invitation.name || currentUser.displayName || normalizedEmail.split('@')[0],
            companyId: invitation.companyId,
            companyName: invitation.companyName,
            role: invitation.role,
            assignedObraIds: invitation.role === 'admin' ? ['ALL'] : invitation.assignedObraIds,
            createdAt: now,
            updatedAt: now,
          };
        }

        await setDoc(userDocRef, currentProfile);
        if (normalizedEmail !== ADMIN_EMAIL) {
          try {
            await updateDoc(doc(db, 'invitations', normalizedEmail), {
              status: 'accepted',
              acceptedByUid: currentUser.uid,
              updatedAt: now,
            });
          } catch (invitationError) {
            logWarning('invitation-status-update-failed', invitationError);
          }
        }
      }

      setProfile(currentProfile);
      profileWasValidated = true;

      if (currentProfile.role === 'admin' && currentProfile.email === ADMIN_EMAIL) {
        try {
          await Promise.all([
            ensureDemoData(currentProfile.companyId),
            ensureStockAlertSettings(currentProfile.companyId, currentUser.uid),
          ]);
        } catch (demoError) {
          logWarning('demo-data-preparation-failed', demoError);
        }
      }

      // Fetch only the obras that the authenticated profile is allowed to read.
      let allObras: Obra[] = [];
      if (currentProfile.role === 'admin' || currentProfile.assignedObraIds.includes('ALL')) {
        const obrasSnap = await withFirestoreRetry(() => getDocs(query(
          collection(db, 'obras'),
          where('companyId', '==', currentProfile.companyId)
        )));
        allObras = obrasSnap.docs.map(d => ({ id: d.id, ...d.data() } as Obra));
      } else {
        const obraSnaps = await withFirestoreRetry(() => Promise.all(
          currentProfile.assignedObraIds.map(id => getDoc(doc(db, 'obras', id)))
        ));
        allObras = obraSnaps
          .filter(snap => snap.exists())
          .map(snap => ({ id: snap.id, ...snap.data() } as Obra))
          .filter(obra => obra.companyId === currentProfile.companyId);
      }
      setObras(allObras);

      // Determine initial activeObraId
      const isUserAdmin = currentProfile.role === 'admin';
      const userCanAccessAll = isUserAdmin;

      let initialObraId = localStorage.getItem('wselent_active_obra_id') || 'ALL';

      const activeObraIds = allObras.filter(o => o.isActive).map(o => o.id);
      if (userCanAccessAll) {
        if (initialObraId !== 'ALL' && !activeObraIds.includes(initialObraId)) initialObraId = 'ALL';
      } else {
        // Storekeeper must be restricted to their assigned obras
        if (!activeObraIds.includes(initialObraId)) {
          initialObraId = activeObraIds[0] || '';
        }
      }

      setActiveObraIdState(initialObraId);
      localStorage.setItem('wselent_active_obra_id', initialObraId);

    } catch (err) {
      logError('profile-or-obras-load-failed', err);
      setObras([]);
      if (profileWasValidated) {
        const code = errorCode(err);
        setAccessError(code === 'permission-denied'
          ? 'Seu login foi confirmado, mas o acesso às obras foi recusado. Tente novamente; se continuar, informe o administrador.'
          : 'Seu login foi mantido, mas os dados não carregaram. Verifique a conexão e tente novamente.');
      } else {
        setProfile(null);
        setAccessError('Não foi possível validar seu acesso. Verifique a conexão e tente novamente.');
      }
    }
  }, []);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (u) => {
      setLoading(true);
      setUser(u);
      if (u) {
        await loadUserData(u);
      } else {
        setProfile(null);
        setObras([]);
        setAccessError('');
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [loadUserData]);

  const refreshProfile = async () => {
    if (user) {
      setLoading(true);
      try { await loadUserData(user); } finally { setLoading(false); }
    }
  };

  // A saved obra only needs to refresh obra data. Reloading the entire profile
  // used to unmount the form, hide its result, and rerun demo initialization.
  const refreshObras = async () => {
    if (!user || !profile?.companyId) return;
    let refreshed: Obra[];
    if (profile.role === 'admin') {
      const snapshot = await getDocsFromServer(query(collection(db, 'obras'), where('companyId', '==', profile.companyId)));
      refreshed = snapshot.docs.map(item => ({ ...item.data(), id: item.id } as Obra));
    } else {
      const snapshots = await Promise.all(profile.assignedObraIds.map(id => getDocFromServer(doc(db, 'obras', id))));
      refreshed = snapshots.filter(item => item.exists()).map(item => ({ ...item.data(), id: item.id } as Obra))
        .filter(obra => obra.companyId === profile.companyId);
    }
    setObras(refreshed);
    setAccessError('');
    if (activeObraId !== 'ALL' && !refreshed.some(obra => obra.id === activeObraId && obra.isActive)) {
      const next = profile.role === 'admin' ? 'ALL' : refreshed.find(obra => obra.isActive)?.id || '';
      setActiveObraIdState(next);
      localStorage.setItem('wselent_active_obra_id', next);
    }
  };

  const setActiveObraId = (id: string) => {
    if (!profile) return;
    if (profile.role !== 'admin' && !profile.assignedObraIds.includes(id)) return;
    setActiveObraIdState(id);
    localStorage.setItem('wselent_active_obra_id', id);
  };

  const signIn = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    setAccessError('');
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      logError('google-auth-signin-failed', error);
      setAccessError(googleAuthErrorMessage(error));
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    localStorage.removeItem('wselent_active_obra_id');
  };

  const isAdmin = profile?.role === 'admin';
  const isStorekeeper = profile?.role === 'storekeeper';

  const userObras = obras.filter(obra => {
    if (!profile) return false;
    if (!obra.isActive) return false;
    if (isAdmin) return true;
    return profile.assignedObraIds.includes(obra.id);
  });

  const activeObra = activeObraId === 'ALL' ? null : (obras.find(o => o.id === activeObraId) || null);

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      loading,
      accessError,
      obras,
      userObras,
      activeObraId,
      activeObra,
      isAdmin,
      isStorekeeper,
      setActiveObraId,
      refreshProfile,
      refreshObras,
      signIn,
      signOut
    }}>
      {children}
    </AuthContext.Provider>
  );
};
