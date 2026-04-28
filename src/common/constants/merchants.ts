/**
 * Base de comerciantes brasileiros conhecidos (merchants).
 *
 * Mapeamento de termos comuns (nomes de lojas, redes, marcas) para
 * categorias e subcategorias padrão. Usado em primeira tentativa de
 * categorização ANTES de RAG/IA — economia de tokens.
 *
 * Estrutura:
 *   - keywords: variações de escrita (lowercase, sem acento)
 *   - category: categoria padrão da transação
 *   - subCategory: subcategoria (opcional)
 *   - type: 'EXPENSES' | 'INCOME'
 *
 * Estende-se via QW8 (Merchant Learning) coletando merchants reais dos usuários.
 */

export interface MerchantEntry {
  keywords: string[];
  category: string;
  subCategory?: string;
  type: 'EXPENSES' | 'INCOME';
}

export const MERCHANTS: MerchantEntry[] = [
  // === SUPERMERCADOS / MERCADOS ===
  {
    keywords: [
      'carrefour',
      'pao de acucar',
      'pao acucar',
      'extra',
      'big bompreco',
      'bompreco',
      'sams club',
      'sams',
      'atacadao',
      'assai',
      'makro',
      'walmart',
      'mundial',
      'guanabara',
      'prezunic',
      'dia%',
      'supermercado dia',
      'mercadinho',
      'mercado dia',
      'hortifruti',
      'hortifrutti',
      'sendas',
      'tenda atacado',
      'tenda',
      'spani',
    ],
    category: 'Alimentação',
    subCategory: 'Supermercado',
    type: 'EXPENSES',
  },

  // === RESTAURANTES / FAST FOOD / DELIVERY ===
  {
    keywords: ['ifood', 'i food', 'rappi', 'uber eats', 'ubereats', '99food', 'james delivery'],
    category: 'Alimentação',
    subCategory: 'Delivery',
    type: 'EXPENSES',
  },
  {
    keywords: [
      'mc donalds',
      'mcdonalds',
      'mc donald',
      'bk',
      'burger king',
      'subway',
      'kfc',
      'habibs',
      'habib',
      'giraffas',
      'bobs',
      'pizza hut',
      'dominos',
      'starbucks',
      'china in box',
      'spoleto',
      'outback',
      'madero',
      'coco bambu',
      'casa bauducco',
      'cacau show',
      'kopenhagen',
      'brasil cacau',
    ],
    category: 'Alimentação',
    subCategory: 'Restaurante',
    type: 'EXPENSES',
  },

  // === PADARIAS / CAFETERIAS ===
  {
    keywords: ['padaria', 'panificadora', 'cafeteria', 'cafe brasil', 'casa do pao'],
    category: 'Alimentação',
    subCategory: 'Padaria',
    type: 'EXPENSES',
  },

  // === COMBUSTÍVEL / POSTOS ===
  {
    keywords: [
      'posto shell',
      'shell',
      'posto ipiranga',
      'ipiranga',
      'posto br',
      'petrobras br',
      'posto ale',
      'ale combustiveis',
      'gasolina',
      'etanol',
      'diesel',
      'combustivel',
    ],
    category: 'Transporte',
    subCategory: 'Combustível',
    type: 'EXPENSES',
  },

  // === TRANSPORTE / APPS ===
  {
    keywords: [
      'uber',
      'uber trip',
      '99',
      '99app',
      '99 pop',
      '99pop',
      'cabify',
      'indrive',
      'lady driver',
    ],
    category: 'Transporte',
    subCategory: 'Uber/99',
    type: 'EXPENSES',
  },
  {
    keywords: [
      'metro sp',
      'metro rio',
      'cptm',
      'supervia',
      'bilhete unico',
      'bilhete único',
      'cartao top',
      'riocard',
      'vlt',
    ],
    category: 'Transporte',
    subCategory: 'Transporte Público',
    type: 'EXPENSES',
  },
  {
    keywords: ['estapar', 'multipark', 'estacionamento', 'zona azul'],
    category: 'Transporte',
    subCategory: 'Estacionamento',
    type: 'EXPENSES',
  },

  // === STREAMING / ASSINATURAS DIGITAIS ===
  {
    keywords: ['netflix', 'netflix com'],
    category: 'Lazer',
    subCategory: 'Streaming',
    type: 'EXPENSES',
  },
  {
    keywords: ['spotify', 'spotify premium'],
    category: 'Lazer',
    subCategory: 'Streaming',
    type: 'EXPENSES',
  },
  {
    keywords: [
      'amazon prime',
      'prime video',
      'disney plus',
      'disney+',
      'star plus',
      'star+',
      'hbo max',
      'max stream',
      'globoplay',
      'globo play',
      'apple tv',
      'apple music',
      'youtube premium',
      'paramount plus',
      'paramount+',
      'deezer',
      'tidal',
    ],
    category: 'Lazer',
    subCategory: 'Streaming',
    type: 'EXPENSES',
  },

  // === COMPRAS ONLINE / E-COMMERCE ===
  {
    keywords: [
      'amazon',
      'amazon br',
      'amazon com br',
      'mercado livre',
      'mercadolivre',
      'mercado pago',
      'shopee',
      'shopee br',
      'aliexpress',
      'shein',
      'magazine luiza',
      'magalu',
      'americanas',
      'submarino',
      'casas bahia',
      'ponto frio',
      'kabum',
      'pichau',
      'dell',
      'apple br',
      'apple store',
    ],
    category: 'Compras',
    subCategory: 'Online',
    type: 'EXPENSES',
  },

  // === FARMÁCIAS / SAÚDE ===
  {
    keywords: [
      'drogasil',
      'droga raia',
      'drogaraia',
      'pacheco',
      'panvel',
      'drogarias pacheco',
      'pague menos',
      'extrafarma',
      'farmacia',
      'drogaria',
      'sao joao',
      'farmacia sao joao',
    ],
    category: 'Saúde',
    subCategory: 'Farmácia',
    type: 'EXPENSES',
  },
  {
    keywords: [
      'amil',
      'unimed',
      'bradesco saude',
      'sulamerica saude',
      'hapvida',
      'notredame',
      'notre dame intermedica',
      'gndi',
      'porto saude',
    ],
    category: 'Saúde',
    subCategory: 'Plano de Saúde',
    type: 'EXPENSES',
  },

  // === EDUCAÇÃO ===
  {
    keywords: [
      'udemy',
      'alura',
      'rocketseat',
      'coursera',
      'edx',
      'kultivi',
      'duolingo',
      'cambly',
      'rosetta stone',
    ],
    category: 'Educação',
    subCategory: 'Cursos Online',
    type: 'EXPENSES',
  },

  // === CONTAS / SERVIÇOS PÚBLICOS ===
  {
    keywords: [
      'enel',
      'cpfl',
      'eletropaulo',
      'light',
      'cemig',
      'celesc',
      'coelba',
      'cosern',
      'celpe',
      'energia eletrica',
      'conta de luz',
    ],
    category: 'Casa',
    subCategory: 'Energia Elétrica',
    type: 'EXPENSES',
  },
  {
    keywords: [
      'sabesp',
      'cedae',
      'caesb',
      'copasa',
      'sanepar',
      'embasa',
      'corsan',
      'agua e esgoto',
      'conta de agua',
    ],
    category: 'Casa',
    subCategory: 'Água',
    type: 'EXPENSES',
  },
  {
    keywords: [
      'comgas',
      'naturgy',
      'gas natural',
      'gas encanado',
      'ultragaz',
      'liquigas',
      'copagaz',
      'nacional gas',
      'botijao',
    ],
    category: 'Casa',
    subCategory: 'Gás',
    type: 'EXPENSES',
  },
  {
    keywords: ['vivo', 'tim', 'claro', 'oi fixo', 'oi celular', 'algar', 'nextel'],
    category: 'Casa',
    subCategory: 'Telefone/Internet',
    type: 'EXPENSES',
  },
  {
    keywords: [
      'net combo',
      'net claro',
      'sky',
      'directv',
      'fibra',
      'oi fibra',
      'vivo fibra',
      'claro net',
    ],
    category: 'Casa',
    subCategory: 'Internet/TV',
    type: 'EXPENSES',
  },

  // === BANCOS / TARIFAS ===
  {
    keywords: [
      'tarifa bancaria',
      'anuidade cartao',
      'iof',
      'tarifa de saque',
      'tarifa ted',
      'tarifa doc',
    ],
    category: 'Finanças',
    subCategory: 'Tarifas Bancárias',
    type: 'EXPENSES',
  },

  // === ACADEMIA / FITNESS ===
  {
    keywords: [
      'smart fit',
      'smartfit',
      'bio ritmo',
      'bioritmo',
      'bluefit',
      'selfit',
      'just fit',
      'pratique fitness',
      'gympass',
      'totalpass',
      'wellhub',
      'academia',
    ],
    category: 'Saúde',
    subCategory: 'Academia',
    type: 'EXPENSES',
  },

  // === PETSHOP ===
  {
    keywords: ['petz', 'cobasi', 'petshop', 'pet shop', 'mundo animal'],
    category: 'Pets',
    subCategory: 'Pet Shop',
    type: 'EXPENSES',
  },

  // === LOJAS / DEPARTAMENTO / MODA ===
  {
    keywords: [
      'renner',
      'c&a',
      'cea',
      'riachuelo',
      'marisa',
      'centauro',
      'nike br',
      'nike store',
      'adidas',
      'havaianas',
      'zara',
      'leroy merlin',
      'leroy',
      'tok stok',
      'tok&stok',
      'mobly',
      'madeira madeira',
      'madeiramadeira',
      'home center',
    ],
    category: 'Compras',
    subCategory: 'Vestuário/Casa',
    type: 'EXPENSES',
  },

  // === CINEMA / LAZER ===
  {
    keywords: ['cinemark', 'kinoplex', 'cinepolis', 'cinesystem', 'ingresso com', 'ingresso.com'],
    category: 'Lazer',
    subCategory: 'Cinema',
    type: 'EXPENSES',
  },

  // === VIAGEM ===
  {
    keywords: [
      'airbnb',
      'booking',
      'booking com',
      'decolar',
      'cvc',
      'hoteis com',
      'hoteis.com',
      'hurb',
      'latam',
      'gol linhas',
      'azul linhas',
      'avianca',
    ],
    category: 'Viagem',
    subCategory: 'Passagens/Hospedagem',
    type: 'EXPENSES',
  },

  // === RECEITAS COMUNS ===
  {
    keywords: ['salario', 'pagamento salario', 'folha de pagamento', 'holerite'],
    category: 'Salário',
    type: 'INCOME',
  },
  {
    keywords: ['pix recebido', 'transferencia recebida', 'ted recebida', 'doc recebido'],
    category: 'Receitas',
    subCategory: 'Transferência',
    type: 'INCOME',
  },
  {
    keywords: ['rendimento', 'rendimentos', 'juros poupanca', 'juros poupança'],
    category: 'Investimentos',
    subCategory: 'Rendimentos',
    type: 'INCOME',
  },
  {
    keywords: ['cashback', 'cash back'],
    category: 'Receitas',
    subCategory: 'Cashback',
    type: 'INCOME',
  },
];

/**
 * Normaliza texto para matching: lowercase, sem acento, sem pontuação extra.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MerchantMatch {
  entry: MerchantEntry;
  matchedKeyword: string;
  score: number; // 0-1, baseado em comprimento da keyword vs texto
}

/**
 * Procura no texto por menções a merchants conhecidos.
 * Retorna o melhor match (maior score) ou null.
 *
 * Score = comprimento da keyword / comprimento do texto normalizado
 * (favorece matches mais específicos sobre genéricos).
 */
export function findMerchant(text: string): MerchantMatch | null {
  if (!text) return null;
  const normalized = normalize(text);
  if (!normalized) return null;

  let best: MerchantMatch | null = null;

  for (const entry of MERCHANTS) {
    for (const kw of entry.keywords) {
      const normalizedKw = normalize(kw);
      if (!normalizedKw) continue;

      // Match por palavra inteira (boundary)
      const pattern = new RegExp(`(^|\\s)${escapeRegex(normalizedKw)}(\\s|$)`);
      if (pattern.test(normalized)) {
        const score = Math.min(1, normalizedKw.length / Math.max(normalized.length, 1)) + 0.3;
        if (!best || score > best.score) {
          best = { entry, matchedKeyword: kw, score };
        }
      }
    }
  }

  return best;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
