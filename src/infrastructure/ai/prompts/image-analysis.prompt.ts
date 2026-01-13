/**
 * Prompts para análise de imagens fiscais
 *
 * Usado para extrair informações de NFe, notas fiscais e comprovantes
 * através de visão computacional (OCR + IA)
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
 * Primeiro extrai o texto com OCR, depois processa com LLM
 */
export const IMAGE_OCR_EXTRACTION_PROMPT = `Extraia o texto desta imagem de nota fiscal.
Foque em encontrar:
1. Valor total (TOTAL, TOTAL A PAGAR)
2. Data (DD/MM/YYYY)
3. Nome da loja/estabelecimento
4. CNPJ (se visível)
5. Lista de produtos (se legível)

Retorne o texto extraído de forma organizada.`;
