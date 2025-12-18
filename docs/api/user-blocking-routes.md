# Rotas de Bloqueio e Desbloqueio de Usuário

## 📋 Visão Geral

Este documento descreve as rotas da API para controle de bloqueio e desbloqueio de usuários no sistema GastoCerto Zap. Existem dois tipos de controle:

1. **Bloqueio de Usuário** (`isBlocked`): Usuário não pode usar o sistema
2. **Status Ativo da Conta** (`isActive`): Conta validada e pode usar o sistema

---

## 🔐 Rotas Administrativas (AdminController)

### Bloquear/Desbloquear Usuário
**Endpoint:** `POST /admin/users/block`

**Descrição:** Altera o status de bloqueio de um usuário. Quando bloqueado, o usuário não pode usar o sistema.

**Autenticação:** JWT Token (Admin)

**Corpo da Requisição:**
```json
{
  "userId": "uuid-do-usuario-no-gastocerto",
  "isBlocked": true,
  "reason": "Violação dos termos de uso" // opcional
}
```

**Resposta de Sucesso (200):**
```json
{
  "success": true,
  "message": "Usuário uuid-do-usuario-no-gastocerto bloqueado com sucesso"
}
```

**Comportamento:**
- Atualiza `isBlocked` no `userCache` (banco de dados)
- ✅ **ATUALIZAÇÃO 2025-12-18**: Invalida cache Redis (`invalidateUser()`)
- Se `isBlocked: true`, desativa a sessão WhatsApp
- Se `isBlocked: false`, apenas remove o bloqueio (não ativa automaticamente)
- ❌ Usuários bloqueados **NÃO podem enviar mensagens** (retorna mensagem de bloqueio)
- ❌ Usuários bloqueados **NÃO iniciam onboarding**

---

### Ativar/Desativar Usuário
**Endpoint:** `POST /admin/users/activate`

**Descrição:** Altera o status ativo da conta do usuário.

**Autenticação:** JWT Token (Admin)

**Corpo da Requisição:**
```json
{
  "userId": "uuid-do-usuario-no-gastocerto",
  "isActive": true
}
```

**Resposta de Sucesso (200):**
```json
{
  "success": true,
  "message": "Usuário uuid-do-usuario-no-gastocerto ativado com sucesso"
}
```

**Comportamento:**
- Atualiza `isActive` no `userCache`
- Se `isActive: true`, ativa a sessão WhatsApp
- Se `isActive: false`, desativa a sessão WhatsApp

---

## 📊 Campos de Controle no Banco de Dados

### Tabela `user_cache`
- `isBlocked` (Boolean): Indica se o usuário está bloqueado permanentemente
- `isActive` (Boolean): Indica se a conta está ativa e validada

### Tabela `whatsAppSession`
- `isActive` (Boolean): Controla se a sessão está ativa

---

## 🔍 Verificação de Status

O sistema verifica os status em múltiplas camadas:

1. **Handler de Mensagens WhatsApp** (`whatsapp-message.handler.ts`):
   ```typescript
   if (user.isBlocked) {
     this.logger.warn(`[WhatsApp] User ${phoneNumber} is blocked`);
     return; // Bloqueia processamento
   }
   ```

2. **Validação de Conta Ativa**: Verifica se `isActive` é true antes de processar mensagens

---

## 📝 Notas de Implementação

- **Bloqueio (`isBlocked`)**: Impede qualquer uso do sistema
- **Status Ativo (`isActive`)**: Controla se a conta foi validada e pode ser usada
- **Sessões WhatsApp**: São afetadas por ambas as configurações
- **Logs**: Todas as ações são logadas nos respectivos serviços

---

## 🧪 Exemplos de Uso

### Bloquear usuário
```bash
curl -X POST http://localhost:4444/admin/users/block \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "uuid-do-usuario", "isBlocked": true, "reason": "Spam"}'
```

### Desbloquear usuário
```bash
curl -X POST http://localhost:4444/admin/users/block \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "uuid-do-usuario", "isBlocked": false}'
```

### Ativar conta do usuário
```bash
curl -X POST http://localhost:4444/admin/users/activate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "uuid-do-usuario", "isActive": true}'
```

### Desativar conta do usuário
```bash
curl -X POST http://localhost:4444/admin/users/activate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "uuid-do-usuario", "isActive": false}'
```</content>
<parameter name="filePath">/Users/haroldorodsilva/projets/gastocerto/zap/gastocerto-zap/docs/api/user-blocking-routes.md