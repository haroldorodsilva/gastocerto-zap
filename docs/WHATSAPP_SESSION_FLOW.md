# Guia Completo: Fluxo de Sessões WhatsApp com QR Code

## 📋 Visão Geral

Este documento descreve o fluxo completo de criação, ativação e gerenciamento de sessões WhatsApp com QR code via WebSocket.

## 🏗️ Arquitetura

```
┌─────────────────────┐
│  WhatsAppController │ ◄── REST API (CRUD de sessões)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ SessionManagerService│ ◄── Bridge/Adapter
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────┐
│ WhatsAppSessionManager  │ ◄── Gerenciador Real (Baileys)
│  - Múltiplas sessões    │
│  - QR code storage      │
│  - Event emission       │
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────┐
│  WhatsAppGateway    │ ◄── WebSocket (distribuição em tempo real)
│  - Emite QR codes   │
│  - Emite status     │
│  - Emite mensagens  │
└─────────────────────┘
```

## 🔄 Fluxo Completo

### 1️⃣ Criar Sessão (REST API)

```bash
POST /whatsapp
Content-Type: application/json
Authorization: Bearer <jwt-token>

{
  "sessionId": "minha-sessao-01",
  "phoneNumber": "5566996285154",
  "name": "Meu WhatsApp"
}
```

**Resposta:**
```json
{
  "id": "uuid-generated",
  "sessionId": "minha-sessao-01",
  "phoneNumber": "5566996285154",
  "name": "Meu WhatsApp",
  "status": "DISCONNECTED",
  "isActive": false,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z"
}
```

### 2️⃣ Conectar ao WebSocket

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/ws', {
  auth: {
    token: 'seu-jwt-token'
  }
});

// Aguardar confirmação de conexão
socket.on('connected', (data) => {
  console.log('Conectado:', data);
  
  // Inscrever-se nos eventos da sessão
  socket.emit('subscribe:session', { 
    sessionId: 'minha-sessao-01' 
  });
});

socket.on('subscribed', (data) => {
  console.log('Inscrito na sessão:', data.sessionId);
});
```

### 3️⃣ Ativar Sessão (Iniciar WhatsApp)

```bash
POST /whatsapp/:id/activate
Authorization: Bearer <jwt-token>
```

**O que acontece:**
1. ✅ Status muda para `CONNECTING`
2. ✅ Baileys inicia conexão
3. ✅ QR code é gerado
4. ✅ Evento `session.qr` é emitido

### 4️⃣ Receber QR Code via WebSocket

```javascript
socket.on('qr', (data) => {
  console.log('QR Code recebido!');
  console.log('SessionId:', data.sessionId);
  console.log('QR Code:', data.qr);
  console.log('Timestamp:', data.timestamp);
  
  // Exibir QR code para o usuário
  displayQRCode(data.qr);
});
```

### 5️⃣ Refresh Automático do QR Code

O Baileys gera automaticamente um novo QR code a cada ~60 segundos até que seja escaneado.

```javascript
socket.on('qr', (data) => {
  // Novo QR code - atualizar display
  updateQRCode(data.qr);
});

socket.on('qr:expired', (data) => {
  console.log('QR code expirado, aguardando novo...');
});
```

### 6️⃣ Autenticação Bem-Sucedida

Após escanear o QR code no WhatsApp:

```javascript
socket.on('session:connected', (data) => {
  console.log('✅ WhatsApp conectado!');
  console.log('SessionId:', data.sessionId);
  
  // Ocultar QR code
  hideQRCode();
  
  // Mostrar interface de chat
  showChatInterface();
});
```

### 7️⃣ Receber Mensagens

```javascript
socket.on('session:message', (data) => {
  console.log('📨 Nova mensagem:');
  console.log('De:', data.message.from);
  console.log('Texto:', data.message.message);
  console.log('Tipo:', data.message.type);
  
  // Processar mensagem
  processMessage(data.message);
});
```

### 8️⃣ Desconexão

```javascript
socket.on('session:disconnected', (data) => {
  console.log('📴 Sessão desconectada');
  console.log('Motivo:', data.reason);
  
  // Mostrar mensagem para usuário
  showDisconnectedMessage();
});
```

## 🔧 Endpoints da API

### Criar Sessão
```
POST /whatsapp
Body: { sessionId, phoneNumber, name? }
```

### Listar Sessões
```
GET /whatsapp
Query: { status?, isActive?, limit?, offset? }
```

### Buscar Sessão
```
GET /whatsapp/:id
```

### Atualizar Sessão
```
PUT /whatsapp/:id
Body: { name?, phoneNumber? }
```

### Ativar Sessão (Conectar)
```
POST /whatsapp/:id/activate
```

### Desativar Sessão (Desconectar)
```
POST /whatsapp/:id/deactivate
```

### Resetar Credenciais
```
POST /whatsapp/:id/reset-auth
```

### Obter QR Code (via REST)
```
GET /whatsapp/:id/qr
Response: { qr: "base64-qr-code" }
```

## 📡 Eventos WebSocket

### Eventos do Cliente → Servidor

- `subscribe:session` - Inscrever-se em eventos de uma sessão
  ```json
  { "sessionId": "minha-sessao-01" }
  ```

- `unsubscribe:session` - Cancelar inscrição
  ```json
  { "sessionId": "minha-sessao-01" }
  ```

### Eventos do Servidor → Cliente

- `connected` - Confirmação de autenticação WebSocket
- `subscribed` - Confirmação de inscrição na sessão
- `qr` - Novo QR code gerado
- `qr:expired` - QR code expirou
- `session:started` - Sessão iniciando
- `session:connected` - Sessão conectada (autenticada)
- `session:disconnected` - Sessão desconectada
- `session:stopped` - Sessão parada
- `session:message` - Nova mensagem recebida
- `session:error` - Erro na sessão
- `session:auth:corrupted` - Credenciais corrompidas
- `session:error:515` - Erro 515 (banimento temporário)

## 🧪 Testar o Fluxo

### Opção 1: Script Completo (Automático)

```bash
npm run test:complete-flow
```

Este script:
1. ✅ Cria sessão no banco
2. ✅ Configura listeners de eventos
3. ✅ Inicia sessão Baileys
4. ✅ Aguarda QR code
5. ✅ Aguarda autenticação (60s)
6. ✅ Mantém ativo por 2 minutos
7. ✅ Cleanup automático

### Opção 2: Cliente WebSocket (Manual)

```bash
# Terminal 1: Iniciar servidor
npm run start:dev

# Terminal 2: Cliente WebSocket
JWT_TOKEN="seu-token" \
SESSION_ID="minha-sessao" \
npm run test:websocket-client
```

### Opção 3: Via API REST + WebSocket

1. **Criar sessão via cURL:**
```bash
curl -X POST http://localhost:3000/whatsapp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "sessionId": "test-session",
    "phoneNumber": "5566996285154"
  }'
```

2. **Conectar WebSocket** (usar script ou cliente)

3. **Ativar sessão:**
```bash
curl -X POST http://localhost:3000/whatsapp/{id}/activate \
  -H "Authorization: Bearer $JWT_TOKEN"
```

4. **Ver QR code no WebSocket** e escanear

## 🔐 Autenticação

Todos os endpoints requerem JWT token no header:
```
Authorization: Bearer <jwt-token>
```

O WebSocket também requer autenticação via:
- Header: `Authorization: Bearer <token>`
- Query: `?token=<token>`
- Auth object: `{ auth: { token: '<token>' } }`

## 📝 Múltiplas Sessões

O sistema suporta múltiplas sessões simultâneas:

```javascript
// Conectar ao WebSocket
const socket = io('http://localhost:3000/ws', {
  auth: { token: JWT_TOKEN }
});

// Inscrever em múltiplas sessões
socket.emit('subscribe:session', { sessionId: 'sessao-1' });
socket.emit('subscribe:session', { sessionId: 'sessao-2' });
socket.emit('subscribe:session', { sessionId: 'sessao-3' });

// Receber eventos de todas as sessões
socket.on('qr', (data) => {
  console.log(`QR para ${data.sessionId}`);
  // Cada sessão emite seu próprio QR
});
```

## ⚠️ Tratamento de Erros

### QR Code não Gerado

Se o QR code não aparecer após ativar:

```bash
# 1. Verificar logs do servidor
# 2. Verificar se Redis está rodando
docker ps | grep redis

# 3. Resetar credenciais
curl -X POST http://localhost:3000/whatsapp/{id}/reset-auth \
  -H "Authorization: Bearer $JWT_TOKEN"

# 4. Tentar novamente
curl -X POST http://localhost:3000/whatsapp/{id}/activate \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### Sessão Desconecta Rapidamente

```javascript
socket.on('session:error', (data) => {
  if (data.error.message.includes('515')) {
    console.error('Conta banida temporariamente');
    // Aguardar algumas horas antes de reconectar
  }
});

socket.on('session:auth:corrupted', (data) => {
  console.error('Credenciais corrompidas');
  // Fazer reset-auth e gerar novo QR
});
```

## 📊 Monitoramento

### Ver Status de Todas as Sessões

```bash
GET /whatsapp
```

### Ver QR Code Atual (REST)

```bash
GET /whatsapp/:id/qr
```

### Logs do Servidor

```bash
npm run start:dev
# Logs em tempo real com:
# 📱 QR code generated
# ✅ Session connected
# 📨 Message received
```

## 🚀 Próximos Passos

Após ler este guia:

1. ✅ Teste o script `test-complete-flow.ts`
2. ✅ Teste o cliente WebSocket
3. ✅ Integre no seu frontend
4. ✅ Configure múltiplas sessões
5. ✅ Implemente tratamento de erros

## 📚 Referências

- [Baileys Documentation](https://github.com/WhiskeySockets/Baileys)
- [Socket.io Documentation](https://socket.io/docs/v4/)
- [NestJS WebSockets](https://docs.nestjs.com/websockets/gateways)
