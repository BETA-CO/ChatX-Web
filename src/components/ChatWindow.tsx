import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot, addDoc, doc, updateDoc, increment, serverTimestamp, setDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { MdSend, MdInsertEmoticon, MdPerson, MdLockOutline, MdDone, MdDoneAll, MdReply, MdClear, MdArrowBack } from 'react-icons/md';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';

if (typeof document !== 'undefined') {
  const styleEl = document.createElement('style');
  styleEl.innerHTML = `
    @keyframes emptyPulse {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 1; }
    }
    @keyframes syncFloat {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-6px); }
    }
    .sync-float {
      animation: syncFloat 4s ease-in-out infinite;
    }
    .empty-pulse {
      animation: emptyPulse 3s ease-in-out infinite;
    }
  `;
  document.head.appendChild(styleEl);
}

interface Message {
  id: string;
  senderID: string;
  senderEmail: string;
  receiverID: string;
  message: string;
  timestamp: any;
  status: string;
  replyToMessageText?: string;
  replyToSenderName?: string;
}

interface ChatWindowProps {
  currentUserId: string;
  currentUserEmail: string;
  activeChatId: string | null;
  activeChatName: string;
  onCloseChat: () => void;
  lockedChats: string[];
  theme: 'dark' | 'light';
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  currentUserId,
  currentUserEmail,
  activeChatId,
  activeChatName,
  onCloseChat,
  lockedChats,
  theme,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [callingState, setCallingState] = useState<'idle' | 'calling'>('idle');
  const [isContactTyping, setIsContactTyping] = useState(false);
  const [isContactOnline, setIsContactOnline] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pendingReply, setPendingReply] = useState<{ message: string; senderName: string } | null>(null);
  
  // Emoji Autocomplete states
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null);
  // Keep typescript happy for unused variable
  if (emojiQuery) {
    // emojiQuery is tracked internally
  }
  const [emojiSuggestions, setEmojiSuggestions] = useState<Array<{ id: string; native: string; name: string }>>([]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<any>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close emoji picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        showEmojiPicker &&
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(event.target as Node) &&
        emojiButtonRef.current &&
        !emojiButtonRef.current.contains(event.target as Node)
      ) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPicker]);

  // Close emoji picker and reset autocompletion when active chat changes
  useEffect(() => {
    setShowEmojiPicker(false);
    setEmojiQuery(null);
    setEmojiSuggestions([]);
    setActiveSuggestionIndex(0);
  }, [activeChatId]);

  // Check cursor position to see if we should show autocomplete suggestions
  const checkEmojiAutocomplete = (text: string, cursorPosition: number) => {
    const textBeforeCursor = text.slice(0, cursorPosition);
    const match = textBeforeCursor.match(/:([a-zA-Z0-9_-]{1,15})$/);
    
    if (match) {
      const queryVal = match[1];
      setEmojiQuery(queryVal);
      
      const suggestions: Array<{ id: string; native: string; name: string }> = [];
      const queryLower = queryVal.toLowerCase();
      
      const emojiData = data as any;
      if (emojiData && emojiData.emojis) {
        for (const id in emojiData.emojis) {
          const emojiObj = emojiData.emojis[id];
          const name = emojiObj.name || '';
          
          if (
            id.toLowerCase().includes(queryLower) ||
            name.toLowerCase().includes(queryLower)
          ) {
            suggestions.push({
              id: id,
              native: emojiObj.skins[0].native,
              name: name,
            });
          }
          if (suggestions.length >= 6) break;
        }
      }
      setEmojiSuggestions(suggestions);
      setActiveSuggestionIndex(0);
    } else {
      setEmojiQuery(null);
      setEmojiSuggestions([]);
      setActiveSuggestionIndex(0);
    }
  };

  // Replace text :shortcode with the native emoji character
  const selectSuggestion = (suggestion: { id: string; native: string }) => {
    const text = inputText;
    const cursorPosition = inputRef.current?.selectionStart || 0;
    const textBeforeCursor = text.slice(0, cursorPosition);
    
    const colonIndex = textBeforeCursor.lastIndexOf(':');
    if (colonIndex !== -1) {
      const emojiChar = suggestion.native;
      const newText = text.slice(0, colonIndex) + emojiChar + text.slice(cursorPosition);
      setInputText(newText);
      
      const newPos = colonIndex + emojiChar.length;
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.setSelectionRange(newPos, newPos);
        }
      }, 0);
    }
    
    setEmojiQuery(null);
    setEmojiSuggestions([]);
    setActiveSuggestionIndex(0);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (emojiSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestionIndex((prev) => (prev + 1) % emojiSuggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestionIndex((prev) => (prev - 1 + emojiSuggestions.length) % emojiSuggestions.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectSuggestion(emojiSuggestions[activeSuggestionIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setEmojiQuery(null);
        setEmojiSuggestions([]);
      }
    }
  };

  const handleInputSelect = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const target = e.currentTarget;
    checkEmojiAutocomplete(target.value, target.selectionStart || 0);
  };

  // Construct standard sorted Chat Room ID (UID_UID)
  const getChatRoomId = (uid1: string, uid2: string) => {
    const ids = [uid1, uid2];
    ids.sort();
    return ids.join('_');
  };

  const chatRoomId = activeChatId ? getChatRoomId(currentUserId, activeChatId) : null;

  // 1. Listen for active contact's online status
  useEffect(() => {
    if (!activeChatId) return;

    const userRef = doc(db, 'Users', activeChatId);
    const unsubscribe = onSnapshot(userRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setIsContactOnline(!!data?.isOnline);
      } else {
        setIsContactOnline(false);
      }
    });

    return () => unsubscribe();
  }, [activeChatId]);

  // 2. Listen for active contact's typing status inside `/chat_rooms/{chatRoomId}`
  useEffect(() => {
    if (!chatRoomId || !activeChatId) return;

    const roomRef = doc(db, 'chat_rooms', chatRoomId);
    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const typingList = data?.typingUsers || [];
        setIsContactTyping(typingList.includes(activeChatId));
      } else {
        setIsContactTyping(false);
      }
    });

    return () => unsubscribe();
  }, [chatRoomId, activeChatId]);

  // 3. Sync messages in real-time & mark incoming messages as read
  useEffect(() => {
    if (!chatRoomId || !activeChatId) return;

    setLoading(true);
    const messagesRef = collection(db, 'chat_rooms', chatRoomId, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'asc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list: Message[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        list.push({
          id: docSnap.id,
          senderID: data.senderID || '',
          senderEmail: data.senderEmail || '',
          receiverID: data.receiverID || '',
          message: data.message || '',
          timestamp: data.timestamp || null,
          status: data.status || 'sent',
          replyToMessageText: data.replyToMessageText,
          replyToSenderName: data.replyToSenderName,
        });
      });

      // Trigger Chrome Notification if document is hidden and new message comes from the contact
      if (list.length > 0) {
        const lastMsg = list[list.length - 1];
        if (
          lastMessageIdRef.current &&
          lastMsg.id !== lastMessageIdRef.current &&
          lastMsg.senderID !== currentUserId &&
          document.hidden
        ) {
          const isLocked = lockedChats.includes(activeChatId);
          if (isLocked) {
            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              new Notification('New Secure Message', {
                body: 'Passcode required to view contents',
                icon: '/splash.png'
              });
            }
          } else {
            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              new Notification(activeChatName, {
                body: lastMsg.message,
                icon: '/splash.png'
              });
            }
          }
        }
        lastMessageIdRef.current = lastMsg.id;
      }

      setMessages(list);
      setLoading(false);
      
      // Clear unread counts
      clearUnreadCount();

      // Automatically mark received messages as read
      snapshot.docs.forEach(async (docSnap) => {
        const msg = docSnap.data();
        if (msg.senderID === activeChatId && msg.status !== 'read') {
          await updateDoc(doc(db, 'chat_rooms', chatRoomId, 'messages', docSnap.id), {
            status: 'read',
          });
        }
      });

    }, (err) => {
      console.error('Error fetching messages:', err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [chatRoomId, activeChatId, currentUserId, activeChatName, lockedChats]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Clear unread badge in Firestore
  const clearUnreadCount = async () => {
    if (!activeChatId) return;
    try {
      const contactDocRef = doc(db, 'Users', currentUserId, 'contacts', activeChatId);
      await updateDoc(contactDocRef, {
        unreadCount: 0,
      });
    } catch (e) {
      // Ignore if document doesn't fully exist yet
    }
  };

  // 5. Update Typing status in Firestore with self-healing creation check
  const updateTypingStatus = async (isTyping: boolean) => {
    if (!chatRoomId) return;
    try {
      const roomRef = doc(db, 'chat_rooms', chatRoomId);
      await setDoc(roomRef, {
        typingUsers: isTyping ? arrayUnion(currentUserId) : arrayRemove(currentUserId),
      }, { merge: true });
    } catch (e) {
      console.error('Failed to update typing status:', e);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const cursorPosition = e.target.selectionStart || 0;

    // Trigger typing=true immediately
    updateTypingStatus(true);

    // Debounce typing=false after 3 seconds
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      updateTypingStatus(false);
    }, 3000);

    // Check for completed emoji shortcode (e.g. :smile:)
    const textBeforeCursor = value.slice(0, cursorPosition);
    const completedMatch = textBeforeCursor.match(/:([a-zA-Z0-9_-]{1,15}):$/);

    if (completedMatch) {
      const shortcode = completedMatch[1];
      const emojiObj = (data as any).emojis?.[shortcode];
      if (emojiObj) {
        const emojiChar = emojiObj.skins[0].native;
        const colonIndex = textBeforeCursor.lastIndexOf(':', cursorPosition - 2);
        if (colonIndex !== -1) {
          const newText = value.slice(0, colonIndex) + emojiChar + value.slice(cursorPosition);
          setInputText(newText);
          
          const newPos = colonIndex + emojiChar.length;
          setEmojiQuery(null);
          setEmojiSuggestions([]);
          setActiveSuggestionIndex(0);
          
          setTimeout(() => {
            if (inputRef.current) {
              inputRef.current.focus();
              inputRef.current.setSelectionRange(newPos, newPos);
            }
          }, 0);
          return;
        }
      }
    }

    setInputText(value);
    checkEmojiAutocomplete(value, cursorPosition);
  };

  // 6. Send message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !chatRoomId || !activeChatId) return;

    const messageContent = inputText.trim();
    setInputText('');
    
    // Cache pending reply details and reset state
    const currentReply = pendingReply;
    setPendingReply(null);
    
    // Stop typing status instantly
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    updateTypingStatus(false);
    setShowEmojiPicker(false);

    try {
      const messagesRef = collection(db, 'chat_rooms', chatRoomId, 'messages');
      const timestamp = serverTimestamp();

      const newMsg = {
        senderID: currentUserId,
        senderEmail: currentUserEmail,
        receiverID: activeChatId,
        message: messageContent,
        timestamp: timestamp,
        status: 'sent',
        ...(currentReply && {
          replyToMessageText: currentReply.message,
          replyToSenderName: currentReply.senderName,
        })
      };

      // A. Add message to messages collection
      await addDoc(messagesRef, newMsg);

      // B. Update last message details in my contacts
      const myContactRef = doc(db, 'Users', currentUserId, 'contacts', activeChatId);
      await setDoc(myContactRef, {
        lastMessage: messageContent,
        lastMessageTime: timestamp,
      }, { merge: true });

      // C. Update receiver contacts
      if (currentUserId !== activeChatId) {
        const receiverContactRef = doc(db, 'Users', activeChatId, 'contacts', currentUserId);
        await setDoc(receiverContactRef, {
          lastMessage: messageContent,
          lastMessageTime: timestamp,
          unreadCount: increment(1),
        }, { merge: true });
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  // 7. Swipe (Drag) to reply gesture hook
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>, msg: Message) => {
    const element = e.currentTarget;
    const startX = e.clientX;
    element.setPointerCapture(e.pointerId);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      // Constraint dragging to maximum 90px to the right
      if (deltaX > 0 && deltaX < 90) {
        element.style.transform = `translateX(${deltaX}px)`;
      }
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      element.style.transition = 'transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
      element.style.transform = 'translateX(0px)';

      const deltaX = upEvent.clientX - startX;
      if (deltaX > 50) {
        // Swipe threshold met! Trigger reply quote popup!
        setPendingReply({
          message: msg.message,
          senderName: msg.senderID === currentUserId ? 'You' : activeChatName
        });
      }

      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', handlePointerUp);
      
      setTimeout(() => {
        element.style.transition = '';
      }, 250);
    };

    element.addEventListener('pointermove', handlePointerMove);
    element.addEventListener('pointerup', handlePointerUp);
  };

  const handleEmojiClick = (emoji: string) => {
    setInputText((prev) => prev + emoji);
  };

  const formatMessageTime = (ts: any) => {
    if (!ts) return '12:00 PM';
    const date = ts.toDate ? ts.toDate() : new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const endCall = () => {
    setCallingState('idle');
  };

  if (!activeChatId) {
    return (
      <div style={styles.emptyContainer} className="animate-fade-in">
        <div style={styles.emptyContent}>
          {/* Clean Syncing SVG Illustration */}
          <div style={styles.illustrationWrapper} className="sync-float">
            <svg width="320" height="220" viewBox="0 0 320 220" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Laptop - outline white/black based on theme, inside secondary/primary */}
              <rect x="30" y="50" width="140" height="90" rx="8" fill="hsl(var(--bg-secondary))" stroke="hsl(var(--text-primary))" strokeWidth="1.8" />
              <rect x="38" y="57" width="124" height="76" rx="4" fill="hsl(var(--bg-primary))" />
              {/* Laptop screen content - chat lines in adaptive primary color */}
              <rect x="48" y="68" width="40" height="6" rx="3" fill="hsl(var(--text-primary))" opacity="0.4" />
              <rect x="48" y="80" width="60" height="6" rx="3" fill="hsl(var(--text-primary))" opacity="0.25" />
              <rect x="48" y="92" width="35" height="6" rx="3" fill="hsl(var(--text-primary))" opacity="0.15" />
              {/* Right side chat bubbles */}
              <rect x="115" y="68" width="38" height="14" rx="7" fill="hsl(var(--text-primary))" opacity="0.3" />
              <rect x="120" y="88" width="38" height="14" rx="7" fill="hsl(var(--text-primary))" opacity="0.15" />
              {/* Laptop base */}
              <path d="M20 140H180L186 148H14L20 140Z" fill="hsl(var(--bg-secondary))" stroke="hsl(var(--text-primary))" strokeWidth="1.8" />
              <rect x="85" y="141" width="30" height="3" rx="1.5" fill="hsl(var(--text-primary))" opacity="0.4" />

              {/* Connection arc */}
              <path d="M178 95 C 210 95, 220 90, 230 75" stroke="hsl(var(--text-primary))" strokeWidth="1.8" strokeLinecap="round" strokeDasharray="4 4" className="empty-pulse" opacity="0.6" />

              {/* Mobile Phone */}
              <rect x="228" y="42" width="52" height="96" rx="10" fill="hsl(var(--bg-secondary))" stroke="hsl(var(--text-primary))" strokeWidth="1.8" />
              <rect x="234" y="50" width="40" height="80" rx="6" fill="hsl(var(--bg-primary))" />
              {/* Phone notch */}
              <rect x="247" y="45" width="14" height="3" rx="1.5" fill="hsl(var(--text-primary))" opacity="0.3" />
              {/* Phone chat bubbles */}
              <rect x="238" y="60" width="22" height="8" rx="4" fill="hsl(var(--text-primary))" opacity="0.3" />
              <rect x="248" y="74" width="22" height="8" rx="4" fill="hsl(var(--text-primary))" opacity="0.2" />
              <rect x="238" y="88" width="28" height="8" rx="4" fill="hsl(var(--text-primary))" opacity="0.1" />
              {/* Phone home indicator */}
              <rect x="248" y="124" width="12" height="3" rx="1.5" fill="hsl(var(--text-primary))" opacity="0.2" />
            </svg>
          </div>

          <h2 style={styles.emptyTitle}>ChatX Web</h2>
          <p style={styles.emptyText}>
            Send and receive messages from your browser.<br />
            Your chats stay synced with your phone in real time.
          </p>

          {/* Encryption Footer */}
          <div style={styles.encryptionFooter}>
            <MdLockOutline size={14} style={{ opacity: 0.6 }} />
            <span>Your personal messages are end-to-end encrypted.</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Top Header - Monochrome Minimal (Added Close Chat button on the left!) */}
      <div style={styles.header}>
        <div style={styles.headerInfo}>
          <button onClick={onCloseChat} style={styles.closeChatBtn} title="Back">
            <MdArrowBack size={22} />
          </button>
          
          <div style={styles.avatarCircle}>
            <MdPerson size={24} color="hsl(var(--text-primary))" />
          </div>
          
          <div style={styles.headerText}>
            <span style={styles.contactName}>{activeChatName}</span>
            <span style={styles.onlineStatus}>
              {isContactTyping ? (
                <span style={{ color: 'hsl(var(--text-primary))', fontWeight: 'bold' }}>typing...</span>
              ) : isContactOnline ? (
                <>
                  <span className="live-indicator" style={{ marginRight: '6px', backgroundColor: '#10b981' }} />
                  Online
                </>
              ) : (
                <>
                  <span className="live-indicator" style={{ marginRight: '6px', backgroundColor: 'hsl(var(--text-muted))' }} />
                  Offline
                </>
              )}
            </span>
          </div>
        </div>

        {/* Call icons removed */}
      </div>

      {/* Message scroll Pane - Pure monochrome background with Drag/Swipe indicator guides */}
      <div style={styles.feedContainer}>
        {loading ? (
          <div style={styles.centerSpinner}>Syncing conversations...</div>
        ) : (
          <div style={styles.messagesList}>
            {messages.length === 0 ? (
              <div style={styles.firstMsgBox}>
                <div style={styles.infoLockCircle}>
                  <MdLockOutline size={20} color="hsl(var(--text-primary))" />
                </div>
                <h4 style={styles.infoTitle}>Secure Chat Session</h4>
                <p style={styles.infoText}>
                  This is the start of your end-to-end encrypted conversation history with <strong>{activeChatName}</strong>.
                </p>
                <div style={styles.tipBox}>
                  <span style={{ marginRight: '6px' }}>💡</span>
                  <span>Tip: Drag any message to the right or double-click to quote-reply instantly.</span>
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                const isMine = msg.senderID === currentUserId;
                return (
                  <div
                    key={msg.id}
                    style={{
                      ...styles.msgRow,
                      justifyContent: isMine ? 'flex-end' : 'flex-start',
                    }}
                  >
                    {/* Floating reply icon guide appearing behind bubble on swipe! */}
                    <div style={{
                      ...styles.swipeBackDrop,
                      justifyContent: isMine ? 'flex-end' : 'flex-start',
                    }}>
                      <MdReply size={20} style={{ color: 'hsl(var(--text-muted))', margin: '0 20px' }} />
                    </div>

                    <div
                      onPointerDown={(e) => handlePointerDown(e, msg)}
                      onDoubleClick={() => setPendingReply({
                        message: msg.message,
                        senderName: isMine ? 'You' : activeChatName
                      })}
                      style={{
                        ...styles.bubble,
                        backgroundColor: 'hsl(var(--bg-secondary))',
                        border: '1px solid hsl(var(--border-light))',
                        borderTopLeftRadius: '20px',
                        borderTopRightRadius: '20px',
                        borderBottomLeftRadius: isMine ? '20px' : '4px',
                        borderBottomRightRadius: isMine ? '4px' : '20px',
                        color: 'hsl(var(--text-primary))',
                        touchAction: 'none',
                        cursor: 'grab',
                      }}
                    >
                      {/* Quote Reply display nested above main bubble text */}
                      {msg.replyToMessageText && (
                        <div style={styles.replyQuoteBubble}>
                          <span style={styles.replyQuoteSender}>{msg.replyToSenderName}</span>
                          <p style={styles.replyQuoteText}>{msg.replyToMessageText}</p>
                        </div>
                      )}

                      <p style={styles.msgText}>{msg.message}</p>
                      
                      <div style={styles.bubbleFooter}>
                        <span style={styles.msgTime}>{formatMessageTime(msg.timestamp)}</span>
                        
                        {/* WhatsApp-style ticks for Sent messages */}
                        {isMine && (
                          <span style={styles.tickIcon}>
                            {msg.status === 'read' ? (
                              <MdDoneAll size={16} color="#3b82f6" title="Read (Blue Tick)" />
                            ) : msg.timestamp ? (
                              <MdDoneAll size={16} color="hsl(var(--text-muted))" title="Delivered" />
                            ) : (
                              <MdDone size={16} color="hsl(var(--text-muted))" title="Sending..." />
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Reply quote popover banner directly above input tray */}
      {pendingReply && (
        <div style={styles.pendingReplyBanner} className="animate-fade-in">
          <div style={styles.replyLeftBorder} />
          <div style={styles.pendingReplyInfo}>
            <span style={styles.pendingReplySender}>Replying to {pendingReply.senderName}</span>
            <span style={styles.pendingReplyText}>{pendingReply.message}</span>
          </div>
          <button onClick={() => setPendingReply(null)} style={styles.clearReplyBtn} title="Cancel reply">
            <MdClear size={18} />
          </button>
        </div>
      )}

      {/* Emoji popover tray */}
      {showEmojiPicker && (
        <div ref={emojiPickerRef} style={styles.emojiPickerContainer} className="animate-fade-in">
          <Picker
            data={data}
            onEmojiSelect={(emoji: any) => {
              handleEmojiClick(emoji.native);
            }}
            theme={theme}
            skinTonePosition="none"
            previewPosition="none"
          />
        </div>
      )}

      {/* Emoji Autocomplete Suggestions Popover */}
      {emojiSuggestions.length > 0 && (
        <div style={styles.autocompleteContainer} className="animate-fade-in">
          {emojiSuggestions.map((suggestion, idx) => (
            <div
              key={suggestion.id}
              onClick={() => selectSuggestion(suggestion)}
              style={{
                ...styles.autocompleteItem,
                backgroundColor: activeSuggestionIndex === idx ? 'hsl(var(--bg-secondary))' : 'transparent',
                borderLeft: activeSuggestionIndex === idx ? '3px solid hsl(var(--text-primary))' : '3px solid transparent',
              }}
            >
              <span style={styles.autocompleteEmoji}>{suggestion.native}</span>
              <span style={styles.autocompleteShortcode}>:{suggestion.id}:</span>
              <span style={styles.autocompleteName}>{suggestion.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Input bar - Matches MyTextField circular styling */}
      <form onSubmit={handleSendMessage} style={styles.footer}>
        <button
          ref={emojiButtonRef}
          type="button"
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          style={styles.footerBtn}
          title="Emojis"
        >
          <MdInsertEmoticon size={22} color={showEmojiPicker ? 'hsl(var(--text-primary))' : 'hsl(var(--text-muted))'} />
        </button>

        <input
          ref={inputRef}
          type="text"
          placeholder="Type secure message..."
          value={inputText}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          onSelect={handleInputSelect}
          className="monochrome-input"
          style={styles.messageInput}
        />

        <button type="submit" style={styles.sendBtn} title="Send Message">
          <MdSend size={18} />
        </button>
      </form>

      {/* VoIP Calling overlay */}
      {callingState === 'calling' && (
        <div style={styles.callOverlay}>
          <div style={styles.callCard} className="monochrome-card animate-fade-in">
            <div style={{ ...styles.avatarCircle, width: '64px', height: '64px' }}>
              <MdPerson size={36} color="hsl(var(--text-primary))" />
            </div>
            <h3 style={styles.callTitle}>Calling {activeChatName}...</h3>
            <p style={styles.callSubtitle}>
              Establishing WebRTC signaling channel via ChatX Cloud
            </p>
            <div style={styles.callBtnRow}>
              <button onClick={endCall} style={styles.endCallBtn}>
                End Call
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    flex: 1,
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    position: 'relative' as const,
    backgroundColor: 'hsl(var(--bg-primary))',
  },
  header: {
    height: '68px',
    borderBottom: '1px solid hsl(var(--border))',
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 5,
    backgroundColor: 'hsl(var(--bg-primary))',
  },
  headerInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  closeChatBtn: {
    padding: '6px',
    borderRadius: '10px',
    backgroundColor: 'transparent',
    border: 'none',
    color: 'hsl(var(--text-muted))',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '4px',
    transition: 'all 0.2s',
  },
  avatarCircle: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    backgroundColor: 'rgba(128, 128, 128, 0.12)',
    color: 'hsl(var(--text-primary))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerText: {
    display: 'flex',
    flexDirection: 'column' as const,
  },
  contactName: {
    fontSize: '14.5px',
    fontWeight: 700,
    color: 'hsl(var(--text-primary))',
  },
  onlineStatus: {
    fontSize: '11px',
    color: 'hsl(var(--text-secondary))',
    display: 'flex',
    alignItems: 'center',
    marginTop: '2px',
  },
  headerActions: {
    display: 'flex',
    gap: '8px',
  },
  actionBtn: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    backgroundColor: 'transparent',
    color: 'hsl(var(--text-secondary))',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s',
    border: 'none',
  },
  feedContainer: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '24px',
    backgroundColor: 'hsl(var(--bg-primary))',
  },
  centerSpinner: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '13px',
    color: 'hsl(var(--text-muted))',
  },
  messagesList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '14px',
  },
  firstMsgBox: {
    alignSelf: 'center',
    textAlign: 'center' as const,
    backgroundColor: 'hsl(var(--bg-secondary))',
    border: '1px solid hsl(var(--border-light))',
    borderRadius: '24px',
    padding: '32px 28px',
    maxWidth: '420px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '12px',
    marginTop: '48px',
    boxShadow: 'var(--shadow-md)',
  },
  infoLockCircle: {
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    backgroundColor: 'rgba(128, 128, 128, 0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '4px',
  },
  infoTitle: {
    fontSize: '15px',
    fontWeight: 700,
    color: 'hsl(var(--text-primary))',
    letterSpacing: '-0.2px',
  },
  infoText: {
    fontSize: '13.5px',
    color: 'hsl(var(--text-secondary))',
    lineHeight: '1.5',
    margin: 0,
  },
  tipBox: {
    marginTop: '8px',
    padding: '10px 14px',
    backgroundColor: 'hsl(var(--bg-primary))',
    borderRadius: '12px',
    border: '1px solid hsl(var(--border))',
    fontSize: '11.5px',
    color: 'hsl(var(--text-muted))',
    lineHeight: '1.45',
    textAlign: 'left' as const,
    display: 'flex',
    alignItems: 'flex-start',
  },
  msgRow: {
    display: 'flex',
    width: '100%',
    position: 'relative' as const,
  },
  swipeBackDrop: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    alignItems: 'center',
    zIndex: 1,
    pointerEvents: 'none' as const,
  },
  bubble: {
    maxWidth: '65%',
    padding: '12px 16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    zIndex: 2,
    transition: 'transform 0.1s ease-out',
  },
  replyQuoteBubble: {
    backgroundColor: 'rgba(128,128,128,0.1)',
    borderLeft: '3px solid hsl(var(--text-primary))',
    borderRadius: '8px',
    padding: '6px 10px',
    marginBottom: '4px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
  },
  replyQuoteSender: {
    fontSize: '11px',
    fontWeight: 700,
    color: 'hsl(var(--text-primary))',
  },
  replyQuoteText: {
    fontSize: '12.5px',
    color: 'hsl(var(--text-secondary))',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    margin: 0,
  },
  msgText: {
    fontSize: '14px',
    lineHeight: '1.45',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    margin: 0,
  },
  bubbleFooter: {
    display: 'flex',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: '6px',
    marginTop: '2px',
  },
  msgTime: {
    fontSize: '10px',
    opacity: 0.5,
  },
  tickIcon: {
    display: 'inline-flex',
    alignItems: 'center',
  },
  pendingReplyBanner: {
    height: '56px',
    borderTop: '1px solid hsl(var(--border))',
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'hsl(var(--bg-secondary))',
    gap: '12px',
    zIndex: 5,
    position: 'relative' as const,
  },
  replyLeftBorder: {
    position: 'absolute' as const,
    left: '24px',
    top: '12px',
    bottom: '12px',
    width: '3.5px',
    backgroundColor: 'hsl(var(--text-primary))',
    borderRadius: '4px',
  },
  pendingReplyInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    paddingLeft: '10px',
    minWidth: 0,
  },
  pendingReplySender: {
    fontSize: '11px',
    fontWeight: 700,
    color: 'hsl(var(--text-primary))',
  },
  pendingReplyText: {
    fontSize: '13px',
    color: 'hsl(var(--text-secondary))',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  clearReplyBtn: {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'hsl(var(--text-muted))',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    height: '76px',
    borderTop: '1px solid hsl(var(--border))',
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    backgroundColor: 'hsl(var(--bg-primary))',
    position: 'relative' as const,
    zIndex: 5,
  },
  footerBtn: {
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    backgroundColor: 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    border: 'none',
  },
  messageInput: {
    flex: 1,
    padding: '12px 20px',
    fontSize: '14.5px',
  },
  sendBtn: {
    width: '42px',
    height: '42px',
    borderRadius: '12px',
    backgroundColor: 'hsl(var(--bg-secondary))',
    color: 'hsl(var(--text-primary))',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  emptyContainer: {
    flex: 1,
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'hsl(var(--bg-primary))',
    borderBottom: '6px solid hsl(var(--status-online))',
  },
  emptyContent: {
    maxWidth: '500px',
    padding: '40px 24px',
    textAlign: 'center' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
  },
  illustrationWrapper: {
    marginBottom: '40px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: '28px',
    fontWeight: 300,
    color: 'hsl(var(--text-primary))',
    marginBottom: '16px',
    letterSpacing: '-0.3px',
  },
  emptyText: {
    fontSize: '14px',
    color: 'hsl(var(--text-muted))',
    lineHeight: '1.7',
    marginBottom: '0',
    maxWidth: '460px',
  },
  encryptionFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    color: 'hsl(var(--text-muted))',
    fontSize: '12px',
    marginTop: '48px',
    opacity: 0.6,
  },
  emojiPickerContainer: {
    position: 'absolute' as const,
    bottom: '76px',
    left: '24px',
    zIndex: 100,
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.25)',
    borderRadius: '16px',
    overflow: 'hidden',
  },
  autocompleteContainer: {
    position: 'absolute' as const,
    bottom: '76px',
    left: '24px',
    right: '24px',
    backgroundColor: 'hsl(var(--bg-primary))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '12px',
    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.15)',
    zIndex: 101,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '6px 0',
  },
  autocompleteItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 16px',
    cursor: 'pointer',
    transition: 'background-color 0.15s, border-left 0.15s',
  },
  autocompleteEmoji: {
    fontSize: '18px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
  },
  autocompleteShortcode: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'hsl(var(--text-primary))',
    fontFamily: 'monospace',
  },
  autocompleteName: {
    fontSize: '12px',
    color: 'hsl(var(--text-secondary))',
    marginLeft: 'auto',
  },
  callOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  callCard: {
    width: '320px',
    padding: '30px',
    textAlign: 'center' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
  },
  callTitle: {
    fontSize: '18px',
    fontWeight: 700,
    marginBottom: '8px',
    marginTop: '20px',
  },
  callSubtitle: {
    fontSize: '12px',
    color: 'hsl(var(--text-secondary))',
    lineHeight: '1.45',
    marginBottom: '24px',
  },
  callBtnRow: {
    display: 'flex',
    justifyContent: 'center',
  },
  endCallBtn: {
    backgroundColor: '#ef4444',
    color: '#fff',
    padding: '12px 28px',
    borderRadius: '12px',
    fontWeight: 600,
    fontSize: '13.5px',
    boxShadow: '0 4px 14px rgba(239, 68, 68, 0.3)',
    border: 'none',
    cursor: 'pointer',
  },
};
