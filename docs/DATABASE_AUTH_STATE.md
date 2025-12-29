# Autenticação via Banco de Dados

## 🎯 Objetivo

Migração de autenticação do WhatsApp de arquivos locais (`.auth_sessions/`) para banco de dados PostgreSQL, permitindo reconexão automática após restart do servidor.

## ✅ O que foi implementado

### 1. DatabaseAuthStateManager
Classe helper que gerencia credenciais do Baileys no banco de dados:
- `useDatabaseAuthState()`: Retorna state e saveCreds compatível com Baileys
- `hasCreds()`: Verifica se há credenciais salvas
- `clearCreds()`: Remove credenciais do banco
- `migrateFromFile()`: Migra credenciais de arquivo para banco (opcional)

**Localização**: `src/infrastructure/whatsapp/sessions/database-auth-state.manager.ts`

### 2. WhatsAppSessionManager Atualizado
- ✅ Removida dependência de `useMultiFileAuthState`
- ✅ Usa `DatabaseAuthStateManager` para salvar/carregar credenciais
- ✅ Implementado `restoreActiveSessions()` no construtor
- ✅ Reconexão automática ao iniciar servidor
- ✅ Credenciais salvas no campo `creds` do modelo `WhatsAppSession`

### 3. Schema Prisma
Campo `lastConnected` adicionado ao modelo `WhatsAppSession`:
```prisma
model WhatsAppSession {
  id            String        @id @default(uuid())
  sessionId     String        @unique
  phoneNumber   String
  name          String?
  status        SessionStatus @default(INACTIVE)
  creds         Json?         // ✅ Credenciais Baileys
  lastConnected DateTime?     // ✅ NOVO - última conexão bem-sucedida
  isActive      Boolean       @default(true)
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}
```

## 🚀 Como funciona

### Primeira conexão
1. Usuário cria sessão via API
2. Sistema inicia socket WhatsApp e gera QR code
3. Usuário escaneia QR code no WhatsApp
4. Baileys gera credenciais de autenticação
5. **Credenciais são salvas no campo `creds` do banco de dados**
6. Status atualizado para `CONNECTED`
7. Campo `lastConnected` atualizado com timestamp atual

### Após reiniciar o servidor
1. `restoreActiveSessions()` é executado no construtor do WhatsAppSessionManager
2. Busca no banco: `isActive=true`, `creds != null`, `status = CONNECTED|CONNECTING`
3. Para cada sessão encontrada:
   - Carrega credenciais do banco via `DatabaseAuthStateManager`
   - Inicia socket WhatsApp com credenciais existentes
   - **Reconecta automaticamente SEM precisar de novo QR code**
4. Pequeno delay (2s) entre cada reconexão

## 📊 Logs do Sistema

### Ao iniciar sem sessões ativas:
```
[WhatsAppSessionManager] 🔄 Restoring active sessions from database...
[WhatsAppSessionManager] 📦 Found 0 active sessions to restore
[WhatsAppSessionManager] ✅ Session restoration completed
```

### Ao iniciar com sessões ativas:
```
[WhatsAppSessionManager] 🔄 Restoring active sessions from database...
[WhatsAppSessionManager] 📦 Found 2 active sessions to restore
[WhatsAppSessionManager] 🔌 Restoring session: session-xxx
[WhatsAppSessionManager] 🔐 Auth state loaded from database for session: session-xxx
[WhatsAppSessionManager] ✅ Session session-xxx connected successfully!
```

### Ao salvar credenciais:
```
[DatabaseAuthStateManager] 💾 Credentials saved to database for session: session-xxx
```

## 🔧 Comandos Utilizados

```bash
# Sincronizar schema com banco (SEM perder dados)
npx prisma db push

# Verificar status do banco
npx prisma studio

# Iniciar servidor
npm run start:dev
```

## 🧪 Como testar

### 1. Criar nova sessão e conectar
```bash
# 1. Criar sessão
POST http://localhost:4444/whatsapp
{
  "name": "Teste Auto-Restore"
}

# 2. Ativar sessão (gera QR code)
POST http://localhost:4444/whatsapp/{sessionId}/activate

# 3. Escanear QR code no WhatsApp
# 4. Aguardar conexão

# Verificar no banco:
# - Campo 'creds' deve conter JSON com credenciais
# - Campo 'lastConnected' deve ter timestamp
# - status = 'CONNECTED'
```

### 2. Testar auto-restore
```bash
# 1. Parar servidor (Ctrl+C)
# 2. Iniciar servidor novamente
npm run start:dev

# 3. Verificar logs - deve aparecer:
# "📦 Found 1 active sessions to restore"
# "🔌 Restoring session: session-xxx"
# "✅ Session session-xxx connected successfully!"

# 4. Sessão deve reconectar automaticamente SEM novo QR code
```

## 📝 Diferenças da implementação anterior

| Aspecto | Antes (Arquivos) | Agora (Banco de Dados) |
|---------|------------------|------------------------|
| **Armazenamento** | `.auth_sessions/{sessionId}/` | Campo `creds` no PostgreSQL |
| **Persistência** | Arquivos locais | Banco de dados |
| **Reconexão** | ❌ Manual | ✅ Automática |
| **Portabilidade** | ❌ Servidor específico | ✅ Qualquer servidor |
| **Backup** | ❌ Difícil | ✅ Com banco de dados |
| **Multi-servidor** | ❌ Não suporta | ✅ Suporta (com precauções) |

## ⚠️ Importante

1. **Não resetar banco em produção**: Sempre use `prisma db push` ao invés de `prisma migrate reset`
2. **Credenciais sensíveis**: Campo `creds` contém chaves de criptografia - proteja o banco
3. **Um socket por sessão**: Não inicie a mesma sessão em múltiplos servidores simultaneamente
4. **Limpeza**: Use o endpoint `/whatsapp/{id}/reset-auth` para forçar novo login

## 🔐 Segurança

- Credenciais são armazenadas em formato JSON no campo `creds`
- Contém chaves privadas de criptografia E2E do WhatsApp
- **Nunca exponha o campo `creds` em APIs públicas**
- Backups do banco devem ser criptografados
- Acesso ao banco deve ser restrito

## 📚 Arquivos modificados

1. `src/infrastructure/whatsapp/sessions/whatsapp-session-manager.service.ts`
   - Removido `useMultiFileAuthState` e dependências de filesystem
   - Adicionado `DatabaseAuthStateManager`
   - Implementado `restoreActiveSessions()`
   - Atualizado `clearSessionCredentials()` para usar banco

2. `src/infrastructure/whatsapp/sessions/database-auth-state.manager.ts`
   - **NOVO** - Gerenciador de autenticação via banco

3. `src/prisma/schema.prisma`
   - Adicionado campo `lastConnected DateTime?`
   - Campo `creds Json?` já existia

## ✅ Status

- ✅ Implementação completa
- ✅ Banco sincronizado sem perda de dados
- ✅ Servidor rodando com auto-restore
- ✅ Pronto para testes de reconexão

## 🎯 Próximos passos

1. Testar reconexão após restart
2. Verificar estabilidade da conexão
3. Monitorar logs de erro
4. Opcional: Remover pasta `.auth_sessions/` após confirmar funcionamento
