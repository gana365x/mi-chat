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
const agentsFilePath = path.join(__dirname, 'agents.json');
const quickRepliesPath = path.join(__dirname, 'quickReplies.json');

// Inicializar archivos si no existen
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

if (!fs.existsSync(agentsFilePath)) {
  fs.writeFileSync(agentsFilePath, JSON.stringify([]));
}

if (!fs.existsSync(quickRepliesPath)) {
  fs.writeFileSync(quickRepliesPath, JSON.stringify([]));
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

// Función para obtener timestamp en GMT-3
function getGMT3Timestamp() {
  const now = new Date();
  const gmt3Date = new Date(now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
  return gmt3Date.toISOString();
}

function getAllChatsSorted() {
  const users = Object.entries(chatHistory)
    .map(([userId, messages]) => {
      const username = userSessions.get(userId)?.username || 'Usuario';
      const validMessages = messages.filter(msg => msg.status !== 'closed');
      const lastValidMessage = validMessages[validMessages.length - 1];
      const lastMessageTime = lastValidMessage?.timestamp ? new Date(lastValidMessage.timestamp) : new Date();
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
        sender: 'System',
        message: '💬 Chat iniciado',
        timestamp: getGMT3Timestamp()
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

    const messageData = { userId: data.userId, sender: data.sender, message: data.message, timestamp: getGMT3Timestamp() };
    if (!chatHistory[data.userId]) chatHistory[data.userId] = [];
    chatHistory[data.userId].push(messageData);

    if (chatHistory[data.userId]) {
  const wasClosed = chatHistory[data.userId].some(msg => msg.status === 'closed');

  if (wasClosed) {
    // Eliminar estado cerrado para reactivar el chat
    chatHistory[data.userId] = chatHistory[data.userId].filter(msg => msg.status !== 'closed');

    // Agregar mensaje de reapertura
    const openMsg = {
      userId: data.userId,
      sender: 'System',
      message: '💬 Chat abierto',
      timestamp: getGMT3Timestamp()
    };
    chatHistory[data.userId].push(openMsg);

    // ❌ NO lo enviamos al usuario (index.html)
    // ✅ Solo lo enviamos al admin
    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        io.to(adminSocketId).emit('admin message', openMsg);
      }
    }

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
        timestamp: getGMT3Timestamp()
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
          <div style="font-size:11px;font-family:'Segoe UI',sans-serif;color:#222;line-height:1.1;margin:0;padding:0;">
            <strong>1 - PARA RETIRAR COMPLETAR:</strong> Usar cuenta bancaria propia<br>
            👉👉👉<br>
            <strong>USUARIO:</strong> _____<br>
            <strong>MONTO A RETIRAR:</strong> _____<br>
            <strong>NOMBRE DE CTA BANCARIA:</strong> _____<br>
            <strong>CBU:</strong> _____<br>
            <strong>COMPROBANTE DE ÚLTIMA CARGA:</strong> _____
          </div>
        `,
        timestamp: getGMT3Timestamp()
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
    if (!data.userId || !data.sender || !data.image) {
      console.error('Datos de imagen incompletos:', data);
      return;
    }
    const imageData = { userId: data.userId, sender: data.sender, image: data.image, timestamp: getGMT3Timestamp() };
    if (!chatHistory[data.userId]) chatHistory[data.userId] = [];
    chatHistory[data.userId].push(imageData);
    saveChatHistory();

    console.log(`Imagen recibida del usuario ${data.userId}. Enviando a cliente y agentes...`);

    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) {
      userSocket.emit('image', imageData);
      console.log(`Imagen enviada al cliente ${data.userId}`);
    } else {
      console.log(`No se encontró socket de usuario para ${data.userId}`);
    }

    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        io.to(adminSocketId).emit('admin image', imageData);
        console.log(`Imagen enviada al agente con socket ${adminSocketId} para usuario ${data.userId}`);
      }
    }

    const botResponse = {
      userId: data.userId,
      sender: 'Bot',
      message: '✅️¡Excelente! Recibido✅️<br>¡En menos de 5 minutos sus fichas serán acreditadas!',
      timestamp: getGMT3Timestamp()
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
    const messageData = { userId: data.userId, sender: 'Agent', message: data.message, timestamp: getGMT3Timestamp() };
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

  // ... (todo tu código antes de llegar al bloque de "socket.on('request chat history')")

socket.on('request chat history', (data) => {
  if (!data.userId) return;
  adminSubscriptions.set(socket.id, data.userId);
  chatHistory[data.userId] = chatHistory[data.userId] || [];

  const lastMsg = chatHistory[data.userId][chatHistory[data.userId].length - 1];
  if (!lastMsg || lastMsg.message !== '💬 Chat abierto') {
    const openMsg = {
      sender: 'System',
      message: '💬 Chat abierto',
      timestamp: getGMT3Timestamp()
    };
    chatHistory[data.userId].push(openMsg);
    saveChatHistory();

    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) userSocket.emit('chat message', openMsg);

    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        io.to(adminSocketId).emit('admin message', openMsg);
      }
    }
  }

  const history = chatHistory[data.userId] || [];
  socket.emit('chat history', { userId: data.userId, messages: history });
});

socket.on('close chat', ({ userId, agentUsername }) => {
  const userSocket = userSessions.get(userId)?.socket;
  if (userSocket) {
    userSocket.emit('chat closed', { userId });
  }

  if (agentUsername) {
    incrementPerformance(agentUsername);
  }

  if (userSessions.has(userId)) {
    const session = userSessions.get(userId);
    userSessions.set(userId, { ...session, socket: null });
  }

  chatHistory[userId] = chatHistory[userId] || [];

  const closeMsg = {
    sender: 'System',
    message: '🔒 Chat cerrado',
    timestamp: getGMT3Timestamp(),
    status: 'closed'
  };
  chatHistory[userId].push(closeMsg);

  if (userSocket) {
    userSocket.emit('chat message', closeMsg);
  }

  for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
    if (subscribedUserId === userId) {
      io.to(adminSocketId).emit('admin message', closeMsg);
    }
  }

  if (chatHistory[userId]) {
    chatHistory[userId].activeSession = false;
  }

  saveChatHistory();
  io.emit('user list', getAllChatsSorted());

  io.emit('chat history', {
    userId,
    messages: chatHistory[userId]
  });
});

  socket.on('disconnect', () => {
    adminSubscriptions.delete(socket.id);
    for (let [userId, session] of userSessions.entries()) {
      if (session.socket?.id === socket.id) {
        userSessions.set(userId, { ...session, socket: null });
        io.emit('user list', getAllChatsSorted());
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

const superAdminUser = 'superadmin';
const superAdminPass = 'gana365super';

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

  const agents = JSON.parse(fs.readFileSync(agentsFilePath));
  const match = agents.find(a => a.username === username && a.password === password);

  if (match) {
    return res.status(200).json({ success: true });
  }

  return res.status(401).json({ success: false, message: 'Credenciales inválidas' });
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

app.post('/update-agent-name', (req, res) => {
  const { username, newName } = req.body;
  if (!username || !newName) {
    return res.status(400).json({ success: false, message: 'Faltan datos' });
  }

  const agents = JSON.parse(fs.readFileSync(agentsFilePath));
  const index = agents.findIndex(a => a.username === username);

  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Agente no encontrado' });
  }

  agents[index].displayName = newName;
  fs.writeFileSync(agentsFilePath, JSON.stringify(agents, null, 2));
  res.status(200).json({ success: true });
});

app.post('/update-agent-password', (req, res) => {
  const { username, newPassword } = req.body;

  if (!username || !newPassword || newPassword.length < 4 || newPassword.length > 16) {
    return res.status(400).json({ success: false, message: 'Contraseña inválida' });
  }

  const agents = JSON.parse(fs.readFileSync(agentsFilePath));
  const index = agents.findIndex(agent => agent.username === username);

  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
  }

  agents[index].password = newPassword;
  fs.writeFileSync(agentsFilePath, JSON.stringify(agents, null, 2));

  return res.status(200).json({ success: true });
});

app.get('/quick-replies', (req, res) => {
  fs.readFile(quickRepliesPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json([]);
    try {
      const replies = JSON.parse(data);
      res.json(replies);
    } catch (e) {
      res.status(500).json([]);
    }
  });
});

app.post('/quick-replies', express.json(), (req, res) => {
  const replies = req.body;
  if (!Array.isArray(replies)) {
    return res.status(400).json({ success: false, message: "Formato incorrecto" });
  }

  fs.writeFileSync(quickRepliesPath, JSON.stringify(replies, null, 2));
  res.json({ success: true });
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
