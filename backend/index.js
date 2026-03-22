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
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  }
});

// Middleware for Socket.io auth
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error'));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
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

    const token = jwt.sign({ id: user.id, username: user.username }, process.env.JWT_SECRET);
    res.json({ token, user: { id: user.id, username: user.username } });
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
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
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

// Serve frontend in production
const frontendPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendPath));

app.use((req, res, next) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.user.username);

  socket.on('sendMessage', async (msgData) => {
    // msgData: { text, type, attachmentUrl, fileName }
    try {
      const msgId = Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
      const text = msgData.text || '';
      const type = msgData.type || 'text';
      const attachmentUrl = msgData.attachmentUrl || null;
      const fileName = msgData.fileName || null;

      const savedMessage = {
        id: msgId,
        text,
        type,
        attachment_url: attachmentUrl,
        file_name: fileName,
        timestamp: new Date().toISOString(),
        sender: socket.user.username
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

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.user.username);
  });
});

const PORT = process.env.PORT || 5000;
initDb().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});
