# Controle de Bloqueio e Status de Usuário

## 📋 Visão Geral

Sistema de controle de acesso que permite bloquear usuários ou desativar contas, impedindo o processamento de mensagens. Este controle é essencial para:

- **Moderação**: Bloquear usuários que violam termos de uso
- **Gestão de Assinaturas**: Controlar acesso baseado em assinatura ativa
- **Desativação de Conta**: Permitir que usuários desativem temporariamente suas contas
- **Preparação para Assinaturas**: Infraestrutura pronta para sistema de cobrança futuro

---

## 🔍 Campos de Controle

### 1. `isBlocked` (Bloqueio)
**Tipo**: `Boolean` | **Padrão**: `false`

**Quando usar:**
- Usuário violou termos de serviço
- Atividade suspeita detectada
- Bloqueio administrativo temporário ou permanente
- Abuso do sistema (spam, tentativas de injection, etc.)

**Comportamento:**
- ❌ Usuário **NÃO PODE** usar o sistema
- 🔒 Todas as mensagens são bloqueadas no handler
- 📝 Log de warning é gerado
- 💬 TODO: Enviar mensagem informando que está bloqueado

**Como bloquear:**
```typescript
await userCacheService.updateUserCache(user.gastoCertoId, {
  isBlocked: true
});
```

---

### 2. `isActive` (Status da Conta)
**Tipo**: `Boolean` | **Padrão**: `true`

**Quando usar:**
- Usuário solicitou desativação temporária da conta
- Conta em processo de exclusão (período de carência)
- Migração ou manutenção de dados

**Comportamento:**
- ❌ Usuário **NÃO PODE** usar o sistema
- 🔒 Todas as mensagens são bloqueadas no handler
- 📝 Log de warning é gerado
- 💬 TODO: Enviar mensagem informando que a conta está desativada

**Como desativar:**
```typescript
await userCacheService.updateUserCache(user.gastoCertoId, {
  isActive: false
});
```

---

### 3. `hasActiveSubscription` (Assinatura)
**Tipo**: `Boolean` | **Padrão**: `false`

**Quando usar:**
- Sistema de assinaturas implementado
- Controle de acesso baseado em pagamento
- Trial/período gratuito expirado

**Comportamento:**
- ❌ Usuário **NÃO PODE** usar o sistema (se false)
- 🔒 Todas as mensagens são bloqueadas no handler
- 📝 Log de warning é gerado
- 💬 TODO: Enviar mensagem sobre renovação

**Como atualizar:**
```typescript
await userCacheService.updateSubscriptionStatus(phoneNumber, true);
```

---

## 🔄 Fluxo de Validação

O fluxo de validação ocorre em `WhatsAppMessageHandler.processMessage()`:

```typescript
// 1. Verificar se está em onboarding
if (isOnboarding) { /* Permitir onboarding */ }

// 2. Buscar usuário
const user = await userCacheService.getUser(phoneNumber);
if (!user) { /* Iniciar onboarding */ }

// 3. Verificar se está bloqueado
if (user.isBlocked) {
  logger.warn(`User ${phoneNumber} is blocked`);
  // TODO: Enviar mensagem
  return; // ❌ BLOQUEIA
}

// 4. Verificar se está ativo
if (!user.isActive) {
  logger.warn(`User ${phoneNumber} is inactive`);
  // TODO: Enviar mensagem
  return; // ❌ BLOQUEIA
}

// 5. Verificar assinatura
if (!user.hasActiveSubscription) {
  logger.warn(`User ${phoneNumber} has no active subscription`);
  // TODO: Enviar mensagem
  return; // ❌ BLOQUEIA
}

// ✅ PERMITIR - continuar processamento
```

---

## 📊 Diferenças Entre os Campos

| Campo | Propósito | Origem | Reversível? | Visível ao Usuário? |
|-------|-----------|--------|-------------|---------------------|
| `isBlocked` | Bloqueio administrativo | Admin/Sistema | Sim (admin) | Sim (mensagem) |
| `isActive` | Status da conta | Usuário/Admin | Sim (fácil) | Sim (mensagem) |
| `hasActiveSubscription` | Pagamento/Trial | Sistema de pagamento | Sim (pagamento) | Sim (renovação) |

---

## 🛠️ Implementação Atual

### ✅ Implementado:
1. ✅ Campos `isBlocked` e `isActive` no schema Prisma
2. ✅ Migration criada (`20251217140235_add_user_blocked_and_active_fields`)
3. ✅ Validação no `WhatsAppMessageHandler.processMessage()`
4. ✅ Atualização em `UserCacheService.createUserCache()`
5. ✅ Atualização em `UserCacheService.createUserCacheWithPlatform()`
6. ✅ Atualização em `UserCacheService.syncUser()`
7. ✅ Logs de warning quando bloqueio é detectado

### ⏳ Pendente (TODOs):
1. ⏳ Enviar mensagem informando que usuário está bloqueado
2. ⏳ Enviar mensagem informando que conta está desativada
3. ⏳ Enviar mensagem sobre renovação de assinatura
4. ⏳ Criar endpoint de admin para bloquear/desbloquear usuários
5. ⏳ Criar endpoint para usuário desativar sua própria conta
6. ⏳ Criar dashboard de admin para visualizar usuários bloqueados
7. ⏳ Integrar com sistema de assinaturas futuro

---

## 🚀 Melhorias Futuras

### 1. Mensagens ao Usuário
Atualmente os usuários bloqueados não recebem feedback. Implementar:

```typescript
// Em WhatsAppMessageHandler.processMessage()

if (user.isBlocked) {
  this.logger.warn(`[WhatsApp] User ${phoneNumber} is blocked`);

  // Enviar mensagem via contexto
  this.contextService.sendMessage(phoneNumber,
    '🚫 *Acesso Bloqueado*\n\n' +
    'Sua conta foi bloqueada. Entre em contato com o suporte para mais informações.'
  );
  return;
}

if (!user.isActive) {
  this.logger.warn(`[WhatsApp] User ${phoneNumber} is inactive`);

  this.contextService.sendMessage(phoneNumber,
    '⚠️ *Conta Desativada*\n\n' +
    'Sua conta está desativada. Para reativar, envie: *"reativar conta"*'
  );
  return;
}

if (!user.hasActiveSubscription) {
  this.logger.warn(`[WhatsApp] User ${phoneNumber} has no active subscription`);

  this.contextService.sendMessage(phoneNumber,
    '💳 *Assinatura Inativa*\n\n' +
    'Sua assinatura expirou. Renove para continuar usando o GastoCerto!\n\n' +
    '➡️ Acesse: https://gastocerto.com/renovar'
  );
  return;
}
```

### 2. Endpoint de Admin
Criar endpoint REST para gerenciar bloqueios:

```typescript
// POST /admin/users/:userId/block
async blockUser(userId: string, reason?: string): Promise<void> {
  await this.userCacheService.updateUserCache(userId, {
    isBlocked: true
  });

  // Log no sistema
  await this.auditLog.create({
    action: 'USER_BLOCKED',
    userId,
    reason,
    timestamp: new Date()
  });
}

// POST /admin/users/:userId/unblock
async unblockUser(userId: string): Promise<void> {
  await this.userCacheService.updateUserCache(userId, {
    isBlocked: false
  });
}
```

### 3. Auto-desativação de Conta
Permitir usuário desativar própria conta:

```typescript
// Intent: DEACTIVATE_ACCOUNT
if (intent === 'DEACTIVATE_ACCOUNT') {
  await this.userCacheService.updateUserCache(user.gastoCertoId, {
    isActive: false
  });

  return {
    success: true,
    message: '✅ Sua conta foi desativada. Para reativar, basta enviar uma mensagem.'
  };
}

// Intent: REACTIVATE_ACCOUNT
if (intent === 'REACTIVATE_ACCOUNT' && !user.isActive) {
  await this.userCacheService.updateUserCache(user.gastoCertoId, {
    isActive: true
  });

  return {
    success: true,
    message: '🎉 Bem-vindo de volta! Sua conta foi reativada.'
  };
}
```

### 4. Dashboard de Admin
Interface web para visualizar:
- Usuários bloqueados (com motivo)
- Contas desativadas
- Usuários sem assinatura ativa
- Histórico de bloqueios/desbloqueios

---

## 🔐 Segurança

### Ordem de Validação
A ordem atual é CRÍTICA para segurança:

1. **Bloqueio** (`isBlocked`) - Prioridade máxima
2. **Status** (`isActive`) - Segunda prioridade
3. **Assinatura** (`hasActiveSubscription`) - Última verificação

**Por que essa ordem?**
- Usuário bloqueado deve ser impedido mesmo se tiver assinatura ativa
- Conta desativada tem precedência sobre verificação de assinatura
- Permite bloquear usuários maliciosos independente de pagamento

### Bypass do Onboarding
O onboarding **NÃO** é afetado por essas validações:
```typescript
// Onboarding acontece ANTES da validação de bloqueio
if (isOnboarding) {
  await this.handleOnboardingMessage(message);
  return; // Não passa pelas validações
}
```

**Importante**: Se precisar bloquear durante onboarding, adicionar validação no `OnboardingService`.

---

## 📈 Monitoramento

### Logs Importantes
```
[WhatsApp] User 66996285154 is blocked
[WhatsApp] User 66996285154 is inactive
[WhatsApp] User 66996285154 has no active subscription
```

### Métricas Sugeridas
- Quantidade de mensagens bloqueadas por dia
- Usuários bloqueados ativos (tentando usar)
- Taxa de reativação de contas desativadas
- Conversão de usuários sem assinatura

---

## 🧪 Testes

### Testar Bloqueio
```typescript
// 1. Bloquear usuário
await userCacheService.updateUserCache(user.gastoCertoId, { isBlocked: true });

// 2. Tentar enviar mensagem
// Resultado esperado: Log de warning, mensagem não processada

// 3. Desbloquear
await userCacheService.updateUserCache(user.gastoCertoId, { isBlocked: false });

// 4. Tentar enviar mensagem
// Resultado esperado: Mensagem processada normalmente
```

### Testar Desativação
```typescript
// Similar ao bloqueio, mas usando isActive
await userCacheService.updateUserCache(user.gastoCertoId, { isActive: false });
// ... enviar mensagem ...
await userCacheService.updateUserCache(user.gastoCertoId, { isActive: true });
```

---

## 📝 Arquivos Modificados

- `src/prisma/schema.prisma` - Adicionados campos `isBlocked` e `isActive`
- `src/features/users/user-cache.service.ts` - Atualizado para incluir novos campos
- `src/infrastructure/whatsapp/messages/whatsapp-message.handler.ts` - Validação de bloqueio
- `src/prisma/migrations/20251217140235_add_user_blocked_and_active_fields/migration.sql` - Migration

---

## 🎯 Próximos Passos

1. Implementar mensagens de feedback aos usuários
2. Criar endpoints de admin para gerenciar bloqueios
3. Adicionar intent para desativar/reativar conta
4. Implementar dashboard de admin
5. Integrar com sistema de assinaturas quando implementado
6. Adicionar testes automatizados para bloqueios
7. Criar documentação de API para endpoints de admin

---

## 💡 Uso para Assinaturas

Quando o sistema de assinaturas for implementado:

```typescript
// Webhook de pagamento recebido
async handlePaymentWebhook(event: PaymentEvent) {
  if (event.status === 'paid') {
    await userCacheService.updateSubscriptionStatus(
      event.phoneNumber,
      true // hasActiveSubscription = true
    );

    // Usuário pode voltar a usar o sistema imediatamente
  }

  if (event.status === 'expired' || event.status === 'cancelled') {
    await userCacheService.updateSubscriptionStatus(
      event.phoneNumber,
      false // hasActiveSubscription = false
    );

    // Usuário será bloqueado na próxima mensagem
  }
}
```

---

## ✅ Status Atual

- ✅ **Infraestrutura**: Completa e funcional
- ⏳ **Feedback ao Usuário**: Pendente (TODOs marcados no código)
- ⏳ **Interface de Admin**: Não implementada
- ⏳ **Sistema de Assinaturas**: Não implementado

**O sistema está pronto para bloquear usuários, mas precisa de melhorias na comunicação com o usuário bloqueado.**
