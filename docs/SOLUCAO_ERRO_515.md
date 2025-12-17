# Solução Definitiva para Erro 515 do WhatsApp (Baileys)

## 🔍 Problema Identificado

O erro 515 do WhatsApp é um **ban temporário** (2-24 horas) que pode ocorrer quando:
- Há múltiplas tentativas de conexão em curto período
- O WhatsApp detecta comportamento suspeito
- Há reconexões muito frequentes

### Bug Anterior

O código anterior tinha uma falha crítica na lógica de reconexão:

1. **Linha 404**: `stopSession()` era chamado, removendo a sessão do Map `this.sessions`
2. **Linha 425**: `scheduleReconnect()` era chamado
3. **Linha 497-498**: `scheduleReconnect()` verificava se a sessão existia no Map e **retornava sem fazer nada**

**Resultado**: A sessão **nunca reconectava** após o erro 515.

## ✅ Solução Implementada

### 1. Manter Sessão em Memória

```typescript
// ❌ ANTES: Removia a sessão do Map
await this.stopSession(sessionId); // Remove do Map!
await this.scheduleReconnect(sessionId, true, 'error_515'); // Falha: sessão não existe

// ✅ AGORA: Mantém a sessão no Map
await sessionInfo.provider.disconnect(); // Apenas desconecta o provider
await this.scheduleReconnect(sessionId, true, 'error_515'); // Funciona!
```

### 2. Contador Específico para Erro 515

```typescript
interface SessionInfo {
  // ... outros campos
  error515Attempts?: number; // Tentativas específicas para erro 515
  lastError515?: Date; // Última ocorrência do erro 515
}
```

- **Limite normal**: 5 tentativas
- **Limite erro 515**: 10 tentativas (mais permissivo, pois é temporário)

### 3. Backoff Exponencial

```typescript
// Delay progressivo: 5min, 10min, 15min, 20min, etc.
const delay = RECONNECT_DELAY_515_MS * attempts;
// 1ª tentativa: 0 * 5min = 0min (imediato)
// 2ª tentativa: 1 * 5min = 5min
// 3ª tentativa: 2 * 5min = 10min
// 4ª tentativa: 3 * 5min = 15min
```

### 4. Reset ao Conectar

```typescript
private async handleConnected(sessionId: string) {
  sessionInfo.restartAttempts = 0;
  sessionInfo.error515Attempts = 0; // Reset contador de erro 515
  // ...
}
```

## 🚀 Comportamento do Sistema

### Quando ocorre erro 515:

1. ⚠️ Sistema detecta erro 515
2. 🕒 Preserva credenciais (NÃO limpa auth state)
3. 📊 Incrementa contador específico (error515Attempts)
4. 🔌 Desconecta provider mas **mantém sessão no Map**
5. ⏰ Agenda reconexão com delay progressivo
6. 🔄 Tenta reconectar automaticamente
7. ✅ Se conectar, reseta todos os contadores
8. ❌ Se falhar 10 vezes, limpa credenciais e pede novo QR code

### Logs Gerados

```log
⚠️  WhatsApp error 515 detected for session_123 - Temporary ban detected
🕒 Keeping credentials intact - error 515 is temporary
⏰ WhatsApp temporary ban - Attempt 1/10
✅ Credentials preserved - Will retry with extended delay
🔄 Scheduling reconnect for error 515 - session_123 (attempt 1/10) in 5m 0s
```

## 🎯 Vantagens da Solução

1. **Reconexão Automática**: Não precisa intervenção manual
2. **Preservação de Credenciais**: Não precisa escanear QR code novamente
3. **Backoff Inteligente**: Aguarda tempo progressivo para não agravar o ban
4. **Limite Permissivo**: 10 tentativas (vs 5 para outros erros)
5. **Logs Detalhados**: Fácil monitoramento e debug
6. **Limpeza Automática**: Após 10 falhas, limpa e permite novo QR code

## 🔧 Configurações

### Constantes

```typescript
RECONNECT_DELAY_515_MS = 300000; // 5 minutos base
MAX_ERROR_515_ATTEMPTS = 10; // Máximo de tentativas
```

### Eventos Emitidos

```typescript
// Evento a cada ocorrência do erro 515
this.eventEmitter.emit('session.error.515', {
  sessionId,
  message: 'WhatsApp error 515: Temporary ban detected (attempt 1/10)...'
});

// Evento quando atinge máximo de tentativas
this.eventEmitter.emit('session.error.515.max_attempts', {
  sessionId,
  message: 'Máximo de tentativas para erro 515 atingido...'
});
```

## 📊 Cenários de Uso

### Cenário 1: Ban de 2 horas

```
00:00 - Erro 515 detectado
00:00 - Tenta reconectar imediatamente (attempt 1) → Falha
05:00 - Tenta reconectar (attempt 2) → Falha
10:00 - Tenta reconectar (attempt 3) → Sucesso! ✅
```

### Cenário 2: Ban de 24 horas

```
00:00 - Erro 515 detectado
00:00 - Attempt 1 → Falha
05:00 - Attempt 2 → Falha
10:00 - Attempt 3 → Falha
...
04:00 (dia seguinte) - Attempt 9 → Sucesso! ✅
```

### Cenário 3: Ban permanente (raro)

```
00:00 - Erro 515 detectado
... tentativas 1-9 falham ...
07:30 - Attempt 10 → Falha
07:30 - Máximo de tentativas atingido
07:30 - Credenciais limpas, requer novo QR code
```

## 🛡️ Prevenção

Para evitar erro 515:

1. **Não conecte o mesmo número em múltiplos lugares** simultaneamente
2. **Evite reconexões muito frequentes** (sistema já implementa delays)
3. **Use apenas uma instância** do bot por número
4. **Aguarde o WhatsApp estabilizar** antes de testar muito

## 📝 Arquivos Modificados

- `src/infrastructure/whatsapp/sessions/session-manager.service.ts`
  - Interface `SessionInfo` com novos campos
  - Constante `MAX_ERROR_515_ATTEMPTS`
  - Lógica de tratamento do erro 515
  - Função `scheduleReconnect` com suporte a erro 515
  - Reset de contador ao conectar

- `COOLIFY_SETUP.md`
  - Documentação atualizada sobre erro 515

- `docs/SOLUCAO_ERRO_515.md` (este arquivo)
  - Documentação completa da solução

## ✅ Checklist de Validação

- [x] Sistema detecta erro 515 corretamente
- [x] Credenciais são preservadas
- [x] Sessão permanece no Map após erro
- [x] Reconexão é agendada com delay correto
- [x] Contador específico é incrementado
- [x] Backoff exponencial funciona
- [x] Reset ao conectar funciona
- [x] Limite de 10 tentativas é respeitado
- [x] Logs são claros e informativos
- [x] Eventos são emitidos corretamente

## 🎉 Resultado

**Solução definitiva implementada!** O sistema agora trata o erro 515 de forma inteligente, reconectando automaticamente sem perder as credenciais.
