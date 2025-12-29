# Auto-Restore Habilitado ✅

## Data: 29/12/2025

## Mudanças Implementadas

### 1. Auto-Restore de Sessões WhatsApp

**Arquivo**: `src/infrastructure/whatsapp/sessions/whatsapp-session-manager.service.ts`

- ✅ Adicionado `OnModuleInit` interface
- ✅ Implementado `onModuleInit()` que chama `restoreActiveSessions()`
- ✅ Sessões com `status=CONNECTED` serão restauradas automaticamente no startup

**Comportamento**:
- Ao iniciar o servidor, todas as sessões WhatsApp com status `CONNECTED` no banco serão reconectadas automaticamente
- Usa as credenciais salvas em `.auth_sessions/{sessionId}/`
- Não precisa mais ativar manualmente via API após restart

### 2. Logs Detalhados de Mensagens

**Arquivo**: `src/infrastructure/whatsapp/messages/whatsapp-message.handler.ts`

- ✅ Log **ANTES** de qualquer filtro mostrando:
  - Número de telefone que enviou (`senderPhone`)
  - `sessionId`
  - `messageId`
  - `remoteJid` completo

**Exemplo de log**:
```
📱 [WhatsApp] RAW MESSAGE | Session: session-xxx | From: 5566996285154 | MessageId: 3EB0... | RemoteJid: 5566996285154@s.whatsapp.net
```

- ✅ Log quando mensagem é filtrada:
```
🚫 [WhatsApp] Message FILTERED OUT | From: 5566996285154 | MessageId: 3EB0... | Reason: Invalid format or content
```

## Arquivos JSON em `.auth_sessions/`

### Sim, é necessário! ✅

O Baileys utiliza o padrão `useMultiFileAuthState` que salva múltiplos arquivos:

| Arquivo | Propósito |
|---------|-----------|
| `creds.json` | Credenciais principais da sessão |
| `app-state-sync-key-*.json` | Chaves de sincronização do app state |
| `app-state-sync-version-*.json` | Versões de sincronização |
| `pre-key-*.json` | Chaves pré-compartilhadas (Signal Protocol) |
| `sender-key-*.json` | Chaves de remetente para grupos |
| `session-*.json` | Sessões de dispositivos |

**Quantidade de arquivos**: 10-50 arquivos por sessão (normal)

**Necessário para**:
- End-to-end encryption (E2EE)
- Reconexão sem QR code
- Sincronização de mensagens
- Grupos e dispositivos múltiplos

### Alternativa: Database Auth (Complexo)

Tentamos implementar `DatabaseAuthStateManager` mas:
- ❌ Causou erros de validação com Baileys
- ❌ Formato de credenciais incompatível
- ❌ Loop de reconexão infinito

**Conclusão**: Usar arquivos é o método **estável e recomendado** pelo Baileys.

## Fluxo Completo

### Primeira Conexão
1. POST `/whatsapp` - Cria sessão (status: `CONNECTING`)
2. POST `/whatsapp/:id/activate` - Inicia conexão
3. QR Code gerado → WebSocket distribui
4. Usuário escaneia QR
5. Status muda para `CONNECTED`
6. Credenciais salvas em `.auth_sessions/{sessionId}/`

### Após Restart do Servidor
1. Servidor inicia
2. `WhatsAppSessionManager.onModuleInit()` executa
3. Busca sessões com `status=CONNECTED`
4. Para cada sessão:
   - Lê credenciais de `.auth_sessions/{sessionId}/`
   - Reconecta automaticamente
   - ✅ Pronto para receber mensagens

### Logs Melhorados
```
# Mensagem recebida (SEMPRE aparece primeiro)
📱 [WhatsApp] RAW MESSAGE | Session: session-1767014152027-i0i07sr | From: 5566996285154 | MessageId: 3EB0A1874A3F1DB45E7DE6

# Se passar no filtro
✅ [WhatsApp] Processing message from 5566996285154

# Se não passar no filtro  
🚫 [WhatsApp] Message FILTERED OUT | From: 5511999999999 | MessageId: ABC123 | Reason: Invalid format or content
```

## Variável de Ambiente para Testes

```env
# Test Mode - Deixe vazio para processar todas as mensagens
# Preencha com número de teste para processar apenas mensagens desse número
# Formato: 5511999999999 (só números, sem +)
TEST_PHONE_NUMBER=5566996285154
```

- Se definido: **apenas** mensagens deste número serão processadas
- Se vazio: **todas** as mensagens serão processadas

## Próximos Passos

✅ **Sistema Operacional**: Arquivos em `.auth_sessions/` + Auto-restore habilitado
⚠️ **Backup**: Considerar backup de `.auth_sessions/` para disaster recovery
🎯 **Produção**: Funcional para múltiplas contas simultâneas

## Teste Rápido

```bash
# 1. Reiniciar servidor
yarn start:dev

# 2. Verificar logs de auto-restore
# Deve aparecer:
# [WhatsAppSessionManager] 🔄 Auto-restoring session: session-xxx

# 3. Enviar mensagem WhatsApp
# Deve aparecer:
# 📱 [WhatsApp] RAW MESSAGE | Session: ... | From: 5566996285154 | ...
```
