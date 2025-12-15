# 🤖 Sistema de Configuração Dinâmica de IA

## ✅ Providers Configurados

### 1. **Groq** (Priority 1 - Mais Rápido)
- **Model**: llama-3.1-70b-versatile
- **Cost**: $0.59 input / $0.79 output (por 1M tokens)
- **Supports**: Texto
- **Status**: Desabilitado (configure API key)

### 2. **DeepSeek** (Priority 1 - Mais Barato)
- **Model**: deepseek-chat
- **Cost**: $0.28 input / $0.42 output (por 1M tokens)
- **Cache Cost**: $0.028 (90% desconto!)
- **Supports**: Texto, Cache
- **Status**: Desabilitado (configure API key)

### 3. **Google Gemini** (Priority 2 - Custo Médio)
- **Model**: gemini-1.5-pro
- **Cost**: $1.25 input / $5.00 output (por 1M tokens)
- **Supports**: Texto, Visão, Cache
- **Status**: Desabilitado (configure API key)

### 4. **OpenAI** (Priority 3 - Melhor Qualidade)
- **Model**: gpt-4o
- **Cost**: $2.50 input / $10.00 output (por 1M tokens)
- **Supports**: Texto, Visão, Áudio
- **Status**: Desabilitado (configure API key)

---

## 🚀 Como Usar

### 1. Visualizar Providers
```bash
# Via Prisma Studio (já aberto)
npx prisma studio

# Via API (requer JWT)
curl http://localhost:4444/admin/ai-providers \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 2. Habilitar um Provider
```bash
# Exemplo: Habilitar DeepSeek
curl -X PUT http://localhost:4444/admin/ai-providers/deepseek \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "apiKey": "sk-your-deepseek-api-key-here"
  }'
```

### 3. Configurar Prioridades
```bash
# DeepSeek como prioridade 1 (primeiro a ser usado)
curl -X PUT http://localhost:4444/admin/ai-providers/deepseek \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "priority": 1,
    "fallbackEnabled": true
  }'

# OpenAI como fallback (prioridade 3)
curl -X PUT http://localhost:4444/admin/ai-providers/openai \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "priority": 3,
    "fallbackEnabled": true
  }'
```

### 4. Ativar Cache (DeepSeek/Gemini)
```bash
curl -X PUT http://localhost:4444/admin/ai-providers/deepseek \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cacheEnabled": true
  }'
```

### 5. Configurar Rate Limits
```bash
curl -X PUT http://localhost:4444/admin/ai-providers/groq \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "rpmLimit": 30,
    "tpmLimit": 6000
  }'
```

---

## 📊 Monitoramento de Custos

### Ver Logs de Uso
```bash
curl "http://localhost:4444/admin/ai-usage-logs?limit=100" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Estatísticas por Provider
```bash
curl "http://localhost:4444/admin/ai-usage-logs/stats" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Filtrar por Provider
```bash
curl "http://localhost:4444/admin/ai-usage-logs?provider=deepseek&from=2025-01-01" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## 💡 Estratégias Recomendadas

### Economia Máxima (DeepSeek First)
1. **Priority 1**: DeepSeek (texto) - $0.28/$0.42
2. **Priority 2**: Groq (texto simples) - $0.59/$0.79
3. **Priority 3**: Gemini (imagens) - $1.25/$5.00
4. **Priority 4**: OpenAI (fallback) - $2.50/$10.00

### Qualidade Máxima (OpenAI First)
1. **Priority 1**: OpenAI - $2.50/$10.00
2. **Priority 2**: Gemini - $1.25/$5.00
3. **Priority 3**: DeepSeek - $0.28/$0.42

### Balanceado (Gemini First)
1. **Priority 1**: Gemini (texto+imagem) - $1.25/$5.00
2. **Priority 2**: DeepSeek (texto) - $0.28/$0.42
3. **Priority 3**: OpenAI (fallback) - $2.50/$10.00

---

## 🔧 Configuração de Ambiente

Adicione as API keys no `.env`:
```env
# OpenAI
OPENAI_API_KEY=sk-...

# Google Gemini
GOOGLE_AI_API_KEY=...

# Groq
GROQ_API_KEY=gsk_...

# DeepSeek
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

---

## 📈 Comparação de Custos

Para 1 milhão de tokens:

| Provider | Input | Output | Total (50/50) | Economia vs OpenAI |
|----------|-------|--------|---------------|-------------------|
| DeepSeek | $0.28 | $0.42  | **$0.35** | **86%** 💰 |
| Groq     | $0.59 | $0.79  | **$0.69** | 72% |
| Gemini   | $1.25 | $5.00  | $3.13 | -25% |
| OpenAI   | $2.50 | $10.00 | $6.25 | 0% (baseline) |

### Com Cache (DeepSeek)
- Input (cache hit): $0.028 (90% desconto!)
- Output: $0.42
- **Total**: $0.22 (91% economia vs OpenAI)

---

## 🎯 Próximos Passos

1. ✅ **Configure API Keys** no `.env`
2. ✅ **Habilite Providers** via admin API
3. ✅ **Defina Prioridades** conforme sua estratégia
4. ✅ **Ative Cache** em DeepSeek/Gemini
5. ✅ **Monitore Custos** via `/admin/ai-usage-logs/stats`
6. ✅ **Ajuste Fallbacks** conforme necessidade

---

**Sistema pronto para uso! 🚀**

Prisma Studio aberto em: http://localhost:5555
