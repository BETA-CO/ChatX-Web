import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, query, onSnapshot, doc } from 'firebase/firestore';
import { MdSearch, MdPushPin, MdLockOutline, MdPerson, MdArrowBack, MdClose } from 'react-icons/md';

interface Contact {
  id: string;
  name: string;
  email: string;
  unreadCount?: number;
  isPinned?: boolean;
  isMuted?: boolean;
  lastMessage?: string;
  lastMessageTime?: any;
}

interface ChatsListProps {
  userId: string;
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  vaultUnlocked: boolean;
  setVaultModalOpen: (open: boolean) => void;
  vaultPasswordHash: string;
  onVaultLock: () => void;
  onVaultUnlock: () => void;
}

// Hashing helper to check search input bypass
async function hashString(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const ChatsList: React.FC<ChatsListProps> = ({
  userId,
  activeChatId,
  setActiveChatId,
  vaultUnlocked,
  setVaultModalOpen,
  vaultPasswordHash,
  onVaultLock,
  onVaultUnlock,
}) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [lockedUids, setLockedUids] = useState<string[]>([]);
  const [isBypassMatch, setIsBypassMatch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [usersMap, setUsersMap] = useState<Record<string, { name?: string; displayName?: string; email?: string }>>({});

  const prevUnreadCounts = useRef<Record<string, number>>({});
  const isInitialLoad = useRef(true);

  // Whether we're viewing the Private Vault panel
  const [showVaultView, setShowVaultView] = useState(false);

  // Sync all user profiles from global Users collection in real-time to resolve names correctly
  useEffect(() => {
    const usersRef = collection(db, 'Users');
    const unsubscribe = onSnapshot(usersRef, (snapshot) => {
      const map: Record<string, { name?: string; displayName?: string; email?: string }> = {};
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        map[docSnap.id] = {
          name: data.name || '',
          displayName: data.displayName || '',
          email: data.email || '',
        };
      });
      setUsersMap(map);
    }, (err) => {
      console.error('Error syncing global user profiles:', err);
    });
    return () => unsubscribe();
  }, []);

  // 1. Sync locked contact uids from Firestore
  useEffect(() => {
    if (!userId) return;
    const userDocRef = doc(db, 'Users', userId);
    const unsubscribe = onSnapshot(userDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const lockedList = snapshot.data()?.lockedChats || [];
        setLockedUids(lockedList);
      }
    }, (err) => {
      console.error('Error fetching locked chats list:', err);
    });

    return () => unsubscribe();
  }, [userId]);

  // 2. Sync all contacts/chats from Firestore under /Users/{userId}/contacts
  useEffect(() => {
    if (!userId) return;
    const contactsRef = collection(db, 'Users', userId, 'contacts');
    const q = query(contactsRef);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Contact[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const contactId = docSnap.id;
        const unreadCount = data.unreadCount || 0;
        const prevCount = prevUnreadCounts.current[contactId] || 0;

        list.push({
          id: contactId,
          name: data.displayName || data.name || data.email || 'Unknown Contact',
          email: data.email || '',
          unreadCount: unreadCount,
          isPinned: data.isPinned || false,
          isMuted: data.isMuted || false,
          lastMessage: data.lastMessage || '',
          lastMessageTime: data.lastMessageTime || null,
        });

        // Trigger Notification if unreadCount increased, and it's not the initial load, and it's not the active chat!
        if (!isInitialLoad.current && unreadCount > prevCount) {
          if (contactId !== activeChatId) {
            const isLocked = lockedUids.includes(contactId);
            if (isLocked) {
              if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                new Notification('New Secure Message', {
                  body: 'Passcode required to view contents',
                  icon: '/splash.png'
                });
              }
            } else {
              const resolvedName = usersMap[contactId]?.displayName || usersMap[contactId]?.name || data.displayName || data.name || data.email || 'Unknown Contact';
              const lastMsg = data.lastMessage || 'Sent you a message';
              if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                new Notification(resolvedName, {
                  body: lastMsg,
                  icon: '/splash.png'
                });
              }
            }
          }
        }

        prevUnreadCounts.current[contactId] = unreadCount;
      });

      isInitialLoad.current = false;
      
      // Sort: Pinned first, then by last message time
      list.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return 0;
      });

      setContacts(list);
      setLoading(false);
    }, (err) => {
      console.error('Error loading contacts:', err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [userId, activeChatId, lockedUids, usersMap]);

  // 3. Check if search query matches bypass keywords/password
  useEffect(() => {
    const checkBypass = async () => {
      const trimmed = searchQuery.trim();
      if (!trimmed) {
        setIsBypassMatch(false);
        return;
      }

      const lower = trimmed.toLowerCase();
      if (lower === 'lock' || lower === 'chatxlock') {
        setIsBypassMatch(true);
        return;
      }

      // Check if hash of entered search matches the vault hash
      if (vaultPasswordHash) {
        const enteredHash = await hashString(trimmed);
        if (enteredHash === vaultPasswordHash) {
          setIsBypassMatch(true);
          return;
        }
      }
      setIsBypassMatch(false);
    };

    checkBypass();
  }, [searchQuery, vaultPasswordHash]);

  // Helper to resolve contact name dynamically
  const getContactName = (contact: Contact) => {
    const profile = usersMap[contact.id];
    if (profile) {
      return profile.displayName || profile.name || profile.email || contact.email || 'Unknown Contact';
    }
    return contact.name || 'Unknown Contact';
  };

  // When vault is locked externally, exit vault view
  useEffect(() => {
    if (!vaultUnlocked) {
      setShowVaultView(false);
    }
  }, [vaultUnlocked]);

  // Handle clicking the vault folder entry
  const handleVaultFolderClick = async () => {
    const trimmed = searchQuery.trim();
    if (vaultUnlocked) {
      // Already unlocked, go straight to vault view
      setShowVaultView(true);
      setSearchQuery('');
    } else if (vaultPasswordHash) {
      const enteredHash = await hashString(trimmed);
      if (enteredHash === vaultPasswordHash) {
        // Direct password match! Unlock directly, no popup!
        onVaultUnlock();
        setShowVaultView(true);
        setSearchQuery('');
      } else {
        // Need password first (opened via 'lock' keyword)
        setSearchQuery('');
        setVaultModalOpen(true);
      }
    } else {
      // Need password first
      setSearchQuery('');
      setVaultModalOpen(true);
    }
  };

  // When vault modal succeeds (called from parent after onSuccess)
  useEffect(() => {
    if (vaultUnlocked && !showVaultView) {
      // Vault was just unlocked, show the vault view
      setShowVaultView(true);
    }
  }, [vaultUnlocked]);

  const handleExitVault = () => {
    setShowVaultView(false);
    setActiveChatId(null);
    onVaultLock();
  };

  // ──────────────────────────────────────────────────────────────────────
  // VAULT VIEW: Shows only locked chats inside a separate panel
  // ──────────────────────────────────────────────────────────────────────
  if (showVaultView && vaultUnlocked) {
    const lockedContacts = contacts.filter((c) => lockedUids.includes(c.id));

    return (
      <div style={styles.container} className="responsive-sidebar-panel animate-fade-in">
        <div style={styles.vaultHeader}>
          <button onClick={handleExitVault} style={styles.backBtn} title="Lock & Go Back">
            <MdArrowBack size={20} />
          </button>
          <div style={styles.vaultTitleRow}>
            <MdLockOutline size={18} style={{ opacity: 0.6 }} />
            <h2 style={styles.vaultTitle}>Private Vault</h2>
          </div>
        </div>

        <div style={styles.listContainer}>
          {lockedContacts.length === 0 ? (
            <div style={styles.emptyVault}>
              <MdLockOutline size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
              <p style={styles.emptyVaultTitle}>Your Private Vault is empty</p>
              <p style={styles.emptyVaultSub}>
                Lock chats from the mobile app to see them here.
              </p>
            </div>
          ) : (
            lockedContacts.map((contact) => {
              const isActive = activeChatId === contact.id;
              return (
                <div
                  key={contact.id}
                  onClick={() => setActiveChatId(contact.id)}
                  className="contact-card-animate"
                  style={{
                    ...styles.contactCard,
                    backgroundColor: isActive ? 'hsl(var(--bg-secondary))' : 'hsl(var(--bg-primary))',
                    borderColor: isActive ? 'hsl(var(--text-primary))' : 'hsl(var(--border))',
                  }}
                >
                  <div style={styles.avatarCircle}>
                    <MdPerson size={24} color="hsl(var(--text-primary))" />
                  </div>
                  <div style={styles.infoCol}>
                    <div style={styles.cardHeader}>
                      <span style={styles.contactName}>{getContactName(contact)}</span>
                    </div>
                    <div style={styles.cardFooter}>
                      <span style={styles.lastMsg}>
                        {contact.lastMessage || 'Tap to chat'}
                      </span>
                      {Number(contact.unreadCount) > 0 && (
                        <span style={styles.unreadBadge}>{contact.unreadCount}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────
  // NORMAL VIEW: Main chat list (locked chats always hidden)
  // ──────────────────────────────────────────────────────────────────────
  const filteredContacts = contacts.filter((contact) => {
    // Always hide locked chats from the main list
    if (lockedUids.includes(contact.id)) {
      return false;
    }

    // Apply search filter
    if (searchQuery.trim()) {
      // Don't show regular contacts when bypass is matched
      if (isBypassMatch) return false;

      const search = searchQuery.toLowerCase();
      const resolvedName = getContactName(contact).toLowerCase();
      return (
        resolvedName.includes(search) ||
        contact.email.toLowerCase().includes(search)
      );
    }

    return true;
  });

  return (
    <div style={styles.container} className="responsive-sidebar-panel animate-fade-in">
      {/* Search Header */}
      <div style={styles.searchHeader}>
        <h2 style={styles.title}>ChatX</h2>
        <div style={styles.searchWrapper}>
          <MdSearch size={18} style={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={styles.searchInput}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={styles.clearSearchBtn}
              title="Clear search"
            >
              <MdClose size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Contacts List viewport */}
      <div style={styles.listContainer}>
        {loading ? (
          <p style={styles.loadingText}>Syncing chats...</p>
        ) : (
          <>
            {/* Private Vault Folder — only shown when bypass keyword matches */}
            {isBypassMatch && lockedUids.length > 0 && (
              <div
                onClick={handleVaultFolderClick}
                className="contact-card-animate"
                style={{
                  ...styles.contactCard,
                  borderColor: 'hsl(var(--border-light))',
                  backgroundColor: 'hsl(var(--bg-secondary))',
                }}
              >
                <div style={{ ...styles.avatarCircle, backgroundColor: 'rgba(128,128,128,0.15)' }}>
                  <MdLockOutline size={20} color="hsl(var(--text-primary))" />
                </div>
                <div style={styles.infoCol}>
                  <div style={styles.cardHeader}>
                    <span style={{ ...styles.contactName, fontWeight: 700 }}>Locked Chats</span>
                  </div>
                  <span style={styles.lastMsg}>
                    Tap to view private conversations
                  </span>
                </div>
              </div>
            )}

            {/* When bypass is matched, only show the vault folder, nothing else */}
            {isBypassMatch ? (
              lockedUids.length === 0 && (
                <p style={styles.noContactsText}>No locked chats configured.</p>
              )
            ) : (
              <>
                {filteredContacts.length === 0 ? (
                  <p style={styles.noContactsText}>
                    {searchQuery ? 'No matching chats found.' : 'No contacts active.'}
                  </p>
                ) : (
                  filteredContacts.map((contact) => {
                    const isActive = activeChatId === contact.id;

                    return (
                      <div
                        key={contact.id}
                        onClick={() => setActiveChatId(contact.id)}
                        className="contact-card-animate"
                        style={{
                          ...styles.contactCard,
                          backgroundColor: isActive ? 'hsl(var(--bg-secondary))' : 'hsl(var(--bg-primary))',
                          borderColor: isActive ? 'hsl(var(--text-primary))' : 'hsl(var(--border))',
                        }}
                      >
                        <div style={styles.avatarCircle}>
                          <MdPerson size={24} color="hsl(var(--text-primary))" />
                        </div>

                        <div style={styles.infoCol}>
                          <div style={styles.cardHeader}>
                            <span style={styles.contactName}>
                              {getContactName(contact)}
                            </span>
                            
                            <div style={styles.statusIcons}>
                              {contact.isPinned && <MdPushPin size={14} style={{ color: 'hsl(var(--text-primary))' }} />}
                            </div>
                          </div>

                          <div style={styles.cardFooter}>
                            <span style={styles.lastMsg}>
                              {contact.lastMessage || 'Tap to chat'}
                            </span>
                            
                            {Number(contact.unreadCount) > 0 && (
                              <span style={styles.unreadBadge}>{contact.unreadCount}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    width: '320px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    borderRight: '1px solid hsl(var(--border))',
    backgroundColor: 'hsl(var(--bg-primary))',
    flexShrink: 0,
  },
  searchHeader: {
    padding: '24px 16px 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
    borderBottom: '1px solid hsl(var(--border))',
  },
  title: {
    fontSize: '24px',
    fontWeight: 800,
    letterSpacing: '-0.5px',
  },
  searchWrapper: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
  },
  searchIcon: {
    position: 'absolute' as const,
    left: '16px',
    color: 'hsl(var(--text-muted))',
  },
  searchInput: {
    width: '100%',
    backgroundColor: 'hsl(var(--bg-secondary))',
    border: '1.5px solid rgba(128, 128, 128, 0.2)',
    borderRadius: '30px', /* circular */
    padding: '12px 36px 12px 42px',
    fontSize: '14.5px',
    color: 'hsl(var(--text-primary))',
    outline: 'none',
  },
  clearSearchBtn: {
    position: 'absolute' as const,
    right: '12px',
    background: 'transparent',
    border: 'none',
    color: 'hsl(var(--text-muted))',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px',
  },

  // Vault header
  vaultHeader: {
    padding: '20px 16px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    borderBottom: '1px solid hsl(var(--border))',
  },
  backBtn: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    backgroundColor: 'transparent',
    border: 'none',
    color: 'hsl(var(--text-primary))',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
  },
  vaultTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  vaultTitle: {
    fontSize: '20px',
    fontWeight: 700,
    letterSpacing: '-0.3px',
  },

  // Empty vault state
  emptyVault: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 24px',
    textAlign: 'center' as const,
  },
  emptyVaultTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: 'hsl(var(--text-primary))',
    marginBottom: '6px',
  },
  emptyVaultSub: {
    fontSize: '13px',
    color: 'hsl(var(--text-muted))',
    lineHeight: '1.5',
  },

  listContainer: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '12px 0',
  },
  loadingText: {
    fontSize: '14px',
    color: 'hsl(var(--text-muted))',
    textAlign: 'center' as const,
    padding: '20px',
  },
  noContactsText: {
    fontSize: '14px',
    color: 'hsl(var(--text-muted))',
    textAlign: 'center' as const,
    padding: '30px 20px',
  },
  contactCard: {
    /* Matches UserTile.dart layout: margin horizontal 16, vertical 6 */
    margin: '6px 16px',
    padding: '12px 16px', /* padding horizontal 16, vertical 12 */
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    cursor: 'pointer',
    borderRadius: '16px', /* BorderRadius.circular(16) */
    border: '1.5px solid hsl(var(--border))',
    transition: 'background-color 0.15s, border-color 0.15s',
  },
  avatarCircle: {
    width: '48px', /* radius 24 */
    height: '48px',
    borderRadius: '50%',
    backgroundColor: 'rgba(128, 128, 128, 0.12)', /* primary.withOpacity(0.1) */
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  infoCol: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    minWidth: 0,
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  contactName: {
    fontSize: '16px', /* from user_tile.dart */
    fontWeight: 600, /* FontWeight.w600 */
    color: 'hsl(var(--text-primary))',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  statusIcons: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  cardFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  lastMsg: {
    fontSize: '14px', /* from user_tile.dart */
    color: 'hsl(var(--text-secondary))', /* onSurface.withOpacity(0.5) */
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flex: 1,
    opacity: 0.8,
  },
  unreadBadge: {
    backgroundColor: 'hsl(var(--text-primary))', /* colorScheme.primary */
    color: 'hsl(var(--bg-primary))', /* colorScheme.surface */
    fontSize: '12px', /* from user_tile.dart */
    fontWeight: 'bold' as const,
    borderRadius: '10px', /* BorderRadius.circular(10) */
    padding: '4px 8px', /* horizontal 8, vertical 4 */
    minWidth: '22px',
    textAlign: 'center' as const,
  },
};
