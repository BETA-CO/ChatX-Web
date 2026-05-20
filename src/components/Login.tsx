import React, { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { signInWithEmailAndPassword, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { MdOutlineQrCodeScanner, MdEmail } from 'react-icons/md';

const getBrowserOS = (): string => {
  const userAgent = navigator.userAgent;
  let os = 'Unknown OS';
  if (userAgent.indexOf('Win') !== -1) os = 'Windows';
  else if (userAgent.indexOf('Mac') !== -1) os = 'macOS';
  else if (userAgent.indexOf('X11') !== -1) os = 'UNIX';
  else if (userAgent.indexOf('Linux') !== -1) os = 'Linux';

  let browser = 'Unknown Browser';
  if (userAgent.indexOf('Chrome') !== -1) browser = 'Chrome';
  else if (userAgent.indexOf('Safari') !== -1) browser = 'Safari';
  else if (userAgent.indexOf('Firefox') !== -1) browser = 'Firefox';
  else if (userAgent.indexOf('MSIE') !== -1 || !!(document as any).documentMode) browser = 'IE';
  
  return `${browser} on ${os}`;
};

interface LoginProps {
  onLoginSuccess: () => void;
  theme: 'dark' | 'light';
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess, theme }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Separate error states for credentials login and background QR pairing
  const [credentialsError, setCredentialsError] = useState('');
  const [qrError, setQrError] = useState('');
  const [loading, setLoading] = useState(false);

  // Responsive state - screens smaller than 768px are treated as mobile
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);

  // QR session state - cached in browser local storage
  const [sessionId, setSessionId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('chatx_qr_session_id');
    }
    return null;
  });
  const [qrLoading, setQrLoading] = useState(false);

  // Handle window resizing to make the interface completely dynamic
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // QR session listener effect - only active when NOT on mobile
  useEffect(() => {
    if (isMobile) {
      if (sessionId) {
        // Clean up pending session document in background
        const sessionRef = doc(db, 'web_sessions', sessionId);
        deleteDoc(sessionRef).catch(() => {});
        setSessionId(null);
        localStorage.removeItem('chatx_qr_session_id');
      }
      return;
    }

    // Reuse existing sessionId or generate a new one
    let currentSessionId = sessionId;
    if (!currentSessionId) {
      currentSessionId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
      setSessionId(currentSessionId);
      localStorage.setItem('chatx_qr_session_id', currentSessionId);
    }

    setQrLoading(true);
    setQrError('');

    const sessionRef = doc(db, 'web_sessions', currentSessionId);
    let isSubscribed = true;
    let unsubscribeSnapshot: (() => void) | null = null;
    let anonymousAuthError: any = null;

    const startListening = () => {
      if (!isSubscribed) return;
      setQrLoading(false);

      unsubscribeSnapshot = onSnapshot(
        sessionRef,
        async (snapshot) => {
          if (!isSubscribed) return;
          if (snapshot.exists()) {
            const data = snapshot.data();
            if (data.status === 'authorized' && data.email && data.password) {
              setLoading(true);
              setQrError('');
              try {
                localStorage.setItem('pairedDeviceId', currentSessionId!);
                
                // Delete anonymous user first if it exists to avoid leaving an orphaned anonymous account
                const anonUser = auth.currentUser;
                if (anonUser && anonUser.isAnonymous) {
                  await anonUser.delete().catch((e) => console.warn('Could not delete anonymous user:', e));
                }
                
                await signInWithEmailAndPassword(auth, data.email.trim(), data.password.trim());
                
                // Clear QR session cache on successful login
                localStorage.removeItem('chatx_qr_session_id');
                
                onLoginSuccess();
                // Securely wipe and delete the session document immediately
                await deleteDoc(sessionRef);
              } catch (err: any) {
                console.error('QR Auto-login error:', err);
                localStorage.removeItem('pairedDeviceId');
                setQrError(err.message || 'QR pairing authentication failed.');
                setSessionId(null); // triggers session doc regeneration
                localStorage.removeItem('chatx_qr_session_id');
              } finally {
                setLoading(false);
              }
            }
          }
        },
        (err) => {
          console.error('Firestore snapshot listener error:', err);
          if (isSubscribed) {
            if (anonymousAuthError && anonymousAuthError.code === 'auth/operation-not-allowed') {
              setQrError('Pairing connection error: Anonymous Authentication is disabled in Firebase console.');
            } else {
              setQrError(`Pairing connection error: ${err.message}`);
            }
            setQrLoading(false);
          }
        }
      );
    };

    const initSession = async () => {
      const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
        unsubscribeAuth(); // only listen once
        
        if (!isSubscribed) return;

        if (currentUser && currentUser.isAnonymous) {
          console.log('Reusing existing anonymous account:', currentUser.uid);
          startListening();
        } else {
          try {
            if (currentUser) {
              if (currentUser.isAnonymous) {
                await currentUser.delete().catch(() => {});
              } else {
                await auth.signOut().catch(() => {});
              }
            }
            await signInAnonymously(auth);
            console.log('Anonymous sign-in successful for QR pairing.');
          } catch (anonErr: any) {
            console.warn('Anonymous sign-in not enabled or failed, continuing unauthenticated:', anonErr);
            anonymousAuthError = anonErr;
          }
          startListening();
        }
      });
    };

    initSession();

    return () => {
      isSubscribed = false;
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
      }
      // Note: We no longer delete the session doc or anonymous user on unmount/refresh!
      // This preserves the session in browser cache so refreshes don't invalidate the active QR pairing.
    };
  }, [isMobile]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setCredentialsError('Please fill in all fields!');
      return;
    }

    setLoading(true);
    setCredentialsError('');

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password.trim());
      onLoginSuccess();
    } catch (err: any) {
      if (
        err.code === 'auth/user-not-found' ||
        err.code === 'auth/wrong-password' ||
        err.code === 'auth/invalid-credential'
      ) {
        setCredentialsError('Incorrect email or password.');
      } else {
        setCredentialsError(err.message || 'Login failed. Try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const logoSrc = '/logo.png';
  const logoStyle = {
    width: '100px',
    height: '100px',
    objectFit: 'cover' as const,
    borderRadius: '50%',
    overflow: 'hidden',
  };

  const cardStyle = {
    display: 'flex',
    flexDirection: (isMobile ? 'column' : 'row') as 'column' | 'row',
    alignItems: 'stretch',
    width: isMobile ? '420px' : '860px',
    maxWidth: '95%',
    padding: isMobile ? '32px 24px' : '48px 48px',
    borderRadius: '32px',
    backgroundColor: theme === 'dark' ? 'rgba(30, 30, 30, 0.35)' : 'rgba(244, 244, 245, 0.65)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1.5px solid hsl(var(--border-light))',
    boxShadow: theme === 'dark' ? '0 24px 64px rgba(0, 0, 0, 0.6)' : '0 24px 64px rgba(0, 0, 0, 0.08)',
    transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
    gap: isMobile ? '0px' : '48px',
    position: 'relative' as const,
    overflow: 'hidden' as const,
  };

  const leftColumnStyle = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
  };

  const rightColumnStyle = {
    flex: 1,
    display: isMobile ? 'none' : 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
  };

  const dividerStyle = {
    display: isMobile ? 'none' : 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative' as const,
    width: '1px',
    backgroundColor: 'hsl(var(--border-light))',
    margin: '0 12px',
  };

  const dividerOrStyle = {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    backgroundColor: theme === 'dark' ? 'hsl(var(--bg-tertiary))' : 'hsl(var(--bg-secondary))',
    border: '1.5px solid hsl(var(--border-light))',
    borderRadius: '50%',
    width: '38px',
    height: '38px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: 800,
    color: 'hsl(var(--text-secondary))',
    textTransform: 'uppercase' as const,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
  };

  return (
    <div 
      style={{ 
        ...styles.container, 
        backgroundImage: theme === 'dark' 
          ? 'radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.02) 0%, rgba(0, 0, 0, 0) 80%)' 
          : 'radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0.01) 0%, rgba(255, 255, 255, 0) 80%)' 
      }}
    >
      <div style={cardStyle} className="animate-fade-in">
        
        {/* Left Side: Email Credentials Login */}
        <div style={leftColumnStyle}>
          <div style={styles.logoWrapper}>
            <img src={logoSrc} style={logoStyle} alt="ChatX" />
          </div>

          <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '8px', color: 'hsl(var(--text-primary))', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MdEmail size={20} />
            Email Login
          </h2>
          <p style={styles.welcomeText}>
            Welcome back!, you've been missed!
          </p>

          <form onSubmit={handleEmailLogin} style={styles.form}>
            <div style={styles.fieldWrapper}>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                className="monochrome-input"
                style={styles.textField}
              />
            </div>

            <div style={styles.fieldWrapper}>
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                className="monochrome-input"
                style={styles.textField}
              />
            </div>

            {credentialsError && <p style={styles.errorText}>{credentialsError}</p>}

            <div style={styles.btnWrapper}>
              <button
                type="submit"
                disabled={loading}
                className="monochrome-btn"
                style={styles.submitBtn}
              >
                {loading ? 'Logging in...' : 'Login'}
              </button>
            </div>
          </form>
        </div>

        {/* Beautiful vertical separation line */}
        <div style={dividerStyle}>
          <div style={dividerOrStyle}>OR</div>
        </div>

        {/* Right Side: QR Pairing Code */}
        {!isMobile && (
          <div style={rightColumnStyle}>
            <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '8px', color: 'hsl(var(--text-primary))', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MdOutlineQrCodeScanner size={20} />
              QR Pairing
            </h2>
            <p style={{ fontSize: '13.5px', color: 'hsl(var(--text-secondary))', marginBottom: '24px', textAlign: 'center', maxWidth: '300px', lineHeight: '1.4' }}>
              Scan the QR code with your ChatX mobile app to log in instantly.
            </p>

            <div style={styles.qrContainer}>
              <div style={styles.qrWrapper}>
                {qrLoading || !sessionId ? (
                  <div style={styles.qrPlaceholder}>
                    <div style={styles.qrSpinner} />
                    <p style={styles.qrLoadingText}>Generating Session...</p>
                  </div>
                ) : (
                  <div style={styles.qrFrame}>
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=140&data=chatx-pairing:${sessionId}|${encodeURIComponent(getBrowserOS())}`}
                      style={{
                        width: '140px',
                        height: '140px',
                        objectFit: 'contain',
                        borderRadius: '8px',
                        backgroundColor: 'white',
                      }}
                      alt="Pairing QR Code"
                    />
                    <div style={styles.scanLine} />
                  </div>
                )}
              </div>

              {qrError && (
                <p style={{ ...styles.errorText, fontSize: '12.5px', marginBottom: '16px', maxWidth: '300px', lineHeight: '1.4' }}>
                  {qrError}
                </p>
              )}

              {loading && <p style={{ color: 'hsl(var(--text-secondary))', fontSize: '14px', marginBottom: '16px', fontWeight: 500, animation: 'pulse 1.5s infinite' }}>Linking secure session...</p>}

              <div style={styles.instructionBox}>
                <div style={styles.stepRow}>
                  <div style={styles.stepCircle}>1</div>
                  <p style={styles.stepText}>Open ChatX on your phone</p>
                </div>
                <div style={styles.stepRow}>
                  <div style={styles.stepCircle}>2</div>
                  <p style={styles.stepText}>Tap QR scanner in search bar</p>
                </div>
                <div style={styles.stepRow}>
                  <div style={styles.stepCircle}>3</div>
                  <p style={styles.stepText}>Scan code to sync instantly</p>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

const styles = {
  container: {
    width: '100vw',
    height: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'hsl(var(--bg-primary))',
    overflow: 'hidden',
    padding: '20px',
  },
  logoWrapper: {
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeText: {
    fontSize: '14.5px',
    color: 'hsl(var(--text-secondary))',
    marginBottom: '28px',
    textAlign: 'center' as const,
  },
  form: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  },
  fieldWrapper: {
    width: '100%',
  },
  textField: {
    width: '100%',
    textAlign: 'center' as const,
  },
  errorText: {
    color: '#ef4444',
    fontSize: '13.5px',
    textAlign: 'center' as const,
    marginTop: '4px',
  },
  btnWrapper: {
    width: '100%',
    padding: '0 25px',
    marginTop: '12px',
  },
  submitBtn: {
    width: '100%',
    fontSize: '16px',
    fontWeight: 700,
    padding: '20px 25px',
    border: 'none',
  },
  qrContainer: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
  },
  qrWrapper: {
    padding: '24px',
    backgroundColor: '#ffffff',
    borderRadius: '24px',
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.15)',
    marginBottom: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.3s ease',
  },
  qrFrame: {
    position: 'relative' as const,
    width: '160px',
    height: '160px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1.5px solid #f0f0f0',
    borderRadius: '16px',
    backgroundColor: '#ffffff',
    overflow: 'hidden' as const,
  },
  scanLine: {
    position: 'absolute' as const,
    left: '8px',
    right: '8px',
    height: '3px',
    backgroundColor: '#00c853',
    boxShadow: '0 0 10px #00c853, 0 0 20px #00c853',
    borderRadius: '2px',
    animation: 'scanAnimation 3s infinite ease-in-out',
    zIndex: 10,
  },
  instructionBox: {
    width: '100%',
    maxWidth: '320px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
    backgroundColor: 'hsl(var(--bg-secondary))',
    padding: '16px 20px',
    borderRadius: '16px',
    border: '1px solid hsl(var(--border))',
  },
  stepRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  stepCircle: {
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    backgroundColor: 'hsl(var(--bg-primary))',
    color: 'hsl(var(--text-primary))',
    fontSize: '11px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid hsl(var(--border-light))',
  },
  stepText: {
    fontSize: '13px',
    color: 'hsl(var(--text-secondary))',
  },
  qrPlaceholder: {
    width: '160px',
    height: '160px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    border: '1.5px dashed #e0e0e0',
  },
  qrSpinner: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: '2px solid #e0e0e0',
    borderTopColor: '#00c853',
    animation: 'spin 1s infinite linear',
  },
  qrLoadingText: {
    marginTop: '12px',
    fontSize: '12px',
    color: '#888888',
    fontWeight: 500,
  },
};
