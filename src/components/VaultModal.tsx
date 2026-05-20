import React, { useState } from 'react';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { MdLockOutline, MdClose } from 'react-icons/md';

interface VaultModalProps {
  userId: string;
  onSuccess: (password: string) => void;
  onClose: () => void;
}

// SHA-256 Hex generator using browser Web Crypto API
async function hashString(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const VaultModal: React.FC<VaultModalProps> = ({
  userId,
  onSuccess,
  onClose,
}) => {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase.trim()) {
      setError('Please enter your passphrase!');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const userDocRef = doc(db, 'Users', userId);
      const userDoc = await getDoc(userDocRef);

      if (!userDoc.exists()) {
        setError('User profile not active.');
        setLoading(false);
        return;
      }

      const correctHash = userDoc.data()?.vaultPasswordHash;
      if (!correctHash) {
        setError('No private vault has been configured on your mobile device yet.');
        setLoading(false);
        return;
      }

      const enteredHash = await hashString(passphrase.trim());

      if (enteredHash === correctHash) {
        onSuccess(passphrase.trim());
      } else {
        setError('Incorrect vault passphrase phrase.');
      }
    } catch (err) {
      console.error('Vault authentication failure:', err);
      setError('Failed to authenticate. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal} className="monochrome-card animate-fade-in">
        {/* Close Button */}
        <button onClick={onClose} style={styles.closeBtn} title="Close">
          <MdClose size={20} />
        </button>

        {/* Lock Icon */}
        <div style={styles.lockCircle}>
          <MdLockOutline size={28} color="hsl(var(--text-primary))" />
        </div>

        <h3 style={styles.title}>Private Vault</h3>
        <p style={styles.subtitle}>
          Enter your secure passcode sentence to decrypt locked contacts.
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            type="password"
            placeholder="Vault Passcode"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            disabled={loading}
            className="monochrome-input"
            style={styles.input}
          />

          {error && <p style={styles.errorText}>{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="monochrome-btn"
            style={styles.submitBtn}
          >
            {loading ? 'Verifying...' : 'Unlock Vault'}
          </button>
        </form>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    width: '400px',
    maxWidth: '90%',
    padding: '36px 28px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    position: 'relative' as const,
  },
  closeBtn: {
    position: 'absolute' as const,
    top: '16px',
    right: '16px',
    background: 'transparent',
    border: 'none',
    color: 'hsl(var(--text-muted))',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockCircle: {
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    backgroundColor: 'rgba(128, 128, 128, 0.12)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '20px',
  },
  title: {
    fontSize: '20px',
    fontWeight: 700,
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '13.5px',
    color: 'hsl(var(--text-secondary))',
    textAlign: 'center' as const,
    lineHeight: '1.45',
    marginBottom: '24px',
  },
  form: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  },
  input: {
    width: '100%',
    textAlign: 'center' as const,
  },
  errorText: {
    color: '#ef4444',
    fontSize: '13px',
    textAlign: 'center' as const,
  },
  submitBtn: {
    width: '100%',
    padding: '16px 20px',
    border: 'none',
  },
};
