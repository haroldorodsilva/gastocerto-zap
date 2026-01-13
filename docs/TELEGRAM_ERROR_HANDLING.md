# Tratamento de Erros do Telegram

## 🔍 Problema Identificado

Quando ocorria erro **401 Unauthorized** do Telegram (token inválido), a aplicação:
1. ❌ Continuava tentando fazer polling infinitamente
2. ❌ Gerava milhares de logs de erro
3. ❌ O WhatsAppGateway (nome confuso) logava erros de Telegram

## ✅ Solução Implementada

### 1. Tratamento de Erro 401 no TelegramProvider

**Arquivo**: [telegram.provider.ts](../src/infrastructure/whatsapp/sessions/telegram/telegram.provider.ts)

```typescript
this.bot.on('polling_error', (error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  // 🛑 Erro 401: Token inválido/expirado
  if (errorMessage.includes('401 Unauthorized') || errorMessage.includes('ETELEGRAM: 401')) {
    this.logger.error(
      `🚫 ERRO 401 - Token inválido na sessão ${sessionInfo}. ` +
      `O bot será desconectado. Atualize o token via @BotFather e reative a sessão.`
    );
    
    // Desconectar IMEDIATAMENTE para parar o loop
    this.disconnect().catch(() => {});
    this.callbacks.onError?.(error);
    return; // ← Importante: não continuar processando
  }
  
  // 🛑 Erro 409: Múltiplas instâncias
  if (errorMessage.includes('409 Conflict')) {
    // ... lógica de erro 409
  }
  
  // Outros erros
  this.callbacks.onError?.(error);
});
```

**O que faz:**
- ✅ Detecta erro 401 do Telegram
- ✅ Desconecta o bot **imediatamente** (stopPolling)
- ✅ Para o loop infinito de erros
- ✅ Chama callback de erro para o MultiPlatformSessionService tratar

### 2. Tratamento de Erro 401 no MultiPlatformSessionService

**Arquivo**: [multi-platform-session.service.ts](../src/infrastructure/whatsapp/sessions/multi-platform-session.service.ts)

```typescript
private async handleError(sessionId: string, error: Error): Promise<void> {
  const errorMsg = error.message || String(error);
  
  // 🛑 Erro 401: Token inválido
  if (errorMsg.includes('401 Unauthorized') || errorMsg.includes('ETELEGRAM: 401')) {
    this.logger.error(
      `🚨 ERRO 401 - Sessão ${sessionId}: Token inválido ou expirado. ` +
      `Desativando sessão automaticamente.`
    );
    
    // Desativar no banco de dados
    if (sessionId.startsWith('telegram-')) {
      await this.prisma.telegramSession.update({
        where: { sessionId },
        data: {
          isActive: false,
          status: SessionStatus.ERROR,
        },
      });
    }
    
    // Remover da memória
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.provider.disconnect().catch(() => {});
      this.sessions.delete(sessionId);
      ACTIVE_SESSIONS_GLOBAL.delete(sessionId);
    }
    
    return; // Não emitir evento session.error (evita spam)
  }
  
  // ... outros erros (409, etc)
}
```

**O que faz:**
- ✅ Atualiza banco: `isActive = false`, `status = ERROR`
- ✅ Remove sessão da memória
- ✅ Logs claros sobre como corrigir (atualizar token)
- ✅ Não emite evento para WebSocket (evita spam)

### 3. Renomeação do Logger do Gateway

**Arquivo**: [whatsapp.gateway.ts](../src/infrastructure/whatsapp/sessions/whatsapp/whatsapp.gateway.ts)

```typescript
export class WhatsAppGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  // ✅ Logger genérico que suporta múltiplas plataformas
  private readonly logger = new Logger('MessagingGateway');
  
  // Este gateway escuta eventos de TODAS as plataformas (WhatsApp + Telegram)
  @OnEvent('session.error')
  handleSessionError(payload: { sessionId: string; error: Error }) {
    this.logger.error(`❌ Session ${payload.sessionId} error: ${payload.error.message}`);
    // ...
  }
}
```

**Por que "MessagingGateway"?**
- O gateway escuta eventos de **todas as plataformas** (WhatsApp, Telegram, etc.)
- O nome `WhatsAppGateway` era confuso quando logava erros de Telegram
- `MessagingGateway` é mais genérico e correto

## 📊 Fluxo de Erro 401

### Antes (Loop Infinito):

```
Token Telegram inválido
    ↓
Bot tenta fazer polling
    ↓
API Telegram retorna 401
    ↓
polling_error é disparado
    ↓
❌ Apenas loga erro, continua tentando
    ↓
Loop infinito: 1000+ erros por minuto
```

### Depois (Parada Imediata):

```
Token Telegram inválido
    ↓
Bot tenta fazer polling
    ↓
API Telegram retorna 401
    ↓
polling_error detecta "401 Unauthorized"
    ↓
✅ TelegramProvider.disconnect() (stopPolling)
    ↓
✅ Callback onError chamado
    ↓
MultiPlatformSessionService.handleError()
    ↓
✅ Atualiza banco (isActive=false, status=ERROR)
    ↓
✅ Remove da memória
    ↓
✅ Bot parado, sem mais erros!
```

## 🛠️ Como Corrigir Erro 401

### 1. Verificar Token Inválido

```bash
# Listar sessões com erro
curl -X GET http://localhost:3000/telegram \
  -H "Authorization: Bearer SEU_JWT"

# Output mostra:
# status: "ERROR"
# isActive: false
```

### 2. Obter Novo Token

1. Abra o Telegram
2. Fale com [@BotFather](https://t.me/BotFather)
3. Comando: `/mybots`
4. Selecione seu bot
5. "API Token" → Copie o novo token

### 3. Atualizar Token na Aplicação

```bash
# Atualizar token da sessão
curl -X PATCH http://localhost:3000/telegram/SEU_ID \
  -H "Authorization: Bearer SEU_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "7123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"
  }'
```

### 4. Reativar Sessão

```bash
# Ativar sessão com novo token
curl -X POST http://localhost:3000/telegram/SEU_ID/activate \
  -H "Authorization: Bearer SEU_JWT"
```

## 🔄 Comparação: 401 vs 409

| Erro | Causa | Ação Automática | Como Resolver |
|------|-------|-----------------|---------------|
| **401 Unauthorized** | Token inválido/expirado | Desconecta e desativa | Atualizar token no banco |
| **409 Conflict** | Múltiplas instâncias | Desconecta após 3 tentativas | Usar tokens diferentes por ambiente |

## 📝 Logs Esperados

### Erro 401 Detectado:

```
[TelegramProvider] 🚫 ERRO 401 - Token inválido na sessão Gasto Hlg (telegram-1767970531497).
                   O bot será desconectado. Atualize o token via @BotFather e reative a sessão.
[TelegramProvider] 🔌 Disconnecting Telegram bot "Gasto Hlg" (telegram-1767970531497)...
[TelegramProvider] ✅ Telegram bot "Gasto Hlg" disconnected successfully
[MultiPlatformSessionService] 🚨 ERRO 401 - Sessão telegram-1767970531497: Token inválido ou expirado.
                               Desativando sessão automaticamente.
[MultiPlatformSessionService] ⚠️  Sessão telegram-1767970531497 foi DESATIVADA por token inválido.
                               Para reativar: 1) Atualize o token com um válido (@BotFather no Telegram),
                               2) Ative a sessão novamente via API: PATCH /telegram/1767970531497
```

### ✅ Sem Loop de Erros

Após a desconexão, **não há mais erros**. A sessão está desativada e aguardando correção manual.

## ✅ Benefícios

1. **Sem Loop Infinito**: Erro 401 para a sessão imediatamente
2. **Logs Limpos**: Apenas 2-3 linhas de log, não mais milhares
3. **Auto-Recovery**: Sessão é desativada automaticamente
4. **Instruções Claras**: Logs explicam exatamente como corrigir
5. **Nome Correto**: Gateway agora se chama "MessagingGateway"

## 🧪 Teste

Para testar o tratamento de erro 401:

```bash
# 1. Criar sessão com token inválido
curl -X POST http://localhost:3000/telegram \
  -H "Authorization: Bearer SEU_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Teste 401",
    "token": "123456:INVALID_TOKEN"
  }'

# 2. Ativar sessão
curl -X POST http://localhost:3000/telegram/SEU_ID/activate \
  -H "Authorization: Bearer SEU_JWT"

# 3. Ver logs - deve mostrar:
# - Erro 401 detectado
# - Bot desconectado
# - Sessão desativada
# - SEM loop de erros

# 4. Verificar banco
curl -X GET http://localhost:3000/telegram/SEU_ID \
  -H "Authorization: Bearer SEU_JWT"

# Output:
# {
#   "status": "ERROR",
#   "isActive": false
# }
```

## 📚 Referências

- [Telegram Bot API - Error Codes](https://core.telegram.org/api/errors)
- [node-telegram-bot-api - Error Handling](https://github.com/yagop/node-telegram-bot-api#error-handling)
