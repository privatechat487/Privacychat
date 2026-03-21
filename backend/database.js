import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import bcrypt from 'bcryptjs';

const dbPromise = open({
  filename: './chat.db',
  driver: sqlite3.Database
});

export const initDb = async () => {
  const db = await dbPromise;
  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      passcode TEXT
    );
    
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER,
      text TEXT,
      type TEXT DEFAULT 'text',
      attachment_url TEXT,
      file_name TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sender_id) REFERENCES users(id)
    );
  `);
  
  return db;
};

export const getDb = () => dbPromise;
