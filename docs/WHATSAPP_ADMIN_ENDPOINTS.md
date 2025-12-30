# WhatsApp Admin Endpoints - Novos Recursos

## 🔧 Funcionalidades Adicionadas

Com uma sessão WhatsApp ativa, agora é possível:
- ✅ Extrair metadados da sessão (perfil, informações do usuário)
- ✅ Buscar informações de contatos específicos
- ✅ Verificar se um número existe no WhatsApp
- ✅ Enviar mensagens manuais para qualquer número
- ✅ Listar contatos da sessão
- ✅ Listar chats ativos (incluindo grupos)
- ✅ Buscar metadados de grupos
- ✅ Listar mensagens de um chat
- ✅ Receber eventos em tempo real via WebSocket

---

## 📡 Endpoints

### 1. Obter Metadados da Sessão

**GET** `/whatsapp/:id/metadata`

Retorna informações do perfil da sessão ativa.

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Response:**
```json
{
  "sessionId": "session-1767016255334-kbk3qqj",
  "user": {
    "id": "556696285154:16@s.whatsapp.net",
    "name": "WhatsApp"
  },
  "connected": true,
  "timestamp": "2025-12-29T15:30:00.000Z"
}
```

---

### 2. Buscar Informações de um Contato

**GET** `/whatsapp/:id/contacts/:phoneNumber`

Busca informações de perfil de um contato específico (status, foto).

**Parameters:**
- `id` - ID da sessão no banco
- `phoneNumber` - Número do telefone (pode incluir código do país)

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Exemplo:**
```bash
GET /whatsapp/46473849-bdf5-4109-bd64-34914e291f60/contacts/5566982851540
```

**Response:**
```json
{
  "jid": "556696285154@s.whatsapp.net",
  "phoneNumber": "556696285154",
  "status": "Hey there! I am using WhatsApp.",
  "profilePicture": "https://pps.whatsapp.net/...",
  "timestamp": "2025-12-29T15:30:00.000Z"
}
```

---

### 3. Verificar se Número Existe no WhatsApp

**GET** `/whatsapp/:id/check-number/:phoneNumber`

Verifica se um número de telefone está registrado no WhatsApp.

**Parameters:**
- `id` - ID da sessão
- `phoneNumber` - Número a verificar

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Exemplo:**
```bash
GET /whatsapp/46473849-bdf5-4109-bd64-34914e291f60/check-number/5566982851540
```

**Response:**
```json
{
  "phoneNumber": "5566982851540",
  "exists": true,
  "timestamp": "2025-12-29T15:30:00.000Z"
}
```

---

### 5. Listar Contatos

**GET** `/whatsapp/:id/contacts`

Lista todos os contatos da sessão.

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Response:**
```json
{
  "sessionId": "session-1767016255334-kbk3qqj",
  "total": 0,
  "contacts": []
}
```

⚠️ **Nota**: Requer implementação de store customizado. Por padrão retorna array vazio.

---

### 6. Listar Chats Ativos

**GET** `/whatsapp/:id/chats`

Lista todos os chats ativos (conversas individuais e grupos).

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Response:**
```json
{
  "sessionId": "session-1767016255334-kbk3qqj",
  "total": 0,
  "chats": []
}
```

⚠️ **Nota**: Requer implementação de store customizado. Por padrão retorna array vazio.

---

### 7. Buscar Metadados de Grupo

**GET** `/whatsapp/:id/groups/:groupId`

Busca informações detalhadas de um grupo específico.

**Parameters:**
- `id` - ID da sessão
- `groupId` - ID do grupo (formato: `120363123456789012@g.us`)

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Exemplo:**
```bash
GET /whatsapp/46473849-bdf5-4109-bd64-34914e291f60/groups/120363123456789012@g.us
```

**Response:**
```json
{
  "id": "120363123456789012@g.us",
  "subject": "Nome do Grupo",
  "owner": "556696285154@s.whatsapp.net",
  "creation": 1703001234,
  "size": 25,
  "participants": [
    {
      "id": "556696285154@s.whatsapp.net",
      "isAdmin": true,
      "isSuperAdmin": true
    },
    {
      "id": "5511987654321@s.whatsapp.net",
      "isAdmin": false,
      "isSuperAdmin": false
    }
  ],
  "desc": "Descrição do grupo",
  "descOwner": "556696285154@s.whatsapp.net"
}
```

---

### 8. Listar Mensagens de um Chat

**GET** `/whatsapp/:id/chats/:chatId/messages`

Lista as últimas mensagens de um chat específico.

**Parameters:**
- `id` - ID da sessão
- `chatId` - ID do chat (formato: `5566982851540@s.whatsapp.net` ou `120363123456789012@g.us` para grupos)
- `limit` (opcional) - Número máximo de mensagens (padrão: 50)

**Headers:**
```
Authorization: Bearer <jwt-token>
```

**Exemplo:**
```bash
GET /whatsapp/46473849-bdf5-4109-bd64-34914e291f60/chats/5566982851540@s.whatsapp.net/messages?limit=50
```

**Response:**
```json
{
  "sessionId": "session-1767016255334-kbk3qqj",
  "chatId": "5566982851540@s.whatsapp.net",
  "total": 0,
  "messages": []
}
```

⚠️ **Nota**: Requer implementação de store customizado para salvar mensagens. Por padrão retorna array vazio. 
Para implementar, salve as mensagens do evento `messages.upsert` no banco de dados.

---

### 4. Enviar Mensagem Manual

**POST** `/whatsapp/:id/send-message`

Envia mensagem manual para qualquer número através da sessão ativa.

**Headers:**
```
Authorization: Bearer <jwt-token>
Content-Type: application/json
```

#### Opção 1: Mensagem de Texto Simples

**Body:**
```json
{
  "to": "5566982851540",
  "text": "Olá! Esta é uma mensagem de teste."
}
```

#### Opção 2: Mensagem com Imagem

**Body:**
```json
{
  "to": "5566982851540",
  "image": "https://example.com/imagem.jpg",
  "caption": "Veja esta imagem!"
}
```

#### Opção 3: Mensagem com Documento

**Body:**
```json
{
  "to": "5566982851540",
  "document": {
    "url": "https://example.com/documento.pdf",
    "mimetype": "application/pdf",
    "fileName": "relatorio.pdf"
  }
}
```

#### Opção 4: Mensagem com Texto + Imagem

**Body:**
```json
{
  "to": "5566982851540",
  "text": "Veja esta imagem",
  "image": "https://example.com/imagem.jpg",
  "caption": "Legenda da imagem"
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "3EB0D3F8D3A5BF2C4D1E",
  "to": "5566982851540",
  "timestamp": "2025-12-29T15:30:00.000Z"
}
```

**Error Response:**
```json
{
  "statusCode": 400,
  "message": "Failed to send message",
  "error": "Bad Request"
}
```

---

## 🔐 Autenticação

Todos os endpoints requerem autenticação JWT no header:

```
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

O token deve ser de um usuário com role **ADMIN** ou **MASTER**.

---

## 📝 Exemplos de Uso com cURL

### Obter metadados da sessão
```bash
curl -X GET \
  http://localhost:4444/whatsapp/46473849-bdf5-4109-bd64-34914e291f60/metadata \
  -H 'Authorization: Bearer <token>'
```

### Listar contatos
```bash
curl -X GET \
  http://localhost:4444/whatsapp/46473849-bdf5-4109-bd64-34914e291f60/contacts \
  -H 'Authorization: Bearer <token>'
```

### Listar chats ativos
```bash
curl -X GET \
  http://localhost:4444/whatsapp/46473849-bdf5-4109-bd64-34914e291f60/chats \
  -H 'Authorization: Bearer <token>'
```

### Buscar metadados de grupo
```bash
curl -X GET \
  http://localhost:4444/whatsapp/46473849-bdf5-4109-bd64-34914e291f60/groups/120363123456789012@g.us \
  -H 'Authorization: Bearer <token>'
```

### Listar mensagens de um chat
```bash
curl -X GET \
  "http://localhost:4444/whatsapp/46473849-bdf5-4109-bd64-34914e291f60/chats/5566982851540@s.whatsapp.net/messages?limit=50" \
  -H 'Authorization: Bearer <token>'
```

### Buscar informações de contato
```bash
curl -X GET \
  http://localhost:4444/whatsapp/46473849-bdf5-4109-bd64-34914e291f60/contacts/5566982851540 \
  -H 'Authorization: Bearer <token>'
```

### Verificar número
```bash
curl -X GET \
  http://localhost:4444/whatsapp/46473849-bdf5-4109-bd64-34914e291f60/check-number/5566982851540 \
  -H 'Authorization: Bearer <token>'
```

### Enviar mensagem
```bash
curl -X POST \
  http://localhost:4444/whatsapp/46473849-bdf5-4109-bd64-34914e291f60/send-message \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "to": "5566982851540",
    "text": "Olá! Esta é uma mensagem de teste."
  }'
```

---

## ⚠️ Notas Importantes

1. **Sessão deve estar conectada**: Todos os endpoints requerem que a sessão esteja ativa e conectada
2. **Formato do número**: Aceita números com ou sem código do país, com ou sem formatação
3. **Rate limiting**: WhatsApp pode bloquear a conta se enviar muitas mensagens em curto período
4. **Validação**: O endpoint de envio de mensagem requer pelo menos `text`, `image` ou `document`
5. **Store Customizado**: Listagem de contatos, chats e mensagens requer implementação de store customizado para persistência
6. **Histórico de Mensagens**: Para carregar histórico, é necessário salvar mensagens do evento `messages.upsert` no banco de dados

---

## 🔌 Eventos WebSocket em Tempo Real

O sistema emite eventos via WebSocket quando mensagens são enviadas ou recebidas:

### Conectar ao WebSocket

```javascript
const socket = io('ws://localhost:4444/ws', {
  auth: {
    token: 'Bearer <jwt-token>'
  }
});

// Inscrever-se para receber eventos de uma sessão específica
socket.emit('subscribe:session', { sessionId: 'session-1767016255334-kbk3qqj' });
```

### Eventos Disponíveis

#### 1. Mensagem Enviada
**Evento:** `message:sent`

```json
{
  "sessionId": "session-1767016255334-kbk3qqj",
  "to": "5566982851540@s.whatsapp.net",
  "messageId": "3EB0D3F8D3A5BF2C4D1E",
  "text": "Olá! Esta é uma mensagem de teste.",
  "timestamp": "2025-12-29T15:30:00.000Z"
}
```

#### 2. Mensagem Recebida
**Evento:** `message:received`

```json
{
  "sessionId": "session-1767016255334-kbk3qqj",
  "from": "5566982851540@s.whatsapp.net",
  "messageId": "3EB0D3F8D3A5BF2C4D1E",
  "text": "Resposta do contato",
  "fromMe": false,
  "timestamp": 1735491000
}
```

#### 3. QR Code Gerado
**Evento:** `qr`

```json
{
  "sessionId": "session-1767016255334-kbk3qqj",
  "qr": "2@abc123...",
  "timestamp": "2025-12-29T15:30:00.000Z"
}
```

#### 4. QR Code Escaneado
**Evento:** `qr:scanned`

```json
{
  "sessionId": "session-1767016255334-kbk3qqj",
  "success": true,
  "timestamp": "2025-12-29T15:30:00.000Z"
}
```

#### 5. Sessão Conectada
**Evento:** `session:connected`

```json
{
  "sessionId": "session-1767016255334-kbk3qqj",
  "timestamp": "2025-12-29T15:30:00.000Z"
}
```

#### 6. Sessão Desconectada
**Evento:** `session:disconnected`

```json
{
  "sessionId": "session-1767016255334-kbk3qqj",
  "reason": "Connection Failure",
  "timestamp": "2025-12-29T15:30:00.000Z"
}
```

### Exemplo de Cliente WebSocket

```javascript
const socket = io('ws://localhost:4444/ws', {
  auth: {
    token: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...'
  }
});

socket.on('connected', (data) => {
  console.log('✅ Connected to WebSocket', data);
  
  // Inscrever-se para receber eventos da sessão
  socket.emit('subscribe:session', { 
    sessionId: 'session-1767016255334-kbk3qqj' 
  });
});

// Escutar eventos de mensagens
socket.on('message:sent', (data) => {
  console.log('📤 Mensagem enviada:', data);
  // Atualizar UI com mensagem enviada
});

socket.on('message:received', (data) => {
  console.log('📥 Mensagem recebida:', data);
  // Atualizar UI com nova mensagem
  // Mostrar notificação para o usuário
});

// Escutar eventos de QR code
socket.on('qr', (data) => {
  console.log('📱 QR Code:', data.qr);
  // Exibir QR code na tela
});

socket.on('qr:scanned', (data) => {
  console.log('✅ QR Code escaneado!', data);
  // Esconder QR code e mostrar mensagem de sucesso
});

// Escutar eventos de conexão
socket.on('session:connected', (data) => {
  console.log('✅ Sessão conectada:', data);
  // Atualizar status da sessão na UI
});

socket.on('session:disconnected', (data) => {
  console.log('❌ Sessão desconectada:', data);
  // Mostrar alerta de desconexão
});
```

---

## ⚠️ Notas Importantes (Atualizado)

### 1. Dashboard Admin
- Visualizar informações da sessão conectada
- Buscar e validar contatos antes de enviar mensagens

### 2. Envio Manual de Mensagens
- Suporte ao cliente direto do admin
- Notificações importantes para usuários específicos

### 3. Validação de Números
- Verificar se números existem antes de cadastrar
- Limpar base de dados de números inválidos

### 4. Análise de Contatos
- Extrair informações de status e perfil
- Análise de disponibilidade de contatos
