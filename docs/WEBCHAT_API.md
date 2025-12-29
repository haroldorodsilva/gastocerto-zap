# API de Chat Web - GastoCerto

## Visão Geral

A API de Chat Web permite integrar o sistema de processamento de transações do GastoCerto diretamente no frontend web, reutilizando toda a lógica de análise de mensagens do WhatsApp/Telegram.

## Endpoint Principal

### POST `/webchat/message`

Envia uma mensagem do usuário e processa como transação.

**Requisição:**

```json
{
  "userId": "user-gastocerto-id-123",
  "message": "Gastei 50 reais no supermercado",
  "profileId": "profile-id-opcional"
}
```

**Campos:**
- `userId` (obrigatório): ID do usuário no sistema GastoCerto (já autenticado no frontend)
- `message` (obrigatório): Mensagem de texto enviada pelo usuário
- `profileId` (opcional): ID do perfil ativo, se o usuário tiver múltiplos perfis

## Respostas Estruturadas

A API retorna um JSON estruturado com informações para formatação no frontend:

### Resposta de Sucesso - Transação Registrada

```json
{
  "success": true,
  "messageType": "transaction",
  "message": "✅ Transação registrada!\n\n💰 Valor: R$ 50,00\n📁 Categoria: Supermercado\n📅 Data: 26/12/2025\n\nDeseja confirmar?",
  "data": {
    "amount": 50.00,
    "category": "Supermercado",
    "date": "2025-12-26"
  },
  "formatting": {
    "emoji": "✅",
    "color": "success",
    "highlight": ["R$ 50,00", "Supermercado", "26/12/2025"]
  }
}
```

### Resposta - Requer Confirmação

```json
{
  "success": false,
  "messageType": "confirmation",
  "message": "❓ Identifiquei uma transação:\n\n💰 R$ 50,00\n📁 Supermercado\n\nEsta informação está correta?\nResponda: SIM ou NÃO",
  "data": {
    "requiresConfirmation": true,
    "confirmationId": "conf-12345",
    "amount": 50.00,
    "category": "Supermercado"
  },
  "formatting": {
    "emoji": "❓",
    "color": "warning",
    "highlight": ["R$ 50,00", "Supermercado"]
  }
}
```

### Resposta - Aprendizado RAG

Quando o sistema detecta ambiguidade e precisa aprender:

```json
{
  "success": true,
  "messageType": "learning",
  "message": "🎓 Encontrei múltiplas possibilidades para 'mercado':\n\n1️⃣ Supermercado (alimentação)\n2️⃣ Farmácia (saúde)\n3️⃣ Mercado Municipal (outros)\n\nQual você quis dizer? Responda com o número.",
  "data": {
    "learningOptions": [
      { "id": 1, "text": "Supermercado", "category": "Alimentação" },
      { "id": 2, "text": "Farmácia", "category": "Saúde" },
      { "id": 3, "text": "Mercado Municipal", "category": "Outros" }
    ]
  },
  "formatting": {
    "emoji": "🎓",
    "color": "info",
    "highlight": ["Supermercado", "Farmácia", "Mercado Municipal"]
  }
}
```

### Resposta - Erro

```json
{
  "success": false,
  "messageType": "error",
  "message": "❌ Não consegui identificar uma transação válida. Tente algo como: 'Gastei R$ 50,00 no supermercado'",
  "formatting": {
    "emoji": "❌",
    "color": "error",
    "highlight": []
  }
}
```

## Tipos de Mensagem

A API pode retornar diferentes tipos de mensagem:

| Tipo | Descrição | Cor Sugerida |
|------|-----------|--------------|
| `transaction` | Transação registrada com sucesso | Verde (success) |
| `confirmation` | Aguardando confirmação do usuário | Amarelo (warning) |
| `learning` | Sistema aprendendo preferências | Azul (info) |
| `info` | Informação geral | Azul (info) |
| `error` | Erro no processamento | Vermelho (error) |

## Fluxo de Conversação

### 1. Registro Simples
```
Usuário: "Gastei 50 reais no supermercado"
      ↓
Sistema: ✅ Transação registrada! [transaction]
```

### 2. Confirmação Necessária
```
Usuário: "Paguei conta"
      ↓
Sistema: ❓ Quanto foi? [confirmation]
      ↓
Usuário: "150 reais"
      ↓
Sistema: ✅ Transação registrada! [transaction]
```

### 3. Aprendizado RAG
```
Usuário: "Comprei no mercado"
      ↓
Sistema: 🎓 Qual mercado? [learning]
      ↓
Usuário: "1" (Supermercado)
      ↓
Sistema: ✅ Aprendi! Processando... [transaction]
```

## Formatação no Frontend

Use os dados retornados para criar uma UI rica:

### 1. Usar `formatting.emoji` no início da mensagem
```jsx
<div className="message">
  <span className="emoji">{response.formatting.emoji}</span>
  <span>{response.message}</span>
</div>
```

### 2. Aplicar cor baseada em `formatting.color`
```jsx
<div className={`alert alert-${response.formatting.color}`}>
  {response.message}
</div>
```

### 3. Destacar palavras-chave em `formatting.highlight`
```jsx
let formattedMessage = response.message;
response.formatting.highlight?.forEach(word => {
  formattedMessage = formattedMessage.replace(
    new RegExp(word, 'g'),
    `<mark>${word}</mark>`
  );
});
```

### 4. Renderizar opções de aprendizado
```jsx
{response.data?.learningOptions && (
  <div className="learning-options">
    {response.data.learningOptions.map(option => (
      <button 
        key={option.id}
        onClick={() => sendMessage(option.id.toString())}
      >
        {option.id}️⃣ {option.text}
      </button>
    ))}
  </div>
)}
```

### 5. Mostrar detalhes da transação
```jsx
{response.data && response.messageType === 'transaction' && (
  <div className="transaction-details">
    <div>💰 {formatCurrency(response.data.amount)}</div>
    <div>📁 {response.data.category}</div>
    {response.data.date && <div>📅 {formatDate(response.data.date)}</div>}
  </div>
)}
```

## Exemplo de Integração React

```typescript
import { useState } from 'react';

interface ChatMessage {
  id: string;
  text: string;
  type: 'user' | 'system';
  data?: any;
  formatting?: any;
}

function WebChat({ userId, profileId }: { userId: string; profileId?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async (text: string) => {
    // Adicionar mensagem do usuário
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text,
      type: 'user',
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      // Chamar API
      const response = await fetch('http://localhost:4444/webchat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, message: text, profileId }),
      });

      const data = await response.json();

      // Adicionar resposta do sistema
      const systemMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: data.message,
        type: 'system',
        data: data.data,
        formatting: data.formatting,
      };
      setMessages(prev => [...prev, systemMessage]);
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      // Adicionar mensagem de erro
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        text: '❌ Erro ao processar mensagem',
        type: 'system',
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map(msg => (
          <div key={msg.id} className={`message ${msg.type}`}>
            {msg.formatting?.emoji && (
              <span className="emoji">{msg.formatting.emoji}</span>
            )}
            <div className="text">{msg.text}</div>
            
            {/* Renderizar opções de aprendizado */}
            {msg.data?.learningOptions && (
              <div className="options">
                {msg.data.learningOptions.map(opt => (
                  <button key={opt.id} onClick={() => sendMessage(opt.id.toString())}>
                    {opt.id}️⃣ {opt.text}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="input-container">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && sendMessage(input)}
          placeholder="Digite sua mensagem..."
          disabled={loading}
        />
        <button onClick={() => sendMessage(input)} disabled={loading || !input}>
          {loading ? '⏳' : '📤'}
        </button>
      </div>
    </div>
  );
}

export default WebChat;
```

## Exemplos de Mensagens Válidas

O sistema aceita mensagens em linguagem natural:

- ✅ "Gastei 50 reais no supermercado"
- ✅ "Paguei 150 de conta de luz"
- ✅ "Almoço de 35 reais"
- ✅ "Comprei remédio por 80"
- ✅ "Uber 25 reais"
- ✅ "50 no mercado"

## Observações Importantes

1. **Autenticação**: O `userId` deve ser do usuário já autenticado no frontend
2. **Cadastro**: O usuário deve ter completado o onboarding via WhatsApp primeiro
3. **Contexto**: O sistema mantém contexto de conversação (aprendizado, confirmações)
4. **Plataforma**: Internamente usa 'whatsapp' como fallback para compatibilidade
5. **Rate Limiting**: O mesmo rate limiting do WhatsApp se aplica

## Possíveis Melhorias Futuras

- [ ] Suporte a envio de imagens (notas fiscais)
- [ ] Histórico de conversas por sessão
- [ ] Sugestões automáticas baseadas em histórico
- [ ] Análise de sentimento para mensagens
- [ ] Integração com notificações push
- [ ] Modo offline com sincronização

## Troubleshooting

### Erro: "Usuário não encontrado"
**Causa**: O `userId` fornecido não existe no sistema  
**Solução**: Verificar se o usuário completou o onboarding via WhatsApp

### Erro: "Não consegui identificar uma transação"
**Causa**: A mensagem não tem formato reconhecível  
**Solução**: Usuário deve enviar mensagem com valor e categoria (ex: "50 reais no mercado")

### Resposta lenta
**Causa**: Processamento de IA pode levar alguns segundos  
**Solução**: Implementar loading state no frontend

## Suporte

Para dúvidas ou problemas, consulte a documentação completa ou entre em contato com a equipe de desenvolvimento.
