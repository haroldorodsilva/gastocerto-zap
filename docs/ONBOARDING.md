# 📋 Fluxo de Onboarding

## Visão Geral

O módulo de onboarding gerencia o processo de cadastro e autenticação de novos usuários através do WhatsApp e Telegram. O fluxo é gerenciado por uma máquina de estados que guia o usuário através das etapas necessárias para criar ou vincular uma conta.

## 🎯 Objetivo

Coletar e validar os dados necessários para:
1. **Usuários novos**: Criar conta na API GastoCerto
2. **Usuários existentes**: Vincular telefone a uma conta existente via código de verificação

## 🔄 Estados do Onboarding

```typescript
enum OnboardingStep {
  COLLECT_NAME                // Coleta nome completo
  COLLECT_EMAIL               // Coleta e valida email
  REQUEST_PHONE               // Solicita compartilhamento do telefone
  CHECK_EXISTING_USER         // Verifica se email já existe na API
  REQUEST_VERIFICATION_CODE   // Envia código por email (usuário existente)
  VERIFY_CODE                 // Valida código de 6 dígitos
  CHOOSE_ACCOUNT              // Seleciona conta (se usuário tem múltiplas)
  CONFIRM_DATA                // Confirma dados antes de criar conta
  CREATING_ACCOUNT            // Criando conta na API
  COMPLETED                   // Onboarding finalizado
}
```

## 📊 Fluxograma Principal

```
┌─────────────────┐
│  COLLECT_NAME   │ ─┐
└─────────────────┘  │
                     ├─> Valida nome (2+ palavras)
┌─────────────────┐  │
│ COLLECT_EMAIL   │ ─┘
└─────────────────┘
         │
         ├─> Valida formato email
         │
┌─────────────────┐
│ REQUEST_PHONE   │ ─┐
└─────────────────┘  │
         │           ├─> WhatsApp: Botão compartilhar
         │           └─> Telegram: Auto-detecção
         │
┌─────────────────────┐
│ CHECK_EXISTING_USER │ ─┐
└─────────────────────┘  │
         │               │
         ├─ Usuário existe? ──> SIM ─┐
         │                            │
         │                   ┌────────────────────────┐
         │                   │ REQUEST_VERIFICATION    │
         │                   │      _CODE              │
         │                   └────────────────────────┘
         │                            │
         │                   ┌────────────────────────┐
         │                   │    VERIFY_CODE          │
         │                   └────────────────────────┘
         │                            │
         │                   ┌────────────────────────┐
         │                   │   CHOOSE_ACCOUNT        │ (se múltiplas contas)
         │                   └────────────────────────┘
         │                            │
         │                            └──> COMPLETED
         │
         └─ Usuário novo? ──> NÃO ─┐
                                    │
                           ┌────────────────┐
                           │  CONFIRM_DATA  │
                           └────────────────┘
                                    │
                           ┌────────────────┐
                           │ CREATING_       │
                           │  ACCOUNT        │
                           └────────────────┘
                                    │
                           ┌────────────────┐
                           │   COMPLETED    │
                           └────────────────┘
```

## 🏗️ Arquitetura

### Camadas Principais

1. **OnboardingService** (`onboarding.service.ts`)
   - Orquestra o fluxo completo
   - Interface com API GastoCerto
   - Gerencia verificação de usuários

2. **OnboardingStateService** (`onboarding-state.service.ts`)
   - Máquina de estados
   - Valida inputs em cada etapa
   - Persiste sessões no PostgreSQL
   - Gerencia timeout (30 minutos)

3. **Validators**
   - `EmailValidator`: Formato e domínios válidos
   - `NameValidator`: Nome completo (2+ palavras)
   - `PhoneValidator`: Normalização e validação

### Banco de Dados

```prisma
model OnboardingSession {
  id           String          @id @default(uuid())
  phoneNumber  String          @unique
  currentStep  OnboardingStep
  data         Json            // Dados coletados
  attempts     Int             @default(0)
  completed    Boolean         @default(false)
  expiresAt    DateTime
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt
}
```

**Campos de `data` (Json):**
```json
{
  "name": "João Silva",
  "email": "joao@exemplo.com",
  "phone": "66996285154",
  "platform": "whatsapp",
  "verificationCode": "123456",
  "selectedAccountId": "uuid",
  "availableAccounts": [...]
}
```

## 📝 Fluxo Detalhado

### 1️⃣ COLLECT_NAME

**Objetivo**: Coletar nome completo

**Entrada**: Mensagem de texto livre

**Validação**:
- Mínimo 2 palavras
- Aceita acentos e caracteres especiais
- Remove emojis e números

**Sucesso**:
```
✅ Perfeito, João Silva!
Agora preciso do seu email para continuar.
```

**Erro**:
```
⚠️ Por favor, digite seu nome completo
(nome e sobrenome)
```

---

### 2️⃣ COLLECT_EMAIL

**Objetivo**: Coletar e validar email

**Entrada**: Email no formato padrão

**Validação**:
- Formato válido (regex RFC 5322)
- Domínio com MX record
- Não aceita emails temporários

**Sucesso**:
```
📧 Email joao@exemplo.com salvo!
```

---

### 3️⃣ REQUEST_PHONE

**Objetivo**: Obter número de telefone

**WhatsApp**:
- Envia botão "Compartilhar Contato"
- Recebe via `metadata.quotedMsg`

**Telegram**:
- Detecta automaticamente do `message.from`
- Não precisa de ação do usuário

**Normalização**:
- Remove código do país (+55)
- Remove formatação
- Formato final: `66996285154`

---

### 4️⃣ CHECK_EXISTING_USER

**Objetivo**: Verificar se email já está cadastrado

**API Call**:
```typescript
GET /users?email={email}
```

**Cenário A - Usuário Existe**:
```
🔐 Encontramos uma conta com esse email!

Para sua segurança, enviamos um código de verificação para joao@exemplo.com

Digite o código de 6 dígitos que você recebeu.
```

→ Próximo estado: `REQUEST_VERIFICATION_CODE`

**Cenário B - Usuário Novo**:
```
📋 Confirme seus dados:

👤 Nome: João Silva
📧 Email: joao@exemplo.com
📱 Telefone: (66) 99628-5154

Está tudo correto? (sim/não)
```

→ Próximo estado: `CONFIRM_DATA`

---

### 5️⃣ REQUEST_VERIFICATION_CODE

**Objetivo**: Enviar código por email para autenticação

**API Call**:
```typescript
POST /auth/verification-code
{
  "email": "joao@exemplo.com",
  "phoneNumber": "66996285154"
}
```

**Comandos Especiais**:
- `"reenviar"` → Reenvia código
- `"corrigir email"` → Volta para COLLECT_EMAIL

**Timeout**: Código válido por 10 minutos

---

### 6️⃣ VERIFY_CODE

**Objetivo**: Validar código de 6 dígitos

**Validação**:
- Exatamente 6 dígitos
- Não expirado (< 10 min)
- Máximo 3 tentativas

**API Call**:
```typescript
POST /auth/verify
{
  "email": "joao@exemplo.com",
  "phoneNumber": "66996285154",
  "code": "123456"
}
```

**Sucesso**:
```
✅ Código verificado com sucesso!
```

→ Próximo estado: `CHOOSE_ACCOUNT` (se múltiplas contas) ou `COMPLETED`

**Erro**:
```
❌ Código incorreto. Tentativas restantes: 2
```

---

### 7️⃣ CHOOSE_ACCOUNT

**Objetivo**: Selecionar conta (se usuário tem múltiplas)

**Quando ocorre**: Usuário existente com 2+ contas

**Exemplo**:
```
Você tem múltiplas contas. Qual deseja usar?

1️⃣ Conta Pessoal
2️⃣ Conta Empresa
3️⃣ Freelancer

Digite o número da conta desejada.
```

**Validação**:
- Número entre 1 e total de contas
- Salva `selectedAccountId` em `data`

---

### 8️⃣ CONFIRM_DATA

**Objetivo**: Confirmar dados antes de criar conta nova

**Mensagem**:
```
📋 Confirme seus dados:

👤 Nome: João Silva
📧 Email: joao@exemplo.com
📱 Telefone: (66) 99628-5154

Está tudo correto? (sim/não)
```

**Comandos**:
- `"sim"`, `"correto"`, `"confirmar"` → Criar conta
- `"não"`, `"errado"`, `"cancelar"` → Reiniciar onboarding

---

### 9️⃣ CREATING_ACCOUNT

**Objetivo**: Criar conta na API GastoCerto

**API Call**:
```typescript
POST /users
{
  "name": "João Silva",
  "email": "joao@exemplo.com",
  "phoneNumber": "66996285154",
  "telegramId": "optional",
  "platform": "whatsapp"
}
```

**Sucesso**:
- Cria cache local (UserCache)
- Marca onboarding como completo
- Retorna `completed: true`

---

### 🔟 COMPLETED

**Objetivo**: Finalizar onboarding

**Mensagem**:
```
🎉 Conta criada com sucesso!

Agora você pode começar a registrar suas transações.
Basta enviar uma mensagem como:

"Paguei R$ 50,00 no mercado"
```

**Ações**:
- Remove sessão de onboarding
- Libera acesso às funcionalidades
- Usuário pronto para usar o bot

---

## 🔐 Segurança

### Validações Implementadas

1. **Email**:
   - Formato RFC 5322
   - MX record válido
   - Blacklist de domínios temporários

2. **Telefone**:
   - Normalização consistente
   - Validação de formato brasileiro
   - Único por usuário

3. **Código de Verificação**:
   - 6 dígitos aleatórios
   - Expira em 10 minutos
   - Máximo 3 tentativas
   - Rate limiting (1 código/minuto)

4. **Sessão**:
   - Timeout de 30 minutos
   - Limpeza automática de sessões expiradas
   - Proteção contra ataques de replay

### Rate Limiting

```typescript
// Limite de tentativas por etapa
MAX_ATTEMPTS = 3

// Timeout de sessão
SESSION_TIMEOUT = 30 * 60 * 1000 // 30 minutos

// Código de verificação
CODE_EXPIRY = 10 * 60 * 1000 // 10 minutos
CODE_RATE_LIMIT = 1 * 60 * 1000 // 1 minuto entre envios
```

---

## 🌐 Diferenças por Plataforma

### WhatsApp

- ✅ Requer botão para compartilhar contato
- ✅ Suporta botões interativos
- ⚠️ Metadata em `quotedMsg`

### Telegram

- ✅ Auto-detecção do telefone
- ✅ Keyboard inline
- ✅ Edição de mensagens
- ⚠️ `telegramId` obrigatório

---

## 🧪 Testes

### Casos de Teste Principais

1. **Happy Path - Usuário Novo**
   - Nome → Email → Telefone → Confirmação → Sucesso

2. **Happy Path - Usuário Existente**
   - Nome → Email → Telefone → Código → Verificação → Sucesso

3. **Validação de Email Inválido**
   - Email com formato errado → Erro → Pedir novamente

4. **Código Incorreto**
   - 3 tentativas com código errado → Bloquear → Pedir reenvio

5. **Timeout de Sessão**
   - Esperar 30 minutos → Sessão expirada → Reiniciar

6. **Múltiplas Contas**
   - Usuário com 2+ contas → Escolher conta → Sucesso

---

## 📊 Métricas

### KPIs Monitorados

- **Taxa de Conclusão**: % usuários que completam onboarding
- **Tempo Médio**: Duração típica do processo
- **Taxa de Abandono por Etapa**: Onde usuários desistem
- **Tentativas de Código**: Quantas tentativas antes de acertar
- **Erros de Validação**: Campos com mais erros

### Logs Importantes

```typescript
// Início do onboarding
this.logger.log(`✅ Onboarding iniciado: ${phoneNumber} (${platform})`);

// Validação falhou
this.logger.warn(`⚠️ Validação falhou em ${step}: ${error}`);

// Usuário existente encontrado
this.logger.log(`🔍 Usuário existente: ${email}`);

// Código verificado
this.logger.log(`✅ Código verificado: ${phoneNumber}`);

// Onboarding completo
this.logger.log(`🎉 Onboarding completo: ${phoneNumber}`);
```

---

## 🚨 Tratamento de Erros

### Erros Comuns

1. **API GastoCerto Indisponível**
   ```
   ⚠️ Estamos com dificuldades técnicas.
   Por favor, tente novamente em alguns minutos.
   ```

2. **Email Já Cadastrado (usuário esqueceu)**
   ```
   ℹ️ Esse email já está cadastrado!
   Vou enviar um código de verificação para você acessar sua conta.
   ```

3. **Telefone Já Vinculado**
   ```
   ⚠️ Este telefone já está vinculado a outra conta.
   Entre em contato com o suporte se precisar de ajuda.
   ```

4. **Sessão Expirada**
   ```
   ⏰ Sua sessão expirou.
   Vamos começar novamente! Digite seu nome completo.
   ```

---

## 🔧 Configuração

### Variáveis de Ambiente

```env
# API GastoCerto
GASTO_CERTO_API_URL=https://api.gastocerto.com
GASTO_CERTO_API_KEY=your_api_key_here

# Timeout
ONBOARDING_SESSION_TIMEOUT=1800000  # 30 minutos
VERIFICATION_CODE_EXPIRY=600000     # 10 minutos

# Rate Limiting
MAX_VERIFICATION_ATTEMPTS=3
MIN_CODE_RESEND_INTERVAL=60000      # 1 minuto
```

---

## 📚 Referências de Código

### Principais Arquivos

- `src/modules/onboarding/onboarding.service.ts` - Orquestração
- `src/modules/onboarding/onboarding-state.service.ts` - Máquina de estados
- `src/modules/onboarding/validators/` - Validadores
- `src/modules/shared/gasto-certo-api.service.ts` - Cliente API
- `src/prisma/schema.prisma` - Modelo de dados

### APIs Utilizadas

```typescript
// GastoCerto API
GET    /users?email={email}           // Verificar usuário existente
POST   /auth/verification-code        // Enviar código
POST   /auth/verify                   // Validar código
POST   /users                         // Criar usuário
GET    /users/:userId/accounts        // Listar contas
```
