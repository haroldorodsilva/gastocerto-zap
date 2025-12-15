# 🧪 Testes do Fluxo de Onboarding

Este documento explica como rodar os testes unitários e de integração (E2E) do fluxo de onboarding.

## 📋 Tipos de Testes

### 1. **Testes Unitários** (`onboarding.service.spec.ts`)
Testam funções individuais com mocks completos.

### 2. **Testes E2E** (`onboarding.e2e.spec.ts`)
Simulam o fluxo completo de onboarding como um usuário real faria.

## 🚀 Como Rodar os Testes

### Rodar todos os testes
```bash
pnpm test
```

### Rodar apenas testes de onboarding
```bash
pnpm test onboarding
```

### Rodar com watch (desenvolvimento)
```bash
pnpm test:watch onboarding
```

### Rodar com coverage
```bash
pnpm test:cov
```

### Rodar testes E2E
```bash
pnpm test onboarding.e2e
```

## 📊 Cenários Testados

### ✅ Cenário 1: Novo Usuário
**Fluxo completo:**
1. Usuário envia primeira mensagem
2. Sistema solicita nome
3. Usuário envia nome válido
4. Sistema solicita email
5. Usuário envia email (novo)
6. Sistema verifica que email não existe
7. Sistema solicita confirmação
8. Usuário confirma com "sim"
9. Sistema cria conta na API
10. Onboarding concluído ✅

**Arquivo:** `onboarding.e2e.spec.ts` → `Fluxo 1: Novo usuário completo`

### 🔐 Cenário 2: Email Existente
**Fluxo com verificação:**
1. Usuário envia nome
2. Usuário envia email (já existe)
3. Sistema detecta email existente
4. Sistema envia código de verificação
5. Usuário digita código
6. Sistema valida e vincula telefone
7. Onboarding concluído ✅

**Arquivo:** `onboarding.e2e.spec.ts` → `Fluxo 2: Email existente com verificação`

### ❌ Cenário 3: Validações
**Testa erros:**
- Nome inválido (muito curto)
- Email inválido (formato incorreto)
- API falha ao criar usuário
- Usuário duplicado (409)

**Arquivo:** `onboarding.service.spec.ts` → `Cenário 3: Erros e validações`

## 🔍 Exemplo de Saída

```bash
$ pnpm test onboarding

PASS  src/modules/onboarding/onboarding.service.spec.ts
  OnboardingService - Fluxo Completo
    Cenário 1: Novo usuário (email não existe)
      ✓ deve completar onboarding com sucesso (25ms)
    Cenário 2: Email já existe (requer verificação)
      ✓ deve solicitar código de verificação (15ms)
      ✓ deve validar código e vincular telefone (12ms)
    Cenário 3: Erros e validações
      ✓ deve tratar erro quando API falha ao criar usuário (8ms)
      ✓ deve tratar usuário duplicado (409) (10ms)

PASS  src/modules/onboarding/onboarding.e2e.spec.ts
  Onboarding E2E - Fluxo Completo
    🎯 Fluxo 1: Novo usuário completo
      ✓ deve completar onboarding de novo usuário passo a passo (45ms)
    🔐 Fluxo 2: Email existente com verificação
      ✓ deve solicitar código quando email já existe (32ms)
    ❌ Fluxo 3: Validações e erros
      ✓ deve rejeitar nome inválido (8ms)
      ✓ deve rejeitar email inválido (9ms)

Test Suites: 2 passed, 2 total
Tests:       9 passed, 9 total
Snapshots:   0 total
Time:        3.254s
```

## 🎯 Estrutura dos Testes E2E

Os testes E2E simulam uma conversa real:

```typescript
// PASSO 1: Usuário inicia conversa
await service.processOnboardingMessage(chatId, 'Oi');
// Resposta: "Bem-vindo! Qual é o seu nome?"

// PASSO 2: Usuário envia nome
await service.processOnboardingMessage(chatId, 'Haroldo Silva');
// Resposta: "Ótimo! Agora informe seu email:"

// PASSO 3: Usuário envia email
await service.processOnboardingMessage(chatId, 'haroldo@example.com');
// Resposta: "Confirme seus dados: Nome: Haroldo Silva, Email: haroldo@example.com"

// PASSO 4: Usuário confirma
await service.processOnboardingMessage(chatId, 'sim');
// Resposta: "✅ Cadastro concluído com sucesso!"
```

## 📝 Mocks Utilizados

### PrismaService
- `onboardingSession.findFirst` - Buscar sessão ativa
- `onboardingSession.upsert` - Criar/atualizar sessão
- `onboardingSession.update` - Atualizar dados
- `auditLog.create` - Registrar conclusão

### GastoCertoApiService
- `getUserByEmail` - Verificar se email existe
- `requestAuthCode` - Solicitar código
- `validateAuthCode` - Validar código
- `createUser` - Criar usuário
- `getUserCategories` - Buscar categorias

### UserCacheService
- `createUserCache` - Criar cache local
- `syncUser` - Sincronizar com API

## 🐛 Debugging

### Ver logs detalhados
```bash
pnpm test onboarding --verbose
```

### Rodar teste específico
```bash
pnpm test -t "deve completar onboarding com sucesso"
```

### Modo debug
```bash
pnpm test:debug onboarding
```

## 📚 Referências

- **Arquivos de teste:**
  - `src/modules/onboarding/onboarding.service.spec.ts`
  - `src/modules/onboarding/onboarding.e2e.spec.ts`

- **Código fonte:**
  - `src/modules/onboarding/onboarding.service.ts`
  - `src/modules/onboarding/onboarding-state.service.ts`

- **Documentação:**
  - [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)
  - [Jest Documentation](https://jestjs.io/docs/getting-started)

## ✅ Checklist de Testes

Antes de fazer deploy, garanta que:

- [ ] Todos os testes unitários passam
- [ ] Todos os testes E2E passam
- [ ] Coverage está acima de 80%
- [ ] Não há testes ignorados (.skip)
- [ ] Mocks estão atualizados com a API real

## 🎓 Como Adicionar Novos Testes

1. **Para testar nova funcionalidade:**
```typescript
it('deve fazer algo específico', async () => {
  // Arrange: preparar mocks
  jest.spyOn(service, 'method').mockResolvedValue(result);
  
  // Act: executar ação
  const response = await service.processMessage(chatId, 'input');
  
  // Assert: verificar resultado
  expect(response.currentStep).toBe('EXPECTED_STEP');
});
```

2. **Para testar novo step do onboarding:**
```typescript
describe('Novo Step: MINHA_FEATURE', () => {
  it('deve processar corretamente', async () => {
    // Setup session no step
    jest.spyOn(prisma.onboardingSession, 'findFirst').mockResolvedValue({
      currentStep: 'MINHA_FEATURE',
      data: { ... }
    });
    
    // Processar mensagem
    const result = await service.processMessage(chatId, 'input');
    
    // Verificar próximo step
    expect(result.currentStep).toBe('NEXT_STEP');
  });
});
```

## 🚨 Troubleshooting

### Erro: "Cannot find module"
```bash
pnpm install
pnpm db:generate
```

### Erro: "Timeout of 5000ms exceeded"
Aumente o timeout no teste:
```typescript
it('test name', async () => {
  // ...
}, 10000); // 10 segundos
```

### Erro: "Mock não está sendo chamado"
Verifique se o spy está no lugar certo:
```typescript
const spy = jest.spyOn(service, 'method');
// execute código
expect(spy).toHaveBeenCalled();
```
