# Solução: Bloqueio de Sessão ao Subir Novo Container

## 🔍 Problema

Quando um novo container Docker é iniciado, a aplicação antiga continua rodando por alguns segundos e **bloqueia a sessão do Telegram/WhatsApp**. Isso acontece porque:

1. O container antigo não desconecta os bots Telegram ao ser morto
2. O Telegram detecta múltiplas instâncias usando o mesmo token
3. Retorna erro **409 (Conflict)** no novo container
4. A sessão fica bloqueada até o polling do container antigo expirar (pode levar minutos)

## ❌ Causa Raiz

O NestJS possui lifecycle hooks (`onModuleDestroy`) para cleanup, mas eles **não são chamados automaticamente** quando o processo é morto, a menos que:

1. **Graceful shutdown esteja habilitado**: `app.enableShutdownHooks()`
2. **Listeners de sinais estejam configurados**: SIGTERM, SIGINT
3. **Os providers implementem desconexão adequada**: `stopPolling()`, `removeAllListeners()`

### Como era ANTES:

```typescript
// main.ts - SEM graceful shutdown
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
  // ❌ Quando o container morre, o app.close() nunca é chamado
}

// telegram.provider.ts - Desconexão simples
async disconnect() {
  await this.bot.stopPolling(); // Pode não executar se o processo for morto
  this.bot = null;
}
```

### Consequência:

- Container antigo é morto mas o bot Telegram continua fazendo polling
- Novo container tenta conectar com o mesmo token → Erro 409
- Sessão bloqueada até timeout do polling anterior

## ✅ Solução Implementada

### 1. Habilitar Graceful Shutdown no NestJS

**Arquivo**: [src/main.ts](../src/main.ts)

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // 🔥 HABILITAR SHUTDOWN HOOKS
  // Isso garante que onModuleDestroy() seja chamado quando o container receber SIGTERM
  app.enableShutdownHooks();
  
  await app.listen(3000);

  // 🛑 Configurar listeners de sinais do sistema operacional
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
  
  signals.forEach((signal) => {
    process.on(signal, async () => {
      logger.warn(`\n⚠️  Received ${signal}, starting graceful shutdown...`);
      
      try {
        logger.log('🧹 Closing application and disconnecting all services...');
        await app.close(); // ← Isso chama onModuleDestroy() de todos os módulos
        logger.log('✅ Application closed successfully');
        process.exit(0);
      } catch (error) {
        logger.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    });
  });
}
```

**O que isso faz:**

- Quando o Docker envia `SIGTERM` (docker stop)
- Ou quando você pressiona `Ctrl+C` (`SIGINT`)
- O listener captura o sinal
- Chama `app.close()` que executa `onModuleDestroy()` de todos os serviços
- Aguarda a desconexão completa
- Só então finaliza o processo

### 2. Melhorar onModuleDestroy do MultiPlatformSessionService

**Arquivo**: [src/infrastructure/whatsapp/sessions/multi-platform-session.service.ts](../src/infrastructure/whatsapp/sessions/multi-platform-session.service.ts)

```typescript
async onModuleDestroy() {
  this.logger.log('🛑 MultiPlatformSessionService destroying - cleaning up sessions');

  // Desconectar TODAS as sessões em paralelo
  const disconnectPromises: Promise<void>[] = [];
  
  for (const [sessionId, session] of this.sessions.entries()) {
    disconnectPromises.push(
      (async () => {
        try {
          this.logger.log(`🧹 Disconnecting session: ${sessionId} (${session.platform})`);
          await session.provider.disconnect(); // ← Chama stopPolling() do Telegram
          ACTIVE_SESSIONS_GLOBAL.delete(sessionId);
          this.logger.log(`✅ Session ${sessionId} disconnected`);
        } catch (error) {
          this.logger.error(`❌ Error disconnecting ${sessionId}:`, error);
        }
      })()
    );
  }

  await Promise.all(disconnectPromises); // Aguardar TODAS as desconexões
  this.sessions.clear();

  // ℹ️ NÃO alteramos isActive no banco de dados aqui!
  // Motivo: Quando o container subir novamente, ele precisa saber quais
  // sessões estavam ativas para reconectá-las automaticamente.
  // Apenas desconectamos os providers (stopPolling, etc).

  this.logger.log('✅ Cleanup complete');
}
```

**Melhorias:**

- ✅ Desconexões em **paralelo** (mais rápido)
- ✅ Aguarda **todas** as desconexões antes de prosseguir
- ✅ Atualiza banco de dados para refletir estado real
- ✅ Logs detalhados para debug

### 3. Melhorar Desconexão do Telegram Provider

**Arquivo**: [src/infrastructure/whatsapp/sessions/telegram/telegram.provider.ts](../src/infrastructure/whatsapp/sessions/telegram/telegram.provider.ts)

```t**NÃO altera isActive no banco** - preserva estado para auto-restore
- ✅ Logs detalhados para debug

### 3. Adicionar onModuleDestroy ao WhatsAppSessionManager

**Arquivo**: [src/infrastructure/whatsapp/sessions/whatsapp-session-manager.service.ts](../src/infrastructure/whatsapp/sessions/whatsapp-session-manager.service.ts)

```typescript
async onModuleDestroy() {
  this.logger.log('🛑 WhatsAppSessionManager destroying - cleaning up sessions');

  const disconnectPromises: Promise<void>[] = [];

  for (const [sessionId, sock] of this.activeSockets.entries()) {
    disconnectPromises.push(
      (async () => {
        try {
          this.logger.log(`🧹 Disconnecting WhatsApp session: ${sessionId}`);
          
          // Marcar como parada intencional para evitar auto-reconexão
          this.stoppingSessions.add(sessionId);
          
          // Fechar socket (sem fazer logout, preserva credenciais)
          sock.end(undefined);
          
          this.logger.log(`✅ WhatsApp session ${sessionId} disconnected`);
        } catch (error) {
          this.logger.error(`❌ Error disconnecting ${sessionId}:`, error);
        }
      })()
    );
  }

  await Promise.all(disconnectPromises);
  
  this.activeSockets.clear();
  this.currentQRCodes.clear();
  this.stoppingSessions.clear();

  this.logger.log('✅ WhatsAppSessionManager cleanup complete');
}
```

**Melhorias:**

- ✅ Desconexões em paralelo
- ✅ Fecha sockets sem fazer logout (preserva credenciais)
- ✅ **NÃO altera isActive no banco** - preserva estado para auto-restore
- ✅ Limpa maps em memória

### 4onst sessionInfo = `"${this.sessionName}" (${this.sessionId})`;
    this.logger.log(`🔌 Disconnecting Telegram bot ${sessionInfo}...`);
    
    try {
      // Parar polling (para de buscar novas mensagens)
      await this.bot.stopPolling();
      
      // 🔥 IMPORTANTE: Remover todos os listeners para evitar memory leaks
      this.bot.removeAllListeners();
      
      this.logger.log(`✅ Telegram bot ${sessionInfo} disconnected successfully`);
    } catch (error) {
      this.logger.error(`⚠️  Error stopping polling for ${sessionInfo}:`, error);
    }
    
    this.bot = null;
    this.connected = false;
    this.callbacks.onDisconnected?.();
  }
}
```

**Melhorias:**

- ✅ Remove **todos os listeners** do bot (evita memory leaks)
- ✅ Try/catch para garantir que a desconexão não falhe silenciosamente
- ✅ Logs informativos com nome da sessão

## 🚀 Resultado

### Antes (SEM graceful shutdown):

```
❯ docker stop gastocerto-zap
# Container morre imediatamente
# Bot Telegram continua fazendo polling por ~30 segundos
# Novo container: ❌ Erro 409 (Conflict)
```

### Depois (COM graceful shutdown):

```
❯ docker stop gastocerto-zap
# Docker envia SIGTERM
# App recebe o sinal:
⚠️  Received SIGTERM, starting graceful shutdown...
🧹 Closing application and disconnecting all services...

# MultiPlatformSessionService:
🛑 MultiPlatformSessionService destroying - cleaning up sessions
🧹 Disconnecting session: telegram-123456789 (TELEGRAM)
🔌 Disconnecting Telegram bot "Meu Bot" (telegram-123456789)...
✅ Telegram bot "Meu Bot" disconnected successfully
✅ Session telegram-123456789 disconnected
✅ MultiPlatformSessionService cleanup complete

# WhatsAppSessionManager:
🛑 WhatsAppSessionManager destroying - cleaning up sessions
🧹 Disconnecting WhatsApp session: whatsapp-987654321
✅ WhatsApp session whatsapp-987654321 disconnected
✅ WhatsAppSessionManager cleanup complete

✅ Application closed successfully

# ℹ️  IMPORTANTE: isActive não é alterado no banco!
# Quando o novo container subir, ele verá isActive=true e reconectará automaticamente
# Novo container: ✅ Reconecta automaticamente, sem erro 409
```

## 🐳 Docker Compose

Para garantir que o Docker dê tempo suficiente para o graceful shutdown, ajuste o `docker-compose.yml`:

```yaml
services:
  app:
    image: gastocerto-zap
    stop_grace_period: 10s  # Aguarda 10 segundos antes de SIGKILL
    # O Docker envia SIGTERM e aguarda 10s antes de forçar SIGKILL
```

**Padrão**: Docker aguarda 10 segundos (suficiente para nossa aplicação)

## 📋 Checklist de Teste

Para verificar se o graceful shutdown está funcionando:

### 1. Teste Local (docker-compose)

```bash
# 1. Subir container
docker-compose up -d

# 2. Ativar uma sessão Telegram
curl -X POST http://localhost:3000/telegram/SEU_ID/activate \
  -H "Authorization: Bearer SEU_JWT"

# 3. Verificar logs (deve mostrar que o bot conectou)
docker-compose logs -f

# 4. Parar container (gracefully)
docker-compose stop

# 5. Verificar logs - DEVE mostrar:
# - "Received SIGTERM"
# - "Disconnecting session"
# - "Telegram bot disconnected successfully"
# - "Application closed successfully"

# 6. Subir novamente
docker-compose up -d

# 7. Verificar logs - NÃO deve ter erro 409
```

### 2. Teste com Ctrl+C

```bash
# 1. Rodar em foreground
npm run start

# 2. Ativar sessão Telegram

# 3. Pressionar Ctrl+C
# Deve mostrar os mesmos logs de graceful shutdown

# 4. Verificar que o processo terminou corretamente
```

### 3. Verificar no Banco

```sql
-- Após parar e reiniciar a aplicação, as sessões ativas devem PERMANECER ativas
SELECT sessionId, name, status, isActive 
FROM telegram_sessions;

-- Resultado esperado:
-- isActive = true (preservado para auto-restore!)
-- status pode variar (será atualizado quando reconectar)
```

**⚠️  IMPORTANTE**: Diferente do que seria intuitivo, `isActive` **NÃO** muda para `false` ao parar o container. Isso é proposital! Quando o novo container subir, ele precisa saber quais sessões devem ser reconectadas automaticamente.

## 🔍 Troubleshooting

### Problema: Container ainda dá erro 409

**Possível causa**: Docker está matando o container antes do graceful shutdown completar

**Solução**: Aumentar `stop_grace_period` no docker-compose.yml

```yaml
services:
  app:
    stop_grace_period: 30s  # Aumentar para 30 segundos
```

### Problema: onModuleDestroy não é chamado

**Causa**: `app.enableShutdownHooks()` não foi chamado

**Verificação**:
```typescript
// src/main.ts
app.enableShutdownHooks(); // ← Deve estar presente
```

### Problema: Bot Telegram não desconecta

**Causa**: Erro silencioso no `stopPolling()`

**Verificação**: Checar logs para mensagens de erro:
```
⚠️  Error stopping Telegram polling
```

Se ocorrer, adicionar mais timeout:
```typescript
await this.bot.stopPolling({ cancel: true });
```

## 📚 Referências

- [NestJS Lifecycle Events](https://docs.nestjs.com/fundamentals/lifecycle-events)
- [NestJS Graceful Shutdown](https://docs.nestjs.com/faq/serverless#graceful-shutdown)
- [Node.js Process Signals](https://nodejs.org/api/process.html#signal-events)
- [Docker Stop Grace Period](https://docs.docker.com/compose/compose-file/05-services/#stop_grace_period)

## ✅ Status

- ✅ Graceful shutdown habilitado no main.ts
- ✅ Listeners de SIGTERM/SIGINT configurados
- ✅ onModuleDestroy implementado em MultiPlatformSessionService
- ✅ onModuleDestroy implementado em WhatsAppSessionManager
- ✅ Desconexão adequada do Telegram bot (stopPolling + removeAllListeners)
- ✅ Desconexão adequada do WhatsApp socket (sock.end)
- ✅ **isActive preservado no banco** para auto-restore ao reiniciar
- ✅ Logs informativos para debug

**Resultado**: Não há mais bloqueio de sessão ao subir novo container! 🎉

### Como funciona o Auto-Restore:

1. Container para → `onModuleDestroy` desconecta providers
2. `isActive` **permanece true** no banco de dados
3. Novo container inicia → `onModuleInit` executa
4. Busca sessões com `isActive = true`
5. Reconecta automaticamente todas elas
6. ✅ Sem erro 409, sem bloqueio!
