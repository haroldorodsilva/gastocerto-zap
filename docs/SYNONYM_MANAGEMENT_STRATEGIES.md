# 🎯 Estratégias de Gerenciamento de Sinônimos

## 📋 Visão Geral

O modelo `UserSynonym` foi projetado para ser flexível e suportar múltiplas estratégias de gerenciamento. A escolha da estratégia depende dos seus objetivos de UX, escalabilidade e custos.

---

## 🔀 Estratégias Disponíveis

### 1. **Aprendizado Automático (Recomendado)** 🤖

**Como funciona:**
- Sistema detecta quando IA acerta e RAG falha (`needsSynonymLearning=true`)
- Job automático extrai sinônimos e adiciona em `user_synonyms`
- Usuário não precisa fazer nada
- Sinônimos são criados com `source: AUTO_LEARNED`

**Vantagens:**
- ✅ Zero fricção para o usuário
- ✅ Aprende continuamente
- ✅ Escalável (funciona para todos usuários)
- ✅ Reduz custo de IA automaticamente

**Desvantagens:**
- ❌ Pode criar sinônimos errados (se IA errou)
- ❌ Sem controle direto do usuário
- ❌ Requer threshold de confiança (ex: 80%+)

**Quando usar:**
- Sistema com alta confiança na IA (≥90%)
- Muitos usuários (escalabilidade importante)
- Foco em automação

**Implementação:**

```typescript
// Job automático (roda diariamente às 3h)
@Cron('0 3 * * *')
async extractSynonyms() {
  const candidates = await this.prisma.aIUsageLog.findMany({
    where: {
      wasRagFallback: true,
      needsSynonymLearning: true,
      success: true,
      aiConfidence: { gte: 0.8 }, // Apenas alta confiança
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
  });

  // Agrupar por userId + query + categoria
  // Criar sinônimos com >= 2 ocorrências
  // Ver código completo em docs/examples/rag-tracking-implementation.example.ts
}
```

---

### 2. **Feedback do Usuário (UX-First)** 👤

**Como funciona:**
- Quando IA sugere categoria, bot pergunta: "Está correto?"
- Se usuário confirma, cria sinônimo com `source: USER_CONFIRMED`
- Sinônimos confirmados têm `confidence: 1.0` (maior prioridade)

**Vantagens:**
- ✅ Sinônimos 100% corretos (usuário validou)
- ✅ Usuário sente controle sobre o sistema
- ✅ Ótimo para aprendizado inicial
- ✅ Não precisa de job automático

**Desvantagens:**
- ❌ Requer interação do usuário (fricção)
- ❌ Usuários podem ignorar pergunta
- ❌ Não escala bem (depende de engajamento)

**Quando usar:**
- Primeiros meses do sistema (coleta inicial)
- Usuários técnicos/engajados
- Foco em qualidade sobre quantidade

**Implementação:**

```typescript
// Após IA sugerir categoria
async handleAISuggestion(userId: string, query: string, category: string) {
  // 1. Salvar transação temporária
  
  // 2. Perguntar usuário
  await this.sendMessage(userId, 
    `💡 Encontrei "${query}" como "${category}"\n\n` +
    `✅ Está correto?\n` +
    `❌ Não, é outra categoria\n` +
    `🧠 Sim e lembrar para próximas vezes`
  );
  
  // 3. Se usuário escolher "lembrar"
  if (userResponse === 'lembrar') {
    await this.prisma.userSynonym.create({
      data: {
        userId,
        keyword: query.toLowerCase(),
        categoryId: category.id,
        categoryName: category.name,
        confidence: 1.0,
        source: 'USER_CONFIRMED',
      },
    });
  }
}
```

**Fluxo UX:**

```
Usuário: "pro labore 1500"

Bot: 💡 Detectei:
     💰 R$ 1.500,00
     📂 Receitas → Salário (sugerido pela IA)
     
     ✅ Confirmar
     ❌ Corrigir categoria
     🧠 Confirmar e lembrar "pro labore" como Salário

[Usuário clica "🧠 Confirmar e lembrar"]

Bot: ✅ Transação registrada!
     🧠 Vou lembrar: "pro labore" = Receitas → Salário
     
     Da próxima vez será automático! 🚀
```

---

### 3. **Gerenciamento Admin (Centralizado)** 👨‍💼

**Como funciona:**
- Admin analisa logs e identifica keywords problemáticos
- Admin cria sinônimos "globais" para todos usuários
- Sinônimos criados com `source: ADMIN_CREATED`

**Vantagens:**
- ✅ Controle total (qualidade garantida)
- ✅ Pode criar sinônimos antes de problema acontecer
- ✅ Bom para termos comuns (PJ, MEI, INSS, etc)

**Desvantagens:**
- ❌ Não escala (trabalho manual)
- ❌ Admin precisa conhecer contexto de cada usuário
- ❌ Não aprende automaticamente

**Quando usar:**
- Setup inicial (popular base de sinônimos comuns)
- Correção de problemas pontuais
- Termos universais (PJ, MEI, DAS, INSS, etc)

**Implementação:**

```typescript
// Endpoint admin
@Post('admin/synonyms/bulk')
@UseGuards(JwtAuthGuard, AdminGuard)
async createBulkSynonyms(@Body() body: CreateBulkSynonymsDto) {
  // Criar mesmo sinônimo para todos usuários
  const users = await this.prisma.userCache.findMany();
  
  for (const user of users) {
    await this.prisma.userSynonym.upsert({
      where: { userId_keyword: { userId: user.id, keyword: body.keyword } },
      create: {
        userId: user.id,
        keyword: body.keyword,
        categoryId: body.categoryId,
        categoryName: body.categoryName,
        confidence: 0.9,
        source: 'ADMIN_CREATED',
      },
      update: {}, // Não sobrescrever se já existe
    });
  }
}
```

**Dashboard Admin:**

```
📊 Sinônimos Admin
──────────────────────────────────────────────

📋 Sinônimos Globais Sugeridos (baseado em logs):

┌─────────────────┬──────────────────────┬──────────┬─────────┐
│ Keyword         │ Categoria Sugerida   │ Ocorr.   │ Ação    │
├─────────────────┼──────────────────────┼──────────┼─────────┤
│ pro labore      │ Receitas → Salário   │ 145      │ [Criar] │
│ das simples     │ Impostos → DAS       │ 89       │ [Criar] │
│ inss            │ Impostos → INSS      │ 67       │ [Criar] │
└─────────────────┴──────────────────────┴──────────┴─────────┘

[Criar todos selecionados]

✅ 23 sinônimos globais criados
```

---

### 4. **Híbrido (Recomendação Final)** 🎯

**Combinação das 3 estratégias:**

```
┌─────────────────────────────────────────────────────────┐
│                    PRIORIDADE                           │
├─────────────────────────────────────────────────────────┤
│ 1️⃣ USER_CONFIRMED (confidence: 1.0)                     │
│    → Usuário validou explicitamente                     │
│                                                          │
│ 2️⃣ ADMIN_CREATED (confidence: 0.9)                      │
│    → Admin criou baseado em análise                     │
│                                                          │
│ 3️⃣ AUTO_LEARNED (confidence: 0.5-0.8)                   │
│    → Sistema aprendeu automaticamente                   │
│                                                          │
│ 4️⃣ AI_SUGGESTED (confidence: 0.7)                       │
│    → IA sugeriu mas usuário não confirmou ainda         │
└─────────────────────────────────────────────────────────┘
```

**Fluxo Híbrido:**

**Fase 1: Setup Inicial (Admin)**
- Admin cria sinônimos globais comuns (PJ, MEI, DAS, INSS, etc)
- Base de 50-100 sinônimos para começar

**Fase 2: Onboarding (Usuário)**
- Primeiras 10 transações: Bot sempre pergunta feedback
- Cria sinônimos USER_CONFIRMED (alta prioridade)
- Aprendizado rápido personalizado

**Fase 3: Operação (Automático)**
- Job diário extrai novos sinônimos (AUTO_LEARNED)
- Apenas para queries com ≥80% confiança e ≥2 ocorrências
- Sinônimos de baixa confiança eventualmente promovidos se usuário não corrigir

**Fase 4: Manutenção (Admin)**
- Admin revisa sinônimos AUTO_LEARNED periodicamente
- Promove para ADMIN_CREATED se fizer sentido globalmente
- Remove sinônimos com baixo usageCount (limpeza)

**Implementação:**

```typescript
// Buscar sinônimo com prioridade
async findSynonym(userId: string, keyword: string): Promise<Synonym | null> {
  const synonyms = await this.prisma.userSynonym.findMany({
    where: { userId, keyword: keyword.toLowerCase() },
    orderBy: [
      { confidence: 'desc' },  // Maior confiança primeiro
      { usageCount: 'desc' },  // Mais usado primeiro
    ],
    take: 1,
  });
  
  return synonyms[0] || null;
}

// Incrementar uso quando sinônimo é usado
async useSynonym(synonymId: string) {
  await this.prisma.userSynonym.update({
    where: { id: synonymId },
    data: { 
      usageCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });
}

// Promover sinônimo AUTO_LEARNED para USER_CONFIRMED
// se usuário não corrigir após N usos
async promoteSynonym(synonymId: string) {
  const synonym = await this.prisma.userSynonym.findUnique({
    where: { id: synonymId },
  });
  
  if (synonym.source === 'AUTO_LEARNED' && synonym.usageCount >= 5) {
    // Depois de 5 usos sem correção, assume que está correto
    await this.prisma.userSynonym.update({
      where: { id: synonymId },
      data: {
        confidence: 0.8, // Aumenta confiança
        // source continua AUTO_LEARNED mas com maior confiança
      },
    });
  }
}
```

---

## 📊 Comparação de Estratégias

| Aspecto | Automático | Usuário | Admin | Híbrido |
|---------|------------|---------|-------|---------|
| **Escalabilidade** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐ | ⭐⭐⭐⭐ |
| **Qualidade** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Fricção UX** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Tempo Setup** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| **Manutenção** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| **Personalização** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |

---

## 🎯 Recomendação por Cenário

### Startup/MVP (Poucos Usuários)
**Estratégia**: Híbrido (Admin + Usuário)
- Admin cria base inicial (50 sinônimos comuns)
- Usuários validam sugestões (feedback)
- Automático fica para depois

### Escala Média (100-1000 usuários)
**Estratégia**: Híbrido (Usuário + Automático)
- Onboarding com feedback (10 primeiras transações)
- Job automático para resto
- Admin revisa semanalmente

### Grande Escala (1000+ usuários)
**Estratégia**: Automático + Limpeza Admin
- Totalmente automático
- Admin apenas remove sinônimos ruins
- Foco em escalabilidade

---

## 🚀 Implementação Recomendada (Passo a Passo)

### Fase 1: Admin Setup (1-2 horas)

```typescript
// Criar endpoint admin
@Post('admin/synonyms/global')
async createGlobalSynonyms() {
  const commonSynonyms = [
    { keyword: 'pj', category: 'Receitas', subcategory: 'Prestação de Serviços' },
    { keyword: 'mei', category: 'Receitas', subcategory: 'MEI' },
    { keyword: 'das', category: 'Impostos', subcategory: 'DAS' },
    { keyword: 'das simples', category: 'Impostos', subcategory: 'DAS' },
    { keyword: 'inss', category: 'Impostos', subcategory: 'INSS' },
    { keyword: 'pro labore', category: 'Receitas', subcategory: 'Salário' },
    { keyword: 'prolabore', category: 'Receitas', subcategory: 'Salário' },
    // ... mais 40-50 termos comuns
  ];
  
  // Aplicar para todos usuários
}
```

### Fase 2: Feedback Usuário (2-4 horas)

```typescript
// Adicionar pergunta após IA sugerir
async handleAISuggestion() {
  const message = 
    `💡 Categoria sugerida: ${category}\n\n` +
    `Responda:\n` +
    `✅ para confirmar\n` +
    `❌ para corrigir\n` +
    `🧠 para confirmar e lembrar`;
  
  // Processar resposta
  // Se 🧠 → criar USER_CONFIRMED
}
```

### Fase 3: Job Automático (1-2 horas)

```typescript
// Job diário
@Cron('0 3 * * *')
async extractSynonyms() {
  // Buscar candidatos (últimos 7 dias)
  // Agrupar por userId + query
  // Criar AUTO_LEARNED com >= 2 ocorrências
}
```

### Fase 4: Dashboard Admin (4-8 horas - opcional)

```typescript
// Endpoints
GET /admin/synonyms/suggested  // Sugestões baseadas em logs
GET /admin/synonyms/usage      // Sinônimos mais usados
GET /admin/synonyms/low-usage  // Candidatos a remoção
POST /admin/synonyms/promote   // Promover AUTO → ADMIN
DELETE /admin/synonyms/bulk    // Remover sinônimos ruins
```

---

## 📝 Schema Atual (Já Suporta Tudo)

```prisma
model UserSynonym {
  id          String   @id @default(uuid())
  userId      String   // Específico por usuário
  keyword     String   // Termo buscado
  categoryId  String   // Categoria mapeada
  categoryName String  
  confidence  Float    @default(1.0) // 0-1
  source      SynonymSource @default(USER_CONFIRMED)
  usageCount  Int      @default(0) // Tracking de uso
  lastUsedAt  DateTime?
  
  @@unique([userId, keyword])
}

enum SynonymSource {
  USER_CONFIRMED   // Usuário confirmou
  AI_SUGGESTED     // IA sugeriu
  AUTO_LEARNED     // Sistema aprendeu
  ADMIN_CREATED    // Admin criou
  IMPORTED         // Importado de base
}
```

**Já está pronto para qualquer estratégia!** ✅

---

## 🎯 Minha Recomendação Final

**Para Gasto Certo, sugiro estratégia HÍBRIDA:**

### Timeline:

**Semana 1-2: Admin Setup**
- ✅ Criar 50-100 sinônimos comuns
- ✅ Testar com usuários beta
- ✅ Ajustar baseado em feedback

**Semana 3-4: Usuário Feedback**
- ✅ Implementar pergunta após IA
- ✅ Onboarding: 10 primeiras transações sempre perguntam
- ✅ Coletar USER_CONFIRMED

**Mês 2: Automático**
- ✅ Job diário extração
- ✅ Apenas alta confiança (≥80%)
- ✅ Admin revisa semanalmente

**Mês 3+: Manutenção**
- ✅ Promover bons AUTO_LEARNED → ADMIN_CREATED
- ✅ Remover sinônimos não usados (usageCount=0 após 30 dias)
- ✅ Dashboard para monitorar

---

## ❓ FAQ

**Q: E se IA errar e criar sinônimo errado?**  
A: Use `confidence` e `usageCount`. Sinônimos AUTO_LEARNED com baixa confiança (0.5-0.6) só são usados se nada melhor existe. Se usuário corrigir, sistema aprende.

**Q: Posso ter sinônimo global + personalizado?**  
A: Não no modelo atual. Um sinônimo é sempre por usuário. Mas você pode criar o mesmo sinônimo para todos usuários (via admin).

**Q: Como funciona a prioridade?**  
A: Query busca por `confidence DESC, usageCount DESC`. Maior confiança e mais usado sempre ganha.

**Q: Posso desabilitar automático?**  
A: Sim! Basta não rodar o job. Você pode usar apenas Admin + Usuário.

**Q: E se keyword for ambíguo?**  
A: Use contexto! Ex: "notebook" pode ser "Eletrônicos" ou "Papelaria". Se usuário sempre usa para eletrônicos, sinônimo personalizado resolve.

---

**Resumo**: Use **HÍBRIDO** para melhor resultado! 🚀
