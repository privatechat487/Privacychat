# ViRaj Connect - Private Chat App 🌴

Welcome to your completely private, real-time chat application! 

This app was custom-built specifically for you and your girlfriend. It uses local storage via SQLite, ensuring that none of your data ever leaves your computer or gets uploaded to the cloud.

## 🌟 Features
- **Total Privacy**: Everything is stored locally on your machine in `backend/chat.db`.
- **Strict Access**: The app ONLY allows exactly two people to ever register. Once two usernames are created, no one else can join.
- **Real-Time Messaging**: Built using WebSockets (Socket.IO) so messages appear instantly without refreshing.
- **Premium Aesthetics**: A stunning dark-mode interface utilizing glassmorphism effects, gradient backgrounds, and micro-animations.
- **Secure Authentication**: Your passcodes are encrypted using bcrypt, and sessions use secure JSON Web Tokens.

---

## 🚀 How to Run the App (if it's not already running)

To keep things perfectly secure and under your control, the system consists of a **Backend Server** and a **Frontend Web App**.

### 1. Start the Backend
Open a terminal and run:
\`\`\`bash
cd /home/rvimal/Desktop/Private_Chat/backend
npm run dev
\`\`\`
*(This runs on http://localhost:5000)*

### 2. Start the Frontend
Open a new terminal and run:
\`\`\`bash
cd /home/rvimal/Desktop/Private_Chat/frontend
npm run dev
\`\`\`
*(This typically runs on http://localhost:5173)*

### 3. Open in Browser
Go to [http://localhost:5173](http://localhost:5173).

---

## 🔒 Setup Instructions for First Use

1. **You and your girlfriend will each open the Website.**
2. **The first time you log in, the system registers you.** You simply type your name (e.g., "Romeo") and a secure Passcode, then click Enter.
3. Have your girlfriend do the same with her own Name and Passcode.
4. **Once 2 people have logged in**, the registration system permanently locks. No 3rd person can ever register or access the chats.

Enjoy your private ViRaj Connect space!
