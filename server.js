const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

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

const users = new Set();
const chatHistory = {};
const userSockets = new Map(); // Mapa para almacenar los sockets de los usuarios

app.use(express.static(__dirname));

io.on('connection', (socket) => {
  console.log('Nuevo cliente conectado:', socket.id);

  socket.on('admin connected', () => {
    console.log('Administrador conectado:', socket.id);
    socket.join('admins');
    socket.emit('user list', Array.from(users));
  });

  socket.on('user joined', (username) => {
    console.log('Usuario conectado:', username);
    users.add(username);
    if (!chatHistory[username]) {
      chatHistory[username] = [];
    }
    // Almacenar el socket del usuario
    userSockets.set(username, socket);
    io.emit('user list', Array.from(users));
  });

  socket.on('chat message', (data) => {
    console.log('Mensaje recibido:', data);
    if (!data.sender || !data.message) {
      console.error('Mensaje inválido, falta sender o message:', data);
      return;
    }
    const messageData = { sender: data.sender, message: data.message };
    if (!chatHistory[data.sender]) {
      chatHistory[data.sender] = [];
    }
    chatHistory[data.sender].push(messageData);
    io.emit('chat message', messageData);
    io.to('admins').emit('admin message', { username: data.sender, ...messageData });

    if (data.message === 'Cargar Fichas') {
      const botMessage = { sender: 'Bot', message: 'TITULAR CTA BANCARIA PAGOSWON CBU 0000156303087805254500 ALIAS PAGOSWON.2' };
      chatHistory[data.sender].push(botMessage);
      io.emit('chat message', botMessage);
      io.to('admins').emit('admin message', { username: data.sender, ...botMessage });
    }
  });

  socket.on('image', (data) => {
    console.log('Imagen recibida:', data);
    if (!data.sender || !data.image) {
      console.error('Imagen inválida, falta sender o image:', data);
      return;
    }
    const imageData = { sender: data.sender, image: data.image };
    if (!chatHistory[data.sender]) {
      chatHistory[data.sender] = [];
    }
    chatHistory[data.sender].push(imageData);
    io.emit('image', imageData);
    io.to('admins').emit('admin image', imageData);

    const botMessage = { 
      sender: 'Bot', 
      message: '✅️¡excelente! Recibido✅️\n\n¡En menos de\n\n5 minutos sus fichas\n\nserán acreditadas!\n\nen breve serán acreditadas.' 
    };
    chatHistory[data.sender].push(botMessage);
    io.emit('chat message', botMessage);
    io.to('admins').emit('admin message', { username: data.sender, ...botMessage });
  });

  socket.on('agent message', (data) => {
    console.log('Mensaje del agente:', data);
    if (!data.username || !data.message) {
      console.error('Mensaje del agente inválido, falta username o message:', data);
      return;
    }
    const messageData = { sender: 'Agent', message: data.message };
    if (!chatHistory[data.username]) {
      chatHistory[data.username] = [];
    }
    chatHistory[data.username].push(messageData);
    io.emit('chat message', { sender: 'Agent', message: data.message });
    io.to('admins').emit('admin message', { username: data.username, ...messageData });
  });

  socket.on('request chat history', (data) => {
    console.log('Solicitud de historial para:', data.username);
    if (!data.username) {
      console.error('Solicitud de historial inválida, falta username:', data);
      return;
    }
    const history = chatHistory[data.username] || [];
    socket.emit('chat history', { username: data.username, messages: history });
  });

  socket.on('close chat', (data) => {
    console.log('Chat cerrado para:', data.username);
    // Enviar el evento solo al cliente específico
    const userSocket = userSockets.get(data.username);
    if (userSocket) {
      userSocket.emit('chat closed', { username: data.username });
    }
    // Opcional: Eliminar al usuario de la lista de usuarios conectados
    users.delete(data.username);
    userSockets.delete(data.username);
    io.emit('user list', Array.from(users));
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
    // Opcional: Eliminar al usuario de la lista si se desconecta
    for (let [username, userSocket] of userSockets.entries()) {
      if (userSocket.id === socket.id) {
        users.delete(username);
        userSockets.delete(username);
        io.emit('user list', Array.from(users));
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
