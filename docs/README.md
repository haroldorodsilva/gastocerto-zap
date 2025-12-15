# 📚 Índice de Documentação

## 🎯 Guias de Fluxo (Essenciais)

Documentação dos fluxos principais do sistema:

### [📋 ONBOARDING.md](./ONBOARDING.md)
**Fluxo completo de cadastro e autenticação**

- 10 estados da máquina de estados
- Validações (nome, email, telefone, código)
- Diferenças WhatsApp vs Telegram
- Segurança e rate limiting
- Tratamento de erros
- Métricas e logs

**Quando ler**: Entender como novos usuários se cadastram

---

### [📨 MESSAGES.md](./MESSAGES.md)
**Processamento e extração de transações via IA**

- Arquitetura de mensagens (filtros, filas, processors)
- Extração via IA (4 providers: OpenAI, Gemini, Groq, DeepSeek)
- Auto-registro vs confirmação (thresholds)
- Análise de imagens (notas fiscais)
- Transcrição de áudio
- Resolução cache-first de categorias
- Segurança e rate limiting

**Quando ler**: Entender como mensagens viram transações

---

### [💼 OPERATIONS.md](./OPERATIONS.md)
**Listagem, consulta de saldo e pagamentos**

- Listar transações (filtros, paginação)
- Consultar saldo (geral e por categoria)
- Processar pagamentos (contas, transferências)
- Endpoints da GastoCerto API
- Formatação de respostas
- Exemplos práticos

**Quando ler**: Implementar consultas e pagamentos

---

## 🔧 Guias Técnicos (Configuração)

### [🤖 AI_CONFIG_GUIDE.md](./AI_CONFIG_GUIDE.md)
**Setup de providers de IA**

- OpenAI (GPT-4, GPT-4o-mini)
- Google Gemini
- Groq (Llama 3)
- DeepSeek
- Comparação de custos e performance
- Configuração de API keys
- Fallback automático

**Quando ler**: Configurar ou trocar providers de IA

---

### [🧠 NLP_INTENT_MATCHING.md](./NLP_INTENT_MATCHING.md)
**Sistema de análise de intenções**

- Intents suportadas (REGISTER, CONFIRM, LIST, etc)
- Matching de padrões
- Confidence scores
- Extensibilidade
- Exemplos de uso

**Quando ler**: Adicionar novas intenções ou entender NLP

---

### [🔐 ADMIN_API_DOCUMENTATION.md](./ADMIN_API_DOCUMENTATION.md)
**Endpoints administrativos**

- Autenticação JWT
- Gestão de sessões WhatsApp
- Estatísticas do sistema
- Logs e monitoramento
- Webhooks

**Quando ler**: Implementar dashboard administrativo

---

## 🚀 Features Opcionais

### [🧠 RAG_IMPLEMENTATION.md](./RAG_IMPLEMENTATION.md)
**Categorização semântica com pgvector (Opcional)**

- Sistema RAG para busca vetorial
- pgvector + embeddings OpenAI
- Cache triplo (memória → DB → API)
- Aprendizado contínuo
- Comparação: String matching vs Vetorial
- Setup e migração
- Custos estimados (~$0.10/mês por 1000 usuários)

**Quando ler**: Precisão atual (75-85%) não é suficiente, precisa 90%+

**Status**: 🟡 Implementar apenas se necessário

---

## 📊 Diagrama de Dependências

```
ONBOARDING.md
  ↓
MESSAGES.md ←→ AI_CONFIG_GUIDE.md
  ↓            ↓
OPERATIONS.md  NLP_INTENT_MATCHING.md
  ↓
ADMIN_API_DOCUMENTATION.md

RAG_IMPLEMENTATION.md (opcional, melhoria)
```

---

## 🎓 Roteiro de Leitura

### Para Desenvolvedores Novos

1. **[README.md](../README.md)** - Visão geral e setup inicial
2. **[ONBOARDING.md](./ONBOARDING.md)** - Como usuários entram
3. **[MESSAGES.md](./MESSAGES.md)** - Como transações são processadas
4. **[AI_CONFIG_GUIDE.md](./AI_CONFIG_GUIDE.md)** - Setup de IA

### Para Implementar Features

- **Adicionar nova intenção?** → [NLP_INTENT_MATCHING.md](./NLP_INTENT_MATCHING.md)
- **Melhorar categorização?** → [RAG_IMPLEMENTATION.md](./RAG_IMPLEMENTATION.md)
- **Criar dashboard admin?** → [ADMIN_API_DOCUMENTATION.md](./ADMIN_API_DOCUMENTATION.md)
- **Adicionar filtros de listagem?** → [OPERATIONS.md](./OPERATIONS.md)

### Para Debugging

- **Onboarding travou?** → [ONBOARDING.md](./ONBOARDING.md) (seção Erros)
- **IA não categoriza bem?** → [MESSAGES.md](./MESSAGES.md) (seção Cache/RAG)
- **API retorna erro?** → [OPERATIONS.md](./OPERATIONS.md) (seção Endpoints)

---

## 📈 Status das Documentações

| Documento | Status | Última Atualização | Completude |
|-----------|--------|-------------------|-----------|
| ONBOARDING.md | ✅ Completo | 2025-12-14 | 100% |
| MESSAGES.md | ✅ Completo | 2025-12-14 | 100% |
| OPERATIONS.md | ✅ Completo | 2025-12-14 | 100% |
| AI_CONFIG_GUIDE.md | ✅ Completo | 2025-11-20 | 90% |
| NLP_INTENT_MATCHING.md | ✅ Completo | 2025-11-15 | 85% |
| RAG_IMPLEMENTATION.md | ✅ Completo | 2025-12-14 | 100% |
| ADMIN_API_DOCUMENTATION.md | ⚠️ Desatualizado | 2025-10-10 | 70% |

---

## 🔄 Changelog

### 2025-12-14
- ✨ Criada documentação RAG_IMPLEMENTATION.md
- ♻️ Refatoração completa de registration.service.ts
- 📝 Atualizadas ONBOARDING.md, MESSAGES.md, OPERATIONS.md
- 🗂️ Reorganização: docs técnicas para /docs, README simplificado

### 2025-11-20
- 📝 Atualizado AI_CONFIG_GUIDE.md com DeepSeek

### 2025-11-15
- 📝 Criado NLP_INTENT_MATCHING.md

---

## 📞 Contato

Dúvidas sobre a documentação? Abra uma issue ou entre em contato com a equipe de desenvolvimento.

**Última revisão**: 14 de dezembro de 2025
