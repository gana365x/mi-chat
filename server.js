const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');

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

// ✅ Función de validación reutilizable
function validateAuthInput(username, password) {
  if (
    !username ||
    !password ||
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    username.length < 3 ||
    password.length < 4
  ) {
    return false;
  }
  return true;
}

// 🔒 MONGO CONNECTION
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://ganaadmin:ped1q2wzerA@cluster1.jpvbt6k.mongodb.net/gana365?retryWrites=true&w=majority&appName=Cluster1';

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('✅ Conectado a MongoDB Atlas');
})
.catch((err) => {
  console.error('❌ Error conectando a MongoDB:', err);
});

// ✅ AGENT SCHEMA
const agentSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  name: String,
  password: String,
  type: { type: String, default: 'agent' }
});

const Agent = mongoose.model('Agent', agentSchema);

// ✅ USERNAME SCHEMA PARA GUARDAR NOMBRES EDITADOS
const userNameSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  name: { type: String, required: true }
});

const UserName = mongoose.model('UserName', userNameSchema);

// ✅ PERFORMANCE SCHEMA
const performanceSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 }
});

const Performance = mongoose.model('Performance', performanceSchema);

// ✅ CHAT MESSAGE SCHEMA
const chatMessageSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  sender: { type: String, required: true },
  message: String,
  image: String,
  timestamp: { type: String, required: true },
  status: String,
  agentUsername: String,
  username: String
});

const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

// 📦 Variables locales
const userSessions = new Map();
const adminSubscriptions = new Map();

const quickRepliesPath = path.join(__dirname, 'quickReplies.json');
const timezoneFile = path.join(__dirname, 'timezone.json');

// 🕒 Función para timestamps con zona horaria
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

// Inicialización de archivos
if (!fs.existsSync(quickRepliesPath)) fs.writeFileSync(quickRepliesPath, JSON.stringify([]));
if (!fs.existsSync(timezoneFile)) fs.writeFileSync(timezoneFile, JSON.stringify({ timezone: "America/Argentina/Buenos_Aires" }, null, 2));

async function incrementPerformance(agentUsername) {
  try {
    await Performance.findOneAndUpdate(
      { username: agentUsername },
      { $inc: { count: 1 } },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error('❌ Error al actualizar performance en MongoDB:', err);
  }
}

async function getAllChatsSorted() {
  const lastMessages = await ChatMessage.aggregate([
    { $sort: { timestamp: -1 } },
    {
      $group: {
        _id: "$userId",
        lastMessage: { $first: "$$ROOT" }
      }
    }
  ]);

  const sortedChats = await Promise.all(lastMessages.map(async ({ _id, lastMessage }) => {
    const savedName = await UserName.findOne({ userId: _id });
    return {
      userId: _id,
      username: savedName?.name || lastMessage.username || userSessions.get(_id)?.username || 'Usuario',
      lastMessageTime: lastMessage.timestamp,
      isClosed: lastMessage.status === 'closed'
    };
  }));

  return sortedChats.sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
}

io.on('connection', (socket) => {
  socket.on('user joined', async (data) => {
    let userId = data.userId;
    let username = data.username;
    if (!username) return;

    if (!userId) {
      userId = uuidv4();
    }

    try {
      const savedName = await UserName.findOne({ userId });
      if (savedName) {
        username = savedName.name;
      }
    } catch (e) {
      console.error("❌ Error buscando nombre editado:", e.message);
    }

    userSessions.set(userId, { username, socket });
    socket.emit('session', { userId, username });

    const existingChat = await ChatMessage.findOne({ userId });
    if (!existingChat) {
      const dateMessage = {
        userId,
        sender: 'System',
        message: '💬 Chat iniciado',
        timestamp: getTimestamp(),
        username: username
      };
      await new ChatMessage(dateMessage).save();
    }
  });

  socket.on('update username', async ({ userId, newUsername }) => {
    if (userSessions.has(userId)) {
      const session = userSessions.get(userId);
      userSessions.set(userId, { ...session, username: newUsername });

      await ChatMessage.updateMany(
        { userId },
        { $set: { username: newUsername } }
      );

      const userSocket = session.socket;
      if (userSocket) {
        userSocket.emit('update username cookie', { newUsername });
      }

      io.emit('user list', await getAllChatsSorted());
      console.log(`✅ Nombre actualizado para el usuario ${userId}: ${newUsername}`);
    }
  });

  socket.on('admin connected', async () => {
    socket.join('admins');
    socket.emit('user list', await getAllChatsSorted());
  });

  socket.on('chat message', async (data) => {
    if (!data.userId || !data.sender || !data.message) return;

    const messageData = {
      userId: data.userId,
      sender: data.sender,
      message: data.message,
      timestamp: getTimestamp(),
      username: userSessions.get(data.userId)?.username || 'Usuario'
    };
    await new ChatMessage(messageData).save();

    const wasClosed = await ChatMessage.findOne({ userId: data.userId, status: 'closed' });
    if (wasClosed) {
      await ChatMessage.deleteMany({ userId: data.userId, status: 'closed' });
      const reopenMsg = {
        userId: data.userId,
        sender: 'System',
        message: '🔄 El chat fue reabierto por el cliente',
        timestamp: getTimestamp(),
        username: userSessions.get(data.userId)?.username || 'Usuario'
      };
      await new ChatMessage(reopenMsg).save();
      io.emit('user list', await getAllChatsSorted());
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
        timestamp: getTimestamp(),
        username: userSessions.get(data.userId)?.username || 'Usuario'
      };
      await new ChatMessage(botMsg).save();
      io.emit('user list', await getAllChatsSorted());
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
        timestamp: getTimestamp(),
        username: userSessions.get(data.userId)?.username || 'Usuario'
      };
      await new ChatMessage(retiroMsg).save();
      io.emit('user list', await getAllChatsSorted());
      if (userSocket) userSocket.emit('chat message', retiroMsg);
      for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
        if (subscribedUserId === data.userId) {
          io.to(adminSocketId).emit('admin message', retiroMsg);
        }
      }
    }
  });

  socket.on('image', async (data) => {
    if (!data.userId || !data.sender || !data.image) {
      console.error('Datos de imagen incompletos:', data);
      return;
    }
    const imageData = {
      userId: data.userId,
      sender: data.sender,
      image: data.image,
      timestamp: getTimestamp(),
      username: userSessions.get(data.userId)?.username || 'Usuario'
    };
    await new ChatMessage(imageData).save();

    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) {
      userSocket.emit('image', imageData);
    }

    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        io.to(adminSocketId).emit('admin image', imageData);
      }
    }

    const botResponse = {
      userId: data.userId,
      sender: 'Bot',
      message: '✅️¡Excelente! Recibido✅️<br>¡En menos de 5 minutos sus fichas serán acreditadas!',
      timestamp: getTimestamp(),
      username: userSessions.get(data.userId)?.username || 'Usuario'
    };
    await new ChatMessage(botResponse).save();
    if (userSocket) userSocket.emit('chat message', botResponse);
    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        io.to(adminSocketId).emit('admin message', botResponse);
      }
    }

    io.emit('user list', await getAllChatsSorted());
  });

  socket.on('agent message', async (data) => {
    if (!data.userId || !data.message) return;
    const messageData = {
      userId: data.userId,
      sender: 'Agent',
      message: data.message,
      timestamp: getTimestamp(),
      username: userSessions.get(data.userId)?.username || 'Usuario'
    };
    await new ChatMessage(messageData).save();

    const userSocket = userSessions.get(data.userId)?.socket;
    if (userSocket) userSocket.emit('chat message', messageData);

    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === data.userId) {
        io.to(adminSocketId).emit('admin message', messageData);
      }
    }

    io.emit('user list', await getAllChatsSorted());
  });

  socket.on('request chat history', async (data) => {
    if (!data.userId) return;
    adminSubscriptions.set(socket.id, data.userId);

    const lastMsg = await ChatMessage.findOne({ userId: data.userId }).sort({ timestamp: -1 });
    if (!lastMsg || lastMsg.message !== '💬 Chat abierto') {
      const openMsg = {
        userId: data.userId,
        sender: 'System',
        message: '💬 Chat abierto',
        timestamp: getTimestamp(),
        username: userSessions.get(data.userId)?.username || 'Usuario'
      };
      await new ChatMessage(openMsg).save();

      const userSocket = userSessions.get(data.userId)?.socket;
      if (userSocket) userSocket.emit('chat message', openMsg);

      for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
        if (subscribedUserId === data.userId) {
          io.to(adminSocketId).emit('admin message', openMsg);
        }
      }
    }

    const history = await ChatMessage.find({ userId: data.userId }).sort({ timestamp: 1 });
    socket.emit('chat history', { userId: data.userId, messages: history });
  });

  socket.on('close chat', async ({ userId, agentUsername }) => {
    const userSocket = userSessions.get(userId)?.socket;
    if (userSocket) {
      userSocket.emit('chat closed', { userId });
    }

    if (agentUsername) {
      await incrementPerformance(agentUsername);
    }

    if (userSessions.has(userId)) {
      const session = userSessions.get(userId);
      userSessions.set(userId, { ...session, socket: null });
    }

    const closeMsg = {
      userId,
      sender: 'System',
      message: '💬 Chat cerrado',
      timestamp: getTimestamp(),
      status: 'closed',
      agentUsername: agentUsername,
      username: userSessions.get(userId)?.username || 'Usuario'
    };
    await new ChatMessage(closeMsg).save();

    if (userSocket) {
      userSocket.emit('chat message', closeMsg);
    }

    for (let [adminSocketId, subscribedUserId] of adminSubscriptions.entries()) {
      if (subscribedUserId === userId) {
        io.to(adminSocketId).emit('admin message', closeMsg);
      }
    }

    io.emit('user list', await getAllChatsSorted());

    const history = await ChatMessage.find({ userId });
    io.emit('chat history', { userId, messages: history });
  });

  socket.on('disconnect', async () => {
    adminSubscriptions.delete(socket.id);
    for (let [userId, session] of userSessions.entries()) {
      if (session.socket?.id === socket.id) {
        userSessions.set(userId, { ...session, socket: null });
        io.emit('user list', await getAllChatsSorted());
        break;
      }
    }
  });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.post('/admin-login', (req, res) => {
  const { username, password } = req.body;
  return res.status(401).json({ success: false, message: 'Endpoint no configurado' });
});

app.post('/superadmin-login', async (req, res) => {
  const { username, password } = req.body;

  if (!validateAuthInput(username, password)) {
    return res.status(400).json({ success: false, message: 'Datos inválidos' });
  }

  try {
    const agent = await Agent.findOne({ username, type: 'superadmin' });
    if (!agent) {
      return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
    }

    const isMatch = await bcrypt.compare(password, agent.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
    }

    res.status(200).json({
      success: true,
      name: agent.name,
      type: agent.type
    });
  } catch (err) {
    console.error('❌ Error en login:', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

app.post('/agent-login', async (req, res) => {
  const { username, password } = req.body;

  if (!validateAuthInput(username, password)) {
    return res.status(400).json({ success: false, message: 'Datos inválidos' });
  }

  try {
    const agent = await Agent.findOne({ username });
    if (!agent) {
      return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
    }

    const isMatch = await bcrypt.compare(password, agent.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
    }

    res.status(200).json({ 
      success: true,
      username: agent.username,
      name: agent.name || agent.username,
      type: agent.type || 'agent'
    });
  } catch (err) {
    console.error('❌ Error en login de agente:', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

app.get('/agents', async (req, res) => {
  try {
    const agents = await Agent.find({}, 'username name type');
    const formattedAgents = agents.map(agent => ({
      username: agent.username,
      name: agent.name || agent.username,
      type: agent.type || 'agent'
    }));
    res.json(formattedAgents);
  } catch (err) {
    console.error('❌ Error al obtener agentes:', err);
    res.status(500).json({ success: false, message: 'Error al obtener agentes' });
  }
});

app.post('/agents', async (req, res) => {
  const { username, name, password, type = 'agent' } = req.body;

  if (!validateAuthInput(username, password) || (name && typeof name !== 'string') || (type && typeof type !== 'string')) {
    return res.status(400).json({ success: false, message: 'Datos inválidos' });
  }

  try {
    const existingAgent = await Agent.findOne({ username });
    if (existingAgent) {
      return res.status(400).json({ success: false, message: 'Ya existe ese usuario' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newAgent = new Agent({
      username,
      name,
      password: hashedPassword,
      type
    });

    await newAgent.save();
    res.status(201).json({ success: true, message: 'Agente creado exitosamente' });
  } catch (error) {
    console.error('❌ Error en la creación del agente:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

app.delete('/agents/:username', async (req, res) => {
  const { username } = req.params;

  try {
    const deleted = await Agent.findOneAndDelete({ username });

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Agente no encontrado' });
    }

    res.status(200).json({ success: true, message: 'Agente eliminado correctamente' });
  } catch (err) {
    console.error('❌ Error eliminando agente:', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

app.put('/agents/:username', async (req, res) => {
  const { username } = req.params;
  const { name, password, newUsername } = req.body;

  if ((!name && !password && !newUsername) || 
      (name && typeof name !== 'string') || 
      (password && typeof password !== 'string') || 
      (newUsername && typeof newUsername !== 'string')) {
    return res.status(400).json({ success: false, message: 'Datos inválidos' });
  }

  try {
    const agent = await Agent.findOne({ username });
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agente no encontrado' });
    }

    if (name) agent.name = name;
    if (newUsername) agent.username = newUsername;

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      agent.password = hashedPassword;
    }

    await agent.save();
    res.status(200).json({ success: true, message: 'Agente actualizado correctamente' });
  } catch (err) {
    console.error('❌ Error actualizando agente:', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

app.post('/update-username', async (req, res) => {
  const { userId, newUsername } = req.body;

  if (!userId || !newUsername) {
    return res.status(400).json({ success: false, message: 'Faltan datos' });
  }

  try {
    const existing = await UserName.findOne({ userId });

    if (existing) {
      existing.name = newUsername;
      await existing.save();
    } else {
      await UserName.create({ userId, name: newUsername });
    }

    io.emit('user name updated', { userId, newUsername });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('❌ Error al guardar nombre del usuario:', err);
    return res.status(500).json({ success: false, message: 'Error interno' });
  }
});

app.get('/performance', async (req, res) => {
  try {
    const allData = await Performance.find({});
    const result = {};

    allData.forEach(item => {
      result[item.username] = item.count;
    });

    res.json(result);
  } catch (err) {
    console.error('❌ Error al obtener performance:', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

app.get('/get-agent-displayname', async (req, res) => {
  const username = req.query.username;
  try {
    const agent = await Agent.findOne({ username });
    if (agent) {
      res.json({ name: agent.name || agent.username });
    } else {
      res.json({ name: username });
    }
  } catch (err) {
    console.error('❌ Error obteniendo nombre:', err);
    res.status(500).json({ name: username });
  }
});

app.post('/update-agent-name', async (req, res) => {
  const { username, newName } = req.body;

  if (!username || !newName || typeof username !== 'string' || typeof newName !== 'string') {
    return res.status(400).json({ success: false, message: 'Datos inválidos' });
  }

  try {
    const agent = await Agent.findOneAndUpdate(
      { username },
      { name: newName },
      { new: true }
    );
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Agente no encontrado' });
    }

    io.emit('agent name updated', { username, newName });
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('❌ Error actualizando nombre:', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

app.post('/update-agent-password', async (req, res) => {
  const { username, newPassword } = req.body;

  if (!username || !newPassword || typeof username !== 'string' || typeof newPassword !== 'string' ||
      newPassword.length < 4 || newPassword.length > 16) {
    return res.status(400).json({ success: false, message: 'Datos inválidos' });
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const agent = await Agent.findOneAndUpdate(
      { username },
      { password: hashedPassword },
      { new: true }
    );
    if (!agent) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('❌ Error actualizando contraseña:', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
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

app.get('/stats', async (req, res) => {
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

    const messages = await ChatMessage.find({
      timestamp: { $gte: fromDate.toISOString(), $lte: toDate.toISOString() }
    });

    let chatsClosed = 0;
    let messagesCount = 0;
    let cargarFichasCount = 0;
    let retirosCount = 0;
    let imagenesCount = 0;

    const userIds = [...new Set(messages.map(msg => msg.userId))];
    for (const userId of userIds) {
      const userMessages = messages.filter(msg => msg.userId === userId);
      if (userMessages.some(msg => msg.status === 'closed')) {
        chatsClosed++;
      }

      messagesCount += userMessages.filter(
        msg => msg.sender === userSessions.get(userId)?.username || (!['Agent', 'System', 'Bot'].includes(msg.sender) && !msg.image)
      ).length;

      imagenesCount += userMessages.filter(
        msg => msg.image && !['Agent', 'System', 'Bot'].includes(msg.sender)
      ).length;

      cargarFichasCount += userMessages.filter(
        msg => msg.message === 'Cargar Fichas'
      ).length;

      retirosCount += userMessages.filter(
        msg => msg.message === 'Retirar'
      ).length;
    }

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

app.get('/stats-agents', async (req, res) => {
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

    const closedMessages = await ChatMessage.find({
      status: 'closed',
      sender: 'System',
      timestamp: { $gte: fromDate.toISOString(), $lte: toDate.toISOString() }
    });

    const agentStatsMap = {};
    closedMessages.forEach(msg => {
      if (msg.agentUsername) {
        agentStatsMap[msg.agentUsername] = (agentStatsMap[msg.agentUsername] || 0) + 1;
      }
    });

    const agents = await Agent.find({}, 'username name');
    const agentStats = agents.map(agent => ({
      username: agent.username,
      name: agent.name || agent.username,
      finalizados: agentStatsMap[agent.username] || 0
    }));
    res.json(agentStats);
  } catch (error) {
    console.error('Error al procesar estadísticas por agente:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ✅ Iniciar servidor
server.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
