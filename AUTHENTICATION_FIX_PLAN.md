# Plano de Correção do Fluxo de Autenticação WhatsApp

## 🎯 Objetivo
Refatorar o fluxo de autenticação do gastocerto-zap para funcionar de forma confiável como no zap-test.

## 📊 Comparação: zap-test vs gastocerto-zap

### ✅ O que funciona no zap-test (SIMPLES)

```typescript
// 1. Carrega estado de autenticação de arquivos locais
const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

// 2. Cria socket uma única vez
const sock = makeWASocket({
  version,
  logger,
  auth: state,  // Estado carregado
  printQRInTerminal: false,
});

// 3. Salva credenciais automaticamente quando atualizadas
sock.ev.on('creds.update', saveCreds);

// 4. Gerencia conexão com lógica simples
sock.ev.on('connection.update', (update) => {
  if (update.qr) {
    // Mostra QR code
  }
  if (update.connection === 'open') {
    // Conectado!
  }
  if (update.connection === 'close') {
    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
    if (shouldReconnect) {
      connectToWhatsApp(); // Reconecta
    }
  }
});
```

### ❌ Problemas no gastocerto-zap (COMPLEXO)

#### Problema 1: Instanciação Múltipla de Providers
```typescript
// ❌ ERRADO: SessionManagerService cria nova instância toda vez
async startSession(sessionId: string) {
  const provider = new BaileysWhatsAppProvider(
    {} as any,  // ConfigService ignorado
  );
  this.sessions.set(sessionId, { provider, ... });
}
```

**Impacto**:
- Cada sessão cria nova instância de BaileysWhatsAppProvider
- Provider injetado via DI é ignorado
- Memória cresce com múltiplas instâncias
- Dificulta testes unitários

**Solução**: Usar factory pattern ou singleton por sessão

---

#### Problema 2: Auth State Manager com Overhead de DB

```typescript
// ❌ COMPLEXO: Cada operação acessa banco de dados
class DatabaseAuthStateManager {
  async loadAuthState(sessionId: string) {
    const session = await this.prisma.whatsAppSession.findUnique({ ... });
    return session?.creds ? JSON.parse(session.creds) : null;
  }

  async saveAuthState(sessionId: string, creds: any) {
    // Debouncing de 2 segundos
    // Serialização complexa com BufferJSON
    await this.prisma.whatsAppSession.update({ ... });
  }
}
```

**vs. zap-test SIMPLES**:
```typescript
// ✅ SIMPLES: Arquivos locais gerenciados pelo Baileys
const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
```

**Diferença**:
- zap-test: Baileys gerencia arquivos automaticamente
- gastocerto-zap: Serialização manual, debouncing, complexidade de DB

**Impacto**:
- Possível perda de dados durante debouncing
- Latência adicional em cada save
- Complexidade desnecessária para autenticação

**Solução**: Manter DB mas simplificar lógica, ou usar cache em memória

---

#### Problema 3: Tratamento de Erro 515 (Ban Temporário)

```typescript
// ❌ ERRADO: Limpa credenciais após max tentativas
if (sessionInfo.error515Attempts > this.MAX_ERROR_515_ATTEMPTS) {
  await this.stopSession(sessionId);
  await this.authStateManager.clearAuthState(sessionId);  // ← DESTRUTIVO!
  return;
}

// Depois tenta agendar reconnect (mas sessionInfo foi removido)
await this.scheduleReconnect(sessionId, true, 'error_515');
```

**Problema**:
- Erro 515 = ban temporário do WhatsApp (não é erro de credenciais)
- Após 10 tentativas, credenciais são deletadas permanentemente
- Usuário perde sessão mesmo que credenciais sejam válidas
- Race condition: sessionInfo removido mas reconnect agendado

**Solução**: Preservar credenciais em erro 515, aumentar delay exponencial

---

#### Problema 4: Sem Timeout para Estado CONNECTING

```typescript
// ❌ Sessão pode ficar presa em CONNECTING indefinidamente
if (connection === 'connecting') {
  detailedLog('CONNECTION_CONNECTING', 'Conectando ao WhatsApp...');
  // Nenhum timeout configurado!
}
```

**Problema**:
- Se Baileys não receber resposta, fica em CONNECTING forever
- Frontend mostra "Conectando..." sem fim
- Usuário não sabe se deve recarregar página

**Solução**: Adicionar timeout de 60s, tentar regenerar QR

---

#### Problema 5: QR Code Não Regenerável

```typescript
// ❌ QR expira após 2 minutos, mas não há forma de gerar novo
GET /whatsapp/sessions/:id/qr
// Retorna QR em cache (pode estar expirado)
```

**Problema**:
- QR tem validade de 2 minutos
- Se timeout, usuário deve desativar e reativar sessão
- Perda de UX

**Solução**: Permitir regeneração de QR se em estado CONNECTING

---

#### Problema 6: Credenciais Corrompidas

```typescript
// ❌ Detecção frágil baseada em substring
const isCorruptedCredentials = reason?.includes(
  "Cannot read properties of undefined (reading 'public')"
);

if (isCorruptedCredentials) {
  await this.authStateManager.clearAuthState(sessionId);  // Destrutivo
}
```

**Problema**:
- Detecção por substring é frágil (pode falhar em outras versões)
- Não há backup de credenciais
- Não há tentativa de recuperação
- Ação destrutiva imediata

**Solução**: Criar backup de credenciais, validar integridade antes de deletar

---

## 🔧 Plano de Ação

### Fase 1: Simplificar e Corrigir (CRÍTICO)

#### 1.1. Refatorar BaileysWhatsAppProvider Factory
**Arquivo**: `src/infrastructure/whatsapp/sessions/session-manager.service.ts`

```typescript
// ANTES (❌):
async startSession(sessionId: string) {
  const provider = new BaileysWhatsAppProvider({} as any);
  this.sessions.set(sessionId, { provider, ... });
}

// DEPOIS (✅):
@Injectable()
export class SessionManagerService {
  constructor(
    private readonly providerFactory: BaileysProviderFactory,
  ) {}

  async startSession(sessionId: string) {
    const provider = await this.providerFactory.create(sessionId);
    this.sessions.set(sessionId, { provider, ... });
  }
}

// Novo arquivo: baileys-provider.factory.ts
@Injectable()
export class BaileysProviderFactory {
  constructor(
    private readonly config: ConfigService,
    private readonly authStateManager: DatabaseAuthStateManager,
  ) {}

  async create(sessionId: string): Promise<BaileysWhatsAppProvider> {
    const authState = await this.authStateManager.createBaileysAuthState(sessionId);
    return new BaileysWhatsAppProvider(this.config, authState);
  }
}
```

**Benefícios**:
- Segue padrão NestJS de DI
- Facilita testes unitários
- Remove overhead de instanciação múltipla

---

#### 1.2. Corrigir Tratamento de Erro 515

**Arquivo**: `src/infrastructure/whatsapp/sessions/session-manager.service.ts`

```typescript
// ANTES (❌):
if (sessionInfo.error515Attempts > this.MAX_ERROR_515_ATTEMPTS) {
  await this.stopSession(sessionId);
  await this.authStateManager.clearAuthState(sessionId);  // DESTRUTIVO
  return;
}

// DEPOIS (✅):
if (sessionInfo.error515Attempts > this.MAX_ERROR_515_ATTEMPTS) {
  this.logger.warn(
    `Sessão ${sessionId} atingiu máximo de tentativas para erro 515. ` +
    `Aguardando intervenção manual.`
  );

  // Emitir evento para admin intervir
  this.eventEmitter.emit('session.error.515.max_attempts', {
    sessionId,
    attempts: sessionInfo.error515Attempts,
    message: 'WhatsApp ban temporário - aguarde 24h ou contate suporte'
  });

  // NÃO deletar credenciais! Apenas marcar como ERROR
  await this.sessionsService.updateSessionStatus(sessionId, 'ERROR');
  return;
}

// Aguardar com backoff exponencial (até 24h)
const delay = Math.min(
  this.RECONNECT_DELAY_515_MS * Math.pow(2, sessionInfo.error515Attempts - 1),
  86400000  // Max 24h
);

this.logger.log(
  `Erro 515 detectado. Aguardando ${delay / 60000}min antes de retry ` +
  `(tentativa ${sessionInfo.error515Attempts}/${this.MAX_ERROR_515_ATTEMPTS})`
);

await this.scheduleReconnect(sessionId, true, 'error_515', delay);
```

**Benefícios**:
- Preserva credenciais válidas
- Aguarda tempo suficiente para ban expirar
- Admin pode intervir se necessário
- Backoff exponencial evita spam ao WhatsApp

---

#### 1.3. Adicionar Timeout para CONNECTING

**Arquivo**: `src/infrastructure/whatsapp/sessions/session-manager.service.ts`

```typescript
async startSession(sessionId: string) {
  // ... código existente ...

  // Adicionar timeout de 60s para estado CONNECTING
  const connectingTimeout = setTimeout(() => {
    const session = this.sessions.get(sessionId);
    if (session && session.status === 'CONNECTING') {
      this.logger.warn(`Sessão ${sessionId} timeout em CONNECTING. Reiniciando...`);
      this.handleDisconnected(sessionId, 'timeout_connecting');
    }
  }, 60000);

  // Armazenar timeout para limpar depois
  this.sessions.set(sessionId, {
    ...sessionInfo,
    connectingTimeout
  });
}

// Limpar timeout quando conectar
private async handleConnectionOpen(sessionId: string) {
  const session = this.sessions.get(sessionId);
  if (session?.connectingTimeout) {
    clearTimeout(session.connectingTimeout);
  }
  // ... resto do código ...
}
```

---

#### 1.4. Implementar Regeneração de QR Code

**Arquivo**: `src/infrastructure/whatsapp/sessions/whatsapp/whatsapp.controller.ts`

```typescript
@Post(':id/regenerate-qr')
async regenerateQR(@Param('id') id: string) {
  const session = await this.sessionsService.findOne(id);

  if (!session) {
    throw new NotFoundException('Sessão não encontrada');
  }

  if (session.status !== 'CONNECTING' && session.status !== 'QR_PENDING') {
    throw new BadRequestException(
      'Só é possível regenerar QR em estado CONNECTING ou QR_PENDING'
    );
  }

  // Reiniciar sessão para gerar novo QR
  await this.sessionManager.stopSession(session.sessionId);
  await this.sessionManager.startSession(session.sessionId);

  // Aguardar novo QR ser gerado (max 10s)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout aguardando novo QR'));
    }, 10000);

    this.eventEmitter.once(`session.qr.${session.sessionId}`, (qr) => {
      clearTimeout(timeout);
      resolve({ success: true, qr });
    });
  });
}
```

---

### Fase 2: Melhorias de Qualidade (IMPORTANTE)

#### 2.1. Adicionar Validação de Credenciais Antes de Deletar

```typescript
async clearAuthState(sessionId: string) {
  // Backup antes de deletar
  const currentCreds = await this.loadAuthState(sessionId);

  if (currentCreds) {
    // Salvar backup com timestamp
    await this.prisma.whatsAppSessionBackup.create({
      data: {
        sessionId,
        creds: JSON.stringify(currentCreds),
        deletedAt: new Date()
      }
    });

    this.logger.log(`Backup de credenciais criado para sessão ${sessionId}`);
  }

  // Agora pode deletar
  await this.prisma.whatsAppSession.update({
    where: { sessionId },
    data: { creds: null }
  });
}
```

#### 2.2. Adicionar Auditoria de Status

```typescript
// Nova tabela: session_status_log
model SessionStatusLog {
  id         String   @id @default(uuid())
  sessionId  String
  oldStatus  String?
  newStatus  String
  reason     String?
  metadata   Json?
  createdAt  DateTime @default(now())

  session    WhatsAppSession @relation(...)
}

// Registrar todas mudanças de status
async updateSessionStatus(sessionId: string, status: string, reason?: string) {
  const session = await this.findBySessionId(sessionId);

  // Log da mudança
  await this.prisma.sessionStatusLog.create({
    data: {
      sessionId,
      oldStatus: session.status,
      newStatus: status,
      reason
    }
  });

  // Atualizar status
  return this.prisma.whatsAppSession.update({
    where: { sessionId },
    data: { status, updatedAt: new Date() }
  });
}
```

---

### Fase 3: Otimizações (OPCIONAL)

#### 3.1. Cache em Memória para Credenciais

```typescript
// Evitar hits desnecessários ao DB
class DatabaseAuthStateManager {
  private credsCache = new Map<string, any>();

  async loadAuthState(sessionId: string) {
    // Verificar cache primeiro
    if (this.credsCache.has(sessionId)) {
      return this.credsCache.get(sessionId);
    }

    // Carregar do DB
    const session = await this.prisma.whatsAppSession.findUnique({ ... });
    const creds = session?.creds ? JSON.parse(session.creds) : null;

    // Cachear
    if (creds) {
      this.credsCache.set(sessionId, creds);
    }

    return creds;
  }

  async saveAuthState(sessionId: string, creds: any) {
    // Atualizar cache
    this.credsCache.set(sessionId, creds);

    // Salvar no DB (com debouncing existente)
    // ...
  }
}
```

---

## 📝 Checklist de Implementação

### Fase 1 (Crítico)
- [ ] 1.1. Criar BaileysProviderFactory
- [ ] 1.2. Refatorar SessionManagerService para usar factory
- [ ] 1.3. Corrigir tratamento de erro 515 (preservar credenciais)
- [ ] 1.4. Adicionar timeout de 60s para CONNECTING
- [ ] 1.5. Implementar endpoint /regenerate-qr
- [ ] 1.6. Testar fluxo completo: QR → Scan → Connected

### Fase 2 (Importante)
- [ ] 2.1. Adicionar backup de credenciais antes de deletar
- [ ] 2.2. Criar tabela session_status_log
- [ ] 2.3. Implementar auditoria de mudanças de status
- [ ] 2.4. Melhorar detecção de credenciais corrompidas

### Fase 3 (Opcional)
- [ ] 3.1. Implementar cache em memória para credenciais
- [ ] 3.2. Adicionar métricas de performance
- [ ] 3.3. Implementar health check para sessões

---

## 🧪 Testes Necessários

### Teste 1: Nova Sessão (QR Code)
```bash
# 1. Criar sessão
POST /whatsapp/sessions { phoneNumber: "5511999999999" }

# 2. Ativar sessão
POST /whatsapp/sessions/:id/activate

# 3. Conectar WebSocket
ws://localhost:4444/ws?token=JWT

# 4. Verificar QR code emitido
# 5. Escanear QR no WhatsApp
# 6. Verificar status = CONNECTED
# 7. Verificar credenciais salvas no DB
```

### Teste 2: Reconexão Automática
```bash
# 1. Parar servidor
# 2. Iniciar servidor
# 3. Verificar auto-start de sessões ativas
# 4. Verificar conexão sem novo QR
```

### Teste 3: Erro 515 (Ban Temporário)
```bash
# 1. Simular erro 515 (desconectar/reconectar rápido múltiplas vezes)
# 2. Verificar credenciais NÃO deletadas
# 3. Verificar backoff exponencial aplicado
# 4. Verificar evento emitido para admin
```

### Teste 4: Regeneração de QR
```bash
# 1. Ativar sessão
# 2. Aguardar QR expirar (2min)
# 3. POST /whatsapp/sessions/:id/regenerate-qr
# 4. Verificar novo QR gerado
# 5. Escanear novo QR
# 6. Verificar conexão bem-sucedida
```

---

## 🎯 Resultado Esperado

Após implementação, o fluxo deve ser:

1. **Primeira conexão**:
   - POST /activate → QR gerado em ~2s
   - WebSocket emite evento com QR
   - Usuário escaneia → CONNECTED em ~5s
   - Credenciais salvas no DB

2. **Reconexão (server restart)**:
   - Auto-start de sessões ativas
   - Sem novo QR necessário
   - CONNECTED em ~10s

3. **Erro 515**:
   - Credenciais preservadas
   - Aguarda tempo crescente (5min → 10min → 20min → ...)
   - Admin notificado após 10 tentativas
   - Sessão marcada como ERROR (não deletada)

4. **QR expirado**:
   - POST /regenerate-qr gera novo QR
   - Sem perda de contexto
   - UX melhorada

---

## 📚 Referências

- Documentação Baileys: https://github.com/WhiskeySockets/Baileys
- NestJS Dependency Injection: https://docs.nestjs.com/providers
- WhatsApp Multi-Device: https://github.com/WhiskeySockets/Baileys/blob/master/docs/using-multi-device.md

---

**Última atualização**: 2025-12-23
**Autor**: Claude Code Agent
**Status**: Plano de ação aprovado, aguardando implementação
