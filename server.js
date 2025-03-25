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
    const messageData = { userId: data.userId, sender: data.sender, message: data.message };
    if (!chatHistory[data.userId]) {
      chatHistory[data.userId] = [];
    }
    chatHistory[data.userId].push(messageData);

    // Enviar el mensaje solo al usuario que lo envió
    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) {
      userSocket.emit('chat message', messageData);
    } else {
      console.error('No se encontró el socket del usuario:', data.userId);
    }

    // Enviar el mensaje a los administradores suscritos
    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        console.log(`Enviando mensaje a admin ${adminSocketId} para userId ${data.userId}:`, messageData);
        io.to(adminSocketId).emit('admin message', messageData);
      }
    }

    // Respuesta del bot para "Cargar Fichas"
    if (data.message === 'Cargar Fichas') {
  const botMessage = { 
    userId: data.userId, 
    sender: 'Bot', 
    message: `1-U𝘴𝘢𝘳 cuenta 𝘱𝘦𝘳𝘴𝘰𝘯𝘢𝘭.\n\n2-Enviar 𝘤𝘰𝘮𝘱𝘳𝘰𝘣𝘢𝘯𝘵𝘦 𝘷𝘪𝘴𝘪𝘣𝘭𝘦.\n\nTITULAR CTA BANCARIA PAGOSWON\n\nCBU\n0000156003987805254500\n\nALIAS\nPagoswon.2`
  };
  ...
}
      };
      chatHistory[data.userId].push(botMessage);
      if (userSocket) {
        userSocket.emit('chat message', botMessage);
      }
      for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
        if (subscribedUserId === data.userId) {
          console.log(`Enviando mensaje de bot a admin ${adminSocketId} para userId ${data.userId}:`, botMessage);
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

    // Enviar la imagen solo al usuario que la envió
    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) {
      userSocket.emit('image', imageData);
    } else {
      console.error('No se encontró el socket del usuario:', data.userId);
    }

    // Enviar la imagen a los administradores suscritos
    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        console.log(`Enviando imagen a admin ${adminSocketId} para userId ${data.userId}:`, imageData);
        io.to(adminSocketId).emit('admin image', imageData);
      }
    }

    // Respuesta del bot
    const botMessage = { 
      userId: data.userId, 
      sender: 'Bot', 
      message: '✅️¡excelente! Recibido✅️\n\n¡En menos de\n\n5 minutos sus fichas\n\nserán acreditadas!\n\nen breve serán acreditadas.' 
    };
    chatHistory[data.userId].push(botMessage);
    if (userSocket) {
      userSocket.emit('chat message', botMessage);
    }
    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        console.log(`Enviando mensaje de bot a admin ${adminSocketId} para userId ${data.userId}:`, botMessage);
        io.to(adminSocketId).emit('admin message', botMessage);
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

    // Enviar el mensaje solo al usuario correspondiente
    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) {
      userSocket.emit('chat message', messageData);
    } else {
      console.error('No se encontró el socket del usuario:', data.userId);
    }

    // Enviar a los administradores suscritos
    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        console.log(`Enviando mensaje de agente a admin ${adminSocketId} para userId ${data.userId}:`, messageData);
        io.to(adminSocketId).emit('admin message', messageData);
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
