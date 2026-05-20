import React from 'react';
import { auth, db } from '../firebase';
import { signOut } from 'firebase/auth';
import { doc, deleteDoc } from 'firebase/firestore';
import { MdChat, MdPersonAdd, MdQrCode, MdLogout, MdWbSunny, MdBrightness2 } from 'react-icons/md';

interface SidebarProps {
  activeTab: 'chats' | 'contacts' | 'qr';
  setActiveTab: (tab: 'chats' | 'contacts' | 'qr') => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  theme,
  toggleTheme,
}) => {
  const handleLogout = async () => {
    try {
      localStorage.setItem('manualLogoutInProgress', 'true');
      const pairedDeviceId = localStorage.getItem('pairedDeviceId');
      const currentUser = auth.currentUser;
      if (pairedDeviceId && currentUser) {
        const deviceRef = doc(db, 'Users', currentUser.uid, 'linked_devices', pairedDeviceId);
        await deleteDoc(deviceRef).catch((e) => console.warn('Could not delete device ref on logout:', e));
      }
      localStorage.removeItem('pairedDeviceId');
      localStorage.removeItem('chatx_cached_user');
      localStorage.removeItem('chatx_qr_session_id');
      if (currentUser && currentUser.isAnonymous) {
        await currentUser.delete().catch((e) => console.warn('Could not delete anonymous user account:', e));
      } else {
        await signOut(auth);
      }
    } catch (err) {
      console.error('Logout failed:', err);
      localStorage.removeItem('manualLogoutInProgress');
    }
  };

  return (
    <div style={{ ...styles.sidebar, backgroundColor: theme === 'dark' ? 'hsl(0, 0%, 6%)' : 'hsl(var(--bg-secondary))' }}>
      {/* Profile Section with custom theme app logo */}
      <div style={styles.profileWrapper}>
        <div 
          style={{
            ...styles.avatar,
            borderRadius: '50%',
            overflow: 'hidden',
          }} 
          className=""
        >
          <img
            src="/logo.png"
            alt="ChatX Logo"
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
          />
        </div>
      </div>

      {/* Navigation Icons Group */}
      <div style={styles.navGroup}>
        <button
          onClick={() => setActiveTab('chats')}
          className="sidebar-btn-animate"
          style={{
            ...styles.navBtn,
            backgroundColor: activeTab === 'chats' ? (theme === 'dark' ? 'hsl(var(--bg-secondary))' : 'hsl(var(--bg-tertiary))') : 'transparent',
            border: 'none',
            color: 'hsl(var(--text-primary))',
          }}
          title="Chats"
        >
          <MdChat size={22} />
        </button>

        <button
          onClick={() => setActiveTab('contacts')}
          className="sidebar-btn-animate"
          style={{
            ...styles.navBtn,
            backgroundColor: activeTab === 'contacts' ? (theme === 'dark' ? 'hsl(var(--bg-secondary))' : 'hsl(var(--bg-tertiary))') : 'transparent',
            border: 'none',
            color: 'hsl(var(--text-primary))',
          }}
          title="Contacts"
        >
          <MdPersonAdd size={22} />
        </button>

        <button
          onClick={() => setActiveTab('qr')}
          className="sidebar-btn-animate"
          style={{
            ...styles.navBtn,
            backgroundColor: activeTab === 'qr' ? (theme === 'dark' ? 'hsl(var(--bg-secondary))' : 'hsl(var(--bg-tertiary))') : 'transparent',
            border: 'none',
            color: 'hsl(var(--text-primary))',
          }}
          title="Pair QR Device"
        >
          <MdQrCode size={22} />
        </button>
      </div>

      {/* Footer Group */}
      <div style={styles.footerGroup}>
        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="sidebar-btn-animate"
          style={styles.footerBtn}
          title={theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
        >
          {theme === 'dark' ? <MdWbSunny size={20} color="hsl(var(--text-primary))" /> : <MdBrightness2 size={20} color="hsl(var(--text-primary))" />}
        </button>

        {/* Logout Button */}
        <button
          onClick={handleLogout}
          className="sidebar-btn-animate"
          style={styles.logoutBtn}
          title="Logout"
        >
          <MdLogout size={20} />
        </button>
      </div>
    </div>
  );
};

const styles = {
  sidebar: {
    width: '64px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '20px 0',
    borderRight: '1px solid hsl(var(--border))',
    backgroundColor: 'hsl(var(--bg-primary))',
    zIndex: 10,
    flexShrink: 0,
  },
  profileWrapper: {
    marginBottom: '32px',
    position: 'relative' as const,
  },
  avatar: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    backgroundColor: 'transparent',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative' as const,
  },
  statusHalo: {
    position: 'absolute' as const,
    bottom: '-2px',
    right: '-2px',
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: 'hsl(var(--status-online))',
    border: '2px solid hsl(var(--bg-primary))',
  },
  navGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
    flex: 1,
  },
  navBtn: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  footerGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
    marginTop: 'auto',
  },
  footerBtn: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  logoutBtn: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    color: '#ef4444',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
};
