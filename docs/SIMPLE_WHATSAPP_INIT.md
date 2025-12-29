# WhatsApp Simples - Implementação do Zero

## 🎯 Objetivo

Implementação SIMPLES do WhatsApp usando Baileys, sem toda a complexidade anterior.

**Características:**
- ✅ Inicia direto no `main.ts` junto com o NestJS
- ✅ Salva credenciais em `.auth_info/creds.json`
- ✅ Se não tiver credencial, mostra QR Code no terminal
- ✅ Se tiver credencial, restaura sessão automaticamente
- ✅ Printa TODAS as mensagens recebidas no terminal
- ✅ Marca mensagens como lidas automaticamente
- ✅ Reconecta automaticamente em caso de queda

## 📂 Arquivos

### `simple-whatsapp-init.ts`
Arquivo único com toda a lógica:
- `initializeSimpleWhatsApp()` - Função principal
- `clearWhatsAppCredentials()` - Remove credenciais (forçar novo login)

### Modificações no `main.ts`
```typescript
import { initializeSimpleWhatsApp } from './infrastructure/whatsapp/simple-whatsapp-init';

// Após iniciar NestJS
await initializeSimpleWhatsApp();
```

## 🚀 Como Usar

### 1. Primeira Execução (Novo Login)

```bash
# Remover credenciais antigas se existirem
rm -rf .auth_info

# Iniciar servidor
yarn start:dev
```

**Resultado:**
1. NestJS inicia na porta 3000
2. WhatsApp inicializa
3. **QR Code aparece no terminal**
4. Escanear com WhatsApp do celular
5. Conexão estabelecida
6. Aguardando mensagens...

### 2. Execuções Subsequentes (Sessão Restaurada)

```bash
# Apenas iniciar
yarn start:dev
```

**Resultado:**
1. NestJS inicia
2. WhatsApp detecta credenciais em `.auth_info`
3. Restaura sessão automaticamente
4. Conexão estabelecida em ~3 segundos
5. Aguardando mensagens...

## 📱 Formato das Mensagens Printadas

Cada mensagem recebida é printada no terminal com:

```
================================================================================
📨 Nova mensagem recebida! (type: notify)

📱 ID: 3EB0B1E1234567890ABCDEF
👤 From: 5511999999999@s.whatsapp.net
📅 Timestamp: 2025-12-26T18:30:45.000Z
📝 FromMe: false
💬 Texto: "Gastei 50 reais no supermercado"
👤 Nome: João Silva
✅ Mensagem marcada como lida
================================================================================
```

### Tipos de Mensagens Detectadas

| Tipo | Emoji | Descrição |
|------|-------|-----------|
| Texto simples | 💬 | `msg.message.conversation` |
| Texto estendido | 💬 | `msg.message.extendedTextMessage.text` |
| Imagem com caption | 🖼️ | `msg.message.imageMessage.caption` |
| Vídeo com caption | 🎥 | `msg.message.videoMessage.caption` |
| Documento | 📎 | `msg.message.documentMessage.fileName` |
| Áudio | 🎵 | `msg.message.audioMessage` |
| Sticker | 😀 | `msg.message.stickerMessage` |
| Outros | 📦 | JSON completo |

## 🔧 Configurações

### Diretório de Credenciais
```typescript
const AUTH_DIR = path.join(process.cwd(), '.auth_info');
```
- Local: `gastocerto-zap/.auth_info/`
- Arquivo principal: `creds.json`
- Outros arquivos: `app-state-sync-*.json`, `session-*.json`

### Informações do Browser
```typescript
browser: ['GastoCerto-ZAP', 'Chrome', '10.0.0']
```
- Aparece como "GastoCerto-ZAP (Chrome)" no WhatsApp Web

### QR Code no Terminal
```typescript
printQRInTerminal: true
```
- QR Code é renderizado diretamente no terminal
- Escanear com câmera do WhatsApp

## 📊 Events Capturados

### 1. `creds.update`
- Salva credenciais automaticamente
- Acionado após login bem-sucedido
- Acionado periodicamente para manter sessão

### 2. `connection.update`
- **`qr`**: QR Code gerado
- **`connecting`**: Tentando conectar
- **`open`**: Conectado com sucesso
- **`close`**: Conexão fechada (reconecta se não for logout)

### 3. `messages.upsert`
- **Mensagens novas** recebidas
- Type pode ser: `notify`, `append`
- Printa cada mensagem no terminal

### 4. `messages.update`
- Status de mensagem atualizado
- Reações recebidas
- Mensagens deletadas

### 5. `presence.update`
- Online/Offline
- Digitando
- Gravando áudio

### 6. `groups.update`
- Nome do grupo alterado
- Descrição alterada
- Configurações do grupo

## 🔄 Reconexão Automática

### Em caso de queda:

```typescript
if (shouldReconnect) {
  logger.log('🔄 Reconectando...');
  setTimeout(() => initializeSimpleWhatsApp(), 3000);
}
```

**Não reconecta apenas se:**
- `DisconnectReason.loggedOut` - Usuário deslogou do WhatsApp

**Reconecta em casos de:**
- Erro de rede
- Timeout
- Servidor do WhatsApp reiniciou
- Erro 515 (pós-autenticação)
- Qualquer outro erro temporário

## 🗑️ Limpar Credenciais

### Método 1: Manual
```bash
rm -rf .auth_info
```

### Método 2: Programático
```typescript
import { clearWhatsAppCredentials } from './simple-whatsapp-init';
clearWhatsAppCredentials();
```

## 🔍 Debug

### Ver logs detalhados:
```typescript
// No simple-whatsapp-init.ts, alterar:
logger: {
  level: 'debug', // ou 'trace'
  // ...
}
```

### Níveis disponíveis:
- `silent` - Nenhum log (padrão)
- `fatal` - Apenas erros fatais
- `error` - Erros
- `warn` - Avisos
- `info` - Informações
- `debug` - Debug detalhado
- `trace` - Tudo

## ⚠️ Observações Importantes

### 1. Erro 515 (Pós-Autenticação)
```
❌ Conexão fechada. Status: 515
Reason: Connection Closed
🔄 Reconectando...
```
- **Normal** após escanear QR Code
- Sistema reconecta automaticamente
- Sessão é restaurada com sucesso

### 2. Timeout de QR Code
- QR Code expira em ~60 segundos
- Novo QR é gerado automaticamente
- Escanear assim que aparecer

### 3. WhatsApp Bloqueando (Erro 515 Imediato)
```
❌ Conexão fechada. Status: 515
[ANTES de mostrar QR Code]
```
- IP/dispositivo temporariamente bloqueado
- **Solução**: Aguardar 15-30 minutos
- Alternativa: Usar IP diferente (VPN, outro Wi-Fi)
- Alternativa: Usar outro dispositivo

### 4. Múltiplas Tentativas
- Evitar múltiplas tentativas em curto período
- WhatsApp detecta como spam
- Aguardar cooldown entre tentativas

## 🎯 Próximos Passos

### 1. Integrar com Sistema Existente
- [ ] Passar mensagens para o processador de transações
- [ ] Integrar com RAG/IA
- [ ] Enviar respostas de volta

### 2. Adicionar Envio de Mensagens
```typescript
await sock.sendMessage(jid, { text: 'Olá!' });
```

### 3. Gerenciar Múltiplas Sessões
- Mover lógica para service
- Criar por usuário/empresa
- Persistir no banco de dados

### 4. Adicionar à API REST
- Endpoint para iniciar sessão
- Endpoint para obter QR Code
- Endpoint para status

## 📝 Comparação: Antes vs Agora

### ❌ Implementação Anterior
- ~2000 linhas de código
- Múltiplos arquivos (provider, factory, manager, state)
- Auto-restore complexo
- Timers e debouncing
- Error handling extensivo
- Difícil de debugar

### ✅ Implementação Atual
- ~200 linhas de código
- 1 arquivo único
- Lógica linear e simples
- Eventos diretos do Baileys
- Fácil de entender e modificar
- Logs claros

## 🔗 Referências

- **Baileys**: https://github.com/WhiskeySockets/Baileys
- **Multi-Device API**: https://github.com/WhiskeySockets/Baileys/blob/master/docs/md.md
- **Exemplos**: `zap-test-files/` (teste bem-sucedido)

## 🚀 Status Atual

- ✅ Compilação: OK
- ✅ Código criado: `simple-whatsapp-init.ts`
- ✅ Main.ts modificado
- ⏳ Teste prático: Aguardando
- ⏳ Integração com sistema: Próximo passo
