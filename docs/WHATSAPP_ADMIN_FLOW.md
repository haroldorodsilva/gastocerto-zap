# 📱 Fluxo de Administração do WhatsApp

## ✅ Status: PRONTO PARA USO

Todo o fluxo de administração de sessões WhatsApp e processamento de mensagens está **completo e funcional**.

---

## 🔄 Fluxo Completo de Uso

### 1️⃣ **Criar Sessão**
```http
POST /admin/whatsapp/sessions
Content-Type: application/json

{
  "sessionId": "whatsapp-simple-session",
  "name": "Sessão Principal",
  "phoneNumber": "5511999999999"
}
```

**Resposta:**
```json
{
  "id": "uuid-da-sessao",
  "sessionId": "whatsapp-simple-session",
  "phoneNumber": "5511999999999",
  "name": "Sessão Principal",
  "status": "DISCONNECTED",
  "isActive": false
}
```

---

### 2️⃣ **Ativar Sessão (Gerar QR Code)**
```http
POST /admin/whatsapp/sessions/{id}/activate
```

**O que acontece:**
1. ✅ Sistema verifica se sessão está `active = true` no banco
2. ✅ Inicia conexão Baileys
3. ✅ Gera QR Code no terminal/logs
4. ⏳ Aguarda scan do QR Code
5. ✅ Salva credenciais em `.auth_info/`
6. ✅ Salva sessão no banco (`status: CONNECTED`)

**Resposta:**
```json
{
  "id": "uuid-da-sessao",
  "sessionId": "whatsapp-simple-session",
  "phoneNumber": "5511999999999",
  "status": "CONNECTING",
  "isActive": true
}
```

**QR Code aparece nos logs:**
```
🚀 Iniciando WhatsApp simples...
✅ Sessão ativa no banco de dados
📁 Criando diretório de autenticação
🆕 Nenhuma credencial encontrada. Será necessário escanear QR Code.
📱 Baileys version: 7.0.0 (latest: true)

████████████████████████████
██ ▄▄▄▄▄ █▀▄▀█▄▄ ▀▄▄█ ▄▄▄▄▄ ██
██ █   █ █ ▄▀▄ ▀█▀ ██ █   █ ██
...
```

---

### 3️⃣ **Usuário Escaneia QR Code**

Após scan bem-sucedido:
1. ✅ Credenciais salvas automaticamente
2. ✅ Status atualizado para `CONNECTED` no banco
3. ✅ Sistema pronto para receber mensagens

**Logs:**
```
✅ WhatsApp conectado!
👤 Nome: Seu Nome
📱 ID: 5511999999999@s.whatsapp.net
💾 Credenciais salvas
💾 Sessão salva no banco de dados
```

---

### 4️⃣ **Processar Mensagens Recebidas**

Quando usuário envia mensagem:

```
📩 ========== NOVA MENSAGEM ==========
📱 ID: 3EB0XXXXX
👤 From: 5511888888888@s.whatsapp.net
📅 Timestamp: 2025-12-26T20:30:00.000Z
💬 [CONVERSATION] Texto: "teste"
👤 Nome do remetente: João Silva
🔄 Processando mensagem através do handler...
✅ Mensagem enviada para processamento
```

**Fluxo de processamento:**
1. ✅ Baileys recebe mensagem
2. ✅ Filtra por `TEST_PHONE_NUMBER` (se configurado)
3. ✅ Emite evento `whatsapp.message`
4. ✅ `WhatsAppMessageHandler` processa
5. ✅ Enfileira no Bull Queue
6. ✅ Rota para `OnboardingService` ou `TransactionsService`
7. ✅ Responde ao usuário

---

## 🎯 Configuração de Ambiente

### Variáveis ENV

```env
# Modo de teste - DEIXE VAZIO para processar todas as mensagens
TEST_PHONE_NUMBER=

# Para testar com um número específico
# TEST_PHONE_NUMBER=5511999999999
```

**Comportamento:**

| `TEST_PHONE_NUMBER` | Comportamento |
|---------------------|---------------|
| Vazio (`""`) | Processa **todas** as mensagens de usuários |
| `5511999999999` | Processa **apenas** mensagens deste número |

---

## 🔐 Controle de Ativação

### Sessão Ativa vs Inativa

A sessão **só é iniciada** se `active = true` no banco de dados.

```sql
-- Verificar status da sessão
SELECT "sessionId", "active", "status" 
FROM "WhatsAppSession" 
WHERE "sessionId" = 'whatsapp-simple-session';

-- Ativar sessão
UPDATE "WhatsAppSession" 
SET "active" = true 
WHERE "sessionId" = 'whatsapp-simple-session';

-- Desativar sessão
UPDATE "WhatsAppSession" 
SET "active" = false 
WHERE "sessionId" = 'whatsapp-simple-session';
```

---

## 📁 Arquitetura

```
src/infrastructure/whatsapp/
├── simple-whatsapp-init.ts           # ⭐ Implementação Baileys (350 linhas)
│   ├── initializeSimpleWhatsApp()    # Inicializa conexão
│   ├── sendWhatsAppMessage()         # Envia mensagens
│   ├── setupWhatsAppIntegration()    # Configura handler
│   └── isSessionActive()             # Verifica se active=true
│
├── whatsapp-integration.service.ts   # 🔌 Serviço de integração
│   ├── onModuleInit()                # Configura handler (não inicia)
│   ├── initializeWhatsApp()          # Inicia sob demanda
│   └── sendMessage()                 # Envia mensagem
│
└── sessions/
    ├── session-manager.service.ts    # 🎮 Gerenciamento de sessões
    │   ├── startSession()            # ⭐ Inicia WhatsApp
    │   ├── stopSession()             # Para WhatsApp
    │   └── CRUD operations           # Banco de dados
    │
    └── whatsapp/
        └── whatsapp.controller.ts    # 🌐 API REST
            ├── POST /sessions        # Criar sessão
            ├── POST /:id/activate    # ⭐ Ativar sessão
            ├── POST /:id/deactivate  # Desativar sessão
            └── GET /sessions         # Listar sessões
```

---

## 🚀 Endpoints da API

### Listar Sessões
```http
GET /admin/whatsapp/sessions
```

### Criar Sessão
```http
POST /admin/whatsapp/sessions
{
  "sessionId": "whatsapp-simple-session",
  "name": "Sessão Principal"
}
```

### Buscar Sessão
```http
GET /admin/whatsapp/sessions/{id}
```

### Ativar Sessão (Iniciar WhatsApp)
```http
POST /admin/whatsapp/sessions/{id}/activate
```

### Desativar Sessão
```http
POST /admin/whatsapp/sessions/{id}/deactivate
```

### Deletar Sessão
```http
DELETE /admin/whatsapp/sessions/{id}
```

---

## ✅ Checklist de Funcionalidades

### Administração
- ✅ Criar sessão via API
- ✅ Ativar sessão via API (gera QR Code)
- ✅ QR Code exibido nos logs
- ✅ Scan de QR Code funcional
- ✅ Auto-restore de sessão (após restart)
- ✅ Desativar sessão via API
- ✅ Deletar sessão via API
- ✅ Listar sessões via API
- ✅ Verificar `active = true` antes de iniciar

### Processamento de Mensagens
- ✅ Receber mensagens do WhatsApp
- ✅ Filtrar por `TEST_PHONE_NUMBER` (se configurado)
- ✅ Filtrar mensagens de grupos (ignora)
- ✅ Emitir evento `whatsapp.message`
- ✅ Processar via `WhatsAppMessageHandler`
- ✅ Enfileirar no Bull Queue
- ✅ Rotear para `OnboardingService`
- ✅ Rotear para `TransactionsService`
- ✅ Enviar respostas aos usuários

### Integração
- ✅ Salvar sessão no banco de dados
- ✅ Atualizar status automaticamente
- ✅ Salvar credenciais em `.auth_info/`
- ✅ Auto-restore de credenciais
- ✅ Keep-alive da conexão
- ✅ Logs detalhados

### Segurança
- ✅ Verificar sessão ativa antes de iniciar
- ✅ Filtro por número de teste
- ✅ Ignorar mensagens de grupos
- ✅ Ignorar mensagens enviadas pelo próprio bot

---

## 🧪 Testando o Fluxo

### 1. Iniciar Servidor
```bash
yarn start:dev
```

### 2. Criar e Ativar Sessão
```bash
# Criar sessão
curl -X POST http://localhost:4444/admin/whatsapp/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "whatsapp-simple-session",
    "name": "Teste"
  }'

# Pegar o ID da resposta e ativar
curl -X POST http://localhost:4444/admin/whatsapp/sessions/{id}/activate
```

### 3. Escanear QR Code
- Olhar nos logs do servidor
- Escanear com WhatsApp
- Aguardar conexão

### 4. Enviar Mensagem de Teste
- Enviar "teste" do WhatsApp
- Ver processamento nos logs

---

## 📝 Notas Importantes

### Modo de Teste
- Use `TEST_PHONE_NUMBER` para testar com segurança
- Deixe vazio em produção para processar todas as mensagens
- Mensagens de grupos são **sempre ignoradas**

### Credenciais
- Salvas em `.auth_info/creds.json`
- **NUNCA** commitar este diretório
- Backup manual se necessário

### Sessão Única
- Atualmente suporta **1 sessão ativa** por vez
- `sessionId` fixo: `whatsapp-simple-session`
- Para múltiplas sessões, será necessária refatoração

### Logs
- Nível `info` para operações principais
- Nível `debug` para detalhes de mensagens
- Erros `logger?.trace` são esperados (não críticos)

---

## 🎉 Conclusão

O sistema está **100% funcional** e pronto para:
- ✅ Administração via API
- ✅ Geração de QR Code
- ✅ Recepção de mensagens
- ✅ Processamento automático
- ✅ Respostas aos usuários
- ✅ Modo de teste configurável
- ✅ Controle por sessão ativa

**Status:** PRODUÇÃO READY 🚀
