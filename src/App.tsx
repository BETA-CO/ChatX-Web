import { useState, useEffect } from 'react';
import { auth, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, updateDoc, onSnapshot } from 'firebase/firestore';
import { Login } from './components/Login';
import { Sidebar } from './components/Sidebar';
import { ChatsList } from './components/ChatsList';
import { ChatWindow } from './components/ChatWindow';
import { VaultModal } from './components/VaultModal';
import { MyQrTab } from './components/MyQrTab';
import { FriendRequestsTab } from './components/FriendRequestsTab';

function App() {
  const [user, setUser] = useState<User | null>(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem('chatx_cached_user');
      if (cached) {
        try {
          return JSON.parse(cached) as any;
        } catch {
          return null;
        }
      }
    }
    return null;
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'chats' | 'contacts' | 'qr'>('chats');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Request Chrome notification permission on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().catch((e) => console.warn('Notification permission request failed:', e));
      }
    }
  }, []);

  // Selected chat details
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChatName, setActiveChatName] = useState('');

  // Secure Private Vault states
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [vaultPasswordHash, setVaultPasswordHash] = useState('');
  const [vaultModalOpen, setVaultModalOpen] = useState(false);
  const [lockedChats, setLockedChats] = useState<string[]>([]);

  // 1. Listen for active Auth changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser && currentUser.isAnonymous) {
        setUser(null);
        localStorage.removeItem('chatx_cached_user');
      } else {
        setUser(currentUser);
        if (currentUser) {
          localStorage.setItem(
            'chatx_cached_user',
            JSON.stringify({
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
            })
          );
        } else {
          localStorage.removeItem('chatx_cached_user');
        }
      }
      setVaultUnlocked(false);
      setVaultPasswordHash('');
      setActiveChatId(null);
      setLockedChats([]);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Sync user profile lockedChats and configurations in real-time
  useEffect(() => {
    if (!user) return;

    const userRef = doc(db, 'Users', user.uid);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setLockedChats(data?.lockedChats || []);
        setVaultPasswordHash(data?.vaultPasswordHash || '');
      }
    });

    return () => unsubscribe();
  }, [user]);

  // Watch active companion linked device status for remote logout revokes
  useEffect(() => {
    if (!user) return;
    const pairedDeviceId = localStorage.getItem('pairedDeviceId');
    if (!pairedDeviceId) return;

    const deviceRef = doc(db, 'Users', user.uid, 'linked_devices', pairedDeviceId);
    const unsubscribe = onSnapshot(
      deviceRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          // Document deleted -> remote logout revoked!
          console.log('Session revoked remotely by phone settings.');
          const manualLogout = localStorage.getItem('manualLogoutInProgress');
          localStorage.removeItem('pairedDeviceId');
          localStorage.removeItem('manualLogoutInProgress');
          auth.signOut().then(() => {
            if (!manualLogout) {
              alert('This session has been logged out from your mobile device.');
            }
          });
        }
      },
      (error) => {
        console.error('Remote session watch error:', error);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Security enforcement check: If vault is locked, instantly clear any open chat that is inside lockedChats array!
  useEffect(() => {
    if (!vaultUnlocked && activeChatId && lockedChats.includes(activeChatId)) {
      setActiveChatId(null);
    }
  }, [vaultUnlocked, activeChatId, lockedChats]);

  const handleVaultLock = () => {
    setVaultUnlocked(false);
    // If the current chat was a locked one, clear it
    if (activeChatId && lockedChats.includes(activeChatId)) {
      setActiveChatId(null);
    }
  };

  // Presence Tracking: mark active user online on load, offline on unload
  useEffect(() => {
    if (!user) return;

    const userRef = doc(db, 'Users', user.uid);
    updateDoc(userRef, { isOnline: true }).catch((e) => console.warn('Presence update error:', e));

    const handleUnload = () => {
      // Mark offline on tab exit
      updateDoc(userRef, { isOnline: false }).catch(() => {});
    };

    window.addEventListener('beforeunload', handleUnload);

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      updateDoc(userRef, { isOnline: false }).catch(() => {});
    };
  }, [user]);

  // Listen for Escape key to close the active chat immediately
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveChatId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // 2. Listen to active contact details in real-time when activeChatId changes
  useEffect(() => {
    if (!activeChatId || !user) {
      setActiveChatName('');
      return;
    }

    if (activeChatId === user.uid) {
      setActiveChatName('Self Conversation');
      return;
    }

    const contactDocRef = doc(db, 'Users', activeChatId);
    const unsubscribe = onSnapshot(contactDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setActiveChatName(data.displayName || data.name || data.email || 'Unknown Contact');
      } else {
        setActiveChatName('Unknown Contact');
      }
    }, (err) => {
      console.error('Error syncing active contact details:', err);
    });

    return () => unsubscribe();
  }, [activeChatId, user]);

  // 3. Theme Application toggle
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const handleVaultSuccess = (_password: string) => {
    setVaultUnlocked(true);
    setVaultModalOpen(false);
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner}>C</div>
        <p style={styles.loadingText}>Connecting to ChatX Secure Network...</p>
      </div>
    );
  }

  // Not authenticated? Show the Login dashboard
  if (!user) {
    return <Login onLoginSuccess={() => {}} theme={theme} />;
  }

  return (
    <div style={styles.appContainer}>
      {/* 1. Sidebar vertical Navigation */}
      {(!isMobile || activeChatId === null) && (
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          theme={theme}
          toggleTheme={toggleTheme}
        />
      )}

      {/* 2. Middle Panel View branch */}
      {(!isMobile || activeChatId === null) && (
        <>
          {activeTab === 'chats' && (
            <ChatsList
              userId={user.uid}
              activeChatId={activeChatId}
              setActiveChatId={setActiveChatId}
              vaultUnlocked={vaultUnlocked}
              setVaultModalOpen={setVaultModalOpen}
              vaultPasswordHash={vaultPasswordHash}
              onVaultLock={handleVaultLock}
              onVaultUnlock={() => setVaultUnlocked(true)}
            />
          )}

          {activeTab === 'contacts' && (
            <FriendRequestsTab userId={user.uid} />
          )}

          {activeTab === 'qr' && (
            <MyQrTab userId={user.uid} />
          )}
        </>
      )}

      {/* 3. Main Chat Canvas Workspace */}
      {(!isMobile || activeChatId !== null) && (
        <ChatWindow
          currentUserId={user.uid}
          currentUserEmail={user.email || ''}
          activeChatId={activeChatId}
          activeChatName={activeChatName}
          onCloseChat={() => setActiveChatId(null)}
          lockedChats={lockedChats}
          theme={theme}
        />
      )}

      {/* 4. Overlay Private Vault Decryption Portal */}
      {vaultModalOpen && (
        <VaultModal
          userId={user.uid}
          onSuccess={handleVaultSuccess}
          onClose={() => setVaultModalOpen(false)}
        />
      )}
    </div>
  );
}

const styles = {
  loadingContainer: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'hsl(var(--bg-primary))',
    gap: '24px',
  },
  spinner: {
    width: '64px',
    height: '64px',
    borderRadius: '16px',
    backgroundColor: 'hsl(var(--bg-secondary))',
    border: '1.5px solid hsl(var(--border-light))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'hsl(var(--text-primary))',
    fontSize: '32px',
    fontWeight: 800,
    animation: 'spinPulse 1.5s infinite ease-in-out',
  },
  loadingText: {
    fontSize: '14.5px',
    color: 'hsl(var(--text-secondary))',
    fontWeight: 500,
    letterSpacing: '0.2px',
  },
  appContainer: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    backgroundColor: 'hsl(var(--bg-primary))',
    overflow: 'hidden',
  },
  placeholderColumn: {
    width: '320px',
    height: '100%',
    padding: '28px 24px',
    borderRight: '1px solid hsl(var(--border))',
    backgroundColor: 'hsl(var(--bg-primary))',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
    flexShrink: 0,
  },
  placeholderTitle: {
    fontSize: '22px',
    fontWeight: 800,
    letterSpacing: '-0.5px',
  },
  placeholderText: {
    fontSize: '13px',
    color: 'hsl(var(--text-secondary))',
    lineHeight: '1.55',
  },
};

// Insert keyframes into document
if (typeof document !== 'undefined') {
  const styleEl = document.createElement('style');
  styleEl.innerHTML = `
    @keyframes spinPulse {
      0% { transform: scale(0.95) rotate(0deg); }
      50% { transform: scale(1.05) rotate(180deg); }
      100% { transform: scale(0.95) rotate(360deg); }
    }
    @keyframes scanAnimation {
      0% { top: 0%; }
      50% { top: 100%; }
      100% { top: 0%; }
    }
  `;
  document.head.appendChild(styleEl);
}

export default App;
