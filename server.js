require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const admin = require('firebase-admin');

// Inicializar Firebase Admin SDK
// Em produção, use um arquivo de credenciais seguro
const serviceAccount = {
  // Aqui iriam as credenciais do Firebase
  // Em produção, isso seria carregado de variáveis de ambiente ou arquivo seguro
};

// Inicializar Firebase (em produção, use credenciais reais)
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || "https://enigma-forense-default-rtdb-default-rtdb.firebaseio.com"
  });
} catch (error) {
  // Para desenvolvimento, inicializar com configuração simulada
  console.log("Usando configuração simulada do Firebase para desenvolvimento");
  admin.initializeApp({
    projectId: 'enigma-enigma-forense-default-rtdb',
    databaseURL: 'https://enigma-forense-default-rtdb-default-rtdb.firebaseio.com'
  });
}

const db = admin.database();
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Variáveis para armazenar contadores
let activeUsers = 0;
let activatedEnigmas = 0;
let solvedEnigmas = 0;

// Middleware para verificar VPN
const checkVpn = async (req, res, next) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    
    // Em produção, use uma API real como IPQualityScore
    // const apiKey = process.env.IPQUALITYSCORE_API_KEY;
    // const response = await axios.get(`https://www.ipqualityscore.com/api/json/ip/${apiKey}/${ip}`);
    
    // Simulação para desenvolvimento
    const isVpn = Math.random() < 0.05; // 5% de chance de ser VPN
    
    if (isVpn) {
      return res.status(403).json({ error: 'VPN ou Tor detectado. Acesso bloqueado.' });
    }
    
    next();
  } catch (error) {
    console.error('Erro ao verificar VPN:', error);
    next(); // Em caso de erro, permitir acesso
  }
};

// Rotas da API
app.get('/api/stats', checkVpn, async (req, res) => {
  try {
    // Em produção, buscar dados reais do Firebase
    const statsRef = db.ref('stats');
    const snapshot = await statsRef.once('value');
    const stats = snapshot.val() || { activeUsers, activatedEnigmas, solvedEnigmas };
    
    res.json(stats);
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

app.post('/api/register-user', checkVpn, async (req, res) => {
  try {
    const { deviceFingerprint } = req.body;
    const userId = uuidv4();
    
    // Verificar se o dispositivo já está registrado
    const usersRef = db.ref('users');
    const snapshot = await usersRef.orderByChild('fingerprint').equalTo(deviceFingerprint).once('value');
    
    if (snapshot.exists()) {
      // Usuário já registrado
      const userData = Object.values(snapshot.val())[0];
      return res.json({ userId: userData.id, isNew: false });
    }
    
    // Registrar novo usuário
    await usersRef.child(userId).set({
      id: userId,
      fingerprint: deviceFingerprint,
      createdAt: admin.database.ServerValue.TIMESTAMP,
      lastSeen: admin.database.ServerValue.TIMESTAMP
    });
    
    // Incrementar contador de usuários ativos
    const statsRef = db.ref('stats');
    await statsRef.transaction((stats) => {
      stats = stats || { activeUsers: 0, activatedEnigmas: 0, solvedEnigmas: 0 };
      stats.activeUsers = (stats.activeUsers || 0) + 1;
      return stats;
    });
    
    res.json({ userId, isNew: true });
  } catch (error) {
    console.error('Erro ao registrar usuário:', error);
    res.status(500).json({ error: 'Erro ao registrar usuário' });
  }
});

app.post('/api/activate-enigma', checkVpn, async (req, res) => {
  try {
    const { userId } = req.body;
    
    // Verificar se o usuário existe
    const userRef = db.ref(`users/${userId}`);
    const snapshot = await userRef.once('value');
    
    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    // Registrar ativação do enigma
    await userRef.update({
      enigmaActivated: true,
      activationTime: admin.database.ServerValue.TIMESTAMP
    });
    
    // Incrementar contador de enigmas ativados
    const statsRef = db.ref('stats');
    await statsRef.transaction((stats) => {
      stats = stats || { activeUsers: 0, activatedEnigmas: 0, solvedEnigmas: 0 };
      stats.activatedEnigmas = (stats.activatedEnigmas || 0) + 1;
      return stats;
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao ativar enigma:', error);
    res.status(500).json({ error: 'Erro ao ativar enigma' });
  }
});

app.post('/api/solve-enigma', checkVpn, async (req, res) => {
  try {
    const { userId, level } = req.body;
    
    // Verificar se o usuário existe
    const userRef = db.ref(`users/${userId}`);
    const snapshot = await userRef.once('value');
    
    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    // Registrar resolução do enigma
    await userRef.update({
      [`enigmaSolved_${level}`]: true,
      [`solutionTime_${level}`]: admin.database.ServerValue.TIMESTAMP
    });
    
    // Incrementar contador de enigmas resolvidos
    const statsRef = db.ref('stats');
    await statsRef.transaction((stats) => {
      stats = stats || { activeUsers: 0, activatedEnigmas: 0, solvedEnigmas: 0 };
      stats.solvedEnigmas = (stats.solvedEnigmas || 0) + 1;
      return stats;
    });
    
    // Verificar se é necessário aumentar a dificuldade
    const currentStats = (await statsRef.once('value')).val() || { solvedEnigmas: 0 };
    let newDifficulty = 1;
    
    if (currentStats.solvedEnigmas >= 1000) {
      newDifficulty = 3;
    } else if (currentStats.solvedEnigmas >= 100) {
      newDifficulty = 2;
    }
    
    res.json({ success: true, newDifficulty });
  } catch (error) {
    console.error('Erro ao resolver enigma:', error);
    res.status(500).json({ error: 'Erro ao resolver enigma' });
  }
});

app.post('/api/check-vpn', async (req, res) => {
  try {
    const { ip } = req.body;
    
    // Em produção, use uma API real como IPQualityScore
    // const apiKey = process.env.IPQUALITYSCORE_API_KEY;
    // const response = await axios.get(`https://www.ipqualityscore.com/api/json/ip/${apiKey}/${ip}`);
    // const isVpn = response.data.proxy || response.data.vpn || response.data.tor;
    
    // Simulação para desenvolvimento
    const isVpn = Math.random() < 0.05; // 5% de chance de ser VPN
    
    res.json({ isVpn });
  } catch (error) {
    console.error('Erro ao verificar VPN:', error);
    res.status(500).json({ error: 'Erro ao verificar VPN' });
  }
});

// Socket.IO para comunicação em tempo real
io.on('connection', (socket) => {
  console.log('Novo cliente conectado:', socket.id);
  
  // Incrementar contador de usuários ativos
  activeUsers++;
  
  // Enviar estatísticas atualizadas para todos os clientes
  io.emit('stats_update', { activeUsers, activatedEnigmas, solvedEnigmas });
  
  // Registrar desconexão
  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
    activeUsers = Math.max(0, activeUsers - 1);
    io.emit('stats_update', { activeUsers, activatedEnigmas, solvedEnigmas });
  });
  
  // Registrar ativação de enigma
  socket.on('enigma_activated', (data) => {
    activatedEnigmas++;
    io.emit('stats_update', { activeUsers, activatedEnigmas, solvedEnigmas });
    
    // Em produção, salvar no Firebase
    const statsRef = db.ref('stats');
    statsRef.update({ activatedEnigmas });
  });
  
  // Registrar resolução de enigma
  socket.on('enigma_solved', (data) => {
    solvedEnigmas++;
    io.emit('stats_update', { activeUsers, activatedEnigmas, solvedEnigmas });
    
    // Em produção, salvar no Firebase
    const statsRef = db.ref('stats');
    statsRef.update({ solvedEnigmas });
    
    // Verificar se é necessário aumentar a dificuldade
    let newDifficulty = 1;
    if (solvedEnigmas >= 1000) {
      newDifficulty = 3;
    } else if (solvedEnigmas >= 100) {
      newDifficulty = 2;
    }
    
    // Notificar todos os clientes sobre mudança de dificuldade
    if (newDifficulty > 1) {
      io.emit('difficulty_change', { level: newDifficulty });
    }
  });
});

// Inicializar contadores do Firebase ao iniciar o servidor
const initializeCounters = async () => {
  try {
    const statsRef = db.ref('stats');
    const snapshot = await statsRef.once('value');
    const stats = snapshot.val();
    
    if (stats) {
      activeUsers = stats.activeUsers || 0;
      activatedEnigmas = stats.activatedEnigmas || 0;
      solvedEnigmas = stats.solvedEnigmas || 0;
    } else {
      // Inicializar contadores no Firebase
      await statsRef.set({
        activeUsers: 0,
        activatedEnigmas: 0,
        solvedEnigmas: 0
      });
    }
    
    console.log('Contadores inicializados:', { activeUsers, activatedEnigmas, solvedEnigmas });
  } catch (error) {
    console.error('Erro ao inicializar contadores:', error);
  }
};

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  await initializeCounters();
});
