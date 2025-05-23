// Integração do frontend com o backend para contador real e bloqueio de VPN
// Este arquivo deve ser incluído no HTML principal

// (Removido bloco duplicado de configuração do Firebase)

// Classe para gerenciar a integração com o backend
class EnigmaBackendService {
  constructor() {
    this.baseUrl = 'https://enigma-forense-backend.onrender.com/api'; // URL do backend no Render
    this.socket = null;
    this.userId = null;
    this.isConnected = false;
    this.callbacks = {
      onStatsUpdate: null,
      onDifficultyChange: null,
      onVpnDetected: null
    };
    
    // Inicializar Firebase
    if (typeof firebase !== 'undefined') {
      firebase.initializeApp(firebaseConfig);
      this.db = firebase.database();
    }
    
    // Inicializar Socket.io
    this.initializeSocket();
    
    // Verificar se o usuário já está registrado
    this.initializeUser();
  }
  
  // Inicializar conexão Socket.io
  initializeSocket() {
    try {
      this.socket = io(this.baseUrl);
      
      this.socket.on('connect', () => {
        console.log('Conectado ao servidor em tempo real');
        this.isConnected = true;
      });
      
      this.socket.on('disconnect', () => {
        console.log('Desconectado do servidor em tempo real');
        this.isConnected = false;
        
        // Tentar reconectar após 5 segundos
        setTimeout(() => {
          if (!this.isConnected) {
            this.socket.connect();
          }
        }, 5000);
      });
      
      this.socket.on('stats_update', (data) => {
        console.log('Estatísticas atualizadas:', data);
        if (this.callbacks.onStatsUpdate) {
          this.callbacks.onStatsUpdate(data);
        }
      });
      
      this.socket.on('difficulty_change', (data) => {
        console.log('Mudança de dificuldade:', data);
        if (this.callbacks.onDifficultyChange) {
          this.callbacks.onDifficultyChange(data);
        }
      });
    } catch (error) {
      console.error('Erro ao inicializar Socket.io:', error);
      // Fallback para modo offline
      this.isConnected = false;
    }
  }
  
  // Inicializar usuário
  async initializeUser() {
    try {
      // Verificar se já existe ID no localStorage
      this.userId = localStorage.getItem('enigma_user_id');
      
      if (!this.userId) {
        // Gerar fingerprint do dispositivo
        const fingerprint = await this.generateFingerprint();
        
        // Registrar novo usuário no backend
        const response = await this.makeRequest('/register-user', 'POST', { deviceFingerprint: fingerprint });
        
        if (response && response.userId) {
          this.userId = response.userId;
          localStorage.setItem('enigma_user_id', this.userId);
          console.log('Novo usuário registrado:', this.userId);
        }
      } else {
        console.log('Usuário existente:', this.userId);
      }
    } catch (error) {
      console.error('Erro ao inicializar usuário:', error);
      // Fallback para ID local se o backend não estiver disponível
      if (!this.userId) {
        this.userId = 'local_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('enigma_user_id', this.userId);
      }
    }
  }
  
  // Gerar fingerprint do dispositivo
  async generateFingerprint() {
    return new Promise((resolve) => {
      if (window.requestIdleCallback) {
        requestIdleCallback(function () {
          Fingerprint2.get(function (components) {
            const values = components.map(function (component) { return component.value });
            const fingerprint = Fingerprint2.x64hash128(values.join(''), 31);
            resolve(fingerprint);
          });
        });
      } else {
        setTimeout(function () {
          Fingerprint2.get(function (components) {
            const values = components.map(function (component) { return component.value });
            const fingerprint = Fingerprint2.x64hash128(values.join(''), 31);
            resolve(fingerprint);
          });
        }, 500);
      }
    });
  }
  
  // Fazer requisição para o backend
  async makeRequest(endpoint, method = 'GET', data = null) {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json'
        }
      };
      
      if (data) {
        options.body = JSON.stringify(data);
      }
      
      const response = await fetch(url, options);
      
      if (response.status === 403) {
        // VPN detectada
        const errorData = await response.json();
        if (this.callbacks.onVpnDetected) {
          this.callbacks.onVpnDetected(errorData);
        }
        return null;
      }
      
      if (!response.ok) {
        throw new Error(`Erro na requisição: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`Erro ao fazer requisição para ${endpoint}:`, error);
      return null;
    }
  }
  
  // Obter estatísticas atuais
  async getStats() {
    try {
      // Tentar obter do backend
      const stats = await this.makeRequest('/stats');
      
      if (stats) {
        return stats;
      }
      
      // Fallback para Firebase direto se o backend não responder
      if (this.db) {
        const snapshot = await this.db.ref('stats').once('value');
        return snapshot.val() || { activeUsers: 0, activatedEnigmas: 0, solvedEnigmas: 0 };
      }
      
      // Fallback para valores locais
      return { activeUsers: 0, activatedEnigmas: 0, solvedEnigmas: 0 };
    } catch (error) {
      console.error('Erro ao obter estatísticas:', error);
      return { activeUsers: 0, activatedEnigmas: 0, solvedEnigmas: 0 };
    }
  }
  
  // Registrar ativação do enigma
  async registerEnigmaActivation() {
    try {
      if (!this.userId) {
        await this.initializeUser();
      }
      
      // Registrar no backend
      await this.makeRequest('/activate-enigma', 'POST', { userId: this.userId });
      
      // Emitir evento via Socket.io
      if (this.isConnected && this.socket) {
        this.socket.emit('enigma_activated', { userId: this.userId });
      }
      
      // Salvar no localStorage
      localStorage.setItem('enigma_activated', 'true');
      
      console.log('Ativação do enigma registrada');
      return true;
    } catch (error) {
      console.error('Erro ao registrar ativação do enigma:', error);
      return false;
    }
  }
  
  // Registrar resolução do enigma
  async registerEnigmaSolution(level) {
    try {
      if (!this.userId) {
        await this.initializeUser();
      }
      
      // Registrar no backend
      const result = await this.makeRequest('/solve-enigma', 'POST', { userId: this.userId, level });
      
      // Emitir evento via Socket.io
      if (this.isConnected && this.socket) {
        this.socket.emit('enigma_solved', { userId: this.userId, level });
      }
      
      // Salvar no localStorage
      localStorage.setItem(`enigma_solved_level${level}`, 'true');
      
      console.log(`Resolução do enigma nível ${level} registrada`);
      
      // Retornar nova dificuldade, se houver
      return result && result.newDifficulty ? result.newDifficulty : null;
    } catch (error) {
      console.error('Erro ao registrar resolução do enigma:', error);
      return null;
    }
  }
  
  // Verificar se o usuário está usando VPN
  async checkVpn() {
    try {
      // Obter IP do cliente
      const ipResponse = await fetch('https://api.ipify.org?format=json');
      const ipData = await ipResponse.json();
      const ip = ipData.ip;
      
      // Verificar VPN no backend
      const result = await this.makeRequest('/check-vpn', 'POST', { ip });
      
      if (result && result.isVpn) {
        if (this.callbacks.onVpnDetected) {
          this.callbacks.onVpnDetected(result);
        }
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Erro ao verificar VPN:', error);
      return false;
    }
  }
  
  // Registrar callbacks para eventos
  on(event, callback) {
    if (this.callbacks.hasOwnProperty(event)) {
      this.callbacks[event] = callback;
    }
  }
}

// Exportar instância única do serviço
const backendService = new EnigmaBackendService();

// Integração do frontend com o backend para contador real e bloqueio de VPN
// Este arquivo deve ser incluído no HTML principal

// Configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAr2JGtfUrzmU7c3QNmY-I6TNZbTf5lOSo",
  authDomain: "enigma-forense-default-rtdb.firebaseapp.com",
  projectId: "enigma-forense-default-rtdb",
  storageBucket: "enigma-forense-default-rtdb.firebasestorage.app",
  messagingSenderId: "18158050058",
  appId: "1:18158050058:web:054a1a533216640554f8f3",
  measurementId: "G-VEZ8SXHS3X"
};

