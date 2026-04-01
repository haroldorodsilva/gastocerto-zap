# GastoCerto-ZAP 🚀
> Bot de gerenciamento financeiro via WhatsApp/Telegram com IA

## 📋 Visão Geral

GastoCerto-ZAP é um microserviço conversacional que permite gerenciar finanças pessoais através de WhatsApp e Telegram. Utiliza inteligência artificial para extrair transações de mensagens de texto, imagens (notas fiscais) e áudios.

### ✨ Principais Funcionalidades

- 🤖 **IA Multi-Provider** (OpenAI, Gemini, Groq, DeepSeek)
- 📱 **Multi-Plataforma** (WhatsApp via Baileys + Telegram via Telegraf)
- 📸 **Análise de Imagens** (Notas fiscais, cupons, comprovantes)
- 🎤 **Transcrição de Áudio** (Whisper API)
- 💬 **Onboarding Conversacional** (Máquina de estados)
- ✅ **Confirmação Inteligente** (Auto-registro em alta confiança)
- 🔄 **Cache-First Strategy** (Redis + PostgreSQL)
- 📊 **Processamento Assíncrono** (Bull Queues)
- 🔐 **Autenticação Dupla** (JWT admin + HMAC service-to-service)
- 🆕 **RAG Tracking & Analytics** (Rastreamento completo RAG → IA → RAG)
- 🆕 **Aprendizado de Sinônimos** (4 estratégias: Auto, User, Admin, Hybrid)

---

## � O que o Usuário Pode Fazer pelo Chat

O GastoZAP permite ao usuário gerenciar suas finanças pessoais inteiramente pelo WhatsApp (ou Telegram), usando linguagem natural. Abaixo estão **todos os recursos** disponíveis:

### 📝 Registrar Despesas e Receitas

O usuário pode registrar gastos e receitas simplesmente descrevendo o que aconteceu:

| Tipo de Entrada | Exemplos |
|-----------------|----------|
| **Texto simples** | `Gastei 50 reais no supermercado` / `Paguei 120 na conta de luz` / `Recebi 3000 de salário` |
| **Valor com R$** | `Comprei remédio por R$ 35,90` / `Paguei R$ 1.250,00 no financiamento` |
| **Sem valor explícito** | `Almocei no restaurante e deu 65` / `Deixei 100 no mercado` |
| **Com data** | `Ontem gastei 80 no jantar` / `Semana passada paguei 200 na oficina` |
| **📸 Foto de nota/cupom** | Envie uma foto de nota fiscal, cupom ou comprovante – a IA extrai os dados automaticamente |
| **🎤 Áudio/voz** | Grave um áudio descrevendo o gasto – o bot transcreve e processa |

**Verbos reconhecidos:** gastei, paguei, comprei, recebi, ganhei, vendi, transferi, depositei, saquei, entre outros.

**Categorização automática:** O bot identifica automaticamente a categoria (Alimentação, Saúde, Transporte, etc.) usando RAG + IA. Se a confiança for baixa, pede confirmação ao usuário.

---

### 💰 Consultar Saldo e Extrato

| Comando | O que faz |
|---------|-----------|
| `saldo` | Mostra o saldo atual da conta |
| `meu saldo` | Mostra o saldo atual |
| `extrato` | Mostra o extrato financeiro |
| `quanto tenho` | Consulta quanto tem disponível |
| `quanto sobrou` | Verifica quanto sobrou no mês |
| `tô devendo` | Verifica se está devendo |

---

### 📊 Resumos e Análises

| Comando | O que faz |
|---------|-----------|
| `resumo do mês` | Resumo mensal completo (receitas vs despesas) |
| `resumo mensal` | Mesmo que acima |
| `quanto gastei` | Total gasto no mês |
| `quanto recebi` | Total recebido no mês |
| `como estou` | Visão geral das finanças |
| `gastos por categoria` | Análise detalhada por categoria com percentuais |
| `onde mais gastei` | Mostra as categorias com maiores gastos |
| `maiores gastos` | Principais gastos do mês |
| `gráfico` / `gerar gráfico` | Gera imagem com gráfico dos gastos por categoria |

---

### 📋 Listar Transações

| Comando | O que faz |
|---------|-----------|
| `minhas transações` | Lista transações do mês |
| `meus gastos` | Lista gastos recentes |
| `histórico` | Histórico de transações |
| `gastos recentes` | Últimas transações |
| `trans` / `trx` | Atalho para listar transações |

---

### ⏳ Contas Pendentes

| Comando | O que faz |
|---------|-----------|
| `contas pendentes` | Lista contas a pagar |
| `contas a pagar` | Mesmo que acima |
| `o que tenho que pagar` | Mostra débitos pendentes |
| `o que falta pagar` | Pendências de pagamento |
| `pendentes` | Lista todas as pendências |
| `o que tenho que receber` | Valores a receber pendentes |

---

### 💳 Cartões de Crédito

| Comando | O que faz |
|---------|-----------|
| `meus cartões` | Lista todos os cartões cadastrados |
| `cc` | Atalho para listar cartões |
| `minhas faturas` | Lista faturas dos cartões |
| `minha fatura` | Detalhes da fatura atual |
| `fatura do cartão [nome]` | Ver fatura de um cartão específico |
| `quanto devo no cartão` | Valor total em aberto nos cartões |
| `pagar fatura` | Marcar fatura como paga |
| `usar cartão [nome]` | Definir cartão padrão |
| `qual cartão` / `meu cartão` | Mostrar cartão padrão atual |

---

### 🏦 Gerenciamento de Perfis/Contas

| Comando | O que faz |
|---------|-----------|
| `meu perfil` | Lista perfis disponíveis |
| `perfil atual` | Mostra o perfil ativo |
| `qual conta` | Mostra a conta ativa |
| `trocar perfil` | Alterna entre perfis (pessoal/empresa) |
| `mudar de perfil` | Mesmo que acima |

---

### ✅ Confirmação de Transações

Quando o bot registra uma transação com baixa confiança, pede confirmação:

| Resposta | Ação |
|----------|------|
| `sim` / `s` / `ok` / `confirmar` / `pode ser` | Confirma a transação |
| `não` / `n` / `cancelar` / `errado` | Cancela e permite corrigir |

---

### ℹ️ Ajuda e Suporte

| Comando | O que faz |
|---------|-----------|
| `ajuda` | Mostra menu de ajuda com comandos disponíveis |
| `como funciona` | Explica como usar o bot |
| `como usar` | Instruções de uso |
| `comandos` | Lista de comandos |
| `help` | Ajuda em inglês |

---

### 👋 Saudações

O bot responde a saudações de forma amigável e contextual:

`oi`, `olá`, `bom dia`, `boa tarde`, `boa noite`, `e aí`, `opa`, `fala`, `tudo bem`

---

### 🎯 Categorias Padrão do Sistema

O sistema vem com 13 categorias de despesas pré-configuradas, cada uma com subcategorias:

| Categoria | Subcategorias |
|-----------|---------------|
| 🛒 **Alimentação** | Feira, Lanches, Marmita, Padaria, Restaurante, Sorveteria, Supermercado, Outros |
| 🏠 **Casa** | Cama e Banho, Diversos, Ferramentas, Manutenção, Móveis, Reforma, Utensílios |
| 📚 **Educação** | Creche, Cursos, Escola Particular, Livros, Material Escolar, Outros |
| 📱 **Eletrônicos** | Acessórios, Eletrodomésticos, Suprimentos, Outros |
| 💰 **Investimentos** | Aluguel, Aplicação, Consórcio, Financiamentos, Outros |
| 👤 **Pessoal** | Cabelo, Crianças, Manicure, Presente |
| 🎮 **Recreação** | Brinquedos, Cinema, Clube, Esporte, Festas, Ingresso, Jogos, Lazer, Parque, Outros |
| 🏥 **Saúde** | Consultas, Dentista, Exames, Farmácia, Fisioterapia, Médico, Plano Funerário, Plano de Saúde, Seguro Vida, Suplementação, Terapia, Ótica, Outros |
| 🔧 **Serviços** | Academia, Assinaturas, Atendimento Técnico, Babá, Despachante, Energia, Frete, Gás, Internet, Lavanderia, Recarga Celular, Refrigeração, Segurança, Água, Outros |
| 📄 **Taxas** | Anuidade, Cartório, Documentação Carro, Imposto de Renda, Multa ou Juros, Tarifa Bancária, Outras |
| 🚗 **Transporte** | Combustível, Estacionamento, Lava Jato, Manutenção, Multas, Pedágio, Rotativo, Seguro |
| 👕 **Vestuário** | Acessórios, Calçados, Roupas |
| ✈️ **Viajem** | Alimentação, Bebidas, Combustível, Farmácia, Hotel, Passagens, Presentes, Restaurante, Taxi |

---

### 🧠 Sistema de Aprendizado (Sinônimos)

O bot aprende com o uso! Termos não reconhecidos na primeira vez passam pela IA e, após confirmação, são registrados como sinônimos para resolução instantânea nas próximas vezes.

**Exemplo:**
1. Usuário envia: `paguei o uber` → Bot não reconhece "uber" → IA sugere "Transporte"
2. Admin aprova sinônimo: `uber → Transporte > Combustível`
3. Próxima vez: `paguei o uber` → Resolvido instantaneamente sem chamar IA

---

## �📚 Documentação

### 🎯 Fluxos Principais

| Documento | Descrição |
|-----------|-----------|
| **[Onboarding](./docs/ONBOARDING.md)** | Cadastro e autenticação de usuários (máquina de estados) |
| **[Mensagens](./docs/MESSAGES.md)** | Processamento de mensagens e extração via IA |
| **[Operações](./docs/OPERATIONS.md)** | Listagem, saldo e pagamentos |

### 🔧 Guias Técnicos

| Documento | Descrição |
|-----------|-----------|
| **[IA Config](./docs/AI_CONFIG_GUIDE.md)** | Setup de providers (OpenAI, Gemini, Groq, DeepSeek) |
| **[NLP & Intents](./docs/NLP_INTENT_MATCHING.md)** | Sistema de análise de intenções |
| **[RAG (Opcional)](./docs/RAG_IMPLEMENTATION.md)** | Categorização semântica com pgvector |
| **[RAG Tracking & Analytics](./docs/RAG_TRACKING_ANALYSIS.md)** | 🆕 Rastreamento completo RAG → IA → RAG e extração de sinônimos |
| **[Admin API](./docs/ADMIN_API_DOCUMENTATION.md)** | Endpoints administrativos |

---

## 🏗️ Arquitetura do Sistema

```
┌─────────────────────────────────────────────┐
│  WhatsApp / Telegram (Entrada)              │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│  MessageFilterService                        │
│  • Normaliza telefone (remove código país)  │
│  • Extrai mídia (imagem/áudio)              │
│  • Valida mensagens (ignora grupos)         │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│  MessagesProcessor (Bull Queue)              │
│  • Fila Redis para processamento async      │
│  • Retry automático (3 tentativas)          │
└────────────────┬────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
┌──────────────┐  ┌──────────────────┐
│ Onboarding   │  │ Transactions     │
│   Service    │  │  Orchestrator    │
└──────────────┘  └────────┬─────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌────────────┐  ┌──────────────┐  ┌──────────────┐
│Registration│  │   Listing    │  │   Payment    │
│  Context   │  │   Context    │  │   Context    │
└─────┬──────┘  └──────────────┘  └──────────────┘
      │
      ▼
┌────────────────────────────────────────────┐
│  AIProviderFactory                          │
│  • OpenAI (GPT-4): Precisão 95%            │
│  • Gemini: Análise de imagens              │
│  • Groq: Velocidade (200 tokens/s)         │
│  • DeepSeek: Custo baixo                   │
└────────────┬───────────────────────────────┘
             │
┌────────────▼───────────────────────────────┐
│  GastoCerto API                             │
│  • Transações                               │
│  • Categorias                               │
│  • Contas                                   │
│  • Saldo                                    │
└─────────────────────────────────────────────┘
```

### Stack Tecnológica

- **Backend**: NestJS 11 + TypeScript (strict mode)
- **WhatsApp**: @whiskeysockets/baileys 7.x
- **Database**: PostgreSQL 16 (Prisma ORM)
- **Cache/Queue**: Redis 7 + Bull
- **WebSocket**: Socket.IO (QR codes, status)
- **IA**: OpenAI GPT-4, Google Gemini, Groq Whisper
- **Autenticação**: JWT (admin) + HMAC SHA-256 (service-to-service)

---

## 🔐 Autenticação

Este serviço implementa **autenticação dupla**:

### 1. JWT (Admin Dashboard)
- Frontend (gastocerto-admin) envia: `Authorization: Bearer <token>`
- Token validado chamando gastocerto-api (com HMAC!)
- Requer role ADMIN ou MASTER

### 2. HMAC SHA-256 (Service-to-Service)
- Serviços se autenticam com headers:
  - `X-Service-ID`: identificação do serviço
  - `X-Timestamp`: timestamp da requisição
  - `X-Signature`: HMAC(timestamp + body, sharedSecret)
- Proteção contra replay attacks (timeout 5 min)
- Comparação timing-safe

**📚 Documentação Completa:**

**🎯 Guias de Fluxo** (Novos - Atualizados 2025)
- **[ONBOARDING.md](./ONBOARDING.md)** - Fluxo completo de cadastro e autenticação
- **[MESSAGES.md](./MESSAGES.md)** - Processamento de mensagens e extração de transações
- **[OPERATIONS.md](./OPERATIONS.md)** - Listagem, saldo e pagamentos

**🎯 Por Onde Começar?**
- **Frontend Developer?** → [QUICK_START_ADMIN.md](./QUICK_START_ADMIN.md) - Setup em 5 minutos
- **Testar API?** → [EXEMPLOS_TESTES_API.md](./EXEMPLOS_TESTES_API.md) - Todos os endpoints com curl
- **Entender Arquitetura?** → [AUTENTICACAO_3_SERVICOS.md](./AUTENTICACAO_3_SERVICOS.md) - Fluxos JWT + HMAC

**📖 Documentação Detalhada:**
- [AI_CONFIG_GUIDE.md](./AI_CONFIG_GUIDE.md) - Configuração de providers de IA
- [NLP_INTENT_MATCHING.md](./NLP_INTENT_MATCHING.md) - Sistema de análise de intenções
- [ADMIN_API_DOCUMENTATION.md](./ADMIN_API_DOCUMENTATION.md) - Endpoints administrativos
- [IMPLEMENTACAO_ADMIN_FRONTEND.md](./IMPLEMENTACAO_ADMIN_FRONTEND.md) - Guia frontend (types, services, hooks)
- [STATUS_INTEGRACAO.md](./STATUS_INTEGRACAO.md) - Status da implementação
- [GUIA_RAPIDO_API.md](./GUIA_RAPIDO_API.md) - Checklist gastocerto-api
- [DIAGRAMA_AUTH.md](./DIAGRAMA_AUTH.md) - Diagramas visuais
- [EXEMPLOS_CODIGO.md](./EXEMPLOS_CODIGO.md) - Exemplos práticos

---

## 🚀 Instalação e Configuração

### Pré-requisitos

- Node.js >= 18.x
- npm ou yarn
- Docker e Docker Compose (recomendado)
- PostgreSQL 16
- Redis 7

### 1. Clone o repositório

```bash
cd gastocerto-zap
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configure as variáveis de ambiente

Copie o arquivo `.env.example` para `.env` e preencha as variáveis:

```bash
cp .env.example .env
```

**Variáveis obrigatórias:**

```env
# Database
DATABASE_URL="postgresql://gastocerto:gastocerto123@localhost:5432/gastocerto_zap?connection_limit=50"

# Redis
REDIS_URL="redis://localhost:6379"

# OpenAI
OPENAI_API_KEY="sk-..."

# Gasto Certo API
GASTO_CERTO_API_URL="https://api.gastocerto.com"
SERVICE_CLIENT_ID="gastocerto-zap-service"
SERVICE_CLIENT_SECRET="your-secret-key"

# Security (apenas para desenvolvimento)
TEST_PHONE_NUMBER="5511999999999"
```

### 4. Inicie o banco de dados e Redis (Docker)

```bash
docker-compose up -d
```

Isso iniciará:
- PostgreSQL na porta `5432`
- Redis na porta `6379`

### 5. Execute as migrações do Prisma

```bash
npm run db:generate
npm run db:migrate
```

### 6. Inicie a aplicação

**Desenvolvimento:**
```bash
npm run start:dev
```

**Produção:**
```bash
npm run build
npm run start:prod
```

A API estará disponível em: `http://localhost:3000`

---

## 📁 Estrutura do Projeto

```
gastocerto-zap/
├── src/
│   ├── modules/
│   │   ├── sessions/          # Gerenciar sessões WhatsApp
│   │   ├── messages/          # Processar mensagens
│   │   ├── users/             # Gestão de usuários
│   │   ├── onboarding/        # Fluxo de cadastro
│   │   ├── ai/                # Interface de IA
│   │   ├── transactions/      # Gestão de transações
│   │   ├── media/             # Processar imagens/áudios
│   │   └── subscriptions/     # Validação de planos
│   ├── common/
│   │   ├── guards/            # Guards (auth, rate limit, etc)
│   │   ├── interceptors/      # Interceptors
│   │   ├── filters/           # Exception filters
│   │   ├── decorators/        # Custom decorators
│   │   └── utils/             # Utilitários
│   ├── config/                # Configurações
│   ├── prisma/                # Prisma schema e migrations
│   ├── main.ts                # Entry point
│   └── app.module.ts          # Módulo principal
├── docker-compose.yml
├── .env.example
├── package.json
└── README.md
```

---

## 🔄 Fluxo de Funcionamento

### 1. Cadastro de Nova Sessão WhatsApp

```bash
POST /sessions
{
  "sessionId": "minha-sessao",
  "phoneNumber": "5511999999999",
  "name": "GastoCerto Bot"
}
```

- Gera QR Code para autenticação
- Salva credenciais no banco de dados
- Inicia conexão com WhatsApp

### 2. Processamento de Mensagens

```
WhatsApp → Baileys → MessageFilter → TestPhoneGuard → UserService
                                                             ↓
                                           Cadastrado? ←────┘
                                           │        │
                                           SIM      NÃO
                                           ↓        ↓
                                  TransactionFlow  OnboardingFlow
```

### 3. Extração de Transação com IA

**Usuário:** "Gastei 50 no mercado"

**IA (GPT-4):** Extrai:
```json
{
  "type": "EXPENSES",
  "amount": 50.00,
  "category": "Alimentação",
  "description": "Mercado",
  "confidence": 0.95
}
```

**Bot:** "💰 Detectei um gasto de R$ 50,00 em Alimentação (Mercado). Confirmar? (sim/não)"

**Usuário:** "sim"

**Bot:** "✅ Gasto registrado com sucesso!"

### 4. Processamento de Imagem (NFe)

**Usuário:** Envia foto de nota fiscal

**IA (GPT-4 Vision):** Extrai:
```json
{
  "type": "EXPENSES",
  "amount": 120.50,
  "merchant": "Supermercado XYZ",
  "date": "2025-12-08",
  "category": "Alimentação"
}
```

**Bot:** Solicita confirmação → Registra na API Gasto Certo

---

## 🧪 Testes

```bash
# Testes unitários
npm run test

# Testes e2e
npm run test:e2e

# Coverage
npm run test:cov
```

---

## 📊 Monitoramento

### Health Check

```bash
GET /health
```

Resposta:
```json
{
  "status": "ok",
  "timestamp": "2025-12-09T22:00:00.000Z",
  "service": "gastocerto-zap"
}
```

### Prometheus Metrics (se habilitado)

```bash
GET /metrics
```

---

## 🔐 Segurança

### 1. Telefone de Teste (Desenvolvimento)

Configure `TEST_PHONE_NUMBER` no `.env` para aceitar mensagens apenas desse número durante o desenvolvimento:

```env
TEST_PHONE_NUMBER="5511999999999"
```

### 2. Autenticação com API Gasto Certo

O serviço autentica via JWT com a API do Gasto Certo usando `SERVICE_CLIENT_ID` e `SERVICE_CLIENT_SECRET`.

### 3. Rate Limiting

Cada usuário pode enviar no máximo 10 mensagens por minuto (configurável via `RATE_LIMIT_MAX_REQUESTS`).

---

## 📈 Escalabilidade

O sistema foi projetado para suportar **10 mil usuários simultâneos** através de:

1. **Filas Bull** com processamento assíncrono
2. **Cache Redis** agressivo
3. **Connection pooling** otimizado
4. **Horizontal scaling** (PM2 cluster ou Kubernetes)
5. **Rate limiting** por usuário

### PM2 Cluster Mode (exemplo)

```bash
npm install -g pm2
pm2 start ecosystem.config.js
```

---

## 🛠️ Scripts Disponíveis

| Script | Descrição |
|--------|-----------|
| `npm run start:dev` | Inicia em modo desenvolvimento |
| `npm run build` | Build para produção |
| `npm run start:prod` | Inicia em produção |
| `npm run db:generate` | Gera Prisma Client |
| `npm run db:migrate` | Executa migrations |
| `npm run db:push` | Push schema (dev) |
| `npm run db:studio` | Abre Prisma Studio |
| `npm run lint` | Lint do código |
| `npm run test` | Executa testes |

---

## 🐛 Troubleshooting

### Erro: "Database connection failed"

Verifique se o PostgreSQL está rodando:
```bash
docker-compose ps
```

Se não estiver:
```bash
docker-compose up -d postgres
```

### Erro: "Redis connection refused"

Verifique se o Redis está rodando:
```bash
docker-compose up -d redis
```

### QR Code não aparece

Certifique-se de que a variável `NODE_ENV=development` está configurada no `.env`.

---

## 📝 Roadmap

### Fase 1: Fundação ✅
- [x] Estrutura de pastas
- [x] Configuração Prisma
- [x] Docker Compose
- [ ] MessageFilterService
- [ ] TestPhoneGuard

### Fase 2: Onboarding
- [ ] OnboardingStateService
- [ ] Validadores
- [ ] Integração com API Gasto Certo

### Fase 3: IA Genérica
- [ ] Interface IAIProvider
- [ ] OpenAIProvider
- [ ] Prompts otimizados

### Fase 4: Transações
- [ ] TransactionConfirmationService
- [ ] Fluxo de confirmação

### Fase 5: Mídia
- [ ] ImageProcessorService
- [ ] AudioProcessorService
- [ ] GPT-4 Vision + Whisper

### Fase 6: Escalabilidade
- [ ] Bull Queues configuradas
- [ ] Caching Redis
- [ ] Testes de carga

---

## 👥 Contribuindo

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/nova-funcionalidade`)
3. Commit suas mudanças (`git commit -m 'Adiciona nova funcionalidade'`)
4. Push para a branch (`git push origin feature/nova-funcionalidade`)
5. Abra um Pull Request

---

## 📄 Licença

MIT

---

## 📞 Suporte

Para dúvidas ou problemas, abra uma issue no repositório ou entre em contato com a equipe GastoCerto.

---

**Desenvolvido com ❤️ pela equipe GastoCerto**
