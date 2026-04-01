# Plan: Humanizar Fluxo de Mensagens do Bot

## TL;DR
O bot funciona mas parece um sistema de menus, não um atendente. Os problemas principais: (1) NLP rule-based não tolera typos nem palavras isoladas, (2) não há memória de conversa, (3) respostas são robóticas com listas de comandos, (4) mensagens ambíguas resultam em "não entendi" genérico ao invés de perguntar. O plano melhora as regras de NLP, adiciona memória de conversa curta, humaniza respostas e implementa desambiguação inteligente.

**Decisões do usuário:**
- Sem LLM fallback para intenção — melhorar apenas regras
- Memória curta (5-10 mensagens, 30min TTL)
- Tom amigável e casual
- Desambiguação com opções rápidas

---

## Progresso Atual

### ✅ Concluído
- **Fase 1.1**: Normalização avançada (`normalizeForIntent` em `src/shared/utils/string-utils.ts`)
- **Fase 1.2**: Keywords expandidas em `src/features/intent/intent-keywords.ts`
- **Fase 1.3**: Fuzzy matching (Levenshtein + `tryFuzzyIntentMatch`)
- **Fase 1.4**: Abreviações (`ABBREVIATION_MAP` + expansão em `normalizeText`)
- **Fase 2.1**: `ConversationMemoryService` criado (Redis, 10 msgs, 30min TTL)
- **Fase 2.2**: Memória integrada no contexto de intent (via `tryContextualFollowUp`)
- **Fase 2.3**: Memória integrada no `TransactionsService` (salva msgs user/bot)
- **Fase 3.1**: `DisambiguationService` criado (fuzzy match com 6 grupos de intent)
- **Fase 3.2**: Estado de desambiguação no Redis (5min TTL) + resolução de respostas numéricas "1"/"2"/"3"
- **Fase 3.3**: Desambiguação integrada antes do UNKNOWN no flow principal
- **Fase 4.1**: Respostas estáticas humanizadas (UNKNOWN, GREETING, HELP)
- **Fase 4.2**: Variações de resposta (`src/shared/utils/response-variations.ts`)
- **Fase 4.3**: Listagem humanizada com comentários contextuais
- **Fase 4.4**: Respostas de saldo/resumo/categoria humanizadas com comentários contextuais
- **Fase 5.1**: Sugestões pós-ação (`getPostActionSuggestion`)
- **Fase 5.2**: Follow-ups contextuais (`tryContextualFollowUp`)
- **Testes**: 27/27 intent-analyzer + 16/16 string-utils + 17/17 disambiguation + 22/22 response-variations passando

### ⬜ Pendente
- **Testes e2e**: Conversa multi-turno, desambiguação end-to-end, variabilidade de respostas

---

## Fase 1: Robustez do NLP (Entender melhor o que o usuário diz)

### 1.1 Normalização de Texto Avançada ✅
- **Arquivo**: `src/features/intent/intent-analyzer.service.ts` (L88)
- **Problema**: `text.toLowerCase().trim()` não remove acentos nem caracteres especiais
- **Mudança**: Criar `normalizeForIntent(text)` que:
  - Remove diacríticos via `.normalize('NFD').replace(/[\u0300-\u036f]/g, '')`
  - Remove caracteres especiais `~`, pontuação
  - Colapsa espaços múltiplos
  - Exemplo: `"transaç~eos"` → `"transacoes"` → match!
- **Referência**: `TextProcessingService.normalize()` em `src/infrastructure/rag/services/text-processing.service.ts` já faz isso para RAG — reusar mesma lógica

### 1.2 Expandir Keywords com Palavras Isoladas e Variações ✅
- **Arquivo**: `src/features/intent/intent-keywords.ts`
- **Mudanças por intent**:
  - **LIST_TRANSACTIONS** (L158): Adicionar `'transacoes'`, `'transacao'`, `'extrato de gastos'`, `'ultimos gastos'`, `'gastos recentes'`
  - **BALANCE**: Adicionar variações informais `'sobrou'`, `'quanto sobrou'`, `'to devendo'`
  - **MONTHLY_SUMMARY**: Adicionar `'como estou'`, `'situacao do mes'`
  - **CATEGORY_BREAKDOWN**: Adicionar `'gastei em que'`, `'gastei mais em que'`
- **Critério**: Apenas palavras que não causem ambiguidade com outros intents

### 1.3 Fuzzy Matching para Keywords (Levenshtein) ✅
- **Arquivo**: `src/features/intent/intent-analyzer.service.ts` — nos métodos `isListTransactions()`, `isCheckBalance()`, etc.
- **Mudança**: Quando nenhum keyword dá match exato, aplicar Levenshtein distance (≤ 2 edits) usando a implementação já existente em `rag-learning.service.ts` (L555-580)
- Extrair `levenshteinDistance()` para `src/shared/utils/string-utils.ts` (reusável)
- Aplicar só quando texto tem ≤ 3 palavras (evitar false positives em frases longas)
- Threshold: similarity ≥ 0.75 para keywords curtas

### 1.4 Abreviações e Gírias Comuns ✅
- **Arquivo**: `src/features/intent/intent-keywords.ts` — nova constante `ABBREVIATION_MAP`
- **Map**: `{ 'trans': 'transacoes', 'trx': 'transacoes', 'cat': 'categoria', 'cc': 'cartao de credito' }`
- **Aplicar** antes do matching de keywords em `intent-analyzer.service.ts`

---

## Fase 2: Memória de Conversa (Contexto entre mensagens)

### 2.1 ConversationMemoryService (Novo) ✅
- **Novo arquivo**: `src/features/conversation/conversation-memory.service.ts`
- **Storage**: Redis com TTL de 30 minutos (mesma infra já usada por RAG/MessageContext)
- **Key**: `conversation:{phoneNumber}` 
- **Estrutura**:
  ```
  { messages: [{ role: 'user'|'bot', text: string, intent: string, timestamp: Date }], lastActivity: Date }
  ```
- **Max**: 10 mensagens (circular buffer)
- **Métodos**: `addMessage()`, `getHistory()`, `getLastBotIntent()`, `clear()`

### 2.2 Integrar Memória no Intent Analyzer ✅
- **Arquivo**: `src/features/intent/intent-analyzer.service.ts`
- **Injetar** ConversationMemoryService
- **Usar contexto** para:
  - Se última intent foi LIST_TRANSACTIONS e user diz "receitas" → LIST_TRANSACTIONS com filtro type=INCOME
  - Se última intent foi MONTHLY_SUMMARY e user diz "do mês passado" → MONTHLY_SUMMARY com mês anterior
  - Se bot perguntou desambiguação e user respondeu "1" ou "2" → executar opção correspondente

### 2.3 Integrar Memória no TransactionsService ✅
- **Arquivo**: `src/features/transactions/transactions.service.ts`
- **Salvar** intent + resposta no histórico após cada processamento
- **Passar** histórico para formatting (para respostas contextuais)

---

## Fase 3: Desambiguação Inteligente (Perguntar ao invés de falhar)

### 3.1 Sistema de Desambiguação ✅
- **Novo arquivo**: `src/features/conversation/disambiguation.service.ts`
- **Lógica**: Quando texto não match nenhum intent mas contém palavras parciais de múltiplos intents:
  - Calcular score parcial para cada intent candidato
  - Se 2+ intents com score > 0.3 → perguntar
  - Se 1 intent com score 0.3-0.5 → sugerir com confirmação
- **Template de pergunta**:
  ```
  Hmm, o que você gostaria de fazer? 🤔
  
  1️⃣ Ver suas transações do mês
  2️⃣ Registrar um novo gasto
  3️⃣ Outra coisa
  ```

### 3.2 Armazenar Estado de Desambiguação ✅
- **Arquivo**: `src/features/conversation/disambiguation.service.ts`
- **Storage**: Redis com TTL de 5 minutos
- **Key**: `disamb:{phoneNumber}`
- **Dados**: opções apresentadas com intent mapeado, timestamp
- **Resolução**: `resolveNumericResponse()` aceita "1", "2", "3" ou "opção N"
- **Integração**: `TransactionsService.processTextMessage()` verifica antes do intent analysis
- **Limpeza**: Estado removido automaticamente após resolução ou por TTL

### 3.3 Integrar no Flow Principal ✅
- **Arquivo**: `src/features/intent/intent-analyzer.service.ts`
- **Antes do UNKNOWN final**: Chamar disambiguation check
- **Se tem pergunta de desambiguação pendente**: Resolver resposta numérica

---

## Fase 4: Humanizar Respostas (Tom amigável e casual)

### 4.1 Reformular Respostas Estáticas ✅
- **Arquivo**: `src/features/intent/intent-analyzer.service.ts` (suggestedResponse strings)
- **UNKNOWN** → Variações aleatórias com tom casual
- **GREETING** → Baseado em hora do dia

### 4.2 Variabilidade nas Respostas ✅
- **Novo arquivo**: `src/shared/utils/response-variations.ts`
- **Padrão**: Para cada tipo de resposta, ter 3-5 variações aleatórias

### 4.3 Humanizar Listagem de Transações ✅
- **Arquivo**: `src/features/transactions/contexts/listing/listing.service.ts`
- **Mudanças**: Comentário contextual no topo, reações baseadas no saldo

### 4.4 Humanizar Resposta de Saldo/Resumo ✅
- **Arquivo**: `src/features/transactions/contexts/summary/summary.service.ts`
- **Novas funções**: `getSummaryIntro`, `getBalanceSummaryIntro`, `getSummaryBalanceComment`, `getCategoryInsight`, `getPredictedBalanceComment` em `response-variations.ts`
- **Mudanças**:
  - Resumo mensal: intro humanizado + insight da top categoria + comentário sobre balanço
  - Balanço geral: intro humanizado + comentário sobre previsão + comentário sobre situação
  - Análise por categoria: insight da maior categoria + comentário sobre balanço líquido

---

## Fase 5: Respostas Contextuais com Memória

### 5.1 Sugestões Proativas Pós-ação ✅
- Após registrar transação: "Se quiser ver como ficou seu mês, é só dizer 'resumo' 😊"
- Após listar transações: "Quer ver por categoria? Diz 'gastos por categoria'"
- Após ver saldo negativo: "Quer ver onde tá gastando mais? Diz 'maiores gastos'"

### 5.2 Follow-ups Contextuais ✅
- User lista gastos → diz "receitas" → entender como LIST_TRANSACTIONS type=INCOME
- User vê resumo março → diz "e fevereiro?" → MONTHLY_SUMMARY mês anterior
- User registra gasto → diz "outro" ou "mais um" → entender como nova transação

---

## Arquivos Criados/Modificados

### Novos
- `src/shared/utils/string-utils.ts` — Normalização e fuzzy matching
- `src/shared/utils/response-variations.ts` — Templates de resposta humanizada (incluindo summary helpers)
- `src/features/conversation/conversation-memory.service.ts` — Memória Redis
- `src/features/conversation/disambiguation.service.ts` — Desambiguação inteligente com estado Redis
- `src/features/conversation/conversation.module.ts` — Módulo NestJS
- `test/unit/string-utils.spec.ts` — 16 testes
- `test/unit/disambiguation.service.spec.ts` — 17 testes
- `test/unit/response-variations.spec.ts` — 22 testes

### Modificados
- `src/features/intent/intent-analyzer.service.ts` — Normalização, fuzzy, greeting, help, unknown, disambiguation async
- `src/features/intent/intent-keywords.ts` — Keywords expandidas + ABBREVIATION_MAP
- `src/features/intent/intent.module.ts` — Importa ConversationModule
- `src/features/transactions/transactions.service.ts` — Memória, follow-ups, sugestões, desambiguação numérica
- `src/features/transactions/transactions.module.ts` — Importa ConversationModule
- `src/features/transactions/contexts/listing/listing.service.ts` — Respostas humanizadas
- `src/features/transactions/contexts/summary/summary.service.ts` — Respostas humanizadas com comentários contextuais
- `test/unit/intent-analyzer.service.spec.ts` — 27 testes (+ RedisService mock)

---

## Relevant Files

- `src/features/intent/intent-analyzer.service.ts` — NLP engine principal
- `src/features/intent/intent-keywords.ts` — Todas as keywords por intent
- `src/features/transactions/transactions.service.ts` — Orquestrador principal
- `src/features/transactions/contexts/listing/listing.service.ts` — Formatação de listagens
- `src/features/transactions/contexts/summary/summary.service.ts` — Formatação de resumo/saldo
- `src/features/transactions/contexts/registration/transaction-message-formatter.service.ts` — Formatação de confirmação
- `src/infrastructure/rag/services/rag-learning.service.ts` — Levenshtein existente
- `src/infrastructure/messaging/messages/message-context.service.ts` — Redis context pattern

---

## Verification

1. ✅ **Teste unitário**: "transações", "transaç~eos", "trans", "trx" → LIST_TRANSACTIONS
2. ✅ **Teste unitário**: Disambiguation — resolução numérica, estado Redis, edge cases (17 testes)
3. ✅ **Teste unitário**: Response variations — todas as funções humanizadas (22 testes)
4. ⬜ **Teste e2e**: Enviar "transações" no webchat → deve listar transações (não UNKNOWN)
5. ⬜ **Teste e2e**: Conversa multi-turno — "minhas transações" → "e as receitas?" → filtrar receitas
6. ⬜ **Teste e2e**: Desambiguação — "gastos" → deve perguntar "listar ou registrar?" → "1" → executar
7. ⬜ **Teste manual**: Verificar variabilidade de respostas
8. ✅ **Teste de regressão**: "gastei 50 no mercado" = REGISTER_TRANSACTION
9. ✅ **Teste de regressão**: "minhas transações" = LIST_TRANSACTIONS (0.9)

---

## Decisions & Scope

- **Incluído**: NLP robustez, memória curta, desambiguação, humanização de respostas
- **Excluído**: LLM fallback para intenção (decisão do usuário), treinar novo modelo NLP, mudar arquitetura de providers
- **Assumption**: Redis já disponível (confirmado pelo stack atual)
- **Risk**: Expandir keywords pode causar colisões entre intents — mitigar com testes extensivos
- **Order**: Fase 1 → 2 → 3 → 4 → 5 (cada fase é independente mas cumulativa)
- Fases 1 e 4 podem rodar em paralelo (sem dependência)
- Fase 3 depende parcialmente de Fase 2 (desambiguação usa memória)
- Fase 5 depende de Fase 2 (follow-ups usam memória)
