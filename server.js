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

function getActiveChatsSorted() {
  const activeUsers = [];

  for (let [userId, session] of userSessions.entries()) {
    const history = chatHistory[userId] || [];

    // Solo mostrar usuarios que enviaron mensajes
    const hasMessages = history.some(msg => msg.sender !== 'Bot');
    if (!hasMessages) continue;

    // Obtenemos el timestamp del último mensaje
    const lastMessageTime = history.length > 0 ? new Date(history[history.length - 1].timestamp || Date.now()) : new Date();

    activeUsers.push({
      userId,
      username: session.username,
      lastMessageTime,
      isClosed: !session.socket // Si no tiene socket activo, está cerrado
    });
  }

  // Ordenar del más nuevo al más viejo
  activeUsers.sort((a, b) => b.lastMessageTime - a.lastMessageTime);

  return activeUsers;
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

    if (!chatHistory[userId]) chatHistory[userId] = [];

    io.emit('user list', getActiveChatsSorted());
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

      io.emit('user list', getActiveChatsSorted());
      console.log(`✅ Nombre actualizado para el usuario ${userId}: ${newUsername}`);
    }
  });

  socket.on('admin connected', () => {
    socket.join('admins');
    socket.emit('user list', getActiveChatsSorted());
  });

  socket.on('chat message', (data) => {
    if (!data.userId || !data.sender || !data.message) return;

    const messageData = { userId: data.userId, sender: data.sender, message: data.message, timestamp: new Date().toISOString() };
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

    if (data.message === 'Cargar Fichas') {
      const botMsg = {
        userId: data.userId,
        sender: 'Bot',
        message: `1- Usar cuenta personal.\n\n2- Enviar comprobante visible.\n\nTITULAR CTA BANCARIA LEPRANCE SRL\n\nCBU\n0000156002555796327337\n\nALIAS\nleprance`,
        timestamp: new Date().toISOString()
      };
      chatHistory[data.userId].push(botMsg);
      saveChatHistory();
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
      if (userSocket) userSocket.emit('chat message', retiroMsg);
      for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
        if (subscribedUserId === data.userId) {
          io.to(adminSocketId).emit('admin message', retiroMsg);
        }
      }
    }

    io.emit('user list', getActiveChatsSorted());
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

    io.emit('user list', getActiveChatsSorted());
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

    io.emit('user list', getActiveChatsSorted());
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
      const session = userSessions.get(data.userId);
      userSessions.set(data.userId, { ...session, socket: null });
    }

    io.emit('user list', getActiveChatsSorted());
  });

  socket.on('disconnect', () => {
    adminSubscriptions.delete(socket.id);
    for (let [userId, session] of userSessions.entries()) {
      if (session.socket?.id === socket.id) {
        userSessions.set(userId, { ...session, socket: null });
        io.emit('user list', getActiveChatsSorted());
        break;
      }
    }
  });
});

app.use(express.static(__dirname));
app.use(express.json());

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'gana365';

app.post('/admin-login', (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    return res.status(200).json({ success: true });
  } else {
    return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
  }
});

const agentsFilePath = path.join(__dirname, 'agents.json');
const superAdminUser = 'superadmin';
const superAdminPass = 'gana365super';

if (!fs.existsSync(agentsFilePath)) {
  fs.writeFileSync(agentsFilePath, JSON.stringify([]));
}

app.post('/superadmin-login', (req, res) => {
  const { username, password } = req.body;
  if (username === superAdminUser && password === superAdminPass) {
    res.status(200).json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});

app.post('/agent-login', (req, res) => {
  const { username, password } = req.body;
  if (username === superAdminUser && password === superAdminPass) {
    return res.status(200).json({ superadmin: true });
  }

  const agents = JSON.parse(fs.readFileSync(agentsFilePath));
  const match = agents.find(a => a.username === username && a.password === password);

  if (match) {
    return res.status(200).json({ success: true });
  }

  return res.status(401).json({ success: false });
});

app.get('/agents', (req, res) => {
  const agents = JSON.parse(fs.readFileSync(agentsFilePath));
  res.json(agents);
});

app.post('/agents', (req, res) => {
  const agents = JSON.parse(fs.readFileSync(agentsFilePath));
  const { username, password } = req.body;
  if (agents.find(a => a.username === username)) {
    return res.status(400).json({ success: false, message: 'Ya existe ese usuario' });
  }
  agents.push({ username, password });
  fs.writeFileSync(agentsFilePath, JSON.stringify(agents, null, 2));
  res.status(200).json({ success: true });
});

app.delete('/agents/:username', (req, res) => {
  let agents = JSON.parse(fs.readFileSync(agentsFilePath));
  const { username } = req.params;
  agents = agents.filter(a => a.username !== username);
  fs.writeFileSync(agentsFilePath, JSON.stringify(agents, null, 2));
  res.status(200).json({ success: true });
});

app.get('/performance', (req, res) => {
  const data = JSON.parse(fs.readFileSync(performanceFile));
  res.json(data);
});

app.get('/get-agent-displayname', (req, res) => {
  const username = req.query.username;
  const agents = JSON.parse(fs.readFileSync(agentsFilePath));
  const found = agents.find(a => a.username === username);
  if (found) {
    res.json({ displayName: found.displayName || username });
  } else {
    res.json({ displayName: username });
  }
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
