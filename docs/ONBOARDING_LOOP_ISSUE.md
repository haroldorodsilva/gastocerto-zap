# 🔍 Análise do Problema: Onboarding Loop

## 🔴 Problema Reportado

Usuários que já têm registro no banco de dados estão caindo no fluxo de onboarding quando enviam mensagens no Telegram ou WhatsApp. Quando tentam validar o código, o sistema diz que está errado.

## 🔎 Causa Raiz Identificada

O problema está na **ordem de validação** no `MessageValidationService`:

### Fluxo Atual (PROBLEMÁTICO)

```typescript
// src/features/messages/message-validation.service.ts - linha 82-95

async validateUser(platformId: string, platform: 'whatsapp' | 'telegram' | 'web') {
  // 1️⃣ PRIMEIRO: Verifica se está em onboarding
  const isOnboarding = await this.onboardingService.isUserOnboarding(platformId);
  
  if (isOnboarding) {
    // ❌ RETORNA AQUI - Não chega a verificar se usuário existe
    return {
      isValid: false,
      action: ValidationAction.ONBOARDING,
    };
  }

  // 2️⃣ DEPOIS: Busca usuário no cache
  const user = await this.fetchUser(platformId, platform);
  
  // ... resto da validação
}
```

### O que acontece:

1. **Sistema verifica onboarding ANTES de verificar se usuário existe**
2. Se existe uma sessão com `completed = false`, entra no fluxo de onboarding
3. Mesmo que o usuário já esteja registrado no `UserCache`, não chega a verificar
4. Usuário fica preso no loop de onboarding

## 📊 Verificação do Problema

O método `isUserOnboarding()` busca sessões ativas:

```typescript
// src/features/onboarding/onboarding-state.service.ts - linha 742

async getActiveSession(platformId: string): Promise<OnboardingSession | null> {
  return this.prisma.onboardingSession.findFirst({
    where: {
      platformId,
      completed: false,  // ⚠️ Qualquer sessão não completa retorna true
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
}
```

## 🎯 Cenários Problemáticos

### Cenário 1: Onboarding incompleto

```
1. Usuário inicia onboarding no Telegram
2. Coleta nome, email
3. Sistema envia código de verificação
4. Usuário ABANDONA antes de validar código
5. Sessão fica com completed=false
6. Quando usuário volta, cai no onboarding de novo
7. Mas o código antigo expirou
8. Validação falha sempre
```

### Cenário 2: Criação manual de usuário

```
1. Admin cria usuário manualmente no UserCache
2. Mas existe sessão antiga de onboarding (completed=false)
3. Usuário tenta usar o sistema
4. Sistema vê sessão ativa e força onboarding
5. Usuário não entende porque precisa fazer onboarding de novo
```

### Cenário 3: Erro no processo de finalização

```
1. Usuário completa onboarding
2. UserCache é criado
3. MAS sessão não é marcada como completed=true (bug/erro)
4. Usuário fica preso no onboarding
```

## 📍 Endpoint de Validação de Código

O endpoint que valida o código de verificação é:

```typescript
// src/shared/gasto-certo-api.service.ts - linha 412-450

async validateAuthCode(data: ValidateAuthCodeDto): Promise<ValidateAuthCodeResponseDto> {
  const response = await this.httpService.post(
    `${this.baseUrl}/external/users/auth-code/validate`,  // ← ENDPOINT
    data,
    {
      headers: {
        ...hmacHeaders,
        'Content-Type': 'application/json',
      }
    }
  );
  
  return response.data;
}
```

**URL completa:** `https://api.gastocerto.com.br/external/users/auth-code/validate`

## 🔧 Soluções Implementadas

### 1. Scripts de Diagnóstico e Correção

Criamos dois scripts para identificar e corrigir o problema:

#### `diagnose-onboarding-issue.ts`

Verifica:
- ✅ Se usuário existe no UserCache
- ⚠️ Se tem sessão de onboarding ativa
- 📋 Histórico de sessões
- 💡 Diagnóstico do problema

**Uso:**
```bash
npx ts-node scripts/diagnose-onboarding-issue.ts <phoneNumber ou chatId>

# Exemplos:
npx ts-node scripts/diagnose-onboarding-issue.ts 5566996285154  # WhatsApp
npx ts-node scripts/diagnose-onboarding-issue.ts 707624962      # Telegram
```

#### `fix-onboarding-sessions.ts`

Corrige automaticamente:
- 🔍 Busca todas as sessões com `completed = false`
- ✅ Verifica se usuário já existe no UserCache
- 🔧 Marca sessão como `completed = true`

**Uso:**
```bash
npx ts-node scripts/fix-onboarding-sessions.ts
```

### 2. Resultado da Execução

```
========================================
🔧 CORREÇÃO DE SESSÕES DE ONBOARDING
========================================

1️⃣ Buscando sessões ativas de onboarding...

📋 Encontradas 3 sessões ativas

2️⃣ Verificando usuários registrados...

ℹ️ Sessão sem usuário registrado (OK):
   Platform ID: 125984879694016
   Step: COLLECT_EMAIL

ℹ️ Sessão sem usuário registrado (OK):
   Platform ID: 5517981233989
   Step: COLLECT_EMAIL

ℹ️ Sessão sem usuário registrado (OK):
   Platform ID: 556696285154
   Step: COLLECT_NAME

3️⃣ RESUMO:

   ✅ Sessões corrigidas: 0
   ℹ️ Sessões válidas (não corrigidas): 3
   📊 Total processado: 3

✅ Nenhuma correção necessária!
```

## 💡 Recomendações de Melhoria no Código

### ✅ IMPLEMENTADAS (05/01/2026)

#### Correção 1: Inverter ordem de validação

Implementado em `message-validation.service.ts`:
- ✅ Agora verifica usuário PRIMEIRO
- ✅ Se usuário existe e está ativo, limpa sessões órfãs automaticamente
- ✅ Só então verifica onboarding se usuário não existir

#### Correção 2: Deletar sessões expiradas

Implementado em `onboarding-state.service.ts`:
- ✅ Sessões expiradas agora são DELETADAS ao invés de reativadas
- ✅ Usuário recomeça onboarding do zero se sessão expirar
- ✅ Evita acúmulo de sessões antigas no banco

#### Correção 3: Cleanup automático de sessões órfãs

Implementado em `message-validation.service.ts`:
- ✅ Método `cleanupOrphanSession()` marca sessões órfãs como completed
- ✅ Executado automaticamente quando usuário registrado é detectado com sessão ativa
- ✅ Logs informativos para tracking

### 🔄 Opções Anteriores (Referência)

### Opção 1: Inverter ordem de validação (IMPLEMENTADA)

```typescript
async validateUser(platformId: string, platform: 'whatsapp' | 'telegram' | 'web') {
  // 1️⃣ PRIMEIRO: Busca usuário no cache
  const user = await this.fetchUser(platformId, platform);
  
  // 2️⃣ Se usuário existe e está OK, retorna
  if (user && user.isActive && !user.isBlocked) {
    return {
      isValid: true,
      action: ValidationAction.PROCEED,
      user,
    };
  }
  
  // 3️⃣ DEPOIS: Verifica onboarding (só se usuário não existe)
  const isOnboarding = await this.onboardingService.isUserOnboarding(platformId);
  
  if (isOnboarding) {
    return {
      isValid: false,
      action: ValidationAction.ONBOARDING,
    };
  }
  
  // ... resto da validação
}
```

### Opção 2: Adicionar verificação dupla

```typescript
async validateUser(platformId: string, platform: 'whatsapp' | 'telegram' | 'web') {
  // Verificar onboarding
  const isOnboarding = await this.onboardingService.isUserOnboarding(platformId);
  
  if (isOnboarding) {
    // ✨ NOVO: Verificar se usuário já existe antes de forçar onboarding
    const user = await this.fetchUser(platformId, platform);
    
    if (user && user.isActive) {
      // Usuário existe - limpar sessão de onboarding órfã
      await this.onboardingService.clearOnboardingSession(platformId);
      this.logger.warn(`Cleared orphan onboarding session for existing user: ${platformId}`);
      
      return {
        isValid: true,
        action: ValidationAction.PROCEED,
        user,
      };
    }
    
    return {
      isValid: false,
      action: ValidationAction.ONBOARDING,
    };
  }
  
  // ... resto da validação
}
```

### Opção 3: Adicionar timeout para sessões de onboarding

```typescript
// onboarding-state.service.ts

async getActiveSession(platformId: string): Promise<OnboardingSession | null> {
  const session = await this.prisma.onboardingSession.findFirst({
    where: {
      platformId,
      completed: false,
      expiresAt: {
        gte: new Date(), // ✨ Apenas sessões não expiradas
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
  
  return session;
}
```

## 📋 Checklist de Validação

Para validar se o problema está resolvido:

- [ ] Executar `fix-onboarding-sessions.ts` para corrigir sessões órfãs
- [ ] Verificar logs do sistema durante mensagem de usuário registrado
- [ ] Confirmar que usuários com registro não entram no onboarding
- [ ] Testar código de verificação válido durante onboarding real
- [ ] Verificar se sessões expiradas não causam problemas
- [ ] Implementar uma das opções de melhoria no código

## 🎯 Próximos Passos

1. **Imediato (Correção):**
   - Execute `fix-onboarding-sessions.ts` para limpar sessões órfãs
   - Monitore logs para identificar novos casos

2. **Curto prazo (Prevenção):**
   - Implementar Opção 2 (verificação dupla)
   - Adicionar cleanup automático de sessões expiradas
   - Melhorar logs para identificar quando acontece

3. **Médio prazo (Robustez):**
   - Implementar rate limiting para códigos de verificação
   - Adicionar timeout explícito para códigos (10 minutos)
   - Sistema de recuperação automática de sessões órfãs
   - Alertas quando usuário fica preso no onboarding

## 📊 Métricas para Monitorar

```sql
-- Sessões órfãs (usuário existe mas tem sessão ativa)
SELECT 
  os.platformId,
  os.currentStep,
  os.createdAt,
  uc.name,
  uc.email
FROM "OnboardingSession" os
JOIN "UserCache" uc ON (
  uc.phoneNumber = os.platformId OR
  uc.telegramId = os.platformId OR
  uc.whatsappId = os.platformId
)
WHERE os.completed = false;

-- Sessões expiradas ainda ativas
SELECT 
  platformId,
  currentStep,
  createdAt,
  expiresAt,
  (EXTRACT(EPOCH FROM (NOW() - expiresAt)) / 60)::int as minutes_expired
FROM "OnboardingSession"
WHERE completed = false
  AND expiresAt < NOW()
ORDER BY expiresAt DESC;
```

## 🔗 Arquivos Relacionados

- `src/features/messages/message-validation.service.ts` (linha 82-95)
- `src/features/onboarding/onboarding-state.service.ts` (linha 742)
- `src/features/onboarding/onboarding.service.ts` (linha 538-600)
- `src/shared/gasto-certo-api.service.ts` (linha 412-450)
- `scripts/diagnose-onboarding-issue.ts` (novo)
- `scripts/fix-onboarding-sessions.ts` (novo)

---

**Última atualização:** 5 de Janeiro de 2026
