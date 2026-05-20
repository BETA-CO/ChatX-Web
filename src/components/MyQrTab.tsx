import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { doc, getDoc, writeBatch, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';
import { MdCopyAll, MdCheckCircleOutline, MdSend } from 'react-icons/md';

interface MyQrTabProps {
  userId: string;
}

export const MyQrTab: React.FC<MyQrTabProps> = ({ userId }) => {
  const [connectionCode, setConnectionCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMessage, setInviteMessage] = useState('');
  const [inviteError, setInviteError] = useState('');

  // 1. Fetch Connection Code from user document in Firestore
  useEffect(() => {
    const fetchCode = async () => {
      if (!userId) return;
      try {
        const userDocRef = doc(db, 'Users', userId);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          setConnectionCode(userSnap.data()?.connectionCode || 'UNKNOWN');
        }
      } catch (e) {
        console.error('Error fetching connection code:', e);
      }
    };

    fetchCode();
  }, [userId]);

  const handleCopy = () => {
    if (!connectionCode) return;
    navigator.clipboard.writeText(connectionCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 2. Submit Invitation Code (Replicating sendFriendRequest from Flutter chat_service.dart)
  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = inviteCode.trim().toUpperCase();
    if (!cleanCode) {
      setInviteError('Please enter a connection code.');
      return;
    }

    setInviteLoading(true);
    setInviteError('');
    setInviteMessage('');

    try {
      // Find user with that connection code
      const usersRef = collection(db, 'Users');
      const q = query(usersRef, where('connectionCode', '==', cleanCode));
      const querySnap = await getDocs(q);

      if (querySnap.empty) {
        setInviteError('Invalid code or user not found.');
        setInviteLoading(false);
        return;
      }

      const targetDoc = querySnap.docs[0];
      const targetUID = targetDoc.id;

      if (targetUID === userId) {
        setInviteError("You can't add yourself!");
        setInviteLoading(false);
        return;
      }

      // Check if already friends
      const contactDocRef = doc(db, 'Users', userId, 'contacts', targetUID);
      const contactSnap = await getDoc(contactDocRef);
      if (contactSnap.exists()) {
        setInviteError('You are already friends with this user!');
        setInviteLoading(false);
        return;
      }

      // Check if request already exists in target's subcollection
      const existingReqRef = doc(db, 'Users', targetUID, 'friend_requests', userId);
      const existingReqSnap = await getDoc(existingReqRef);
      if (existingReqSnap.exists()) {
        setInviteError('A connection invitation has already been sent to this user.');
        setInviteLoading(false);
        return;
      }

      // Perform Batch Transaction
      const batch = writeBatch(db);
      
      // Write target received request
      batch.set(doc(db, 'Users', targetUID, 'friend_requests', userId), {
        timestamp: serverTimestamp(),
        status: 'pending',
      });

      // Write self sent request tracking
      batch.set(doc(db, 'Users', userId, 'sent_requests', targetUID), {
        timestamp: serverTimestamp(),
        status: 'pending',
      });

      await batch.commit();

      setInviteMessage('Connection invitation successfully sent!');
      setInviteCode('');
    } catch (err: any) {
      console.error('Error sending friend invitation:', err);
      setInviteError('Failed to submit connection invitation.');
    } finally {
      setInviteLoading(false);
    }
  };

  // Generate QR Code containing the user's UID just like ShowQrPage.dart!
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&color=000000&bgcolor=ffffff&data=${encodeURIComponent(userId)}`;

  return (
    <div style={styles.container} className="responsive-sidebar-panel animate-fade-in">
      <h2 style={styles.title}>My QR Code</h2>
      <p style={styles.subtitle}>Have someone scan this to connect instantly</p>

      {/* QR Code Container */}
      <div style={styles.qrCard}>
        <img src={qrApiUrl} style={styles.qrImage} alt="Connection QR" />
      </div>

      {/* Connection Code Copy Card */}
      <div style={styles.codeSection}>
        <span style={styles.label}>Connection Code</span>
        <div style={styles.codeRow} onClick={handleCopy}>
          <span style={styles.codeText}>{connectionCode || 'Loading...'}</span>
          {copied ? <MdCheckCircleOutline size={20} color="#10b981" /> : <MdCopyAll size={20} />}
        </div>
      </div>

      {/* Invite Friends Field (Manual Connection Code entry!) */}
      <div style={styles.inviteSection}>
        <span style={styles.inviteLabel}>Invite Friend via Code</span>
        <form onSubmit={handleSendInvite} style={styles.inviteForm}>
          <input
            type="text"
            placeholder="Enter Connection Code"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            disabled={inviteLoading}
            className="monochrome-input"
            style={styles.inviteInput}
          />
          <button
            type="submit"
            disabled={inviteLoading}
            className="monochrome-btn"
            style={styles.inviteBtn}
          >
            <MdSend size={18} />
          </button>
        </form>

        {inviteError && <p style={styles.errorText}>{inviteError}</p>}
        {inviteMessage && <p style={styles.successText}>{inviteMessage}</p>}
      </div>
    </div>
  );
};

const styles = {
  container: {
    width: '320px',
    height: '100%',
    padding: '28px 24px',
    borderRight: '1px solid hsl(var(--border))',
    backgroundColor: 'hsl(var(--bg-primary))',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    flexShrink: 0,
    overflowY: 'auto' as const,
  },
  title: {
    fontSize: '22px',
    fontWeight: 800,
    letterSpacing: '-0.5px',
    marginBottom: '4px',
    textAlign: 'center' as const,
  },
  subtitle: {
    fontSize: '13px',
    color: 'hsl(var(--text-secondary))',
    textAlign: 'center' as const,
    lineHeight: '1.45',
    marginBottom: '28px',
  },
  qrCard: {
    padding: '20px',
    backgroundColor: '#ffffff',
    border: '1.5px solid hsl(var(--border-light))',
    borderRadius: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: 'var(--shadow-md)',
    marginBottom: '28px',
  },
  qrImage: {
    width: '180px',
    height: '180px',
    objectFit: 'contain' as const,
  },
  codeSection: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
    marginBottom: '28px',
  },
  label: {
    fontSize: '12px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    color: 'hsl(var(--text-muted))',
    letterSpacing: '0.5px',
  },
  codeRow: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'hsl(var(--bg-secondary))',
    border: '1.5px solid rgba(128,128,128,0.2)',
    borderRadius: '16px',
    padding: '12px 18px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  codeText: {
    fontSize: '18px',
    fontWeight: 800,
    letterSpacing: '2px',
    color: 'hsl(var(--text-primary))',
  },
  inviteSection: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  inviteLabel: {
    fontSize: '12px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    color: 'hsl(var(--text-muted))',
    letterSpacing: '0.5px',
  },
  inviteForm: {
    width: '100%',
    display: 'flex',
    gap: '8px',
  },
  inviteInput: {
    flex: 1,
    padding: '10px 16px',
    fontSize: '14px',
    textAlign: 'center' as const,
    textTransform: 'uppercase' as const,
  },
  inviteBtn: {
    padding: '12px 16px',
    borderRadius: '16px',
    border: 'none',
  },
  errorText: {
    color: '#ef4444',
    fontSize: '12.5px',
    textAlign: 'center' as const,
    marginTop: '6px',
    lineHeight: '1.4',
  },
  successText: {
    color: '#10b981',
    fontSize: '12.5px',
    textAlign: 'center' as const,
    marginTop: '6px',
    lineHeight: '1.4',
  },
};
