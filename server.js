
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

app.use(express.static(__dirname));

io.on('connection', (socket) => {
  console.log('Nuevo cliente conectado:', socket.id);

  socket.on('admin connected', () => {
    socket.join('admins');
    const users = Array.from(userSessions.entries())
      .filter(([userId, session]) => userId && session.username)
      .map(([userId, session]) => ({ userId, username: session.username }));
    socket.emit('user list', users);
  });

  socket.on('user joined', (data) => {
    const userId = data.userId || uuidv4();
    const username = data.username;
    if (!username) return;

    userSessions.set(userId, { username, socket });
    if (!chatHistory[userId]) chatHistory[userId] = [];
    socket.emit('session', { userId, username });

    const users = Array.from(userSessions.entries())
      .filter(([id, session]) => id && session.username)
      .map(([id, session]) => ({ userId: id, username: session.username }));
    io.emit('user list', users);
  });

  socket.on('chat message', (data) => {
    if (!data.userId || !data.sender || !data.message) return;
    const messageData = { userId: data.userId, sender: data.sender, message: data.message };
    if (!chatHistory[data.userId]) chatHistory[data.userId] = [];
    chatHistory[data.userId].push(messageData);

    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) userSocket.emit('chat message', messageData);

    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        io.to(adminSocketId).emit('admin message', messageData);
      }
    }

    // Bot respuesta a "Cargar Fichas"
    if (data.message === 'Cargar Fichas') {
      const botMessage = {
        userId: data.userId,
        sender: 'Bot',
        message: '1- Usar cuenta personal.
2- Enviar comprobante visible.
TITULAR CTA BANCARIA LEPRANSE SRL
CBU: 0000156002555796327337
ALIAS: leprance'
      };
      chatHistory[data.userId].push(botMessage);
      if (userSocket) userSocket.emit('chat message', botMessage);
      for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
        if (subscribedUserId === data.userId) {
          io.to(adminSocketId).emit('admin message', botMessage);
        }
      }
    }

    // Bot respuesta a "Retirar"
    if (data.message === 'Retirar') {
      const botMessage = {
        userId: data.userId,
        sender: 'Bot',
        message: 'PARA RETIRAR COMPLETAR DATOS:
Utilizar tu propia cuenta bancaria

👇👇👇
USUARIO:
MONTO A RETIRAR:
NOMBRE DE CTA BANCARIA:
CBU:
COMPROBANTE DE TU ULTIMA CARGA:'
      };
      chatHistory[data.userId].push(botMessage);
      if (userSocket) userSocket.emit('chat message', botMessage);
      for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
        if (subscribedUserId === data.userId) {
          io.to(adminSocketId).emit('admin message', botMessage);
        }
      }
    }
  });

  socket.on('image', (data) => {
    if (!data.userId || !data.sender || !data.image) return;
    const imageData = { userId: data.userId, sender: data.sender, image: data.image };
    if (!chatHistory[data.userId]) chatHistory[data.userId] = [];
    chatHistory[data.userId].push(imageData);

    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) userSocket.emit('image', imageData);
    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        io.to(adminSocketId).emit('admin image', imageData);
      }
    }

    const confirmMessage = {
      userId: data.userId,
      sender: 'Bot',
      message: '✅️¡excelente! Recibido✅️
¡En menos de 5 minutos sus fichas serán acreditadas!
En breve serán acreditadas.'
    };
    chatHistory[data.userId].push(confirmMessage);
    if (userSocket) userSocket.emit('chat message', confirmMessage);
    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        io.to(adminSocketId).emit('admin message', confirmMessage);
      }
    }
  });

  socket.on('agent message', (data) => {
    if (!data.userId || !data.message) return;
    const messageData = { userId: data.userId, sender: 'Agent', message: data.message };
    if (!chatHistory[data.userId]) chatHistory[data.userId] = [];
    chatHistory[data.userId].push(messageData);

    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) userSocket.emit('chat message', messageData);
    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        io.to(adminSocketId).emit('admin message', messageData);
      }
    }
  });

  socket.on('request chat history', (data) => {
    if (!data.userId) return;
    adminSubscriptions.set(socket.id, data.userId);
    const history = chatHistory[data.userId] || [];
    socket.emit('chat history', { userId: data.userId, messages: history });
  });

  socket.on('close chat', (data) => {
    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) userSocket.emit('chat closed', { userId: data.userId });
    userSessions.delete(data.userId);
    const users = Array.from(userSessions.entries())
      .filter(([id, session]) => id && session.username)
      .map(([id, session]) => ({ userId: id, username: session.username }));
    io.emit('user list', users);
  });

  socket.on('disconnect', () => {
    adminSubscriptions.delete(socket.id);
    for (let [userId, session] of userSessions.entries()) {
      if (session.socket.id === socket.id) {
        userSessions.delete(userId);
        const users = Array.from(userSessions.entries())
          .filter(([id, session]) => id && session.username)
          .map(([id, session]) => ({ userId: id, username: session.username }));
        io.emit('user list', users);
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
