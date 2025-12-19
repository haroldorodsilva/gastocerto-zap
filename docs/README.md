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
**Configuração e gerenciamento de providers de IA**

- Setup de providers (OpenAI, Gemini, Groq, DeepSeek)
- Custos e rate limits
- Fallback e prioridades
- Operações por tipo (texto, imagem, áudio)
- Endpoints administrativos
- Métricas e custos

**Quando ler**: Configurar ou trocar providers de IA

---

## 🆕 Sistema de Rastreamento RAG (NOVO)

### [⚡ QUICK_START_RAG_TRACKING.md](./QUICK_START_RAG_TRACKING.md) 🔥 COMECE AQUI
**Guia rápido para usar o novo sistema de tracking**

- ✅ O que foi implementado
- 🚀 Como usar (passo a passo)
- 📊 Como executar análises
- 💡 Como criar sinônimos
- 🤖 Como automatizar extração
- ❓ FAQ completo

**Quando ler**: Implementar tracking nos services ou executar análises

---

### [📊 RAG_TRACKING_ANALYSIS.md](./RAG_TRACKING_ANALYSIS.md)
**Documentação completa do sistema de tracking RAG → IA → RAG**

- Fluxo detalhado (3 steps com diagrama)
- Descrição de todos os campos novos
- 6+ queries SQL de análise prontas
- Estratégias de melhoria contínua
- Extração automática de sinônimos
- Dashboard de monitoramento
- KPIs e métricas de sucesso
- Roadmap de implementação

**Quando ler**: Entender como funciona o rastreamento completo e estratégias de otimização

---

### [✅ SUMMARY_RAG_TRACKING.md](./SUMMARY_RAG_TRACKING.md)
**Resumo executivo: O que foi feito e próximos passos**

- Problema original e solução implementada
- Checklist de implementação
- Métricas de sucesso (antes/depois)
- Tempo estimado de implementação
- Status atual e próximos passos

**Quando ler**: Ver visão geral do projeto e roadmap

---

### [🗄️ MIGRATION_RAG_TRACKING.sql](./MIGRATION_RAG_TRACKING.sql)
**Migration SQL para adicionar campos de tracking**

- ALTER TABLE para rag_search_logs (12 campos)
- ALTER TABLE para ai_usage_logs (11 campos)
- Índices otimizados
- Queries de verificação
- Notas de implementação

**Quando usar**: Backup da migration ou aplicação manual em produção

---

### [📝 CHANGELOG_RAG_TRACKING.md](./CHANGELOG_RAG_TRACKING.md)
**Changelog detalhado das alterações**

- Todas as mudanças no schema
- Cenários de uso (1, 2 e 3 steps)
- Impacto esperado (antes/depois)
- Exemplos práticos de queries

**Quando ler**: Ver detalhes técnicos de todas as alterações

---

### [💻 examples/rag-tracking-implementation.example.ts](./examples/rag-tracking-implementation.example.ts)
**Código de exemplo completo para implementação**

- RAGService com tracking (step 1)
- AIService com contexto RAG (step 2)
- CategoryResolutionService com fluxo completo
- RAGAnalyticsService com queries prontas
- Exemplos de todas as integrações

**Quando ler**: Implementar tracking nos services existentes

---

### [🎯 SYNONYM_MANAGEMENT_STRATEGIES.md](./SYNONYM_MANAGEMENT_STRATEGIES.md) 🆕
**Guia completo de estratégias de gerenciamento de sinônimos**

- 4 estratégias: Automático, Usuário, Admin, Híbrido
- Comparação detalhada (escalabilidade, qualidade, UX)
- Implementação passo a passo de cada estratégia
- Recomendações por cenário (MVP, média escala, grande escala)
- Exemplos de código para cada abordagem
- FAQ sobre gerenciamento de sinônimos

**Quando ler**: Decidir como gerenciar sinônimos (admin vs usuário vs automático)

---

### [🤔 SYNONYM_DECISION_TREE.md](./SYNONYM_DECISION_TREE.md) 🆕
**Árvore de decisão visual para escolher estratégia de sinônimos**

- Fluxograma de decisão
- Tabela de decisão rápida por cenário
- Perguntas para te ajudar a decidir
- Casos de uso reais (startup, escala média, grande)
- Checklist de decisão
- Erros comuns e como evitar

**Quando ler**: Não sabe qual estratégia escolher? Comece aqui!

---

**Quando ler**: Configurar ou trocar providers de IA

---

### [🧠 NLP_INTENT_MATCHING.md](./NLP_INTENT_MATCHING.md)
**Sistema de detecção de intenções**

- Análise de mensagens sem transações
- 15+ intenções detectadas
- Thresholds de confiança
- Respostas contextualizadas
- Logs e métricas

**Quando ler**: Entender como o bot interpreta comandos

---

### [🔍 RAG_IMPLEMENTATION.md](./RAG_IMPLEMENTATION.md)
**Busca semântica de categorias (opcional)**

- Setup pgvector + embeddings
- BM25 vs AI embeddings
- Configuração de threshold
- Comparação de performance

**Quando ler**: Implementar busca semântica avançada

---

### [📊 RAG_TRACKING_ANALYSIS.md](./RAG_TRACKING_ANALYSIS.md) 🆕
**Rastreamento completo do fluxo RAG → IA → RAG**

- Diagrama do fluxo completo (3 steps)
- Novos campos em `RAGSearchLog` e `AIUsageLog`
- 5+ queries SQL de análise prontas
- Extração automática de sinônimos
- Dashboard de monitoramento
- KPIs e métricas de sucesso
- Estratégias de melhoria contínua

**Quando ler**: Analisar por que RAG falha e como melhorar com sinônimos

---

### [🗄️ MIGRATION_RAG_TRACKING.sql](./MIGRATION_RAG_TRACKING.sql) 🆕
**Migration para adicionar campos de tracking**

- ALTER TABLE para `rag_search_logs` e `ai_usage_logs`
- Índices otimizados
- Queries de verificação

**Quando usar**: Aplicar migration no banco de dados

---

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

## 📦 Operações e Deploy

### [☁️ COOLIFY.md](./COOLIFY.md)
**Deploy com Coolify (self-hosted)**
- Configuração de servidor
- Docker + Coolify setup
- Variáveis de ambiente
- Monitoramento

### [☁️ COOLIFY_SETUP.md](./COOLIFY_SETUP.md)
**Guia passo a passo Coolify**
- Instalação e configuração
- Deploy da aplicação
- Troubleshooting

### [🚀 DEPLOY.md](./DEPLOY.md)
**Guia geral de deploy**
- Preparação para produção
- Checklist de deploy
- Configurações de ambiente

### [🚀 DEPLOY_READY.md](./DEPLOY_READY.md)
**Status de prontidão para deploy**
- Checklist completo
- Validações necessárias
- Passos finais

### [🔧 TROUBLESHOOTING_COOLIFY.md](./TROUBLESHOOTING_COOLIFY.md)
**Resolução de problemas Coolify**
- Erros comuns
- Soluções práticas
- Dicas de debug

### [📊 DIAGRAMAS_FLUXO.md](./DIAGRAMAS_FLUXO.md)
**Diagramas do sistema**
- Fluxo de mensagens
- Arquitetura
- Integração de componentes

### [🔄 FLOW_COMPLETE.md](./FLOW_COMPLETE.md)
**Fluxo completo ponta a ponta**
- Da mensagem até a API
- Todos os componentes
- Decisões e validações

---

## 📋 Padronizações e Melhorias

### [📏 PADRONIZACAO_COMPLETA.md](./PADRONIZACAO_COMPLETA.md)
**Padrões de código e arquitetura**
- Estrutura de pastas
- Convenções de nomenclatura
- Best practices

### [🎯 PLANO_MELHORIAS.md](./PLANO_MELHORIAS.md)
**Roadmap de melhorias**
- Features planejadas
- Otimizações
- Prioridades

### [✅ SOLUCAO_DEFINITIVA.md](./SOLUCAO_DEFINITIVA.md)
**Soluções para problemas críticos**
- Problemas resolvidos
- Abordagens definitivas
- Lições aprendidas

---

## 🧪 Testes e Validações

### [🧪 TESTES.md](./TESTES.md)
**Guia completo de testes**
- Testes unitários
- Testes de integração
- Cobertura

### [📊 TESTES_RESUMO.md](./TESTES_RESUMO.md)
**Resumo dos testes realizados**
- Status atual
- Resultados
- Métricas

### [🔀 TESTE_MULTICONTAS.md](./TESTE_MULTICONTAS.md)
**Testes de múltiplas contas**
- Cenários testados
- Validações
- Resultados

---

## 🔄 Multi-contas e Features Específicas

### [👥 STATUS_MULTICONTAS.md](./STATUS_MULTICONTAS.md)
**Status da feature de múltiplas contas**
- Implementação atual
- Limitações
- Próximos passos

### [🗄️ REDIS_SETUP.md](./REDIS_SETUP.md)
**Configuração do Redis**
- Setup e instalação
- Configurações
- Uso no sistema

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
- **Analisar falhas do RAG?** → [RAG_TRACKING_ANALYSIS.md](./RAG_TRACKING_ANALYSIS.md) 🆕
- **Implementar tracking RAG?** → [QUICK_START_RAG_TRACKING.md](./QUICK_START_RAG_TRACKING.md) 🆕
- **Ver código de exemplo?** → [examples/rag-tracking-implementation.example.ts](./examples/rag-tracking-implementation.example.ts) 🆕
- **Criar dashboard admin?** → [ADMIN_API_DOCUMENTATION.md](./ADMIN_API_DOCUMENTATION.md)
- **Adicionar filtros de listagem?** → [OPERATIONS.md](./OPERATIONS.md)

### Para Debugging

- **Onboarding travou?** → [ONBOARDING.md](./ONBOARDING.md) (seção Erros)
- **IA não categoriza bem?** → [MESSAGES.md](./MESSAGES.md) (seção Cache/RAG)
- **RAG com baixa taxa de sucesso?** → [RAG_TRACKING_ANALYSIS.md](./RAG_TRACKING_ANALYSIS.md) 🆕
- **Como analisar logs RAG?** → Execute `npx ts-node scripts/analyze-rag-logs.ts` 🆕
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
| RAG_TRACKING_ANALYSIS.md | ✅ Completo | 2025-12-19 | 100% |
| ADMIN_API_DOCUMENTATION.md | ⚠️ Desatualizado | 2025-10-10 | 70% |

---

## 🔄 Changelog

### 2025-12-19 🆕
- ✨ **Criada documentação RAG_TRACKING_ANALYSIS.md** - Rastreamento completo do fluxo RAG → IA → RAG
- ✨ **Criada MIGRATION_RAG_TRACKING.sql** - Migration para novos campos de tracking
- ✨ **Criada CHANGELOG_RAG_TRACKING.md** - Resumo completo das alterações
- 🗂️ **Reorganização**: Movidos 15 arquivos .md da raiz para docs/
- 📝 **Atualizado schema.prisma**: Novos campos em RAGSearchLog e AIUsageLog
- 📝 **Atualizados README.md principal e docs/README.md**

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

**Última revisão**: 19 de dezembro de 2025
