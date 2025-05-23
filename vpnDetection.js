const axios = require('axios');
require('dotenv').config();

/**
 * Serviço para detecção de VPN/Tor usando IPQualityScore API
 */
class VpnDetectionService {
  constructor() {
    this.apiKey = process.env.IPQUALITYSCORE_API_KEY;
    this.enabled = process.env.VPN_DETECTION_ENABLED === 'true';
    this.cache = new Map(); // Cache para armazenar resultados e reduzir chamadas à API
    this.cacheExpiration = 3600000; // Cache válido por 1 hora (em ms)
  }

  /**
   * Verifica se um IP está usando VPN, proxy ou Tor
   * @param {string} ip - Endereço IP para verificar
   * @returns {Promise<Object>} - Resultado da verificação
   */
  async checkIp(ip) {
    // Se a detecção estiver desabilitada, retornar falso
    if (!this.enabled) {
      console.log('Detecção de VPN desabilitada');
      return { isVpn: false, proxy: false, vpn: false, tor: false };
    }

    // Verificar cache para evitar chamadas desnecessárias à API
    if (this.cache.has(ip)) {
      const cachedResult = this.cache.get(ip);
      if (Date.now() - cachedResult.timestamp < this.cacheExpiration) {
        console.log(`Usando resultado em cache para IP ${ip}`);
        return cachedResult.data;
      }
      // Cache expirado, remover
      this.cache.delete(ip);
    }

    try {
      // Em produção, usar a API real
      if (this.apiKey && this.apiKey !== 'your_api_key_here') {
        console.log(`Verificando IP ${ip} com IPQualityScore API`);
        const response = await axios.get(
          `https://www.ipqualityscore.com/api/json/ip/${this.apiKey}/${ip}`,
          {
            params: {
              strictness: 1,
              allow_public_access_points: true,
              fast: false,
              mobile: false
            }
          }
        );

        const result = {
          isVpn: response.data.proxy || response.data.vpn || response.data.tor,
          proxy: response.data.proxy,
          vpn: response.data.vpn,
          tor: response.data.tor,
          fraudScore: response.data.fraud_score,
          country: response.data.country_code,
          isp: response.data.ISP
        };

        // Armazenar resultado no cache
        this.cache.set(ip, {
          timestamp: Date.now(),
          data: result
        });

        return result;
      } else {
        // Simulação para desenvolvimento/demonstração
        console.log(`Simulando verificação de VPN para IP ${ip}`);
        const isVpn = Math.random() < 0.05; // 5% de chance de ser VPN
        const result = {
          isVpn,
          proxy: isVpn && Math.random() < 0.5,
          vpn: isVpn && Math.random() < 0.7,
          tor: isVpn && Math.random() < 0.2,
          fraudScore: isVpn ? Math.floor(Math.random() * 50) + 50 : Math.floor(Math.random() * 30),
          country: 'US',
          isp: 'Simulated ISP'
        };

        // Armazenar resultado no cache
        this.cache.set(ip, {
          timestamp: Date.now(),
          data: result
        });

        return result;
      }
    } catch (error) {
      console.error('Erro ao verificar VPN:', error);
      // Em caso de erro, permitir acesso (não bloquear)
      return { isVpn: false, proxy: false, vpn: false, tor: false };
    }
  }

  /**
   * Middleware Express para verificar VPN
   * @returns {Function} - Middleware Express
   */
  middleware() {
    return async (req, res, next) => {
      try {
        // Obter IP real do cliente, considerando proxies
        const ip = req.headers['x-forwarded-for'] || 
                   req.headers['x-real-ip'] || 
                   req.connection.remoteAddress;
        
        // Remover IPv6 prefix se presente
        const cleanIp = ip.replace(/^::ffff:/, '');
        
        // Ignorar IPs locais para desenvolvimento
        if (cleanIp === '127.0.0.1' || cleanIp === 'localhost' || cleanIp.startsWith('192.168.') || cleanIp.startsWith('10.')) {
          return next();
        }

        const result = await this.checkIp(cleanIp);
        
        // Armazenar resultado na requisição para uso posterior
        req.vpnCheck = result;
        
        // Se for VPN/proxy/Tor, bloquear acesso
        if (result.isVpn) {
          console.log(`Bloqueando acesso de VPN/proxy/Tor: ${cleanIp}`);
          return res.status(403).json({ 
            error: 'Acesso bloqueado', 
            message: 'VPN, proxy ou Tor detectado. Por razões de segurança, o acesso ao sistema de enigmas forenses não é permitido através dessas redes.',
            details: {
              proxy: result.proxy,
              vpn: result.vpn,
              tor: result.tor
            }
          });
        }
        
        // Se não for VPN, continuar
        next();
      } catch (error) {
        console.error('Erro no middleware de detecção de VPN:', error);
        // Em caso de erro, permitir acesso
        next();
      }
    };
  }

  /**
   * Limpa o cache de resultados
   */
  clearCache() {
    this.cache.clear();
    console.log('Cache de detecção de VPN limpo');
  }
}

// Exportar instância única do serviço
module.exports = new VpnDetectionService();
