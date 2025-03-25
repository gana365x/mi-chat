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

// Mapa para almacenar sesiones: { userId: { username, socket } }
const userSessions = new Map();
// Mapa para almacenar el historial de chats: { userId: [mensajes] }
const chatHistory = {};
// Mapa para almacenar qué administradores están viendo qué chats: { adminSocketId: userId }
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
    const messageData = { sender: data.sender, message: data.message };
    if (!chatHistory[data.userId]) {
      chatHistory[data.userId] = [];
    }
    chatHistory[data.userId].push(messageData);
    io.emit('chat message', messageData);

    // Enviar el mensaje solo a los administradores que están viendo este chat
    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        console.log(`Enviando mensaje a admin ${adminSocketId} para userId ${data.userId}:`, messageData);
        io.to(adminSocketId).emit('admin message', { userId: data.userId, ...messageData });
      }
    }

    if (data.message === 'Cargar Fichas') {
      const botMessage = { sender: 'Bot', message: 'TITULAR CTA BANCARIA PAGOSWON CBU 0000156303087805254500 ALIAS PAGOSWON.2' };
      chatHistory[data.userId].push(botMessage);
      io.emit('chat message', botMessage);
      for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
        if (subscribedUserId === data.userId) {
          console.log(`Enviando mensaje de bot a admin ${adminSocketId} para userId ${data.userId}:`, botMessage);
          io.to(adminSocketId).emit('admin message', { userId: data.userId, ...botMessage });
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
    const imageData = { sender: data.sender, image: data.image };
    if (!chatHistory[data.userId]) {
      chatHistory[data.userId] = [];
    }
    chatHistory[data.userId].push(imageData);
    io.emit('image', imageData);

    // Enviar la imagen solo a los administradores que están viendo este chat
    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        console.log(`Enviando imagen a admin ${adminSocketId} para userId ${data.userId}:`, imageData);
        io.to(adminSocketId).emit('admin image', { userId: data.userId, ...imageData });
      }
    }

    const botMessage = { 
      sender: 'Bot', 
      message: '✅️¡excelente! Recibido✅️\n\n¡En menos de\n\n5 minutos sus fichas\n\nserán acreditadas!\n\nen breve serán acreditadas.' 
    };
    chatHistory[data.userId].push(botMessage);
    io.emit('chat message', botMessage);
    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        console.log(`Enviando mensaje de bot a admin ${adminSocketId} para userId ${data.userId}:`, botMessage);
        io.to(adminSocketId).emit('admin message', { userId: data.userId, ...botMessage });
      }
    }
  });

  socket.on('agent message', (data) => {
    console.log('Mensaje del agente:', data);
    if (!data.userId || !data.message) {
      console.error('Mensaje del agente inválido, falta userId o message:', data);
      return;
    }
    const messageData = { sender: 'Agent', message: data.message };
    if (!chatHistory[data.userId]) {
      chatHistory[data.userId] = [];
    }
    chatHistory[data.userId].push(messageData);
    io.emit('chat message', { sender: 'Agent', message: data.message });
    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        console.log(`Enviando mensaje de agente a admin ${adminSocketId} para userId ${data.userId}:`, messageData);
        io.to(adminSocketId).emit('admin message', { userId: data.userId, ...messageData });
      }
    }
  });

  socket.on('request chat history', (data) => {
    console.log('Solicitud de historial para:', data);
    if (!data.userId) {
      console.error('Solicitud de historial inválida, falta userId:', data);
      return;
    }
    // Almacenar qué administrador está viendo qué chat
    adminSubscriptions.set(socket.id, data.userId);
    console.log('Suscripción actualizada:', Array.from(adminSubscriptions.entries()));
    const history = chatHistory[data.userId] || [];
    socket.emit('chat history', { userId: data.userId, messages: history });
  });

  socket.on('close chat', (data) => {
    console.log('Chat cerrado para:', data);
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
    console.log('Cliente desconectado:', socket.id);
    // Eliminar la suscripción del administrador
    adminSubscriptions.delete(socket.id);
    console.log('Suscripción eliminada:', Array.from(adminSubscriptions.entries()));
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
