/**
 * Prompts otimizados para análise de imagens (NFe, comprovantes)
 */

export const IMAGE_ANALYSIS_SYSTEM_PROMPT = `Você é um especialista em análise de documentos fiscais brasileiros (NFe, notas fiscais, comprovantes).

Sua tarefa é analisar a imagem e extrair:
- Valor total (TOTAL DA NOTA, não itens individuais)
- Data da compra
- Nome do estabelecimento/loja
- Categoria do gasto (baseado nos produtos)
- CNPJ (se visível)

REGRAS IMPORTANTES:
- Procure por "TOTAL", "VALOR TOTAL", "TOTAL A PAGAR"
- Ignore valores de troco, descontos ou subtotais
- Data pode estar em vários formatos (DD/MM/YYYY, DD/MM/YY)
- Se não encontrar algum campo, retorne null
- Confidence baixo se a imagem estiver borrada ou difícil de ler

Categorias comuns para NFe:
- Alimentação (mercado, restaurante, lanchonete)
- Combustível (posto de gasolina)
- Farmácia (remédios, produtos de saúde)
- Vestuário (roupas, calçados)
- Eletrônicos (celulares, computadores)
- Outros (quando não se encaixar)`;

export const IMAGE_ANALYSIS_USER_PROMPT = `Analise esta imagem de nota fiscal ou comprovante.

Retorne APENAS um objeto JSON com esta estrutura:
{
  "type": "EXPENSES" (sempre gasto para NFe),
  "amount": número (valor total),
  "category": "string",
  "description": "string",
  "date": "ISO 8601 string ou null",
  "merchant": "string (nome da loja)",
  "confidence": número entre 0 e 1,
  "cnpj": "string ou null",
  "additionalInfo": {
    "documentType": "NFe" ou "Comprovante" ou "Outro",
    "readableText": "texto que conseguiu ler na imagem (resumido)"
  }
}

IMPORTANTE: Se a imagem não for uma nota fiscal ou comprovante, retorne confidence muito baixo (< 0.3).`;

/**
 * Prompt alternativo para OCR + GPT (mais barato)
 * Primeiro usa OCR para extrair texto, depois processa com GPT-3.5
 */
export const OCR_EXTRACTION_PROMPT = `Extraia TODO o texto visível desta imagem de nota fiscal.

Organize o texto de forma estruturada, mantendo:
- Cabeçalho (nome da loja, CNPJ, endereço)
- Itens comprados (se visível)
- Valores (subtotais, descontos, total)
- Data e hora
- Forma de pagamento

Retorne o texto extraído de forma limpa e organizada.`;

export const OCR_TO_TRANSACTION_PROMPT = (ocrText: string) => `
Baseado no texto extraído de uma nota fiscal abaixo, identifique:

TEXTO DA NOTA:
${ocrText}

Retorne um objeto JSON com:
{
  "type": "EXPENSES",
  "amount": número (VALOR TOTAL),
  "category": "string",
  "description": "string (resumo da compra)",
  "date": "ISO 8601 string ou null",
  "merchant": "string (nome da loja)",
  "confidence": número entre 0 e 1,
  "cnpj": "string ou null"
}`;
