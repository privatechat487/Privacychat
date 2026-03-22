import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import axios from 'axios';
import EmojiPicker from 'emoji-picker-react';
import { Send, LogOut, Paperclip, Mic, Square, File as FileIcon, Phone, Video, PhoneOff, PhoneIncoming, Smile, MicOff, VideoOff, RefreshCcw } from 'lucide-react';

const BACKEND_URL = import.meta.env.PROD ? '' : 'http://localhost:5000';

const Chat = () => {
  const [socket, setSocket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [user, setUser] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  
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
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    const storedUser = JSON.parse(localStorage.getItem('user'));
    
    if (!token || !storedUser) {
      navigate('/login');
      return;
    }
    
    setUser(storedUser);

    axios.get(`${BACKEND_URL}/api/messages`, {
      headers: { Authorization: `Bearer ${token}` }
    }).then(res => setMessages(res.data))
      .catch(err => console.error("Failed to load messages:", err));

    const newSocket = io(BACKEND_URL, {
      auth: { token }
    });

    newSocket.on('connect_error', (err) => {
      console.error('Socket connection error', err);
      if (err.message === 'Authentication error') {
        localStorage.removeItem('token');
        navigate('/login');
      }
    });

    newSocket.on('receiveMessage', (message) => {
      setMessages((prev) => [...prev, message]);
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

    setSocket(newSocket);

    window.stopCallingInternal = cleanupCall;

    return () => {
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


  const handleSend = (e) => {
    e.preventDefault();
    if (!inputText.trim() || !socket) return;
    socket.emit('sendMessage', { text: inputText, type: 'text' });
    setInputText('');
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

  const onEmojiClick = (emojiObj) => {
    setInputText(prev => prev + emojiObj.emoji);
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
      return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <img src={`${BACKEND_URL}${msg.attachment_url}`} alt="attachment" style={{ maxWidth: '100%', borderRadius: '12px' }} />
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
          <div className="call-box" style={{ padding: callAccepted ? '20px' : '40px'}}>
            {!callAccepted && receivingCall ? (
              <div className="incoming-call">
                <PhoneIncoming size={48} className="pulse-icon" />
                <h3>{callerName} is calling...</h3>
                <p>{isVideo ? 'Video Call' : 'Voice Call'}</p>
                <div className="call-actions">
                  <button className="reject-btn" onClick={endCall}><PhoneOff size={24}/></button>
                  <button className="accept-btn" onClick={answerCall}><Phone size={24}/></button>
                </div>
              </div>
            ) : !callAccepted && calling ? (
              <div className="outgoing-call">
                <h3>Calling...</h3>
                <p>{isVideo ? 'Video' : 'Voice'}</p>
                <button className="reject-btn" onClick={endCall}><PhoneOff size={24}/></button>
              </div>
            ) : callAccepted ? (
              <div className="active-call">
                <div className={`video-container ${!isVideo ? 'voice-only' : ''}`}>
                   <video playsInline ref={remoteVideoRef} autoPlay className="remote-video" style={{ display: (isVideo && remoteStreamState?.getVideoTracks()?.length > 0) ? 'block' : 'none' }} />
                   <video playsInline ref={localVideoRef} autoPlay muted className="local-video" style={{ display: (isVideo && !isVideoDisabled) ? 'block' : 'none', transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }} />
                   {(!isVideo || isVideoDisabled || !remoteStreamState?.getVideoTracks()?.length) && <div className="voice-placeholder" style={{display:'flex', justifyContent:'center', alignItems:'center', height:'100%'}}><Mic size={64} className="pulse-icon"/></div>}
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
                   <button className="call-btn off" onClick={endCall}><PhoneOff size={24}/></button>
                </div>

              </div>
            ) : null}
          </div>
        </div>
      )}

      <div className="chat-container">
        <div className="chat-header">
          <h2>
            <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>ViRaj Connect</span>
            <div className="status-dot"></div>
          </h2>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
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
            return (
              <div key={msg.id || index} className={`message-wrapper ${isMine ? 'mine' : 'other'}`}>
                {!isMine && <div className="message-sender">{msg.sender}</div>}
                <div className="message-bubble">{renderMessageContent(msg)}</div>
                <div className="message-time">{msg.timestamp ? formatDateTime(msg.timestamp) : ''}</div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-area" style={{ position: 'relative' }}>
          
          {showEmojiPicker && (
            <div className="emoji-picker-container">
              <EmojiPicker onEmojiClick={onEmojiClick} theme="dark" />
            </div>
          )}

          <button 
            type="button" 
            className="action-btn"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          >
            <Smile size={20} />
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
