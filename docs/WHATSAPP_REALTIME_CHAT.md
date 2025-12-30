# WhatsApp Chat em Tempo Real - Implementação

## ✅ Funcionalidades Implementadas

### 📡 Novos Endpoints

1. **GET** `/whatsapp/:id/contacts` - Lista contatos da sessão
2. **GET** `/whatsapp/:id/chats` - Lista chats ativos (conversas e grupos)
3. **GET** `/whatsapp/:id/groups/:groupId` - Busca metadados de grupo específico
4. **GET** `/whatsapp/:id/chats/:chatId/messages` - Lista mensagens de um chat
5. **POST** `/whatsapp/:id/send-message` - Envia mensagem (já atualizado com evento WS)

### 🔌 Eventos WebSocket

#### Mensagens
- `message:sent` - Disparado quando você envia uma mensagem
- `message:received` - Disparado quando recebe uma mensagem de um contato

#### QR Code
- `qr` - QR code gerado
- `qr:scanned` - QR code escaneado com sucesso

#### Sessão
- `session:connected` - Sessão conectada
- `session:disconnected` - Sessão desconectada

---

## 🔄 Fluxo de Funcionamento

### 1. Enviar Mensagem
```
[Frontend] POST /whatsapp/:id/send-message
    ↓
[Backend] whatsappSessionManager.sendAdvancedMessage()
    ↓
[Backend] EventEmitter.emit('session.message.sent')
    ↓
[Gateway] handleMessageSent() 
    ↓
[WebSocket] Emite 'message:sent' para todos os clientes
    ↓
[Frontend] Escuta 'message:sent' e atualiza UI
```

### 2. Receber Mensagem
```
[WhatsApp] Nova mensagem chega
    ↓
[Baileys] sock.ev.on('messages.upsert')
    ↓
[Backend] EventEmitter.emit('session.message.received')
    ↓
[Gateway] handleMessageReceived()
    ↓
[WebSocket] Emite 'message:received' para todos os clientes
    ↓
[Frontend] Escuta 'message:received' e atualiza UI + notifica
```

---

## 📝 Exemplo de Implementação Frontend

### Conectar ao WebSocket

```javascript
import io from 'socket.io-client';

const socket = io('ws://localhost:4444/ws', {
  auth: {
    token: `Bearer ${jwtToken}`
  }
});

// Conectado com sucesso
socket.on('connected', (data) => {
  console.log('✅ Connected:', data);
  
  // Inscrever-se na sessão
  socket.emit('subscribe:session', { 
    sessionId: 'session-1767016255334-kbk3qqj' 
  });
});
```

### Escutar Mensagens em Tempo Real

```javascript
// Mensagem enviada por você
socket.on('message:sent', (data) => {
  console.log('📤 Mensagem enviada:', data);
  
  // Adicionar mensagem no chat da UI
  addMessageToChat({
    id: data.messageId,
    text: data.text,
    to: data.to,
    fromMe: true,
    timestamp: data.timestamp
  });
});

// Mensagem recebida de um contato
socket.on('message:received', (data) => {
  console.log('📥 Mensagem recebida:', data);
  
  // Adicionar mensagem no chat da UI
  addMessageToChat({
    id: data.messageId,
    text: data.text,
    from: data.from,
    fromMe: data.fromMe,
    timestamp: data.timestamp
  });
  
  // Mostrar notificação
  if (!data.fromMe) {
    showNotification(`Nova mensagem de ${data.from}`, data.text);
  }
  
  // Atualizar badge de mensagens não lidas
  updateUnreadBadge(data.from);
});
```

### Listar Chats Ativos

```javascript
async function loadChats() {
  const response = await fetch(
    'http://localhost:4444/whatsapp/46473849-bdf5-4109-bd64-34914e291f60/chats',
    {
      headers: {
        'Authorization': `Bearer ${jwtToken}`
      }
    }
  );
  
  const data = await response.json();
  console.log('Chats ativos:', data.chats);
  
  // Renderizar lista de chats na UI
  renderChatList(data.chats);
}
```

### Ver Mensagens de um Chat

```javascript
async function loadChatMessages(chatId) {
  const response = await fetch(
    `http://localhost:4444/whatsapp/46473849-bdf5-4109-bd64-34914e291f60/chats/${chatId}/messages?limit=50`,
    {
      headers: {
        'Authorization': `Bearer ${jwtToken}`
      }
    }
  );
  
  const data = await response.json();
  console.log('Mensagens:', data.messages);
  
  // Renderizar mensagens na UI
  renderMessages(data.messages);
}
```

### Enviar Mensagem

```javascript
async function sendMessage(to, text) {
  const response = await fetch(
    'http://localhost:4444/whatsapp/46473849-bdf5-4109-bd64-34914e291f60/send-message',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to, text })
    }
  );
  
  const data = await response.json();
  console.log('Mensagem enviada:', data);
  
  // O evento 'message:sent' será emitido via WebSocket
  // e a mensagem aparecerá automaticamente na UI
}
```

### Buscar Informações de Grupo

```javascript
async function loadGroupInfo(groupId) {
  const response = await fetch(
    `http://localhost:4444/whatsapp/46473849-bdf5-4109-bd64-34914e291f60/groups/${groupId}`,
    {
      headers: {
        'Authorization': `Bearer ${jwtToken}`
      }
    }
  );
  
  const data = await response.json();
  console.log('Grupo:', data);
  
  // Exibir informações do grupo
  showGroupInfo({
    name: data.subject,
    participants: data.participants,
    description: data.desc
  });
}
```

---

## ⚠️ Limitações Atuais

### Store Customizado Necessário

Os seguintes endpoints retornam arrays vazios por padrão e requerem implementação de store:

1. **Contatos** - `GET /whatsapp/:id/contacts`
2. **Chats Ativos** - `GET /whatsapp/:id/chats`  
3. **Mensagens** - `GET /whatsapp/:id/chats/:chatId/messages`

### Como Implementar Store

Para ter histórico completo, você precisa:

#### 1. Criar Tabela no Banco de Dados

```sql
-- Tabela de mensagens
CREATE TABLE whatsapp_messages (
  id VARCHAR(255) PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  chat_id VARCHAR(255) NOT NULL,
  from_jid VARCHAR(255),
  from_me BOOLEAN DEFAULT FALSE,
  message_text TEXT,
  message_type VARCHAR(50),
  timestamp BIGINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_session_chat (session_id, chat_id),
  INDEX idx_timestamp (timestamp DESC)
);

-- Tabela de chats
CREATE TABLE whatsapp_chats (
  id VARCHAR(255) PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  chat_id VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  is_group BOOLEAN DEFAULT FALSE,
  last_message_timestamp BIGINT,
  unread_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_session (session_id),
  INDEX idx_last_message (last_message_timestamp DESC)
);
```

#### 2. Salvar Mensagens no Handler

```typescript
// No handler de messages.upsert
sock.ev.on('messages.upsert', async ({ messages }) => {
  for (const msg of messages) {
    // Salvar no banco de dados
    await prisma.whatsappMessage.create({
      data: {
        id: msg.key.id,
        sessionId: sessionId,
        chatId: msg.key.remoteJid,
        fromJid: msg.key.remoteJid,
        fromMe: msg.key.fromMe || false,
        messageText: msg.message?.conversation || msg.message?.extendedTextMessage?.text,
        messageType: Object.keys(msg.message || {})[0],
        timestamp: msg.messageTimestamp,
      }
    });
    
    // Atualizar chat
    await prisma.whatsappChat.upsert({
      where: { chatId: msg.key.remoteJid },
      update: {
        lastMessageTimestamp: msg.messageTimestamp,
        updatedAt: new Date(),
      },
      create: {
        chatId: msg.key.remoteJid,
        sessionId: sessionId,
        name: msg.pushName || msg.key.remoteJid,
        isGroup: msg.key.remoteJid.includes('@g.us'),
        lastMessageTimestamp: msg.messageTimestamp,
      }
    });
    
    // Emitir eventos...
  }
});
```

#### 3. Implementar Queries

```typescript
async getChats(sessionId: string) {
  return await this.prisma.whatsappChat.findMany({
    where: { sessionId },
    orderBy: { lastMessageTimestamp: 'desc' }
  });
}

async getChatMessages(sessionId: string, chatId: string, limit = 50) {
  return await this.prisma.whatsappMessage.findMany({
    where: { sessionId, chatId },
    orderBy: { timestamp: 'desc' },
    take: limit
  });
}
```

---

## 🎯 Casos de Uso

### Dashboard de Atendimento

```javascript
// 1. Conectar WebSocket
const socket = connectWebSocket(token);

// 2. Carregar lista de chats
const chats = await loadChats();

// 3. Quando clicar em um chat
function onChatClick(chatId) {
  // Carregar mensagens
  loadChatMessages(chatId);
  
  // Marcar como ativo
  setActiveChat(chatId);
}

// 4. Escutar mensagens novas
socket.on('message:received', (data) => {
  // Se mensagem é do chat ativo, adicionar na lista
  if (data.from === activeChat) {
    appendMessage(data);
  } else {
    // Senão, incrementar badge de não lidas
    incrementUnreadBadge(data.from);
  }
});

// 5. Enviar mensagem
function onSendMessage(text) {
  sendMessage(activeChat, text);
  // Mensagem aparece via evento 'message:sent'
}
```

### Notificações Push

```javascript
socket.on('message:received', (data) => {
  if (!data.fromMe && document.hidden) {
    // Mostrar notificação do browser
    new Notification('Nova mensagem WhatsApp', {
      body: data.text,
      icon: '/whatsapp-icon.png',
      tag: data.from
    });
  }
});
```

---

## 🚀 Próximos Passos

1. ✅ Endpoints criados
2. ✅ Eventos WebSocket implementados
3. ⚠️ **Implementar store para persistência** (banco de dados)
4. ⚠️ **Frontend: UI de chat** com lista de conversas
5. ⚠️ **Frontend: WebSocket client** para tempo real
6. 🔜 Suporte a envio de imagens/documentos
7. 🔜 Indicador de "digitando..."
8. 🔜 Status de entrega/leitura de mensagens
