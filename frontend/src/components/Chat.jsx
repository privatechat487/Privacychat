import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import axios from 'axios';
import { Send, LogOut, Paperclip, Mic, Square, File as FileIcon, Phone, Video, PhoneOff, PhoneIncoming, Sticker, MicOff, VideoOff, RefreshCcw, Check, CheckCheck, Trash2, Edit2, X, Reply as ReplyIcon, ChevronDown, Camera, Smile, Heart } from 'lucide-react';

const STICKERS = [
  { id: 't1', url: 'https://media.tenor.com/eHs266qK3esAAAAC/gang-leader-nani.gif' },
  { id: 't2', url: 'https://media.tenor.com/VXSLV7zrm-8AAAAC/unexpected-kiss-kiss.gif' },
  { id: 't3', url: 'https://media.tenor.com/-miQ1kjbu3kAAAAC/kiss-siddharth.gif' },
  { id: 'l1', url: 'https://media.tenor.com/CUoWdrqlZz0AAAAC/action-hugging-in-love.gif' },
  { id: 'l2', url: 'https://media.tenor.com/ppEMcgZOnboAAAAC/i-love-you-sivakarthikeyan.gif' },
  { id: 'l3', url: 'https://media.tenor.com/fdg39cc2tsgAAAAC/kiss-romantic.gif' },
  { id: 'l4', url: 'https://media.tenor.com/wFa0JCc01-4AAAAC/gang-leader-nani.gif' },
  { id: 'l5', url: 'https://media.tenor.com/x785JatZ3vsAAAAC/happy-love.gif' }
];

const BACKEND_URL = import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`;
const VAPID_PUBLIC_KEY = 'BNZ-a2S8rXae5d46RRXs4ZXhW6u8en8Rz9Q87r9V9B0jQFCti3vaC0COWw4fKvd2qXW0412_Gs2Af8aGH56PFzU';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const Chat = () => {
  const [socket, setSocket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [user, setUser] = useState(null);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [activeMenu, setActiveMenu] = useState(null);
  const [reactingTo, setReactingTo] = useState(null);
  const [users, setUsers] = useState({});
  const [statuses, setStatuses] = useState({});
  const [theme, setTheme] = useState('default');
  const touchRefs = useRef({});
  const longPressTimer = useRef(null);
  const heartsArray = useRef(Array.from({ length: 15 }));

  useEffect(() => {
    const handleClickOutside = () => {
       setActiveMenu(null);
       setReactingTo(null);
    };
    document.addEventListener('click', handleClickOutside);
    
    // Notification Permission Check (Safety for Mobile)
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => document.removeEventListener('click', handleClickOutside);
  }, []);
  
  const fileInputRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

  // WebRTC States
  const [calling, setCalling] = useState(false);
  const [receivingCall, setReceivingCall] = useState(false);
  const [callerName, setCallerName] = useState('');
  const [callerSignal, setCallerSignal] = useState(null);
  const [callAccepted, setCallAccepted] = useState(false);
  const [isVideo, setIsVideo] = useState(false);
  
  // Call Option Enhancements
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoDisabled, setIsVideoDisabled] = useState(false);
  const [facingMode, setFacingMode] = useState("user");
  
  const [remoteStreamState, setRemoteStreamState] = useState(null);
  const [localStreamState, setLocalStreamState] = useState(null);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const iceQueueRef = useRef([]);

  useEffect(() => {
    if (callAccepted && remoteVideoRef.current && remoteStreamState) {
      remoteVideoRef.current.srcObject = remoteStreamState;
      remoteVideoRef.current.play().catch(e=>console.log('Video play policy issue', e));
    }
  }, [callAccepted, remoteStreamState]);

  useEffect(() => {
    if ((calling || callAccepted) && localVideoRef.current && localStreamState) {
      localVideoRef.current.srcObject = localStreamState;
      localVideoRef.current.play().catch(e=>console.log('Video play policy issue', e));
    }
  }, [calling, callAccepted, localStreamState]);

  const cleanupCall = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    iceQueueRef.current = [];
    setCalling(false);
    setReceivingCall(false);
    setCallAccepted(false);
    setIsVideo(false);
    setIsMuted(false);
    setIsVideoDisabled(false);
    setCallerName('');
    setCallerSignal(null);
    setRemoteStreamState(null);
    setLocalStreamState(null);
    setFacingMode("user");
    if(window._callSetupTimer) clearTimeout(window._callSetupTimer);
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    const storedUser = JSON.parse(localStorage.getItem('user'));
    
    if (!token || !storedUser) {
      navigate('/login');
      return;
    }
    
    setUser(storedUser);

    // Subscribe to Push Notifications
    const subscribeToPush = async () => {
      try {
        if ('serviceWorker' in navigator && typeof Notification !== 'undefined') {
          const registration = await navigator.serviceWorker.ready;
          if (!registration.pushManager) {
            console.warn('PushManager not supported on this browser');
            return;
          }
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
          });
          
          await axios.post(`${BACKEND_URL}/api/subscribe`, { subscription }, {
            headers: { Authorization: `Bearer ${token}` }
          });
          console.log('Mobile Push Subscribed');
        }
      } catch (e) {
        console.error('Push Subscription failed', e);
      }
    };

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      subscribeToPush();
    }

    const fetchMessages = () => {
      axios.get(`${BACKEND_URL}/api/messages`, {
        headers: { Authorization: `Bearer ${token}` }
      }).then(res => setMessages(res.data))
        .catch(err => console.error("Failed to load messages:", err));
    };

    fetchMessages();

    axios.get(`${BACKEND_URL}/api/users`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(res => {
      const userMap = {};
      const statusMap = {};
      res.data.forEach(u => { 
        userMap[u.username] = u.profile_pic; 
        if (u.last_seen) statusMap[u.username] = { status: 'offline', lastSeen: u.last_seen };
      });
      setUsers(userMap);
      setStatuses(prev => ({ ...prev, ...statusMap }));
    }).catch(err => {
       console.error("Failed to load users:", err);
       setUsers({ [storedUser.username]: storedUser.profilePic }); 
    });

    const newSocket = io(BACKEND_URL, {
      auth: { token }
    });

    newSocket.on('connect', () => {
      newSocket.emit('checkStatus');
    });

    newSocket.on('statusUpdate', ({ username, status, lastSeen }) => {
      setStatuses(prev => ({ ...prev, [username]: { status, lastSeen } }));
    });

    newSocket.on('allStatuses', (onlineMap) => {
      const updated = {};
      Object.keys(onlineMap).forEach(u => updated[u] = { status: 'online' });
      setStatuses(prev => ({ ...prev, ...updated }));
    });

    newSocket.on('connect_error', (err) => {
      console.error('Socket connection error', err);
      if (err.message === 'Authentication error') {
        localStorage.removeItem('token');
        navigate('/login');
      }
    });

    newSocket.on('receiveMessage', (message) => {
      setMessages((prev) => {
         if (prev.find(m => m.id === message.id)) return prev;
         return [...prev, message];
      });
      if (message.sender !== storedUser.username) {
        newSocket.emit('markDelivered', message.id);
        if (document.hasFocus() || document.visibilityState === 'visible') {
           newSocket.emit('markRead', message.id);
        } else {
           // Show browser notification
           if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
             try {
               new Notification(`New message from ${message.sender}`, {
                 body: message.text || (message.type === 'image' ? 'Image' : 'Attachment'),
                 icon: '/favicon.png',
                 badge: '/favicon.png',
                 tag: 'new-message',
                 renotify: true
               });
             } catch(e) { console.error('Notify failed', e); }
           }
        }
      }
    });

    newSocket.on('messageReaction', ({ id, reactions }) => {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, reactions } : m));
    });

    newSocket.on('userUpdate', ({ username, profilePic }) => {
      setUsers(prev => ({ ...prev, [username]: profilePic }));
      if (username === storedUser.username) {
        const updated = { ...storedUser, profilePic };
        localStorage.setItem('user', JSON.stringify(updated));
        setUser(updated);
      }
    });

    newSocket.on('messageStatus', ({ id, status }) => {
      setMessages(prev => prev.map(m => m.id === id ? { 
         ...m, 
         status: status === 'read' ? 'read' : m.status === 'read' ? 'read' : status 
      } : m));
    });

    newSocket.on('messageEdited', ({ id, text }) => {
      setMessages(prev => prev.map(m => m.id === id ? { ...m, text, isEdited: true } : m));
    });

    const handleFocus = () => {
      fetchMessages(); // SYNC ON FOCUS
      setMessages(prev => {
        prev.forEach(m => {
          if (m.sender !== storedUser.username && m.status !== 'read') {
            newSocket.emit('markRead', m.id);
          }
        });
        return prev;
      });
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') handleFocus();
    });

    newSocket.on('deleteMessage', (msgId) => {
      setMessages((prev) => prev.filter(m => m.id !== msgId));
    });

    newSocket.on('callIncoming', (data) => {
      setReceivingCall(true);
      setCallerName(data.from);
      setCallerSignal(data.offer);
      setIsVideo(data.isVideo);
    });

    newSocket.on('callAccepted', async (answer) => {
      setCallAccepted(true);
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        while(iceQueueRef.current.length > 0) {
          const c = iceQueueRef.current.shift();
          peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
      }
    });

    newSocket.on('iceCandidate', async (candidate) => {
      if (peerConnectionRef.current) {
        try {
          if (peerConnectionRef.current.remoteDescription) {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            iceQueueRef.current.push(candidate);
          }
        } catch(e) { console.error('ICE error', e); }
      }
    });

    newSocket.on('callEnded', () => {
      window.stopCallingInternal();
    });

    // Socket Keep-Alive for Mobile
    const keepAlive = setInterval(() => { if(newSocket.connected) newSocket.emit('ping'); }, 20000);

    setSocket(newSocket);
    window.stopCallingInternal = cleanupCall;

    return () => {
      clearInterval(keepAlive);
      window.removeEventListener('focus', handleFocus);
      if(window.stopCallingInternal) window.stopCallingInternal();
      newSocket.close();
    };
  }, [navigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startCall = async (video) => {
    setIsVideo(video);
    setCalling(true);
    
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: video ? { facingMode: "user" } : false, 
        audio: true 
      });
      localStreamRef.current = mediaStream;
      setLocalStreamState(mediaStream);
      
      const peer = new RTCPeerConnection({ 
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ] 
      });
      peerConnectionRef.current = peer;

      // Add a 20-second timeout to check if call connects
      const callTimer = setTimeout(() => {
        if (!callAccepted) {
            alert('Call timed out. The other person might be experiencing connection issues.');
            endCall();
        }
      }, 20000);
      window._callSetupTimer = callTimer;

      mediaStream.getTracks().forEach(track => peer.addTrack(track, mediaStream));

      peer.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('iceCandidate', { candidate: event.candidate });
        }
      };

      peer.ontrack = (event) => {
        setRemoteStreamState(event.streams[0]);
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socket.emit('callUser', { offer, isVideo: video });

    } catch (e) {
      console.error(e);
      alert('Could not access Camera or Microphone. Please grant OS permissions.');
      cleanupCall();
    }
  };

  const answerCall = async () => {
    setCallAccepted(true);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: isVideo ? { facingMode: "user" } : false, 
        audio: true 
      });
      localStreamRef.current = mediaStream;
      setLocalStreamState(mediaStream);
      
      const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      peerConnectionRef.current = peer;

      mediaStream.getTracks().forEach(track => peer.addTrack(track, mediaStream));

      peer.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('iceCandidate', { candidate: event.candidate });
        }
      };

      peer.ontrack = (event) => {
        setRemoteStreamState(event.streams[0]);
      };

      await peer.setRemoteDescription(new RTCSessionDescription(callerSignal));
      
      while(iceQueueRef.current.length > 0) {
        const c = iceQueueRef.current.shift();
        peer.addIceCandidate(new RTCIceCandidate(c)).catch(()=>{});
      }

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      
      socket.emit('answerCall', { answer });
    } catch (e) {
      console.error(e);
      alert('We could not read your camera/mic. Grant permission via browser.');
      cleanupCall();
      if(socket) socket.emit('endCall');
    }
  };

  const endCall = () => {
    cleanupCall();
    if (socket) socket.emit('endCall');
  };

  // Call WebRTC Options
  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideoLayer = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoDisabled(!videoTrack.enabled);
      }
    }
  };

  const switchCamera = async () => {
    if (!isVideo || !localStreamRef.current) return;
    try {
      const newMode = facingMode === "user" ? "environment" : "user";
      
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newMode },
        audio: true
      });

      localStreamRef.current.getTracks().forEach(track => track.stop());

      localStreamRef.current = newStream;
      setLocalStreamState(newStream);
      setFacingMode(newMode);

      if (isMuted) newStream.getAudioTracks()[0].enabled = false;
      if (isVideoDisabled) newStream.getVideoTracks()[0].enabled = false;

      if (peerConnectionRef.current) {
        const videoSender = peerConnectionRef.current.getSenders().find(s => s.track && s.track.kind === 'video');
        if (videoSender && newStream.getVideoTracks()[0]) {
          videoSender.replaceTrack(newStream.getVideoTracks()[0]);
        }
        const audioSender = peerConnectionRef.current.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (audioSender && newStream.getAudioTracks()[0]) {
          audioSender.replaceTrack(newStream.getAudioTracks()[0]);
        }
      }
    } catch (e) {
      console.error('Switch camera failed', e);
    }
  };


  const cancelEditOrReply = () => {
    setEditingMessage(null);
    setReplyingTo(null);
    setInputText('');
  };

  const deleteMsg = (id) => {
    if (window.confirm('Delete this message?')) {
      socket.emit('deleteMessageExplicit', id);
    }
  };

  const startEditMsg = (msg) => {
    setEditingMessage(msg);
    setInputText(msg.text);
    setReplyingTo(null);
  };

  const handleTouchStart = (e, msgId) => {
    touchRefs.current[msgId] = e.touches[0].clientX;
    
    // Check for long press
    longPressTimer.current = setTimeout(() => {
       const msg = messages.find(m => (m.id || m.index) === msgId);
       if (msg) setReactingTo(msg);
    }, 600);
  };

  const handleTouchEnd = (e, msg) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    
    const startX = touchRefs.current[msg.id];
    if (startX) {
      const endX = e.changedTouches[0].clientX;
      if (endX - startX > 50) {
        setReplyingTo(msg);
        setEditingMessage(null);
      }
      delete touchRefs.current[msg.id];
    }
  };

  const reactToMsg = (msgId, emoji) => {
    socket.emit('reactToMessage', { id: msgId, reaction: emoji });
    setReactingTo(null);
  };

  const updateProfilePic = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await axios.post(`${BACKEND_URL}/api/upload`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      socket.emit('updateProfilePic', res.data.url);
    } catch (err) {
      console.error(err);
    }
  };

  const renderProfilePic = (username, size = 40) => {
    const url = users[username];
    if (url) {
      return <img src={`${BACKEND_URL}${url}`} alt={username} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--accent)' }} />;
    }
    return (
       <div style={{ 
          width: size, height: size, borderRadius: '50%', background: 'var(--accent)', 
          display: 'flex', justifyContent: 'center', alignItems: 'center', fontWeight: 'bold', fontSize: size * 0.4
       }}>
         {username.charAt(0).toUpperCase()}
       </div>
    );
  };

  const formatLastSeen = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diff = (now - date) / 1000;
    
    if (diff < 60) return `last seen just now`;
    if (diff < 3600) return `last seen ${Math.floor(diff / 60)}m ago`;
    if (date.toDateString() === now.toDateString()) {
      return `last seen today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return `last seen on ${date.toLocaleDateString()}`;
  };

  const getPartnerStatus = () => {
     const partnerName = Object.keys(users).find(u => u !== user.username);
     if (!partnerName) return null;
     const statusInfo = statuses[partnerName];
     if (statusInfo?.status === 'online') return <span style={{ color: '#00cec9', fontWeight: 600 }}>Online</span>;
     return <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{formatLastSeen(statusInfo?.lastSeen)}</span>;
  };

  const getPartnerName = () => Object.keys(users).find(u => u !== user.username) || 'Partner';
  const getPartnerPic = () => renderProfilePic(getPartnerName(), 50);

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputText.trim() || !socket) return;
    
    if (editingMessage) {
      socket.emit('editMessage', { id: editingMessage.id, text: inputText });
      setEditingMessage(null);
    } else {
      const payload = { text: inputText, type: 'text' };
      if (replyingTo) {
        payload.replyTo = { 
          id: replyingTo.id, 
          sender: replyingTo.sender, 
          text: replyingTo.type === 'text' ? replyingTo.text : 
                (replyingTo.type === 'image' ? 'Image' : 'Attachment')
        };
      }
      socket.emit('sendMessage', payload);
    }
    
    setInputText('');
    setReplyingTo(null);
  };

  const uploadFile = async (fileObj, customType = null) => {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('file', fileObj);

    try {
      const res = await axios.post(`${BACKEND_URL}/api/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          Authorization: `Bearer ${token}`
        }
      });
      const { url, type, fileName } = res.data;
      socket.emit('sendMessage', { text: '', type: customType || type, attachmentUrl: url, fileName });
    } catch (err) {
      console.error("Failed to upload file", err);
      alert("Failed to upload file");
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFile(e.target.files[0]);
      e.target.value = null;
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        audioChunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        mediaRecorder.onstop = () => {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const file = new File([audioBlob], 'voice-message.webm', { type: 'audio/webm' });
          uploadFile(file, 'audio');
          stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        setIsRecording(true);
      } catch (err) {
        console.error("Microphone access denied or error:", err);
        alert("Cannot access microphone.");
      }
    }
  };

  const sendSticker = (url) => {
    socket.emit('sendMessage', { text: '', type: 'image', attachmentUrl: url, fileName: 'sticker' });
    setShowStickerPicker(false);
  };

  const handleLogout = () => {
    cleanupCall();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (socket) socket.close();
    navigate('/login');
  };

  const formatDateTime = (isoString) => {
    const safeString = isoString.endsWith('Z') ? isoString : isoString + 'Z';
    const date = new Date(safeString);
    if(isNaN(date.getTime())) return '';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const renderMessageContent = (msg) => {
    if (msg.type === 'image' && msg.attachment_url) {
      const src = msg.attachment_url.startsWith('http') ? msg.attachment_url : `${BACKEND_URL}${msg.attachment_url}`;
      return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <img src={src} alt="attachment" style={{ maxWidth: '100%', borderRadius: '12px' }} />
          {msg.text && <span style={{ marginTop: '8px' }}>{msg.text}</span>}
        </div>
      );
    } else if (msg.type === 'audio' && msg.attachment_url) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <audio controls src={`${BACKEND_URL}${msg.attachment_url}`} style={{ height: '40px', outline: 'none', maxWidth: '200px' }} />
        </div>
      );
    } else if (msg.type === 'file' && msg.attachment_url) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px' }}>
          <FileIcon size={24} />
          <a href={`${BACKEND_URL}${msg.attachment_url}`} download={msg.file_name} target="_blank" rel="noreferrer" style={{ color: 'white', textDecoration: 'none', wordBreak: 'break-all' }}>
             {msg.file_name || 'Download File'}
          </a>
        </div>
      );
    }
    return <span>{msg.text}</span>;
  };

  if (!user) return <div style={{ color: 'white' }}>Loading...</div>;

  return (
    <div className="chat-wrapper">
      {(calling || receivingCall) && (
        <div className="call-overlay">
          <div className="call-box" style={{ padding: callAccepted ? '20px' : '40px' }}>
            {!callAccepted && receivingCall ? (
              <div className="incoming-call">
                <PhoneIncoming size={48} className="pulse-icon" />
                <h3>{callerName} is calling...</h3>
                <p>{isVideo ? 'Video Call' : 'Voice Call'}</p>
                <div className="call-actions">
                  <button className="reject-btn" onClick={endCall}><PhoneOff size={24} /></button>
                  <button className="accept-btn" onClick={answerCall}><Phone size={24} /></button>
                </div>
              </div>
            ) : !callAccepted && calling ? (
              <div className="outgoing-call">
                <h3>Calling...</h3>
                <p>{isVideo ? 'Video' : 'Voice'}</p>
                <button className="reject-btn" onClick={endCall}><PhoneOff size={24} /></button>
              </div>
            ) : callAccepted ? (
              <div className="active-call">
                <div className={`video-container ${!isVideo ? 'voice-only' : ''}`}>
                  <video playsInline ref={remoteVideoRef} autoPlay className="remote-video" style={{ display: (isVideo && remoteStreamState?.getVideoTracks()?.length > 0) ? 'block' : 'none' }} />
                  <video playsInline ref={localVideoRef} autoPlay muted className="local-video" style={{ display: (isVideo && !isVideoDisabled) ? 'block' : 'none', transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }} />
                  {(!isVideo || isVideoDisabled || !remoteStreamState?.getVideoTracks()?.length) && <div className="voice-placeholder" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}><Mic size={64} className="pulse-icon" /></div>}
                </div>

                <div className="call-control-bar">
                  <button className={`call-btn ${isMuted ? 'off' : ''}`} onClick={toggleMute}>
                    {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                  </button>
                  {isVideo && (
                    <>
                      <button className={`call-btn ${isVideoDisabled ? 'off' : ''}`} onClick={toggleVideoLayer}>
                        {isVideoDisabled ? <VideoOff size={24} /> : <Video size={24} />}
                      </button>
                      <button className="call-btn" onClick={switchCamera}>
                        <RefreshCcw size={24} />
                      </button>
                    </>
                  )}
                  <button className="call-btn off" onClick={endCall}><PhoneOff size={24} /></button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div className={`chat-container ${theme === 'love' ? 'theme-love' : ''}`}>
        {theme === 'love' && (
          <div className="love-hearts">
            {heartsArray.current.map((_, i) => (
              <div 
                key={i} 
                className="heart-particle"
                style={{ 
                  left: `${Math.random() * 100}%`, 
                  top: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 5}s`,
                  fontSize: `${15 + Math.random() * 15}px`,
                  zIndex: 0
                }}
              >❤️</div>
            ))}
          </div>
        )}
        <div className="chat-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <div style={{ position: 'relative' }}>
                {getPartnerPic()}
                {statuses[getPartnerName()]?.status === 'online' && (
                  <div style={{ 
                    position: 'absolute', bottom: 3, right: 3, 
                    width: '12px', height: '12px', background: '#00cec9', 
                    borderRadius: '50%', border: '2px solid #2d3436',
                    boxShadow: '0 0 10px #00cec9'
                  }}></div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <h2 style={{ marginBottom: 0 }}>
                  <span style={{ fontSize: '1.4rem', fontWeight: 700 }}>{getPartnerName()}</span>
                </h2>
                <div style={{ marginTop: '2px' }}>
                  {getPartnerStatus()}
                </div>
              </div>
            </div>
            
            <div style={{ position: 'absolute', top: '10px', right: '50%', transform: 'translateX(50%)', opacity: 0.6 }}>
               <label style={{ cursor: 'pointer' }} title="Change Your Profile Picture">
                 {renderProfilePic(user.username, 30)}
                 <input type="file" onChange={updateProfilePic} style={{ display: 'none' }} accept="image/*" />
               </label>
            </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button 
               className={`icon-btn ${theme === 'love' ? 'active-theme' : ''}`} 
               onClick={() => setTheme(prev => prev === 'love' ? 'default' : 'love')} 
               title="Toggle Love Theme"
               style={{ color: theme === 'love' ? '#ff4d6d' : 'var(--text-secondary)' }}
            >
              <Heart size={20} fill={theme === 'love' ? '#ff4d6d' : 'none'} />
            </button>
            <button className="icon-btn" onClick={() => startCall(false)} title="Voice Call"><Phone size={20} /></button>
            <button className="icon-btn" onClick={() => startCall(true)} title="Video Call"><Video size={20} /></button>
            <button className="logout-btn" onClick={handleLogout}>
              <LogOut size={16} /> Exit
            </button>
          </div>
        </div>
        
        <div className="chat-messages">
          {messages.map((msg, index) => {
            const isMine = msg.sender === user.username;
            const isMenuOpen = activeMenu === (msg.id || index);
            
            const handleToggleMenu = (e) => {
              e.stopPropagation();
              setActiveMenu(isMenuOpen ? null : (msg.id || index));
            };

            return (
              <div 
                key={msg.id || index} 
                className={`message-wrapper ${isMine ? 'mine' : 'other'}`}
                onTouchStart={(e) => handleTouchStart(e, msg.id || index)}
                onTouchEnd={(e) => handleTouchEnd(e, {...msg, id: msg.id || index})}
                onContextMenu={(e) => { e.preventDefault(); setReactingTo(msg); }}
                style={{ zIndex: (isMenuOpen || reactingTo?.id === msg.id) ? 999 : 1, position: 'relative', display: 'flex', flexDirection: 'column' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-end', flexDirection: isMine ? 'row-reverse' : 'row' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start' }}>
                    <div className="message-bubble" style={{ position: 'relative', paddingRight: isMenuOpen || isMine ? '30px' : '18px' }}>
                      
                      <button onClick={handleToggleMenu} className={`msg-chevron ${isMenuOpen ? 'open' : ''}`}>
                        <ChevronDown size={14} />
                      </button>

                      {isMenuOpen && (
                        <div className="msg-dropdown" style={{ right: isMine ? '8px' : 'auto', left: isMine ? 'auto' : '8px', top: '35px' }} onClick={(e) => e.stopPropagation()}>
                          <button className="msg-dropdown-btn" onClick={() => { setReactingTo(msg); setActiveMenu(null); }}>React</button>
                          <button className="msg-dropdown-btn" onClick={() => { setReplyingTo(msg); setActiveMenu(null); }}>Reply</button>
                          {isMine && msg.type === 'text' && (
                            <button className="msg-dropdown-btn" onClick={() => { startEditMsg(msg); setActiveMenu(null); }}>Edit</button>
                          )}
                          {isMine && (
                            <button className="msg-dropdown-btn msg-dropdown-danger" onClick={() => { deleteMsg(msg.id); setActiveMenu(null); }}>Delete</button>
                          )}
                        </div>
                      )}

                      {reactingTo && reactingTo.id === msg.id && (
                        <div className="reaction-picker" style={{ left: isMine ? 'auto' : '0', right: isMine ? '0' : 'auto', top: index === 0 ? '45px' : '-55px' }} onClick={(e) => e.stopPropagation()}>
                           {['❤️', '😂', '😮', '😢', '🔥', '👍'].map(emoji => (
                             <span key={emoji} onClick={() => reactToMsg(msg.id, emoji)}>{emoji}</span>
                           ))}
                        </div>
                      )}

                      {msg.replyTo && (
                        <div style={{ backgroundColor: 'rgba(0,0,0,0.2)', padding: '5px 10px', borderRadius: '8px', marginBottom: '5px', fontSize: '0.85em', borderLeft: '3px solid var(--primary)' }}>
                          <strong style={{ display: 'block', color: 'var(--primary)' }}>{msg.replyTo.sender}</strong>
                          {msg.replyTo.text}
                        </div>
                      )}
                      {renderMessageContent(msg)}
                      {msg.isEdited && <div style={{ fontSize: '0.7em', color: 'gray', textAlign: 'right', marginTop: '4px' }}>(edited)</div>}

                      {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                        <div className="reactions-container">
                          {Object.entries(msg.reactions).map(([user, emoji]) => (
                            <span key={user} title={user}>{emoji}</span>
                          ))}
                        </div>
                      )}
                      
                      <div className="message-time" style={{ textAlign: isMine ? 'right' : 'left', marginTop: '6px', opacity: 0.8 }}>
                         {msg.timestamp ? formatDateTime(msg.timestamp) : ''}
                         {isMine && msg.status === 'read' && <CheckCheck size={14} color="#34B7F1" style={{marginLeft: 4, verticalAlign: 'text-bottom'}}/>}
                         {isMine && msg.status === 'delivered' && <CheckCheck size={14} color="grey" style={{marginLeft: 4, verticalAlign: 'text-bottom'}}/>}
                         {isMine && (!msg.status || msg.status === 'sent') && <Check size={14} color="grey" style={{marginLeft: 4, verticalAlign: 'text-bottom'}}/>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-area" style={{ position: 'relative' }}>
          
          {(replyingTo || editingMessage) && (
            <div style={{ position: 'absolute', top: '-45px', left: '10px', right: '10px', background: 'var(--glass-bg)', backdropFilter: 'blur(10px)', border: '1px solid var(--glass-border)', borderRadius: '8px', padding: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 10 }}>
              <div style={{ fontSize: '0.9rem', color: 'white' }}>
                {replyingTo && <div style={{ display:'flex', alignItems:'center' }}><ReplyIcon size={14} style={{ marginRight: '6px' }} /> Replying to <strong style={{ marginLeft: '4px' }}>{replyingTo.sender}</strong></div>}
                {editingMessage && <div style={{ display:'flex', alignItems:'center' }}><Edit2 size={14} style={{ marginRight: '6px' }} /> Editing message</div>}
              </div>
              <button type="button" onClick={cancelEditOrReply} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}><X size={16} /></button>
            </div>
          )}
          
          {showStickerPicker && (
            <div className="sticker-picker-container" style={{
               position: 'absolute', bottom: '80px', right: '10px', 
               background: 'var(--glass-bg)', backdropFilter: 'blur(16px)', 
               border: '1px solid var(--glass-border)', padding: '15px', 
               borderRadius: '16px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', 
               gap: '10px', maxHeight: '300px', overflowY: 'auto', width: '280px', zIndex: 100
            }}>
              {STICKERS.map(s => (
                 <img 
                    key={s.id} 
                    src={s.url} 
                    onClick={() => sendSticker(s.url)} 
                    style={{ width: '100%', height: '80px', objectFit: 'cover', borderRadius: '8px', cursor: 'pointer', backgroundColor: 'rgba(255,255,255,0.1)' }} 
                 />
              ))}
            </div>
          )}

          <button 
            type="button" 
            className="action-btn"
            onClick={() => setShowStickerPicker(!showStickerPicker)}
          >
            <Sticker size={20} />
          </button>

          <button 
            type="button" 
            className="action-btn"
            onClick={() => fileInputRef.current.click()}
          >
            <Paperclip size={20} />
          </button>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            style={{ display: 'none' }} 
          />

          <button 
            type="button" 
            className={`action-btn ${isRecording ? 'recording' : ''}`}
            onClick={toggleRecording}
          >
            {isRecording ? <Square size={20} color="#ff7675" fill="#ff7675" /> : <Mic size={20} />}
          </button>

          <form onSubmit={handleSend} style={{ display: 'flex', flex: 1, gap: '12px' }}>
            <input
              type="text"
              className="chat-input"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={isRecording ? 'Recording...' : 'Type a message...'}
              disabled={isRecording}
              autoFocus
            />
            <button 
              type="submit" 
              className="send-btn" 
              disabled={(!inputText.trim() && !isRecording) || isRecording}
            >
              <Send size={20} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Chat;
