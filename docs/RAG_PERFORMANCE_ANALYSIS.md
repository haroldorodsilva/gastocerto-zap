# 📊 Análise de Performance do RAG - GastoCerto

## 🎯 Objetivo
Documentar o impacto do crescimento do dicionário de sinônimos e categorias no sistema RAG (Retrieval-Augmented Generation).

## 🧠 Arquitetura Atual

### Sistema RAG Implementado
- **Algoritmo**: BM25 (Best Matching 25) - Busca textual sem embeddings
- **Cache**: Redis (persistente) ou Map (temporário)
- **TTL**: 24 horas
- **Sinônimos**: ~200 mapeamentos hardcoded
- **Modo alternativo**: Busca vetorial com AI (embeddings)

### Fluxo de Busca
```
1. Usuário envia: "comprei um computador por 1000 reais"
2. Sistema normaliza: "comprei um computador por 1000 reais" → tokens
3. RAG busca matches em categorias do usuário usando BM25
4. Sistema retorna categoria: "Eletrônicos → Equipamentos" (score: 0.75)
```

## 📈 Impacto do Crescimento de Dados

### ⚠️ Dicionário de Sinônimos (Hardcoded)

**Estado Atual**: ~200 mapeamentos fixos no código

**Problema**:
- ❌ Não escala: cada categoria nova precisa código
- ❌ Não personaliza: usuário tem "Pro Labore" mas sistema não conhece
- ❌ Não aprende: "INSS", "DAS", "equipamentos" precisam ser mapeados manualmente

**Impacto na Performance**:
- ✅ **O(1) lookup**: Map.get() é instantâneo
- ✅ **Sem degradação**: dicionário hardcoded não cresce com usuários
- ⚠️ **Limitação funcional**: não atende casos específicos de cada usuário

### 📊 Cache de Categorias (Por Usuário)

**Estado Atual**: Todas categorias do usuário em cache Redis

**Tamanho por usuário**:
```
Média de categorias: 20-30 categorias + subcategorias
Tamanho JSON: ~10-15 KB por usuário
Redis TTL: 24h
```

**Impacto ao crescer de 100 → 10.000 usuários**:
```
100 usuários:   100 × 15 KB = 1.5 MB Redis
1.000 usuários: 1.000 × 15 KB = 15 MB Redis
10.000 usuários: 10.000 × 15 KB = 150 MB Redis
```

**Análise**:
- ✅ **Escalável**: 150 MB é trivial para Redis
- ✅ **Performance mantida**: busca é sempre O(n) onde n = categorias do usuário (20-30)
- ✅ **Isolamento**: cache de um usuário não afeta outros

### 🔄 Busca BM25

**Complexidade Atual**:
```
Para cada mensagem:
  1. Normalização: O(m) onde m = tamanho da mensagem
  2. Tokenização: O(m)
  3. Loop categorias: O(n) onde n = categorias do usuário (20-30)
  4. Cálculo BM25: O(t × d) onde t = tokens query, d = tokens categoria
  5. Check sinônimos: O(t × s) onde s = sinônimos por token (~5)

Total: O(m + n × (t × d + t × s))

Com valores típicos:
  m = 50 caracteres
  n = 30 categorias
  t = 5 tokens
  d = 3 tokens (categoria)
  s = 5 sinônimos

= O(50 + 30 × (5×3 + 5×5)) = O(50 + 30 × 40) = O(1250) operações
```

**Tempo de resposta medido**: 5-15ms (log atual)

**Impacto do crescimento**:
- ✅ **Linear por usuário**: se usuário tiver 100 categorias, tempo ≈ 50ms
- ✅ **Independente de outros usuários**: não há degradação global
- ⚠️ **Limite prático**: >500 categorias por usuário começa a ficar lento (>100ms)

## 🚀 Proposta: Sistema de Aprendizado Dinâmico

### Problema a Resolver
```
Usuário escreve:
- "saquei 5000 de pro labore"      → ❌ não encontra "Pro Labore" (categoria específica)
- "paguei 456,67 de inss"          → ❌ não encontra "INSS" (categoria específica)
- "paguei 3456 de das"             → ❌ não encontra "DAS" (categoria específica)
- "comprei um notebook"            → ✅ encontra "Eletrônicos → Equipamentos" (genérico)
- "abasteci o carro"               → ✅ encontra "Transporte → Combustível" (sinônimo)
```

### Solução: Aprendizado Baseado em RAG Logs

#### 1. Analytics de Falhas (JÁ IMPLEMENTADO ✅)
```typescript
// Tabela: RAGSearchLog
{
  userId: string,
  query: "saquei 5000 de pro labore",
  queryNormalized: "saquei 5000 de pro labore",
  bestMatch: null,  // ❌ Não encontrou
  bestScore: 0.15,  // Score baixo
  success: false,   // ❌ Falhou
  threshold: 0.25
}
```

#### 2. Sugestão Assistida por IA (NOVO 🆕)
```typescript
// Quando RAG falha:
// 1. Extrair contexto: "pro labore" + histórico do usuário
// 2. Buscar categorias similares com IA
// 3. Sugerir ao usuário: "Não encontrei 'pro labore'. Deseja criar em 'Receitas → Salário'?"
// 4. Se usuário aceitar, adicionar ao dicionário PESSOAL
```

#### 3. Dicionário Pessoal por Usuário (NOVO 🆕)

**Nova tabela Prisma**:
```prisma
model UserSynonym {
  id          String   @id @default(cuid())
  userId      String   // gastoCertoId
  keyword     String   // "pro labore", "inss", "das", "notebook"
  categoryId  String   // ID da categoria mapeada
  confidence  Float    // Confiança do mapeamento (0-1)
  source      String   // "USER_CONFIRMED", "AI_SUGGESTED", "AUTO_LEARNED"
  usageCount  Int      @default(0) // Quantas vezes foi usado
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([userId, keyword])
  @@index([userId])
}
```

**Fluxo de busca melhorado**:
```typescript
async findSimilarCategories(text: string, userId: string) {
  // 1. Buscar com BM25 tradicional
  let matches = await this.bm25Search(text, userId);

  // 2. Se score baixo, buscar sinônimos PESSOAIS do usuário
  if (matches[0]?.score < 0.4) {
    const userSynonyms = await this.getUserSynonyms(userId, text);
    if (userSynonyms.length > 0) {
      // Aplicar sinônimos pessoais com boost alto
      matches = this.applyUserSynonyms(matches, userSynonyms);
    }
  }

  // 3. Se ainda falhou, sugerir criação com IA
  if (matches[0]?.score < 0.25) {
    await this.suggestNewMapping(userId, text);
  }

  return matches;
}
```

## 📊 Impacto da Solução Proposta

### Performance

**Novo fluxo**:
```
1. BM25 tradicional: 5-15ms
2. Busca sinônimos pessoais (Redis): +2ms
3. Aplicação de sinônimos: +1ms
4. Sugestão IA (se falhar): +500ms (só quando necessário)

Total médio: 8-18ms (sem IA)
Total com IA: 508-518ms (só em falhas, ~5% dos casos)
```

**Escalabilidade**:
```
Sinônimos pessoais por usuário: ~50-100 keywords
Redis storage: 100 × 50 bytes = 5 KB por usuário
10.000 usuários: 50 MB adicional (trivial)

Lookup: O(1) usando Redis hash ou Map
Sem degradação de performance
```

### Funcionalidade

**Antes** (sistema atual):
- ✅ Categorias comuns funcionam ("mercado", "uber", "gasolina")
- ❌ Termos específicos falham ("pro labore", "INSS", "DAS", "notebook")
- ❌ Usuário precisa adaptar linguagem ao sistema

**Depois** (com aprendizado):
- ✅ Categorias comuns funcionam
- ✅ Termos específicos aprendidos ("pro labore" → "Receitas → Salário")
- ✅ Sistema se adapta ao usuário
- ✅ Melhora contínua: mais uso = melhor match

## 🎯 Recomendações

### Fase 1: Monitoramento (Já implementado ✅)
- [x] RAGSearchLog registrando tentativas
- [x] Endpoint /admin/rag/search-logs para analytics
- [x] Identificação de queries que falham

### Fase 2: Aprendizado Assistido (Próximo)
- [ ] Criar tabela UserSynonym
- [ ] Implementar busca em sinônimos pessoais
- [ ] Criar endpoint para sugerir mapeamentos com IA
- [ ] UI de confirmação: "Não encontrei X. Criar em categoria Y?"

### Fase 3: Aprendizado Automático (Futuro)
- [ ] Análise de padrões: usuário sempre confirma "notebook" → "Eletrônicos"
- [ ] Auto-criação de sinônimos com baixa confiança (requer confirmação depois)
- [ ] Compartilhamento de sinônimos entre usuários (opt-in)

### Fase 4: Otimizações (Se necessário)
- [ ] Cache de sinônimos pessoais em Redis
- [ ] Pré-carregamento de sinônimos mais usados
- [ ] Busca vetorial com embeddings para casos complexos

## 📝 Conclusão

**O sistema atual é escalável** para milhares de usuários:
- ✅ Performance linear por usuário (O(n) onde n = suas categorias)
- ✅ Isolamento total entre usuários
- ✅ Redis suporta milhões de chaves facilmente

**O problema NÃO é performance, é funcionalidade**:
- ❌ Dicionário hardcoded não cobre casos específicos
- ❌ Usuários têm vocabulários únicos ("pro labore", "INSS", "DAS")
- ❌ Sistema não aprende com uso

**Solução proposta mantém performance e adiciona inteligência**:
- ✅ Sinônimos pessoais: +2ms overhead (trivial)
- ✅ IA só quando necessário: não impacta fluxo feliz
- ✅ Aprendizado incremental: sistema melhora com uso
- ✅ Escalável: 50 MB para 10k usuários

**Próximo passo**: Implementar Fase 2 (Aprendizado Assistido)
