import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { MdOutlineInbox, MdOutlineSend, MdDone, MdClear } from 'react-icons/md';

interface FriendRequestsTabProps {
  userId: string;
}

interface RequestUser {
  uid: string;
  name: string;
  email: string;
}

export const FriendRequestsTab: React.FC<FriendRequestsTabProps> = ({ userId }) => {
  const [receivedRequests, setReceivedRequests] = useState<RequestUser[]>([]);
  const [sentRequests, setSentRequests] = useState<RequestUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<'pending' | 'sent'>('pending');

  // 1. Listen for received friend requests in real-time
  useEffect(() => {
    if (!userId) return;

    const receivedRef = collection(db, 'Users', userId, 'friend_requests');
    const unsubscribe = onSnapshot(receivedRef, async (snapshot) => {
      const list: RequestUser[] = [];
      
      for (const docSnap of snapshot.docs) {
        const senderUID = docSnap.id;
        // Fetch sender user details from main Users collection
        try {
          const userDoc = await getDoc(doc(db, 'Users', senderUID));
          if (userDoc.exists()) {
            const data = userDoc.data();
            list.push({
              uid: senderUID,
              name: data.displayName || data.name || data.email || 'Unknown Contact',
              email: data.email || '',
            });
          }
        } catch (e) {
          console.error('Error fetching received request sender details:', e);
        }
      }
      setReceivedRequests(list);
      setLoading(false);
    }, (err) => {
      console.error('Error loading received requests:', err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [userId]);

  // 2. Listen for sent friend requests in real-time
  useEffect(() => {
    if (!userId) return;

    const sentRef = collection(db, 'Users', userId, 'sent_requests');
    const unsubscribe = onSnapshot(sentRef, async (snapshot) => {
      const list: RequestUser[] = [];

      for (const docSnap of snapshot.docs) {
        const targetUID = docSnap.id;

        // Check self-heal: if they are already in my contacts, the request was accepted. Clean up!
        const contactDoc = await getDoc(doc(db, 'Users', userId, 'contacts', targetUID));
        if (contactDoc.exists()) {
          // Stale entry cleanup
          writeBatch(db).delete(docSnap.ref).commit().catch(() => {});
          continue;
        }

        try {
          const userDoc = await getDoc(doc(db, 'Users', targetUID));
          if (userDoc.exists()) {
            const data = userDoc.data();
            list.push({
              uid: targetUID,
              name: data.displayName || data.name || data.email || 'Unknown Contact',
              email: data.email || '',
            });
          }
        } catch (e) {
          console.error('Error fetching sent request recipient details:', e);
        }
      }
      setSentRequests(list);
    }, (err) => {
      console.error('Error loading sent requests:', err);
    });

    return () => unsubscribe();
  }, [userId]);

  // 3. Replicate acceptFriendRequest logic from Flutter
  const handleAccept = async (senderUID: string) => {
    if (!userId || !senderUID) return;

    try {
      const batch = writeBatch(db);

      // A. Add to my contacts subcollection
      batch.set(doc(db, 'Users', userId, 'contacts', senderUID), {
        addedAt: serverTimestamp(),
      });

      // B. Add me to their contacts subcollection
      batch.set(doc(db, 'Users', senderUID, 'contacts', userId), {
        addedAt: serverTimestamp(),
      });

      // C. Delete received request
      batch.delete(doc(db, 'Users', userId, 'friend_requests', senderUID));

      // D. Delete sent request from sender
      batch.delete(doc(db, 'Users', senderUID, 'sent_requests', userId));

      await batch.commit();
    } catch (e) {
      console.error('Failed to accept friend request:', e);
    }
  };

  // 4. Replicate declineFriendRequest logic from Flutter
  const handleDecline = async (senderUID: string) => {
    if (!userId || !senderUID) return;

    try {
      const batch = writeBatch(db);

      // A. Delete received request
      batch.delete(doc(db, 'Users', userId, 'friend_requests', senderUID));

      // B. Delete sent request from sender
      batch.delete(doc(db, 'Users', senderUID, 'sent_requests', userId));

      await batch.commit();
    } catch (e) {
      console.error('Failed to decline friend request:', e);
    }
  };

  return (
    <div style={styles.container} className="responsive-sidebar-panel animate-fade-in">
      <div style={styles.header}>
        <h2 style={styles.title}>Friend Requests</h2>
        
        {/* Sub-tab Switchers */}
        <div style={styles.tabBar}>
          <button
            onClick={() => setActiveSubTab('pending')}
            style={{
              ...styles.tabBtn,
              borderBottom: activeSubTab === 'pending' ? '2.5px solid hsl(var(--text-primary))' : 'none',
              color: activeSubTab === 'pending' ? 'hsl(var(--text-primary))' : 'hsl(var(--text-muted))',
              border: 'none',
              outline: 'none',
              background: 'transparent',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <MdOutlineInbox size={18} />
              <span>Pending Requests ({receivedRequests.length})</span>
            </div>
          </button>
          <button
            onClick={() => setActiveSubTab('sent')}
            style={{
              ...styles.tabBtn,
              borderBottom: activeSubTab === 'sent' ? '2.5px solid hsl(var(--text-primary))' : 'none',
              color: activeSubTab === 'sent' ? 'hsl(var(--text-primary))' : 'hsl(var(--text-muted))',
              border: 'none',
              outline: 'none',
              background: 'transparent',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <MdOutlineSend size={18} />
              <span>Requests Sent ({sentRequests.length})</span>
            </div>
          </button>
        </div>
      </div>

      {/* Requests viewport list */}
      <div style={styles.listArea}>
        {loading ? (
          <p style={styles.infoText}>Loading requests...</p>
        ) : (
          <>
            {activeSubTab === 'pending' && (
              receivedRequests.length === 0 ? (
                <div style={styles.emptyState}>
                  <MdOutlineInbox size={48} style={styles.emptyIcon} />
                  <p style={styles.emptyTitle}>No pending requests</p>
                  <p style={styles.emptyText}>When someone invites you, it'll appear here.</p>
                </div>
              ) : (
                receivedRequests.map((req) => (
                  <div key={req.uid} style={styles.requestCard} className="monochrome-card">
                    <div style={styles.avatar}>
                      {req.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={styles.info}>
                      <span style={styles.name}>{req.name}</span>
                      <span style={styles.email}>{req.email}</span>
                    </div>
                    <div style={styles.actions}>
                      <button
                        onClick={() => handleDecline(req.uid)}
                        style={styles.declineBtn}
                        title="Decline invitation"
                      >
                        <MdClear size={18} />
                      </button>
                      <button
                        onClick={() => handleAccept(req.uid)}
                        style={styles.acceptBtn}
                        title="Accept invitation"
                      >
                        <MdDone size={18} />
                      </button>
                    </div>
                  </div>
                ))
              )
            )}

            {activeSubTab === 'sent' && (
              sentRequests.length === 0 ? (
                <div style={styles.emptyState}>
                  <MdOutlineSend size={48} style={styles.emptyIcon} />
                  <p style={styles.emptyTitle}>No sent requests</p>
                  <p style={styles.emptyText}>Send connection invites by sharing connection codes.</p>
                </div>
              ) : (
                sentRequests.map((req) => (
                  <div key={req.uid} style={styles.requestCard} className="monochrome-card">
                    <div style={styles.avatar}>
                      {req.name.charAt(0).toUpperCase()}
                    </div>
                    <div style={styles.info}>
                      <span style={styles.name}>{req.name}</span>
                      <span style={styles.email}>{req.email}</span>
                    </div>
                    <span style={styles.sentBadge}>Pending</span>
                  </div>
                ))
              )
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
  header: {
    padding: '24px 16px 0',
    borderBottom: '1px solid hsl(var(--border))',
  },
  title: {
    fontSize: '22px',
    fontWeight: 800,
    letterSpacing: '-0.5px',
    marginBottom: '16px',
  },
  tabBar: {
    display: 'flex',
    width: '100%',
  },
  tabBtn: {
    flex: 1,
    paddingBottom: '10px',
    fontSize: '13.5px',
    fontWeight: 700,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'center' as const,
  },
  listArea: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px 0',
  },
  infoText: {
    textAlign: 'center' as const,
    fontSize: '13.5px',
    color: 'hsl(var(--text-muted))',
    padding: '20px',
  },
  requestCard: {
    margin: '6px 16px',
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    borderRadius: '16px',
    border: '1.5px solid hsl(var(--border))',
  },
  avatar: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    backgroundColor: 'rgba(128,128,128,0.12)',
    color: 'hsl(var(--text-primary))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: 700,
    fontSize: '14px',
    flexShrink: 0,
  },
  info: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    minWidth: 0,
  },
  name: {
    fontSize: '14.5px',
    fontWeight: 700,
    color: 'hsl(var(--text-primary))',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  email: {
    fontSize: '11px',
    color: 'hsl(var(--text-secondary))',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    marginTop: '2px',
  },
  actions: {
    display: 'flex',
    gap: '6px',
  },
  declineBtn: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    color: '#ef4444',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  acceptBtn: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    color: '#10b981',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  sentBadge: {
    fontSize: '11px',
    fontWeight: 700,
    color: 'hsl(var(--text-muted))',
    backgroundColor: 'hsl(var(--bg-secondary))',
    padding: '4px 10px',
    borderRadius: '10px',
    border: '1px solid hsl(var(--border-light))',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 24px',
    textAlign: 'center' as const,
  },
  emptyIcon: {
    color: 'hsl(var(--text-muted))',
    marginBottom: '12px',
    opacity: 0.5,
  },
  emptyTitle: {
    fontSize: '15px',
    fontWeight: 700,
    color: 'hsl(var(--text-primary))',
    marginBottom: '4px',
  },
  emptyText: {
    fontSize: '12.5px',
    color: 'hsl(var(--text-secondary))',
    lineHeight: '1.45',
  },
};
