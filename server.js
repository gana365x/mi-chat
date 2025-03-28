const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');

// 📁 Ruta al archivo de historial
const historyFilePath = path.join(__dirname, 'chatHistory.json');

// 🧠 Estado en memoria
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

// 📥 Cargar historial desde archivo
if (fs.existsSync(historyFilePath)) {
  const data = fs.readFileSync(historyFilePath, 'utf-8');
  try {
    Object.assign(chatHistory, JSON.parse(data));
  } catch (e) {
    console.error('Error al leer el historial:', e);
  }
}

// 💾 Guardar historial al archivo
function saveChatHistory() {
  fs.writeFileSync(historyFilePath, JSON.stringify(chatHistory, null, 2));
}

// 🚀 Manejo de conexiones
io.on('connection', (socket) => {
  socket.on('user joined', (data) => {
    let userId = data.userId;
    const username = data.username;
    if (!username) return;

    if (!userId) {
      userId = uuidv4();
    }

    // ✅ Siempre actualizamos el socket del usuario
    userSessions.set(userId, { username, socket });

    // ✅ Enviamos la sesión al cliente (esto guarda el userId en cookie)
    socket.emit('session', { userId, username });

    // ✅ Si no hay historial previo, lo iniciamos
    if (!chatHistory[userId]) chatHistory[userId] = [];

    // ✅ Actualizamos la lista de usuarios conectados
    const users = Array.from(userSessions.entries())
      .filter(([id, session]) => session.socket) // sólo usuarios con socket activo
      .map(([id, session]) => ({ userId: id, username: session.username }));
    io.emit('user list', users);
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

      const users = Array.from(userSessions.entries())
        .filter(([id, session]) => session.socket)
        .map(([id, session]) => ({ userId: id, username: session.username }));

      io.emit('user list', users);
      console.log(`✅ Nombre actualizado para el usuario ${userId}: ${newUsername}`);
    }
  });

  socket.on('admin connected', () => {
    socket.join('admins');
    const users = Array.from(userSessions.entries())
      .filter(([id, session]) => id && session.username)
      .map(([id, session]) => ({ userId: id, username: session.username }));
    socket.emit('user list', users);
  });

  socket.on('chat message', (data) => {
    if (!data.userId || !data.sender || !data.message) return;

    const messageData = { userId: data.userId, sender: data.sender, message: data.message };
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
        message: `1- Usar cuenta personal.\n\n2- Enviar comprobante visible.\n\nTITULAR CTA BANCARIA LEPRANCE SRL\n\nCBU\n0000156002555796327337\n\nALIAS\nleprance`
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
  </div>`
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
  });

  socket.on('image', (data) => {
    if (!data.userId || !data.sender || !data.image) return;
    const imageData = { userId: data.userId, sender: data.sender, image: data.image };
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
      message: '✅️¡Excelente! Recibido✅️<br>¡En menos de 5 minutos sus fichas serán acreditadas!'
    };
    chatHistory[data.userId].push(botResponse);
    saveChatHistory();
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
    saveChatHistory();

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

    if (userSessions.has(data.userId)) {
      const session = userSessions.get(data.userId);
      userSessions.set(data.userId, { ...session, socket: null });
    }

    const users = Array.from(userSessions.entries())
      .filter(([id, session]) => id && session.username)
      .map(([id, session]) => ({ userId: id, username: session.username }));
    io.emit('user list', users);
  });

  socket.on('disconnect', () => {
    adminSubscriptions.delete(socket.id);
    for (let [userId, session] of userSessions.entries()) {
      if (session.socket?.id === socket.id) {
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

app.use(express.static(__dirname));

// Ruta de login para admin
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

// --- SUPER ADMIN LOGIN ---
const agentsFilePath = path.join(__dirname, 'agents.json');
const superAdminUser = 'superadmin';
const superAdminPass = 'gana365super';

app.use(express.json());

// Crear archivo inicial si no existe
if (!fs.existsSync(agentsFilePath)) {
  fs.writeFileSync(agentsFilePath, JSON.stringify([]));
}

// Ruta de login del superadmin
app.post('/superadmin-login', (req, res) => {
  const { username, password } = req.body;
  if (username === superAdminUser && password === superAdminPass) {
    res.status(200).json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});

// Obtener lista de agentes
app.get('/agents', (req, res) => {
  const agents = JSON.parse(fs.readFileSync(agentsFilePath));
  res.json(agents);
});

// Crear nuevo agente
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

// Eliminar un agente
app.delete('/agents/:username', (req, res) => {
  let agents = JSON.parse(fs.readFileSync(agentsFilePath));
  const { username } = req.params;
  agents = agents.filter(a => a.username !== username);
  fs.writeFileSync(agentsFilePath, JSON.stringify(agents, null, 2));
  res.status(200).json({ success: true });
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
