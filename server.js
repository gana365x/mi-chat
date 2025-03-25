const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid'); // Importar la biblioteca uuid

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

const users = new Set(); // Lista de nombres de usuarios visibles
const chatHistory = {}; // Historial de chats por sessionId
const userSessions = new Map(); // Mapa de sessionId a { username, socket }

app.use(express.static(__dirname));

io.on('connection', (socket) => {
  console.log('Nuevo cliente conectado:', socket.id);

  socket.on('admin connected', () => {
    console.log('Administrador conectado:', socket.id);
    socket.join('admins');
    // Enviar solo los nombres de usuario al panel de administración
    socket.emit('user list', Array.from(users));
  });

  socket.on('user joined', (username) => {
    console.log('Usuario intenta unirse:', username);
    // Generar un ID de sesión único para este usuario
    const sessionId = uuidv4();
    console.log('ID de sesión generado:', sessionId);

    // Almacenar el nombre de usuario y el socket en userSessions
    userSessions.set(sessionId, { username, socket });
    users.add(username);

    // Crear un historial de chat para este sessionId
    if (!chatHistory[sessionId]) {
      chatHistory[sessionId] = [];
    }

    // Enviar el sessionId al cliente
    socket.emit('session assigned', { sessionId });

    // Actualizar la lista de usuarios en todos los clientes
    io.emit('user list', Array.from(users));
  });

  socket.on('chat message', (data) => {
    console.log('Mensaje recibido:', data);
    if (!data.sessionId || !data.sender || !data.message) {
      console.error('Mensaje inválido, falta sessionId, sender o message:', data);
      return;
    }
    const messageData = { sender: data.sender, message: data.message };
    if (!chatHistory[data.sessionId]) {
      chatHistory[data.sessionId] = [];
    }
    chatHistory[data.sessionId].push(messageData);
    // Enviar el mensaje a todos los clientes, incluyendo el sessionId
    io.emit('chat message', { sessionId: data.sessionId, ...messageData });
    io.to('admins').emit('admin message', { sessionId: data.sessionId, username: data.sender, ...messageData });

    if (data.message === 'Cargar Fichas') {
      const botMessage = { sender: 'Bot', message: 'TITULAR CTA BANCARIA PAGOSWON CBU 0000156303087805254500 ALIAS PAGOSWON.2' };
      chatHistory[data.sessionId].push(botMessage);
      io.emit('chat message', { sessionId: data.sessionId, ...botMessage });
      io.to('admins').emit('admin message', { sessionId: data.sessionId, username: data.sender, ...botMessage });
    }
  });

  socket.on('image', (data) => {
    console.log('Imagen recibida:', data);
    if (!data.sessionId || !data.sender || !data.image) {
      console.error('Imagen inválida, falta sessionId, sender o image:', data);
      return;
    }
    const imageData = { sender: data.sender, image: data.image };
    if (!chatHistory[data.sessionId]) {
      chatHistory[data.sessionId] = [];
    }
    chatHistory[data.sessionId].push(imageData);
    io.emit('image', { sessionId: data.sessionId, ...imageData });
    io.to('admins').emit('admin image', { sessionId: data.sessionId, username: data.sender, ...imageData });

    const botMessage = { 
      sender: 'Bot', 
      message: '✅️¡excelente! Recibido✅️\n\n¡En menos de\n\n5 minutos sus fichas\n\nserán acreditadas!\n\nen breve serán acreditadas.' 
    };
    chatHistory[data.sessionId].push(botMessage);
    io.emit('chat message', { sessionId: data.sessionId, ...botMessage });
    io.to('admins').emit('admin message', { sessionId: data.sessionId, username: data.sender, ...botMessage });
  });

  socket.on('agent message', (data) => {
    console.log('Mensaje del agente:', data);
    if (!data.sessionId || !data.username || !data.message) {
      console.error('Mensaje del agente inválido, falta sessionId, username o message:', data);
      return;
    }
    const messageData = { sender: 'Agent', message: data.message };
    if (!chatHistory[data.sessionId]) {
      chatHistory[data.sessionId] = [];
    }
    chatHistory[data.sessionId].push(messageData);
    io.emit('chat message', { sessionId: data.sessionId, ...messageData });
    io.to('admins').emit('admin message', { sessionId: data.sessionId, username: data.username, ...messageData });
  });

  socket.on('request chat history', (data) => {
    console.log('Solicitud de historial para:', data);
    if (!data.sessionId) {
      console.error('Solicitud de historial inválida, falta sessionId:', data);
      return;
    }
    const history = chatHistory[data.sessionId] || [];
    socket.emit('chat history', { sessionId: data.sessionId, messages: history });
  });

  socket.on('close chat', (data) => {
    console.log('Chat cerrado para:', data);
    const userSocket = userSessions.get(data.sessionId);
    if (userSocket) {
      userSocket.emit('chat closed', { sessionId: data.sessionId });
    }
    // Eliminar la sesión del usuario
    const userInfo = userSessions.get(data.sessionId);
    if (userInfo) {
      users.delete(userInfo.username);
      userSessions.delete(data.sessionId);
      delete chatHistory[data.sessionId];
    }
    io.emit('user list', Array.from(users));
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
    for (let [sessionId, userInfo] of userSessions.entries()) {
      if (userInfo.socket.id === socket.id) {
        users.delete(userInfo.username);
        userSessions.delete(sessionId);
        io.emit('user list', Array.from(users));
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
