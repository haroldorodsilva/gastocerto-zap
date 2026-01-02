# API de Chat Web - GastoCerto

## Visão Geral

A API de Chat Web permite integrar o sistema de processamento de transações do GastoCerto diretamente no frontend web, reutilizando toda a lógica de análise de mensagens do WhatsApp/Telegram.

## Autenticação

A API requer autenticação JWT. O token deve ser enviado no header `Authorization`:

```
Authorization: Bearer <jwt-token>
```

O `userId` é extraído automaticamente do token JWT validado.

## Endpoint Principal

### POST `/webchat/message`

Envia uma mensagem do usuário e processa como transação.

**Headers:**

```
Authorization: Bearer <jwt-token>              (obrigatório)
x-account: <account-id>                        (opcional)
Content-Type: application/json
```

**Requisição:**

```json
{
  "message": "Gastei 50 reais no supermercado"
}
```

**Campos:**
- `message` (obrigatório): Mensagem de texto enviada pelo usuário

**Headers:**
- `Authorization` (obrigatório): Token JWT do usuário autenticado
- `x-account` (opcional): ID da conta/perfil ativo. Se não fornecido, usa a conta padrão do usuário

---

### POST `/webchat/upload/image`

Envia uma imagem para processamento (nota fiscal, comprovante).

**Headers:**

```
Authorization: Bearer <jwt-token>              (obrigatório)
x-account: <account-id>                        (opcional)
Content-Type: multipart/form-data
```

**Requisição (multipart/form-data):**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `file` | File | Sim | Arquivo de imagem (JPG, PNG, PDF) |
| `message` | String | Não | Mensagem de contexto adicional |

**Exemplo com cURL:**
```bash
curl -X POST https://zap.hlg.gastocerto.com.br/webchat/upload/image \
  -H "Authorization: Bearer <jwt-token>" \
  -H "x-account: <account-id>" \
  -F "file=@nota_fiscal.jpg" \
  -F "message=Nota fiscal do supermercado"
```

**Exemplo com JavaScript:**
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('message', 'Nota fiscal do supermercado');

const response = await fetch('https://zap.hlg.gastocerto.com.br/webchat/upload/image', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwtToken}`,
    'x-account': accountId,
  },
  body: formData,
});
```

**Processamento:**
- ✅ **Usa o MESMO sistema de OCR que WhatsApp e Telegram**
- O WebChat é apenas mais um provider - alterações afetam todos igualmente
- Resposta segue o mesmo formato estruturado do endpoint `/webchat/message`
- 🔧 **MimeType automático**: Converte `image/jpg` → `image/jpeg` para compatibilidade com Gemini

**Limitações:**
- Tamanho máximo: 10MB
- Formatos aceitos: JPG, PNG, WEBP, HEIC, HEIF, PDF
- OCR compartilhado com demais plataformas

**Tipos MIME suportados:**
- `image/jpeg` ou `image/jpg` (convertido automaticamente)
- `image/png`
- `image/webp`
- `image/heic`
- `image/heif`
- `application/pdf`

---

### POST `/webchat/upload/audio`

Envia um áudio para transcrição (mensagem de voz).

**Headers:**

```
Authorization: Bearer <jwt-token>              (obrigatório)
x-account: <account-id>                        (opcional)
Content-Type: multipart/form-data
```

**Requisição (multipart/form-data):**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `file` | File | Sim | Arquivo de áudio (MP3, OGG, WAV, M4A) |
| `message` | String | Não | Mensagem de contexto adicional |

**Exemplo com cURL:**
```bash
curl -X POST https://zap.hlg.gastocerto.com.br/webchat/upload/audio \
  -H "Authorization: Bearer <jwt-token>" \
  -H "x-account: <account-id>" \
  -F "file=@mensagem_voz.mp3" \
  -F "message=Minhas despesas do dia"
```

**Exemplo com JavaScript:**
```javascript
const formData = new FormData();
formData.append('file', audioFile);
formData.append('message', 'Minhas despesas do dia');

const response = await fetch('https://zap.hlg.gastocerto.com.br/webchat/upload/audio', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwtToken}`,
    'x-account': accountId,
  },
  body: formData,
});
```

**Processamento:**
- ✅ **Usa o MESMO sistema de transcrição que WhatsApp e Telegram**
- O WebChat é apenas mais um provider - alterações afetam todos igualmente
- Resposta segue o mesmo formato estruturado do endpoint `/webchat/message`

**Limitações:**
- Tamanho máximo: 20MB
- Formatos aceitos: MP3, OGG, WAV, M4A
- Transcrição compartilhada com demais plataformas (status: em implementação)

---

## Respostas Estruturadas

A API retorna um JSON estruturado com informações para formatação no frontend:

### Resposta de Sucesso - Transação Registrada

```json
{
  "success": true,
  "messageType": "transaction",
  "message": "Transação registrada!\n\nValor: R$ 50,00\nCategoria: Supermercado\nData: 26/12/2025\n\nDeseja confirmar?",
  "data": {
    "amount": 50.00,
    "category": "Supermercado",
    "date": "2025-12-26"
  },
  "formatting": {
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
  "message": "Identifiquei uma transação:\n\nR$ 50,00\nSupermercado\n\nEsta informação está correta?\nResponda: SIM ou NÃO",
  "data": {
    "requiresConfirmation": true,
    "confirmationId": "conf-12345",
    "amount": 50.00,
    "category": "Supermercado"
  },
  "formatting": {
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
  "message": "Encontrei múltiplas possibilidades para 'mercado':\n\n1 Supermercado (alimentação)\n2 Farmácia (saúde)\n3 Mercado Municipal (outros)\n\nQual você quis dizer? Responda com o número.",
  "data": {
    "learningOptions": [
      { "id": 1, "text": "Supermercado", "category": "Alimentação" },
      { "id": 2, "text": "Farmácia", "category": "Saúde" },
      { "id": 3, "text": "Mercado Municipal", "category": "Outros" }
    ]
  },
  "formatting": {
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
  "message": "Não consegui identificar uma transação válida. Tente algo como: 'Gastei R$ 50,00 no supermercado'",
  "formatting": {
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
Sistema: Transação registrada! [transaction]
```

### 2. Confirmação Necessária
```
Usuário: "Paguei conta"
      ↓
Sistema: Quanto foi? [confirmation]
      ↓
Usuário: "150 reais"
      ↓
Sistema: Transação registrada! [transaction]
```

### 3. Aprendizado RAG
```
Usuário: "Comprei no mercado"
      ↓
Sistema: Qual mercado? [learning]
      ↓
Usuário: "1" (Supermercado)
      ↓
Sistema: Aprendi! Processando... [transaction]
```

## Formatação no Frontend

Use os dados retornados para criar uma UI rica:

### 1. Processar Markdown na mensagem

As mensagens podem conter formatação Markdown simples:
- `*texto*` = **negrito**
- `_texto_` = _itálico_
- `\n` = quebra de linha

```jsx
// Função para processar markdown simples
function parseMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')  // **negrito**
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')      // *negrito*
    .replace(/_(.*?)_/g, '<em>$1</em>');               // _itálico_
}

// Uso com dangerouslySetInnerHTML (sanitize antes em produção!)
<div 
  className="text" 
  style={{ whiteSpace: 'pre-line' }}
  dangerouslySetInnerHTML={{ __html: parseMarkdown(msg.text) }}
/>

// OU use uma biblioteca como react-markdown
import ReactMarkdown from 'react-markdown';

<div className="text" style={{ whiteSpace: 'pre-line' }}>
  <ReactMarkdown>{msg.text}</ReactMarkdown>
</div>
```

### 2. Aplicar cor baseada em `formatting.color`
```jsx
<div className={`alert alert-${response.formatting.color}`}>
  {response.message}
</div>
```

**Cores sugeridas:**
```css
.alert-success { background-color: #d4edda; color: #155724; }
.alert-warning { background-color: #fff3cd; color: #856404; }
.alert-info { background-color: #d1ecf1; color: #0c5460; }
.alert-error { background-color: #f8d7da; color: #721c24; }
```

**CSS para preservar quebras de linha:**
```css
.message .text {
  white-space: pre-line; /* Preserva quebras de linha \n */
}

/* Ou use pre-wrap para preservar também espaços múltiplos */
.message .text {
  white-space: pre-wrap;
}
```

### 3. Destacar palavras-chave em `formatting.highlight`
```jsx
// Destaca valores monetários e outras palavras-chave
let formattedMessage = response.message;
response.formatting.highlight?.forEach(word => {
  formattedMessage = formattedMessage.replace(
    new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    `<mark>${word}</mark>`
  );
});
```

**CSS para destaque:**
```css
mark {
  background-color: #fff3cd;
  padding: 2px 4px;
  border-radius: 3px;
}
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
        {option.id} {option.text}
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

// Função para processar markdown simples
function parseMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g, '<em>$1</em>');
}

function WebChat({ 
  jwtToken, 
  accountId 
}: { 
  jwtToken: string; 
  accountId?: string;
}) {
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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
      };
      
      // Adicionar header x-account se fornecido
      if (accountId) {
        headers['x-account'] = accountId;
      }

      const response = await fetch('https://zap.hlg.gastocerto.com.br/webchat/message', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: text }),
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
        text: 'Erro ao processar mensagem',
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
            <div 
              className={`text alert-${msg.formatting?.color || 'info'}`}
              style={{ whiteSpace: 'pre-line' }}
              dangerouslySetInnerHTML={{ 
                __html: parseMarkdown(msg.text) 
              }}
            />
            
            {/* Renderizar opções de aprendizado */}
            {msg.data?.learningOptions && (
              <div className="options">
                {msg.data.learningOptions.map(opt => (
                  <button key={opt.id} onClick={() => sendMessage(opt.id.toString())}>
                    {opt.id} {opt.text}
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
          {loading ? 'Enviando...' : 'Enviar'}
        </button>
      </div>
    </div>
  );
}

export default WebChat;
```

**CSS sugerido:**
```css
.chat-container {
  max-width: 600px;
  margin: 0 auto;
}

.messages {
  max-height: 500px;
  overflow-y: auto;
  padding: 20px;
}

.message {
  margin-bottom: 15px;
}

.message.user {
  text-align: right;
}

.message .text {
  display: inline-block;
  padding: 10px 15px;
  border-radius: 8px;
  max-width: 80%;
  white-space: pre-line;
}

.message.user .text {
  background-color: #007bff;
  color: white;
}

.message.system .text {
  background-color: #f1f1f1;
  color: #333;
}

/* Cores baseadas em formatting.color */
.alert-success {
  background-color: #d4edda;
  color: #155724;
  border-left: 4px solid #28a745;
}

.alert-warning {
  background-color: #fff3cd;
  color: #856404;
  border-left: 4px solid #ffc107;
}

.alert-info {
  background-color: #d1ecf1;
  color: #0c5460;
  border-left: 4px solid #17a2b8;
}

.alert-error {
  background-color: #f8d7da;
  color: #721c24;
  border-left: 4px solid #dc3545;
}

/* Formatação markdown */
.text strong {
  font-weight: 600;
}

.text em {
  font-style: italic;
  opacity: 0.8;
}

/* Destaque de valores */
mark {
  background-color: #fff3cd;
  padding: 2px 4px;
  border-radius: 3px;
  font-weight: 500;
}

.learning-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.learning-options button {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  text-align: left;
}

.learning-options button:hover {
  background-color: #f8f9fa;
}

.input-container {
  display: flex;
  gap: 10px;
  padding: 20px;
  border-top: 1px solid #ddd;
}

.input-container input {
  flex: 1;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.input-container button {
  padding: 10px 20px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.input-container button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

## Exemplos de Mensagens Válidas

O sistema aceita mensagens em linguagem natural:

- ✅ "Gastei 50 reais no supermercado"
- ✅ "Paguei 150 de conta de luz"
- ✅ "Almoço de 35 reais"
- ✅ "Comprei remédio por 80"
- ✅ "Uber 25 reais"
- ✅ "50 no mercado"
- ✅ "meus cartões" (lista cartões de crédito)
- ✅ "faturas do cartão" (lista faturas)
- ✅ "saldo" (consulta saldo)

## Exemplo: Mensagem com Formatação Markdown

Algumas respostas, como listagem de cartões, vêm com formatação Markdown:

```json
{
  "success": true,
  "messageType": "transaction",
  "message": "*Seus Cartões de Crédito*\n\n *Total:* 2 cartão(ões)\n\n───────────────────\n\n1. *[XP] Casa*\n Sicredi\n Limite: R$ R$ 7.000,00\n Disponível: R$ R$ 7.000,00\n Fechamento: dia 1\n Vencimento: dia 10\n\n2. *[C6] Casa*\n Sicredi\n Limite: R$ R$ 20.000,00\n Disponível: R$ R$ 3.665,45\n Fechamento: dia 30\n Vencimento: dia 5\n\n _Para ver as faturas, digite: \"faturas do cartão\"_\n _Para definir cartão padrão, digite: \"usar cartão [nome]\"_",
  "data": {
    "amount": 7000
  },
  "formatting": {
    "color": "success",
    "highlight": ["R$ 7.000,00", "R$ 20.000,00", "R$ 3.665,45"]
  }
}
```

**O que o frontend deve fazer:**

1. **Processar Markdown:**
   - `*Texto*` → `<strong>Texto</strong>` (negrito)
   - `_Texto_` → `<em>Texto</em>` (itálico)

2. **Preservar quebras de linha:**
   - Use `white-space: pre-line` no CSS
   - Os `\n` serão renderizados como quebras de linha

3. **Aplicar cor:**
   - `formatting.color: "success"` → fundo verde claro

4. **Destacar valores:**
   - `formatting.highlight` contém os valores monetários para destacar

**Resultado visual esperado:**

```
───────────────────────────────
| **Seus Cartões de Crédito** |
|                               |
| **Total:** 2 cartão(ões)      |
|                               |
| ─────────────────────────     |
|                               |
| 1. **[XP] Casa**              |
|    Sicredi                    |
|    Limite: R$ 7.000,00        | ← Destacado
|    Disponível: R$ 7.000,00    | ← Destacado
|    Fechamento: dia 1          |
|    Vencimento: dia 10         |
|                               |
| 2. **[C6] Casa**              |
|    Sicredi                    |
|    Limite: R$ 20.000,00       | ← Destacado
|    Disponível: R$ 3.665,45    | ← Destacado
|    Fechamento: dia 30         |
|    Vencimento: dia 5          |
|                               |
| _Para ver as faturas..._      |
───────────────────────────────
```

## Observações Importantes

1. **Autenticação**: Requer token JWT válido do usuário
2. **Criação Automática**: Se o usuário não existir no sistema de mensagens, será criado automaticamente usando os dados da API do GastoCerto
3. **Sem Onboarding**: Diferente do WhatsApp/Telegram, não é necessário completar onboarding - o registro é feito automaticamente
4. **Contexto**: O sistema mantém contexto de conversação (aprendizado, confirmações)
5. **Plataforma**: Internamente usa identificador único `webchat-{userId}` para compatibilidade
6. **Rate Limiting**: O mesmo rate limiting do WhatsApp se aplica
7. **Quebras de Linha**: As mensagens preservam `\n` para quebras de linha - use `white-space: pre-line` ou `pre-wrap` no CSS para renderizar corretamente

## Status de Implementação

### ✅ Funcionalidades Completas

- ✅ **Mensagens de texto** - Processamento idêntico ao WhatsApp/Telegram
- ✅ **Autenticação JWT** - Integrada com API GastoCerto
- ✅ **Upload de imagens** - Estrutura pronta, usa mesmo OCR das outras plataformas
- ✅ **Upload de áudio** - Estrutura pronta, usa mesma transcrição das outras plataformas
- ✅ **Multi-conta** - Suporte a header `x-account`
- ✅ **Sistema RAG** - Aprendizado compartilhado entre plataformas
- ✅ **Sem emojis** - Interface limpa específica para web

### 🚧 Em Desenvolvimento (Afeta Todas as Plataformas)

- 🚧 **OCR de Notas Fiscais** - Quando implementado, funcionará em WhatsApp, Telegram e WebChat
- 🚧 **Transcrição de Áudio** - Quando implementado, funcionará em WhatsApp, Telegram e WebChat
- 🚧 **Armazenamento Permanente de Arquivos** - Sistema de storage em nuvem compartilhado

### 📋 Melhorias Futuras

- [ ] Histórico de conversas por sessão
- [ ] Sugestões automáticas baseadas em histórico
- [ ] Análise de sentimento para mensagens
- [ ] Integração com notificações push
- [ ] Modo offline com sincronização
  
- [ ] **Suporte a envio de áudios** (mensagens de voz)
  - Endpoint: `POST /webchat/upload/audio`
  - Transcrição de áudio para texto
  - Processamento como mensagem de transação
  
- [ ] Histórico de conversas por sessão
- [ ] Sugestões automáticas baseadas em histórico
- [ ] Análise de sentimento para mensagens
- [ ] Integração com notificações push
- [ ] Modo offline com sincronização

### Limitação Atual

⚠️ **Importante**: No momento, o webchat aceita **apenas mensagens de texto**. Não é possível enviar:
- Fotos/imagens
- Áudios/mensagens de voz
- Arquivos/documentos
- Vídeos

Para funcionalidades de upload de arquivos, você precisará aguardar uma versão futura da API.

## Troubleshooting

### Erro: "Erro ao criar seu perfil"
**Causa**: Falha ao buscar dados do usuário na API do GastoCerto ou ao criar o registro local  
**Solução**: Verificar se o userId do JWT é válido e se o usuário existe na API do GastoCerto

### Erro: 401 Unauthorized
**Causa**: Token JWT inválido, expirado ou ausente  
**Solução**: Renovar o token JWT e enviar no header Authorization

### Erro: "Não consegui identificar uma transação"
**Causa**: A mensagem não tem formato reconhecível  
**Solução**: Usuário deve enviar mensagem com valor e categoria (ex: "50 reais no mercado")

### Resposta lenta
**Causa**: Processamento de IA pode levar alguns segundos  
**Solução**: Implementar loading state no frontend

## Suporte

Para dúvidas ou problemas, consulte a documentação completa ou entre em contato com a equipe de desenvolvimento.
