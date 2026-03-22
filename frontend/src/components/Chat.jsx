import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import axios from 'axios';
import { Send, LogOut, Paperclip, Mic, Square, File as FileIcon } from 'lucide-react';

const BACKEND_URL = import.meta.env.PROD ? '' : 'http://localhost:5000';

const Chat = () => {
  const [socket, setSocket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [user, setUser] = useState(null);
  
  // Media states
  const fileInputRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

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

    setSocket(newSocket);

    return () => newSocket.close();
  }, [navigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      const finalType = customType || type;
      
      socket.emit('sendMessage', { 
        text: '', 
        type: finalType, 
        attachmentUrl: url, 
        fileName 
      });
    } catch (err) {
      console.error("Failed to upload file", err);
      alert("Failed to upload file");
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      uploadFile(file);
      // reset input
      e.target.value = null;
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      // Stop recording
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    } else {
      // Start recording
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
          // Stop all audio tracks
          stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        setIsRecording(true);
      } catch (err) {
        console.error("Microphone access denied or error:", err);
        alert("Cannot access microphone. Ensure permissions are granted.");
      }
    }
  };

  const handleLogout = () => {
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
      <div className="chat-container">
        <div className="chat-header">
          <h2>
            <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>ViRaj Connect</span>
            <div className="status-dot"></div>
          </h2>
          <button className="logout-btn" onClick={handleLogout}>
            <LogOut size={16} /> Exit
          </button>
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

        <div className="chat-input-area">
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
