import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, getDb } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'viraj-connect-secret-core-152712';

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    // Generate unique filename preserving original extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage });

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const httpServer = createServer(app);

// Optimize server for persistent connections to prevent 502 Bad Gateway
httpServer.keepAliveTimeout = 65000; 
httpServer.headersTimeout = 66000;

const io = new Server(httpServer, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']
});

// Middleware for Socket.io auth
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error'));
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

app.post('/api/login', async (req, res) => {
  const { username, passcode } = req.body;
  if (!username || !passcode) {
    return res.status(400).json({ error: 'Username and passcode required' });
  }

  try {
    const db = await getDb();
    let user = await db.get('SELECT * FROM users WHERE username = ?', [username]);

    if (!user) {
      // Check if there are already 2 users
      const { count } = await db.get('SELECT COUNT(*) as count FROM users');
      if (count >= 2) {
        return res.status(403).json({ error: 'Maximum users reached. Access denied.' });
      }

      // Create new user
      const hashedPasscode = await bcrypt.hash(passcode, 10);
      const result = await db.run('INSERT INTO users (username, passcode) VALUES (?, ?)', [username, hashedPasscode]);
      user = { id: result.lastID, username };
    } else {
      // Verify passcode
      const isValid = await bcrypt.compare(passcode, user.passcode);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid passcode' });
      }
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '365d' });
    res.json({ token, user: { id: user.id, username: user.username, profilePic: user.profile_pic } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No token provided' });
  
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  // Return the path relative to the backend URL
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ 
    url: fileUrl, 
    fileName: req.file.originalname,
    type: req.file.mimetype.startsWith('image/') ? 'image' 
          : req.file.mimetype.startsWith('audio/') ? 'audio' 
          : 'file'
  });
});

const ephemeralMessages = [];

app.get('/api/messages', authMiddleware, (req, res) => {
  res.json(ephemeralMessages);
});

app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    const db = await getDb();
    const users = await db.all('SELECT username, profile_pic, last_seen FROM users');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Serve frontend in production
const frontendPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendPath));

app.use((req, res, next) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

const onlineUsers = new Set();

io.on('connection', async (socket) => {
  const username = socket.user.username;
  console.log('User connected:', username);
  onlineUsers.add(username);
  
  // Broadcast that this user is online
  io.emit('statusUpdate', { username, status: 'online' });

  socket.on('sendMessage', async (msgData) => {
    // msgData: { text, type, attachmentUrl, fileName }
    try {
      const msgId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
      const text = msgData.text || '';
      const type = msgData.type || 'text';
      const attachmentUrl = msgData.attachmentUrl || null;
      const fileName = msgData.fileName || null;
      const replyTo = msgData.replyTo || null;

      const savedMessage = {
        id: msgId,
        text,
        type,
        attachment_url: attachmentUrl,
        file_name: fileName,
        replyTo,
        timestamp: new Date().toISOString(),
        sender: socket.user.username,
        status: 'sent'
      };
      
      ephemeralMessages.push(savedMessage);
      io.emit('receiveMessage', savedMessage);

      // Auto-delete after 3 minutes
      setTimeout(() => {
        const idx = ephemeralMessages.findIndex(m => m.id === msgId);
        if (idx !== -1) {
          ephemeralMessages.splice(idx, 1);
        }
        io.emit('deleteMessage', msgId);
        
        // Delete physical attachment if it exists
        if (attachmentUrl) {
          const filePath = path.join(__dirname, attachmentUrl);
          if (fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
            } catch(e) {}
          }
        }
      }, 3 * 60 * 1000);

    } catch (error) {
      console.error('Failed to process message', error);
    }
  });

  socket.on('editMessage', (data) => {
    const idx = ephemeralMessages.findIndex(m => m.id === data.id && m.sender === socket.user.username);
    if (idx !== -1 && ephemeralMessages[idx].type === 'text') {
      ephemeralMessages[idx].text = data.text;
      ephemeralMessages[idx].isEdited = true;
      io.emit('messageEdited', { id: data.id, text: data.text });
    }
  });

  socket.on('deleteMessageExplicit', (msgId) => {
    const idx = ephemeralMessages.findIndex(m => m.id === msgId && m.sender === socket.user.username);
    if (idx !== -1) {
      const msg = ephemeralMessages[idx];
      ephemeralMessages.splice(idx, 1);
      io.emit('deleteMessage', msgId);
      
      if (msg.attachment_url) {
        const filePath = path.join(__dirname, msg.attachment_url);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch(e) {}
        }
      }
    }
  });

  // WebRTC Signaling Channels
  socket.on('callUser', (data) => {
    // Assuming a 1-on-1 chat, find the other user
    const targetUsername = Array.from(onlineUsers).find(u => u !== username);

    if (targetUsername && onlineUsers.has(targetUsername)) {
      // If target is online, broadcast the call
      socket.broadcast.emit('callIncoming', { from: username, offer: data.offer, isVideo: data.isVideo });
    } else {
       // Log as a missed call message in DB
       getDb().then(db => {
         const msgText = `Missed ${data.isVideo ? 'Video' : 'Voice'} Call from ${username}`;
         // For simplicity, we'll store this as a system message.
         // In a real app, you might want a dedicated 'missed_calls' table or a more complex message structure.
         db.run('INSERT INTO messages (sender, text, type, timestamp, status) VALUES (?, ?, ?, ?, ?)', 
            [username, msgText, 'system', new Date().toISOString(), 'sent']);
         // Notify the sender that the person is offline
         socket.emit('callEnded', { reason: 'User offline' }); // Inform the caller that the call ended because the user is offline
       }).catch(e => console.error("Failed to log missed call:", e));
    }
  });

  socket.on('answerCall', (data) => {
    socket.broadcast.emit('callAccepted', data.answer);
  });

  socket.on('iceCandidate', (data) => {
    socket.broadcast.emit('iceCandidate', data.candidate);
  });

  socket.on('endCall', () => {
    socket.broadcast.emit('callEnded');
  });

  // Message Tracking (WhatsApp Tick system)
  socket.on('markDelivered', (msgId) => {
    const msg = ephemeralMessages.find(m => m.id === msgId);
    if (msg && msg.status !== 'read') {
      msg.status = 'delivered';
      io.emit('messageStatus', { id: msgId, status: 'delivered' });
    }
  });

  socket.on('markRead', (msgId) => {
    const msg = ephemeralMessages.find(m => m.id === msgId);
    if (msg && msg.status !== 'read') {
      msg.status = 'read';
      // Broadcast to everybody that this specific message was read
      io.emit('messageStatus', { id: msgId, status: 'read' });
    }
  });

  socket.on('reactToMessage', ({ id, reaction }) => {
    const msg = ephemeralMessages.find(m => m.id === id);
    if (msg) {
      if (!msg.reactions) msg.reactions = {};
      // If same reaction, toggle it off
      if (msg.reactions[socket.user.username] === reaction) {
        delete msg.reactions[socket.user.username];
      } else {
        msg.reactions[socket.user.username] = reaction;
      }
      io.emit('messageReaction', { id, reactions: msg.reactions });
    }
  });

  socket.on('updateProfilePic', async (url) => {
    try {
      const db = await getDb();
      await db.run('UPDATE users SET profile_pic = ? WHERE username = ?', [url, socket.user.username]);
      io.emit('userUpdate', { username: socket.user.username, profilePic: url });
    } catch (e) {
      console.error('Update profile pic failed', e);
    }
  });

  socket.on('disconnect', async () => {
    console.log('User disconnected:', username);
    onlineUsers.delete(username);
    const lastSeen = new Date().toISOString();
    
    try {
      const db = await getDb();
      await db.run('UPDATE users SET last_seen = ? WHERE username = ?', [lastSeen, username]);
    } catch(e) { console.error(e); }

    io.emit('statusUpdate', { username, status: 'offline', lastSeen });
  });

  socket.on('checkStatus', () => {
     // Let users check status explicitly on load
     const statuses = {};
     onlineUsers.forEach(u => statuses[u] = 'online');
     socket.emit('allStatuses', statuses);
  });
});

const PORT = process.env.PORT || 5000;
initDb().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
