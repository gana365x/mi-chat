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
    console.log('Administrador conectado:', socket.id);
    socket.join('admins');
    const users = Array.from(userSessions.entries())
      .filter(([userId, session]) => userId && session.username)
      .map(([userId, session]) => ({
        userId,
        username: session.username
      }));
    socket.emit('user list', users);
  });

  socket.on('user joined', (data) => {
    console.log('Usuario conectado:', data);
    const userId = data.userId || uuidv4();
    const username = data.username;

    if (!username) {
      console.error('Nombre de usuario vacío, no se puede registrar la sesión:', data);
      return;
    }

    userSessions.set(userId, { username, socket });
    if (!chatHistory[userId]) {
      chatHistory[userId] = [];
    }

    socket.emit('session', { userId, username });

    const users = Array.from(userSessions.entries())
      .filter(([userId, session]) => userId && session.username)
      .map(([id, session]) => ({
        userId: id,
        username: session.username
      }));
    io.emit('user list', users);
  });

  socket.on('chat message', (data) => {
    console.log('Mensaje recibido:', data);
    if (!data.userId || !data.sender || !data.message) {
      console.error('Mensaje inválido, falta userId, sender o message:', data);
      return;
    }
    const messageData = { userId: data.userId, sender: data.sender, message: data.message };
    if (!chatHistory[data.userId]) {
      chatHistory[data.userId] = [];
    }
    chatHistory[data.userId].push(messageData);

    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) {
      userSocket.emit('chat message', messageData);
    } else {
      console.error('No se encontró el socket del usuario:', data.userId);
    }

    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        console.log(`Enviando mensaje a admin ${adminSocketId} para userId ${data.userId}:`, messageData);
        io.to(adminSocketId).emit('admin message', messageData);
      }
    }

    if (data.message === 'Cargar Fichas') {
      const botMessage = { 
        userId: data.userId, 
        sender: 'Bot', 
        message: '1-Usar cuenta personal.\n\n2-Enviar comprobante visible.\n\nTITULAR CTA BANCARIA LEPRANSE SRL\n\nCBU\n0000156002555796327337\n\nALIAS\nleprance'
      };
      chatHistory[data.userId].push(botMessage);
      if (userSocket) {
        userSocket.emit('chat message', botMessage);
      }
      for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
        if (subscribedUserId === data.userId) {
          io.to(adminSocketId).emit('admin message', botMessage);
        }
      }
    }

    if (data.message === 'Retirar') {
      const botMessage = { 
        userId: data.userId, 
        sender: 'Bot', 
        message: 'PARA RETIRAR COMPLETAR\n\nDATOS:\n\nUtilizar tu propia cuenta bancaria\n\n\n\n👇👇👇\n\nUSUARIO :\n\nMONTO A RETIRAR :\n\nNOMBRE DE CTA BANCARIA :\n\nCBU:\n\nCOMPROBANTE DE TU ULTIMA CARGA :'
      };
      chatHistory[data.userId].push(botMessage);
      if (userSocket) {
        userSocket.emit('chat message', botMessage);
      }
      for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
        if (subscribedUserId === data.userId) {
          io.to(adminSocketId).emit('admin message', botMessage);
        }
      }
    }
  });

  socket.on('image', (data) => {
    console.log('Imagen recibida:', data);
    if (!data.userId || !data.sender || !data.image) {
      console.error('Imagen inválida, falta userId, sender o image:', data);
      return;
    }
    const imageData = { userId: data.userId, sender: data.sender, image: data.image };
    if (!chatHistory[data.userId]) {
      chatHistory[data.userId] = [];
    }
    chatHistory[data.userId].push(imageData);

    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) {
      userSocket.emit('image', imageData);
    }

    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        io.to(adminSocketId).emit('admin image', imageData);
      }
    }
  });

  socket.on('agent message', (data) => {
    console.log('Mensaje del agente:', data);
    if (!data.userId || !data.message) {
      console.error('Mensaje del agente inválido, falta userId o message:', data);
      return;
    }
    const messageData = { userId: data.userId, sender: 'Agent', message: data.message };
    if (!chatHistory[data.userId]) {
      chatHistory[data.userId] = [];
    }
    chatHistory[data.userId].push(messageData);

    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) {
      userSocket.emit('chat message', messageData);
    }

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
    userSessions.delete(data.userId);
    const users = Array.from(userSessions.entries())
      .filter(([userId, session]) => userId && session.username)
      .map(([id, session]) => ({
        userId: id,
        username: session.username
      }));
    io.emit('user list', users);
  });

  socket.on('disconnect', () => {
    adminSubscriptions.delete(socket.id);
    for (let [userId, session] of userSessions.entries()) {
      if (session.socket.id === socket.id) {
        userSessions.delete(userId);
        const users = Array.from(userSessions.entries())
          .filter(([userId, session]) => userId && session.username)
          .map(([id, session]) => ({
            userId: id,
            username: session.username
          }));
        io.emit('user list', users);
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
