# 📋 Plano de Melhorias - GastoCerto WhatsApp/Telegram Bot

## 🎯 Objetivo
Melhorar a experiência do usuário, organização do código e manutenibilidade do sistema de onboarding e operações do bot.

---

## 1. 🔧 MELHORIAS CRÍTICAS (Prioridade Alta)

### 1.1 ✅ Formatação de Detalhes da Fatura
**Status:** ✅ **CONCLUÍDO**

**Problema:**
- Título mostrava apenas categoria
- Faltava diferenciação entre categoria e subcategoria

**Solução Implementada:**
```typescript
// Título: descrição OU subcategoria OU categoria
const title = t.description || t.subCategory?.name || t.category?.name;

// Linha discriminação: categoria → subcategoria
const categoryLine = t.subCategory
  ? `${t.category?.name} → ${t.subCategory.name}`
  : t.category?.name;
```

**Exemplo do resultado:**
```
1. Painel Solar
   🔴 R$ 388.88
   📂 Investimentos → Energia Solar
   📅 05/03/2025
```

---

### 1.2 🔒 Sistema de Cache Unificado por gastoCertoId
**Status:** ✅ **CONCLUÍDO**

**Problema:**
- Redis tinha múltiplas chaves por usuário (uma por plataforma)
- Telegram e WhatsApp não compartilhavam cache
- Dados duplicados no Redis

**Solução Implementada:**
```typescript
// ANTES: user:707624962 (Telegram) + user:5511999999999 (WhatsApp)
// DEPOIS: user:abc-123-gastoCertoId (única chave universal)

private getCacheKey(gastoCertoId: string): string {
  return `user:${gastoCertoId}`;
}
```

**Benefícios:**
- ✅ Cache compartilhado entre plataformas
- ✅ Consistência garantida
- ✅ Economia de memória Redis

---

### 1.3 📞 Coletar Telefone para Usuários WhatsApp

**Problema Atual:**
- WhatsApp pula a etapa `REQUEST_PHONE`
- Usuários WhatsApp podem ter `phoneNumber` vazio
- Inconsistência com fluxo do Telegram

**Impacto:**
- Dificulta recuperação de conta
- Impede integração com sistemas que exigem telefone
- Experiência inconsistente entre plataformas

**Solução Proposta:**

**Arquivo:** `src/features/onboarding/onboarding-state.service.ts`

```typescript
// Linha 252-255: Remover skip condicional para WhatsApp
async handleEmailCollection(input: string, data: OnboardingData): Promise<OnboardingResponse> {
  // ... validação de email ...

  // ANTES:
  const nextStep = data.platform === 'telegram'
    ? OnboardingStep.REQUEST_PHONE
    : OnboardingStep.CHECK_EXISTING_USER;

  // DEPOIS:
  const nextStep = OnboardingStep.REQUEST_PHONE; // Para ambas as plataformas
}
```

**Mensagem para WhatsApp:**
```
📱 *Qual é o seu número de telefone?*

Digite no formato: (66) 99628-5154
Ou envie contato através do botão de anexo.

💡 _Seu telefone é usado para recuperação de conta e notificações importantes._
```

**Impacto:** 🟡 Médio | **Esforço:** 🟢 Baixo (2-4h)

---

## 2. 🛡️ MELHORIAS DE SEGURANÇA (Prioridade Alta)

### 2.1 🔐 Rate Limiting para Código de Verificação

**Problema Atual:**
- Usuários podem tentar código de verificação ilimitadas vezes
- Vulnerável a ataques de força bruta

**Solução Proposta:**

**Arquivo:** `src/features/onboarding/onboarding-state.service.ts`

```typescript
// Adicionar no OnboardingSession model
attempts: number        // Já existe
maxAttempts: number = 5 // Novo campo
codeLockedUntil?: Date  // Novo campo

async handleVerifyCode(code: string, session: OnboardingSession): Promise<OnboardingResponse> {
  // Verificar se está bloqueado
  if (session.codeLockedUntil && session.codeLockedUntil > new Date()) {
    const remainingMinutes = Math.ceil(
      (session.codeLockedUntil.getTime() - Date.now()) / 60000
    );

    return {
      success: false,
      message: `🔒 *Muitas tentativas incorretas*\n\n` +
        `Aguarde ${remainingMinutes} minuto(s) para tentar novamente.\n\n` +
        `💡 _Se esqueceu o código, digite "reenviar código"_`,
    };
  }

  // Incrementar tentativas
  session.attempts += 1;

  // Validar código
  const isValid = await this.gastoCertoApi.validateAuthCode(session.data.email, code);

  if (!isValid) {
    // Bloquear após 5 tentativas
    if (session.attempts >= 5) {
      session.codeLockedUntil = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos
      await this.saveSession(session);

      return {
        success: false,
        message: `❌ *Código incorreto*\n\n` +
          `🔒 Você atingiu o limite de tentativas.\n` +
          `Aguarde 5 minutos para tentar novamente.\n\n` +
          `💡 _Ou digite "reenviar código" para receber um novo._`,
      };
    }

    const remainingAttempts = 5 - session.attempts;
    return {
      success: false,
      message: `❌ *Código incorreto*\n\n` +
        `Tentativas restantes: ${remainingAttempts}\n\n` +
        `💡 _Verifique sua caixa de entrada e spam_`,
    };
  }

  // Código válido - resetar tentativas
  session.attempts = 0;
  session.codeLockedUntil = null;
  // ... prosseguir com sucesso
}
```

**Schema Prisma:**
```prisma
model OnboardingSession {
  // ... campos existentes
  attempts        Int      @default(0)
  maxAttempts     Int      @default(5)
  codeLockedUntil DateTime?
}
```

**Impacto:** 🔴 Alto | **Esforço:** 🟡 Médio (4-6h)

---

### 2.2 ⏱️ Timeout Explícito para Código de Verificação

**Problema Atual:**
- Código pode expirar na API sem aviso ao usuário
- Usuário não sabe se código ainda é válido

**Solução Proposta:**

```typescript
// Adicionar no OnboardingSession
codeSentAt?: Date

async handleRequestVerificationCode(): Promise<OnboardingResponse> {
  // Solicitar código à API
  await this.gastoCertoApi.requestAuthCode(email);

  // Salvar timestamp
  session.data.codeSentAt = new Date().toISOString();
  await this.saveSession(session);

  return {
    success: true,
    message: `📧 *Código enviado!*\n\n` +
      `Enviamos um código de 6 dígitos para:\n` +
      `📮 ${email}\n\n` +
      `⏱️ O código expira em 10 minutos.\n\n` +
      `💡 _Não recebeu? Digite "reenviar código"_`,
  };
}

async handleVerifyCode(code: string): Promise<OnboardingResponse> {
  // Verificar se código expirou (10 minutos)
  const codeSentAt = new Date(session.data.codeSentAt);
  const now = new Date();
  const minutesSinceSent = (now.getTime() - codeSentAt.getTime()) / 60000;

  if (minutesSinceSent > 10) {
    return {
      success: false,
      message: `⏱️ *Código expirado*\n\n` +
        `O código enviado há ${Math.floor(minutesSinceSent)} minutos expirou.\n\n` +
        `💡 _Digite "novo código" para receber outro_`,
    };
  }

  // ... validação normal
}
```

**Impacto:** 🟡 Médio | **Esforço:** 🟢 Baixo (2h)

---

## 3. 🎨 MELHORIAS DE UX (Prioridade Média)

### 3.1 📱 Mensagem de Retomada de Sessão

**Problema Atual:**
- Usuário é re-saudado ao retornar após timeout
- Confuso se sessão foi perdida ou recuperada

**Solução Proposta:**

```typescript
async handleMessage(input: string, session: OnboardingSession): Promise<OnboardingResponse> {
  const wasInactive = this.isExpired(session);

  if (wasInactive) {
    // Atualizar timestamp
    session.lastMessageAt = new Date();
    await this.saveSession(session);

    return {
      success: true,
      message: `👋 *Bem-vindo de volta, ${session.data.name || 'amigo'}!*\n\n` +
        `📝 Você estava na etapa: *${this.getStepLabel(session.currentStep)}*\n\n` +
        `Vamos continuar de onde paramos?\n\n` +
        `💡 _Digite "recomeçar" se quiser começar do zero_`,
      requiresConfirmation: true,
    };
  }

  // ... processamento normal
}

private getStepLabel(step: OnboardingStep): string {
  const labels = {
    [OnboardingStep.COLLECT_NAME]: 'Coleta de Nome',
    [OnboardingStep.COLLECT_EMAIL]: 'Coleta de Email',
    [OnboardingStep.REQUEST_PHONE]: 'Coleta de Telefone',
    [OnboardingStep.CHECK_EXISTING_USER]: 'Verificação de Conta',
    [OnboardingStep.REQUEST_VERIFICATION_CODE]: 'Envio de Código',
    [OnboardingStep.VERIFY_CODE]: 'Validação de Código',
    [OnboardingStep.CONFIRM_DATA]: 'Confirmação de Dados',
    [OnboardingStep.CREATING_ACCOUNT]: 'Criação de Conta',
    [OnboardingStep.COMPLETED]: 'Cadastro Completo',
  };
  return labels[step] || 'Etapa Desconhecida';
}
```

**Impacto:** 🟢 Baixo | **Esforço:** 🟢 Baixo (1-2h)

---

### 3.2 📋 Comando /status Durante Onboarding

**Proposta:**
Permitir usuário verificar progresso sem interromper fluxo

```typescript
async handleMessage(input: string, session: OnboardingSession): Promise<OnboardingResponse> {
  // Detectar comando /status
  if (input.trim().toLowerCase() === '/status') {
    const progress = this.calculateProgress(session.currentStep);

    return {
      success: true,
      message: `📊 *Status do Cadastro*\n\n` +
        `✅ Progresso: ${progress}%\n\n` +
        this.getProgressBar(progress) + `\n\n` +
        `📍 Etapa atual: ${this.getStepLabel(session.currentStep)}\n\n` +
        this.getCompletedSteps(session) +
        `\n💡 _Continue respondendo para completar o cadastro_`,
    };
  }

  // ... processamento normal
}

private calculateProgress(step: OnboardingStep): number {
  const totalSteps = 9;
  const stepOrder = {
    [OnboardingStep.COLLECT_NAME]: 1,
    [OnboardingStep.COLLECT_EMAIL]: 2,
    [OnboardingStep.REQUEST_PHONE]: 3,
    [OnboardingStep.CHECK_EXISTING_USER]: 4,
    // ... etc
  };
  const currentStepNumber = stepOrder[step] || 0;
  return Math.round((currentStepNumber / totalSteps) * 100);
}

private getProgressBar(percent: number): string {
  const filled = Math.floor(percent / 10);
  const empty = 10 - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty) + ` ${percent}%`;
}

private getCompletedSteps(session: OnboardingSession): string {
  let steps = '';
  if (session.data.name) steps += '✅ Nome coletado\n';
  if (session.data.email) steps += '✅ Email coletado\n';
  if (session.data.realPhoneNumber) steps += '✅ Telefone coletado\n';
  return steps;
}
```

**Exemplo de saída:**
```
📊 Status do Cadastro

✅ Progresso: 33%

▓▓▓░░░░░░░ 33%

📍 Etapa atual: Coleta de Email

✅ Nome coletado

💡 _Continue respondendo para completar o cadastro_
```

**Impacto:** 🟡 Médio | **Esforço:** 🟡 Médio (3-4h)

---

### 3.3 🔄 Botão "Pular Telefone" Mais Claro (Telegram)

**Problema Atual:**
- Usuários não sabem se podem pular telefone
- Mensagens de skip são muito textuais

**Solução Proposta:**

```typescript
// Para Telegram: usar botões inline
async handlePhoneRequest(): Promise<OnboardingResponse> {
  if (platform === 'telegram') {
    return {
      success: true,
      message: `📱 *Qual é o seu número de telefone?*\n\n` +
        `Compartilhe seu contato usando o botão abaixo,\n` +
        `ou digite manualmente no formato: (66) 99628-5154\n\n` +
        `💡 _Usado para recuperação de conta_`,
      metadata: {
        keyboard: {
          inline_keyboard: [[
            { text: '📞 Compartilhar Contato', request_contact: true },
            { text: '⏭️ Pular', callback_data: 'skip_phone' }
          ]]
        }
      }
    };
  }

  // Para WhatsApp: texto normal
  return {
    success: true,
    message: `📱 *Qual é o seu número de telefone?*\n\n` +
      `Digite no formato: (66) 99628-5154\n\n` +
      `💡 _Digite "pular" se preferir cadastrar sem telefone_`,
  };
}
```

**Impacto:** 🟡 Médio | **Esforço:** 🟡 Médio (2-3h)

---

## 4. 🏗️ REFATORAÇÃO E ORGANIZAÇÃO (Prioridade Baixa)

### 4.1 📦 Separar Validators em Módulo Dedicado

**Problema Atual:**
- Validators estão dentro de `/features/onboarding`
- Poderiam ser reutilizados em outras features

**Solução Proposta:**

**Estrutura Nova:**
```
src/
├── common/
│   └── validators/
│       ├── name.validator.ts
│       ├── email.validator.ts
│       ├── phone.validator.ts
│       ├── cpf.validator.ts (futuro)
│       └── index.ts
```

**Benefícios:**
- Reutilização em outras features (ex: atualização de perfil)
- Testes isolados
- Melhor separação de responsabilidades

**Impacto:** 🟢 Baixo | **Esforço:** 🟡 Médio (4h)

---

### 4.2 🧪 Adicionar Testes Unitários para Validators

**Cobertura Atual:**
- 0% de testes para validators

**Proposta:**

```typescript
// src/common/validators/__tests__/name.validator.spec.ts
describe('NameValidator', () => {
  describe('validate', () => {
    it('should accept valid Brazilian names', () => {
      expect(NameValidator.validate('João Silva')).toEqual({ valid: true });
      expect(NameValidator.validate('Maria da Silva Santos')).toEqual({ valid: true });
    });

    it('should reject test patterns', () => {
      const result = NameValidator.validate('teste teste');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('nome real');
    });

    it('should reject names with numbers', () => {
      const result = NameValidator.validate('João Silva123');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('apenas letras');
    });

    it('should require at least 2 words', () => {
      const result = NameValidator.validate('João');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('nome completo');
    });
  });

  describe('normalizeName', () => {
    it('should convert to title case', () => {
      expect(NameValidator.normalizeName('joao silva')).toBe('João Silva');
    });

    it('should handle Portuguese exceptions', () => {
      expect(NameValidator.normalizeName('MARIA DA SILVA')).toBe('Maria da Silva');
      expect(NameValidator.normalizeName('JOÃO DOS SANTOS')).toBe('João dos Santos');
    });
  });
});
```

**Meta de Cobertura:** 80%+

**Impacto:** 🟢 Baixo | **Esforço:** 🟡 Médio (6-8h)

---

### 4.3 🎭 Implementar Pattern State para OnboardingStep

**Problema Atual:**
- Switch/case gigante para processar cada step
- Difícil adicionar novos steps

**Solução Proposta (Design Pattern):**

```typescript
// src/features/onboarding/steps/base-step.ts
abstract class BaseOnboardingStep {
  abstract validate(input: string): ValidationResult;
  abstract process(input: string, data: OnboardingData): Promise<OnboardingResponse>;
  abstract getNextStep(): OnboardingStep;
  abstract getHelpMessage(): string;
}

// src/features/onboarding/steps/collect-name.step.ts
class CollectNameStep extends BaseOnboardingStep {
  validate(input: string): ValidationResult {
    return NameValidator.validate(input);
  }

  async process(input: string, data: OnboardingData): Promise<OnboardingResponse> {
    const normalized = NameValidator.normalizeName(input);
    data.name = normalized;

    return {
      success: true,
      message: `Prazer em te conhecer, ${normalized}! 👋\n\nQual é o seu email?`,
      data,
      nextStep: OnboardingStep.COLLECT_EMAIL,
    };
  }

  getNextStep(): OnboardingStep {
    return OnboardingStep.COLLECT_EMAIL;
  }

  getHelpMessage(): string {
    return 'Digite seu nome completo (ex: João Silva)';
  }
}

// src/features/onboarding/onboarding-state.service.ts
class OnboardingStateService {
  private stepHandlers: Map<OnboardingStep, BaseOnboardingStep> = new Map([
    [OnboardingStep.COLLECT_NAME, new CollectNameStep()],
    [OnboardingStep.COLLECT_EMAIL, new CollectEmailStep()],
    [OnboardingStep.REQUEST_PHONE, new RequestPhoneStep()],
    // ...
  ]);

  async processMessage(input: string, session: OnboardingSession): Promise<OnboardingResponse> {
    const handler = this.stepHandlers.get(session.currentStep);
    if (!handler) {
      throw new Error(`No handler for step: ${session.currentStep}`);
    }

    // Validar
    const validation = handler.validate(input);
    if (!validation.valid) {
      return { success: false, message: validation.error };
    }

    // Processar
    return handler.process(input, session.data);
  }
}
```

**Benefícios:**
- Código mais modular
- Fácil adicionar novos steps
- Cada step é testável isoladamente
- Segue princípios SOLID

**Impacto:** 🟢 Baixo | **Esforço:** 🔴 Alto (12-16h)

---

## 5. 📊 MONITORAMENTO E OBSERVABILIDADE

### 5.1 📈 Métricas de Onboarding

**Proposta:**
Adicionar métricas para acompanhar conversão

```typescript
// src/features/onboarding/onboarding-metrics.service.ts
@Injectable()
export class OnboardingMetricsService {
  async trackStepStarted(step: OnboardingStep, platform: string): Promise<void> {
    await this.metricsService.increment('onboarding.step.started', {
      step,
      platform,
    });
  }

  async trackStepCompleted(step: OnboardingStep, platform: string, duration: number): Promise<void> {
    await this.metricsService.increment('onboarding.step.completed', {
      step,
      platform,
    });

    await this.metricsService.histogram('onboarding.step.duration', duration, {
      step,
      platform,
    });
  }

  async trackValidationError(step: OnboardingStep, errorType: string): Promise<void> {
    await this.metricsService.increment('onboarding.validation.error', {
      step,
      errorType,
    });
  }

  async trackFunnelDropoff(step: OnboardingStep, platform: string): Promise<void> {
    await this.metricsService.increment('onboarding.funnel.dropoff', {
      step,
      platform,
    });
  }

  async trackCompletionRate(platform: string, timeToComplete: number): Promise<void> {
    await this.metricsService.increment('onboarding.completed', { platform });
    await this.metricsService.histogram('onboarding.time_to_complete', timeToComplete, { platform });
  }
}
```

**Dashboards Sugeridos:**
- Taxa de conversão por etapa (funil)
- Tempo médio de conclusão
- Taxa de abandono por etapa
- Erros de validação mais comuns
- Comparação Telegram vs WhatsApp

**Impacto:** 🟡 Médio | **Esforço:** 🟡 Médio (4-6h)

---

## 6. 🚀 ROADMAP DE IMPLEMENTAÇÃO

### **Fase 1: Correções Críticas** (1-2 semanas)
1. ✅ Formatação de detalhes da fatura _(CONCLUÍDO)_
2. ✅ Cache unificado por gastoCertoId _(CONCLUÍDO)_
3. ⏳ Coletar telefone para WhatsApp
4. ⏳ Rate limiting de código de verificação
5. ⏳ Timeout explícito de código

### **Fase 2: Melhorias de UX** (1 semana)
6. ⏳ Mensagem de retomada de sessão
7. ⏳ Comando /status
8. ⏳ Botões inline para Telegram

### **Fase 3: Refatoração** (2-3 semanas)
9. ⏳ Separar validators
10. ⏳ Adicionar testes unitários
11. ⏳ Pattern State (opcional)

### **Fase 4: Observabilidade** (1 semana)
12. ⏳ Métricas de onboarding
13. ⏳ Dashboards

---

## 7. 📝 CHECKLIST DE QUALIDADE

Antes de cada release, verificar:

- [ ] Build passa sem erros (`npm run build`)
- [ ] TypeScript check passa (`npx tsc --noEmit`)
- [ ] Testes unitários passam (`npm test`)
- [ ] Testes E2E passam (quando disponíveis)
- [ ] Logs não contêm dados sensíveis
- [ ] Mensagens de erro são user-friendly
- [ ] Discord notifications funcionam
- [ ] Cache Redis está consistente
- [ ] Validações estão corretas

---

## 8. 📚 DOCUMENTAÇÃO ADICIONAL NECESSÁRIA

- [ ] Fluxograma visual do onboarding (Mermaid)
- [ ] Guia de contribuição para adicionar novos steps
- [ ] Documentação de validators
- [ ] Runbook de troubleshooting
- [ ] Guia de métricas e dashboards

---

## 9. ✅ RESUMO EXECUTIVO

### **Concluídas:**
1. ✅ Formatação de detalhes da fatura com categoria → subcategoria
2. ✅ Sistema de cache unificado por gastoCertoId

### **Prioridades Imediatas:**
1. 🔴 Coletar telefone para WhatsApp (paridade com Telegram)
2. 🔴 Rate limiting de código de verificação (segurança)
3. 🟡 Timeout explícito de código (UX)

### **Melhorias de Longo Prazo:**
- Refatoração com Pattern State
- Testes unitários completos
- Métricas e observabilidade

### **Tempo Estimado Total:**
- **Fase 1 (Crítico):** 2 semanas
- **Fase 2 (UX):** 1 semana
- **Fase 3 (Refatoração):** 3 semanas
- **Fase 4 (Métricas):** 1 semana

**Total:** ~7 semanas de desenvolvimento

---

**Última atualização:** 18/12/2025
**Versão:** 1.0
