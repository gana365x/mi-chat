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
const configFilePath = path.join(__dirname, 'config.json');
const timezoneFile = path.join(__dirname, 'timezone.json');

// Función para obtener timestamp con zona horaria configurable
function getTimestamp() {
  const defaultTimezone = "America/Argentina/Buenos_Aires";
  let timezone = defaultTimezone;

  try {
    const data = fs.readFileSync(timezoneFile, 'utf-8');
    const config = JSON.parse(data);
    if (config.timezone) {
      timezone = config.timezone;
    }
  } catch (e) {
    console.error("❌ Error leyendo timezone.json:", e.message);
  }

  try {
    const now = new Date();
    const localTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    return localTime.toISOString();
  } catch (e) {
    console.error("❌ Error convirtiendo a zona horaria:", e.message);
    return new Date().toISOString();
  }
}

// Inicializar archivos si no existen
if (!fs.existsSync(historyFilePath)) fs.writeFileSync(historyFilePath, JSON.stringify({}));
if (!fs.existsSync(performanceFile)) fs.writeFileSync(performanceFile, JSON.stringify({}));
if (!fs.existsSync(agentsFilePath)) fs.writeFileSync(agentsFilePath, JSON.stringify([]));
if (!fs.existsSync(quickRepliesPath)) fs.writeFileSync(quickRepliesPath, JSON.stringify([]));
if (!fs.existsSync(timezoneFile)) fs.writeFileSync(timezoneFile, JSON.stringify({ timezone: "America/Argentina/Buenos_Aires" }, null, 2));

// Cargar historial de chat
try {
  const data = fs.readFileSync(historyFilePath, 'utf-8');
  Object.assign(chatHistory, JSON.parse(data));
} catch (e) {
  console.error('Error al leer el historial:', e);
}

function saveChatHistory() {
  fs.writeFileSync(historyFilePath, JSON.stringify(chatHistory, null, 2));
}

function incrementPerformance(agentUsername) {
  try {
    const data = JSON.parse(fs.readFileSync(performanceFile, 'utf-8'));
    if (!data[agentUsername]) data[agentUsername] = 0;
    data[agentUsername]++;
    fs.writeFileSync(performanceFile, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error al actualizar performance:', e);
  }
}

function getAllChatsSorted() {
  const users = Object.entries(chatHistory)
    .map(([userId, messages]) => {
      const username = userSessions.get(userId)?.username || 'Usuario';
      const validMessages = messages.filter(msg => msg.status !== 'closed');
      const lastValidMessage = validMessages[validMessages.length - 1];
      const lastMessageTime = lastValidMessage?.timestamp || new Date().toISOString(); // Enviar como string ISO
      const isClosed = messages.some(msg => msg.status === 'closed');
      return { userId, username, lastMessageTime, isClosed };
    })
    .sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime)); // Comparar como fechas
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
        timestamp: getTimestamp()
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

    const messageData = { userId: data.userId, sender: data.sender, message: data.message, timestamp: getTimestamp() };
    if (!chatHistory[data.userId]) chatHistory[data.userId] = [];
    chatHistory[data.userId].push(messageData);

    if (chatHistory[data.userId]) {
      // Si el chat estaba cerrado y el usuario vuelve a escribir
      const wasClosed = chatHistory[data.userId].some(msg => msg.status === 'closed');
      if (wasClosed) {
        // Removemos el estado cerrado para reactivar el chat
        chatHistory[data.userId] = chatHistory[data.userId].filter(msg => msg.status !== 'closed');

        // Enviamos un mensaje del sistema para marcar reapertura
        chatHistory[data.userId].push({
          userId: data.userId,
          sender: 'System',
          message: '🔄 El chat fue reabierto por el cliente',
          timestamp: getTimestamp()
        });

        saveChatHistory();
        io.emit('user list', getAllChatsSorted());
      }

      // Bloque original para 'Cargar Fichas' o 'Retirar'
      if (data.message === 'Cargar Fichas' || data.message === 'Retirar') {
        if (!chatHistory[data.userId]) chatHistory[data.userId] = [];
        chatHistory[data.userId].activeSession = true;
        saveChatHistory();
        io.emit('user list', getAllChatsSorted());
      } else {
        saveChatHistory();
      }
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
        timestamp: getTimestamp()
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
        timestamp: getTimestamp()
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
    const imageData = { userId: data.userId, sender: data.sender, image: data.image, timestamp: getTimestamp() };
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
      timestamp: getTimestamp()
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
    const messageData = { userId: data.userId, sender: 'Agent', message: data.message, timestamp: getTimestamp() };
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

  socket.on('request chat history', (data) => {
    if (!data.userId) return;
    adminSubscriptions.set(socket.id, data.userId);
    chatHistory[data.userId] = chatHistory[data.userId] || [];

    const lastMsg = chatHistory[data.userId][chatHistory[data.userId].length - 1];
    if (!lastMsg || lastMsg.message !== '💬 Chat abierto') {
      const openMsg = {
        sender: 'System',
        message: '💬 Chat abierto',
        timestamp: getTimestamp()
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
      userId,
      sender: 'System',
      message: '💬 Chat cerrado',
      timestamp: getTimestamp(),
      status: 'closed'
    };

    chatHistory[userId].push(closeMsg);
    saveChatHistory();

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

// Ruta actualizada para enviar el timezone al frontend
app.get('/get-timezone', (req, res) => {
  try {
    const data = fs.readFileSync(timezoneFile, 'utf-8');
    const config = JSON.parse(data);
    res.json({ timezone: config.timezone || "UTC" });
  } catch (e) {
    console.error('Error leyendo zona horaria:', e.message);
    res.json({ timezone: "UTC" });
  }
});

app.post('/update-timezone', (req, res) => {
  const { timezone } = req.body;
  if (!timezone || typeof timezone !== 'string') {
    return res.status(400).json({ success: false, message: "Zona inválida" });
  }

  // Validar que la zona horaria sea una de las permitidas
  const validTimezones = [
    "America/Argentina/Buenos_Aires",
    "America/Mexico_City",
    "America/Bogota",
    "Europe/Madrid",
    "UTC"
  ];

  if (!validTimezones.includes(timezone)) {
    return res.status(400).json({ success: false, message: "Zona horaria no válida" });
  }

  fs.writeFileSync(timezoneFile, JSON.stringify({ timezone }, null, 2));
  res.json({ success: true });
});

// Nueva ruta para estadísticas
app.get('/stats', (req, res) => {
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: 'Faltan parámetros from y to' });
  }

  try {
    const fromDate = new Date(from);
    const toDate = new Date(to);

    if (isNaN(fromDate) || isNaN(toDate)) {
      return res.status(400).json({ error: 'Fechas inválidas' });
    }

    const chatData = JSON.parse(fs.readFileSync(historyFilePath, 'utf-8'));

    let chatsClosed = 0;
    let messagesCount = 0;
    let cargarFichasCount = 0;
    let retirosCount = 0;
    let imagenesCount = 0;

    Object.keys(chatData).forEach(userId => {
      const messages = chatData[userId];
      const filteredMessages = messages.filter(msg => {
        const msgDate = new Date(msg.timestamp);
        return msgDate >= fromDate && msgDate <= toDate;
      });

      if (filteredMessages.some(msg => msg.status === 'closed')) {
        chatsClosed++;
      }

      messagesCount += filteredMessages.filter(
        msg => msg.sender === userSessions.get(userId)?.username || (!['Agent', 'System', 'Bot'].includes(msg.sender) && !msg.image)
      ).length;

      imagenesCount += filteredMessages.filter(
        msg => msg.image && !['Agent', 'System', 'Bot'].includes(msg.sender)
      ).length;

      cargarFichasCount += filteredMessages.filter(
        msg => msg.message === 'Cargar Fichas'
      ).length;

      retirosCount += filteredMessages.filter(
        msg => msg.message === 'Retirar'
      ).length;
    });

    res.json({
      chats: chatsClosed,
      messages: messagesCount,
      cargarFichas: cargarFichasCount,
      retiros: retirosCount,
      imagenes: imagenesCount
    });
  } catch (error) {
    console.error('Error al procesar estadísticas:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
