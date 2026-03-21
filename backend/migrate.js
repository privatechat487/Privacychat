import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const migrate = async () => {
  const db = await open({
    filename: './chat.db',
    driver: sqlite3.Database
  });

  try {
    await db.exec('ALTER TABLE messages ADD COLUMN type TEXT DEFAULT "text"');
  } catch (e) {
    console.log('type column might exist', e.message);
  }
  
  try {
    await db.exec('ALTER TABLE messages ADD COLUMN attachment_url TEXT');
  } catch (e) {
    console.log('attachment_url column might exist', e.message);
  }
  
  try {
    await db.exec('ALTER TABLE messages ADD COLUMN file_name TEXT');
  } catch (e) {
    console.log('file_name column might exist', e.message);
  }

  console.log('Migration complete');
  await db.close();
};

migrate();
