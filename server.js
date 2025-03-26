
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
      .filter(([userId, session]) => userId && session.username)
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

    if (data.message === 'Cargar Fichas') {
      const botMsg = {
        userId: data.userId,
        sender: 'Bot',
        message: `1- Usar cuenta personal.

2- Enviar comprobante visible.

TITULAR CTA BANCARIA LEPRANCE SRL

CBU
0000156002555796327337

ALIAS
leprance`
      };
      chatHistory[data.userId].push(botMsg);
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
        <div class="fichas-bancarias" style="font-size: 12px;">
          <p><strong>PARA RETIRAR COMPLETAR DATOS:</strong> Usar cuenta bancaria propia</p>
          <p>👇👇👇</p>
          <p><strong>USUARIO:</strong> __________</p>
          <p><strong>MONTO A RETIRAR:</strong> __________</p>
          <p><strong>NOMBRE DE CTA BANCARIA:</strong> __________</p>
          <p><strong>CBU:</strong> __________</p>
          <p><strong>COMPROBANTE DE ÚLTIMA CARGA:</strong> __________</p>
        </div>`
      };
      chatHistory[data.userId].push(retiroMsg);
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

    const botResponse = {
      userId: data.userId,
      sender: 'Bot',
      message: '✅️¡excelente! Recibido✅️<br>¡En menos de 5 minutos sus fichas serán acreditadas!<br>En breve serán acreditadas.'
    };
    chatHistory[data.userId].push(botResponse);
    if (userSocket) userSocket.emit('chat message', botResponse);
    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        io.to(adminSocketId).emit('admin message', botResponse);
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
  if (userSocket) {
    userSocket.emit('chat closed', { userId: data.userId });
  }

  // No eliminamos el historial ni al usuario del mapa general
  // Solo lo sacamos de la lista de conectados si hace falta
  if (userSessions.has(data.userId)) {
    const session = userSessions.get(data.userId);
    userSessions.set(data.userId, { ...session, socket: null }); // desconectado pero persistente
  }

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
          .filter(([userId, session]) => userId && session.username)
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
