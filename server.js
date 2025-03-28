const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

const PORT = process.env.PORT || 3000;
const userSessions = new Map();
const chatHistory = {};
const adminSubscriptions = new Map();

const historyFilePath = path.join(__dirname, 'chatHistory.json');
const performanceFile = path.join(__dirname, 'performance.json');

if (fs.existsSync(historyFilePath)) {
  const data = fs.readFileSync(historyFilePath, 'utf-8');
  try {
    Object.assign(chatHistory, JSON.parse(data));
  } catch (e) {
    console.error('Error al leer el historial:', e);
  }
}

if (!fs.existsSync(performanceFile)) {
  fs.writeFileSync(performanceFile, JSON.stringify({}));
}

function saveChatHistory() {
  fs.writeFileSync(historyFilePath, JSON.stringify(chatHistory, null, 2));
}

function incrementPerformance(agentUsername) {
  const data = JSON.parse(fs.readFileSync(performanceFile));
  if (!data[agentUsername]) data[agentUsername] = 0;
  data[agentUsername]++;
  fs.writeFileSync(performanceFile, JSON.stringify(data, null, 2));
}

function getAllChatsSorted() {
  const users = Object.entries(chatHistory)
    .map(([userId, messages]) => {
      const username = userSessions.get(userId)?.username || 'Usuario';

      const lastMessage = messages[messages.length - 1];
      const lastMessageTime = lastMessage?.timestamp ? new Date(lastMessage.timestamp) : new Date();

      const isClosed = messages.some(msg => msg.status === 'closed');

      return { userId, username, lastMessageTime, isClosed };
    })
    .sort((a, b) => b.lastMessageTime - a.lastMessageTime);

  return users;
}

io.on('connection', (socket) => {
  socket.on('user joined', (data) => {
    let userId = data.userId;
    const username = data.username;
    if (!username) return;

    if (!userId) {
      userId = uuidv4();
    }

    userSessions.set(userId, { username, socket });
    socket.emit('session', { userId, username });

    if (!chatHistory[userId]) {
      chatHistory[userId] = [];
      const dateMessage = {
        userId,
        sender: 'system',
        message: `📅 Chat iniciado el ${new Date().toLocaleDateString()}`,
        timestamp: new Date().toISOString()
      };
      chatHistory[userId].push(dateMessage);
      saveChatHistory();
    }
  });

  socket.on('update username', ({ userId, newUsername }) => {
    if (userSessions.has(userId)) {
      const session = userSessions.get(userId);
      userSessions.set(userId, { ...session, username: newUsername });

      if (chatHistory[userId]) {
        chatHistory[userId] = chatHistory[userId].map(msg => ({
          ...msg,
          username: newUsername
        }));
      }

      saveChatHistory();

      const userSocket = session.socket;
      if (userSocket) {
        userSocket.emit('update username cookie', { newUsername });
      }

      io.emit('user list', getAllChatsSorted());
      console.log(`✅ Nombre actualizado para el usuario ${userId}: ${newUsername}`);
    }
  });

  socket.on('admin connected', () => {
    socket.join('admins');
    socket.emit('user list', getAllChatsSorted());
  });

  socket.on('chat message', (data) => {
    if (!data.userId || !data.sender || !data.message) return;

    const messageData = { userId: data.userId, sender: data.sender, message: data.message, timestamp: new Date().toISOString() };
    if (!chatHistory[data.userId]) chatHistory[data.userId] = [];
    chatHistory[data.userId].push(messageData);

    // Si el chat estaba cerrado y vuelve a escribir, lo reactivamos
    if (chatHistory[data.userId]) {
      const wasClosed = chatHistory[data.userId].some(msg => msg.status === 'closed');
      if (wasClosed) {
        // 🔁 Quitamos la marca de cierre anterior
        chatHistory[data.userId] = chatHistory[data.userId].filter(msg => msg.status !== 'closed');
        
        // 🔄 Y reenviamos el listado actualizado a los admins
        io.emit('user list', getAllChatsSorted());
      }
    }

    if (data.message === 'Cargar Fichas' || data.message === 'Retirar') {
      if (!chatHistory[data.userId]) chatHistory[data.userId] = [];
      chatHistory[data.userId].activeSession = true;
      saveChatHistory();
      io.emit('user list', getAllChatsSorted());
    } else {
      saveChatHistory();
    }

    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) userSocket.emit('chat message', messageData);

    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        io.to(adminSocketId).emit('admin message', messageData);
      }
    }

    if (data.message === 'Cargar Fichas') {
      const botMsg = {
        userId: data.userId,
        sender: 'Bot',
        message: `1- Usar cuenta personal.\n\n2- Enviar comprobante visible.\n\nTITULAR CTA BANCARIA LEPRANCE SRL\n\nCBU\n0000156002555796327337\n\nALIAS\nleprance`,
        timestamp: new Date().toISOString()
      };
      chatHistory[data.userId].push(botMsg);
      saveChatHistory();
      io.emit('user list', getAllChatsSorted());
      if (userSocket) userSocket.emit('chat message', botMsg);
      for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
        if (subscribedUserId === data.userId) {
          io.to(adminSocketId).emit('admin message', botMsg);
        }
      }
    }

    if (data.message === 'Retirar') {
      const retiroMsg = {
        userId: data.userId,
        sender: 'Bot',
        message: `
  <div style="font-size: 13px; line-height: 1.2; font-family: 'Segoe UI', sans-serif; color: #222;">
    <div style="margin-bottom: 6px;"><strong>1 - PARA RETIRAR COMPLETAR:</strong> Usar cuenta bancaria propia</div>
    <div style="margin: 4px 0;">👉👉👉</div>
    <div><strong>USUARIO:</strong> __________</div>
    <div><strong>MONTO A RETIRAR:</strong> __________</div>
    <div><strong>NOMBRE DE CTA BANCARIA:</strong> __________</div>
    <div><strong>CBU:</strong> __________</div>
    <div><strong>COMPROBANTE DE ÚLTIMA CARGA:</strong> __________</div>
  </div>`,
        timestamp: new Date().toISOString()
      };
      chatHistory[data.userId].push(retiroMsg);
      saveChatHistory();
      io.emit('user list', getAllChatsSorted());
      if (userSocket) userSocket.emit('chat message', retiroMsg);
      for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
        if (subscribedUserId === data.userId) {
          io.to(adminSocketId).emit('admin message', retiroMsg);
        }
      }
    }
  });

  socket.on('image', (data) => {
    if (!data.userId || !data.sender || !data.image) return;
    const imageData = { userId: data.userId, sender: data.sender, image: data.image, timestamp: new Date().toISOString() };
    if (!chatHistory[data.userId]) chatHistory[data.userId] = [];
    chatHistory[data.userId].push(imageData);
    saveChatHistory();

    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) userSocket.emit('image', imageData);

    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        io.to(adminSocketId).emit('admin image', imageData);
      }
    }

    const botResponse = {
      userId: data.userId,
      sender: 'Bot',
      message: '✅️¡Excelente! Recibido✅️<br>¡En menos de 5 minutos sus fichas serán acreditadas!',
      timestamp: new Date().toISOString()
    };
    chatHistory[data.userId].push(botResponse);
    saveChatHistory();
    if (userSocket) userSocket.emit('chat message', botResponse);
    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        io.to(adminSocketId).emit('admin message', botResponse);
      }
    }

    io.emit('user list', getAllChatsSorted());
  });

  socket.on('agent message', (data) => {
    if (!data.userId || !data.message) return;
    const messageData = { userId: data.userId, sender: 'Agent', message: data.message, timestamp: new Date().toISOString() };
    if (!chatHistory[data.userId]) chatHistory[data.userId] = [];
    chatHistory[data.userId].push(messageData);
    saveChatHistory();

    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) userSocket.emit('chat message', messageData);

    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        io.to(adminSocketId).emit('admin message', messageData);
      }
    }

    io.emit('user list', getAllChatsSorted());
  });

  socket.on('request chat history', (data) => {
    if (!data.userId) return;
    adminSubscriptions.set(socket.id, data.userId);
    const history = chatHistory[data.userId] || [];
    socket.emit('chat history', { userId: data.userId, messages: history });
  });

  socket.on('close chat', (data) => {
    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) {
      userSocket.emit('chat closed', { userId: data.userId });
    }

    if (data.agentUsername) {
      incrementPerformance(data.agentUsername);
    }

    if (userSessions.has(data.userId)) {
      const session = userSessions
