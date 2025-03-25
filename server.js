// Evento 'chat message'
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
    const botMessage = { userId: data.userId, sender: 'Bot', message: 'TITULAR CTA BANCARIA PAGOSWON CBU 0000156303087805254500 ALIAS PAGOSWON.2' };
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

// Evento 'image'
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

// Evento 'agent message'
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
