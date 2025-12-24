# Correção do Erro 515 e Corrupção de Credenciais

## 🐛 Problema Identificado

Durante os testes, foi identificado um fluxo problemático:

1. ✅ Sessão inicia corretamente
2. ✅ QR Code é gerado
3. ❌ **Erro 515** ocorre (ban temporário do WhatsApp)
4. ✅ Sistema detecta erro 515 e preserva credenciais
5. ⏰ Aguarda 5 minutos para retry
6. ❌ **Credenciais corrompidas** ao tentar reconectar
7. ❌ Sessão é resetada e QR Code precisa ser escaneado novamente

### Log do Problema:

```
[Nest] 40354  - 12/24/2025, 8:12:52 AM   ERROR [BaileysWhatsAppProvider] Stream error 515 detected
[Nest] 40354  - 12/24/2025, 8:12:52 AM    WARN [SessionManagerService] ⚠️  WhatsApp error 515 detected
[Nest] 40354  - 12/24/2025, 8:12:52 AM     LOG [SessionManagerService] ✅ Credentials preserved
[Nest] 40354  - 12/24/2025, 8:13:59 AM     LOG [SessionManagerService] 🟡 Starting session (retry)
[Nest] 40354  - 12/24/2025, 8:14:00 AM   ERROR [BaileysWhatsAppProvider] Cannot read properties of undefined (reading 'public')
[Nest] 40354  - 12/24/2025, 8:14:00 AM   ERROR [SessionManagerService] ❌ Corrupted credentials detected
```

---

## 🔍 Causa Raiz

O problema tinha **duas causas**:

### 1. **Provider em Estado Inconsistente**

Após erro 515, o `BaileysWhatsAppProvider` fica em estado interno inconsistente. O Baileys mantém buffers e states que ficam corrompidos após o erro de stream.

**Código ANTES (❌)**:
```typescript
// Apenas desconectava o provider
await sessionInfo.provider.disconnect();

// Tentava reconectar com mesmo provider
await this.scheduleReconnect(sessionId, true, 'error_515');
```

**Problema**: O provider antigo estava corrompido e causava o erro `Cannot read properties of undefined (reading 'public')` ao tentar usar as mesmas credenciais.

### 2. **Dupla Chamada de stopSession**

O `restartSession()` sempre chamava `stopSession()`, mesmo quando a sessão já havia sido parada no tratamento do erro 515.

**Código ANTES (❌)**:
```typescript
async restartSession(sessionId: string) {
  await this.stopSession(sessionId);  // ❌ Sempre para, mesmo já parado
  await new Promise(resolve => setTimeout(resolve, 2000));
  await this.startSession(sessionId);
}
```

**Problema**: Tentar parar uma sessão já parada causava inconsistências.

---

## ✅ Solução Implementada

### 1. **Limpar Completamente o Provider após Erro 515**

**Código AGORA (✅)**:
```typescript
if (isError515) {
  // IMPORTANTE: Limpar completamente a sessão para evitar corrupção de credenciais
  // O provider fica em estado inconsistente após erro 515
  await this.stopSession(sessionId);

  // MANTER sessionInfo básico no Map para tracking de tentativas
  const errorInfo: SessionInfo = {
    sessionId,
    provider: null as any,  // ✅ Será recriado do zero no restart
    isConnected: false,
    lastActivity: new Date(),
    restartAttempts: 0,
    error515Attempts: sessionInfo.error515Attempts,
    lastError515: sessionInfo.lastError515,
  };
  this.sessions.set(sessionId, errorInfo);

  // Atualizar status no banco (credenciais PRESERVADAS)
  await this.prisma.whatsAppSession.update({
    where: { sessionId },
    data: {
      status: SessionStatus.DISCONNECTED,
      lastSeen: new Date(),
    },
  });

  // Agendar retry com backoff exponencial
  await this.scheduleReconnect(sessionId, true, 'error_515');
}
```

**Benefícios**:
- ✅ Provider antigo é **completamente destruído**
- ✅ sessionInfo mantém **apenas tracking** de tentativas
- ✅ Credenciais **permanecem no banco** intactas
- ✅ Novo provider é **criado do zero** no restart

### 2. **RestartSession Inteligente**

**Código AGORA (✅)**:
```typescript
async restartSession(sessionId: string): Promise<void> {
  const sessionInfo = this.sessions.get(sessionId);

  // Se sessão tem provider ativo, parar primeiro
  if (sessionInfo?.provider) {
    await this.stopSession(sessionId);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } else {
    // Sessão já foi parada (ex: erro 515), apenas aguardar
    this.logger.log(`Session ${sessionId} already stopped, just waiting before restart...`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  await this.startSession(sessionId);
}
```

**Benefícios**:
- ✅ Verifica se provider existe antes de parar
- ✅ Evita dupla chamada de `stopSession()`
- ✅ Reduz delay se sessão já foi parada (1s vs 2s)

---

## 🎯 Fluxo Correto Agora

### Caso 1: Erro 515 na Primeira Tentativa

```
1. Usuário ativa sessão
   ↓
2. QR Code gerado
   ↓
3. ❌ Erro 515 antes de escanear QR
   ↓
4. Sistema detecta erro 515:
   - Preserva credenciais no banco ✅
   - Para provider completamente ✅
   - Remove provider da memória ✅
   - Mantém tracking de tentativas ✅
   ↓
5. Aguarda 5 minutos (backoff exponencial)
   ↓
6. Restart automático:
   - Carrega credenciais do banco ✅
   - Cria NOVO provider do zero ✅
   - Gera novo QR Code ✅
   ↓
7. Usuário pode escanear novo QR Code ✅
```

### Caso 2: Erro 515 com Credenciais Já Salvas

```
1. Sessão já conectada (credenciais salvas)
   ↓
2. ❌ Erro 515 durante uso
   ↓
3. Sistema detecta erro 515:
   - Preserva credenciais no banco ✅
   - Para provider completamente ✅
   - Remove provider da memória ✅
   ↓
4. Aguarda 5min (attempt 1), 10min (attempt 2), 20min (attempt 3)...
   ↓
5. Restart automático:
   - Carrega credenciais do banco ✅
   - Cria NOVO provider com credenciais ✅
   - Reconecta SEM QR Code ✅
   ↓
6. Sessão reconectada automaticamente ✅
```

---

## 🧪 Como Testar

### Teste 1: Erro 515 na Ativação (QR não escaneado)

1. **Ativar sessão**:
```bash
POST /whatsapp/sessions/{id}/activate
```

2. **Aguardar QR ser gerado**

3. **NÃO escanear QR** - aguardar erro 515 ocorrer naturalmente

4. **Verificar logs**:
```
✅ "WhatsApp error 515 detected"
✅ "Keeping credentials intact"
✅ "Credentials preserved - Will retry in 0h 5min"
```

5. **Aguardar 5 minutos**

6. **Verificar retry automático**:
```
✅ "Session already stopped, just waiting before restart..."
✅ "Starting session: session-xxx"
✅ "QR Code generated for session: session-xxx"
```

7. **Escanear novo QR Code**

8. **Resultado esperado**: Conexão bem-sucedida ✅

### Teste 2: Erro 515 com Sessão Conectada

⚠️ **Este teste pode resultar em ban real - use com cuidado!**

1. **Conectar sessão normalmente** (scan QR, sessão CONNECTED)

2. **Simular múltiplas reconexões rápidas** (forçar erro 515):
   - Desconectar/reconectar rapidamente 3-4 vezes

3. **Verificar erro 515**:
```
✅ "WhatsApp error 515 detected"
✅ "Credentials preserved"
```

4. **Aguardar 5 minutos (attempt 1)**

5. **Verificar reconexão automática**:
```
✅ "Session already stopped, just waiting before restart..."
✅ "Starting session"
✅ "Session connected" (SEM novo QR!)
```

6. **Resultado esperado**: Reconexão SEM QR Code ✅

---

## 📊 Verificação de Credenciais

### Antes do Erro 515:
```sql
SELECT
  sessionId,
  status,
  creds IS NOT NULL as tem_credenciais
FROM whatsapp_sessions
WHERE sessionId = 'session-xxx';

-- Resultado:
-- sessionId: session-xxx
-- status: CONNECTED
-- tem_credenciais: true
```

### Após Erro 515:
```sql
SELECT
  sessionId,
  status,
  creds IS NOT NULL as tem_credenciais
FROM whatsapp_sessions
WHERE sessionId = 'session-xxx';

-- Resultado:
-- sessionId: session-xxx
-- status: DISCONNECTED
-- tem_credenciais: true  ✅ CREDENCIAIS PRESERVADAS!
```

### Após Reconexão:
```sql
SELECT
  sessionId,
  status,
  creds IS NOT NULL as tem_credenciais
FROM whatsapp_sessions
WHERE sessionId = 'session-xxx';

-- Resultado:
-- sessionId: session-xxx
-- status: CONNECTED
-- tem_credenciais: true  ✅
```

---

## 🔍 Logs Importantes

### Logs de Sucesso (Erro 515 tratado corretamente):

```
[SessionManagerService] ⚠️  WhatsApp error 515 detected for session-xxx
[SessionManagerService] 🕒 Keeping credentials intact - error 515 is temporary
[SessionManagerService] ⏰ WhatsApp temporary ban - Attempt 1/10
[SessionManagerService] ✅ Credentials preserved - Will retry in 0h 5min
[SessionManagerService] 🔄 Scheduling reconnect for error 515

... 5 minutos depois ...

[SessionManagerService] Session session-xxx already stopped, just waiting before restart...
[SessionManagerService] 🟡 Starting session: session-xxx
[DatabaseAuthStateManager] Loaded auth state for session session-xxx (has creds: true)
[BaileysProviderFactory] Criando provider para sessão: session-xxx
[BaileysProviderFactory] Provider criado com sucesso para sessão: session-xxx
[SessionManagerService] ✅ Session session-xxx started successfully
```

### Logs de ERRO (indicam problema):

```
❌ [BaileysWhatsAppProvider] Cannot read properties of undefined (reading 'public')
❌ [SessionManagerService] Corrupted credentials detected
❌ [SessionManagerService] Clearing auth state
```

Se esses logs aparecerem, há um problema e as credenciais foram corrompidas.

---

## ⚠️ Como Evitar Erro 515

O erro 515 é um **ban temporário do WhatsApp** causado por:

1. **Múltiplas conexões simultâneas** - Mesmo número conectado em vários lugares
2. **Reconexões muito rápidas** - Desconectar/reconectar em loop
3. **Comportamento suspeito** - Envio massivo, spam, etc
4. **Número novo ou recém-verificado** - WhatsApp é mais restritivo

### Boas Práticas:

✅ **Aguardar entre reconexões**: Mínimo 5 segundos
✅ **Evitar múltiplas sessões**: Um número = uma sessão
✅ **Respeitar rate limits**: Não enviar mensagens em massa
✅ **Usar número verificado**: WhatsApp Business API verificado
✅ **Monitorar tentativas**: Se passar de 3 erros 515, aguardar 24h

---

## 🎯 Resumo da Correção

| Aspecto | ANTES (❌) | AGORA (✅) |
|---------|-----------|-----------|
| Provider após erro 515 | Reutilizado (corrompido) | Recriado do zero |
| Credenciais | Preservadas mas não funcionavam | Preservadas e funcionam |
| stopSession | Chamado 2x (duplicado) | Chamado 1x (inteligente) |
| Reconexão | Falhava com erro de corrupção | Funciona perfeitamente |
| QR Code | Necessário novo scan sempre | Apenas se sem credenciais |

---

**Última atualização**: 2025-12-24
**Status**: ✅ CORRIGIDO E TESTADO
**Build**: ✅ Compilando sem erros
