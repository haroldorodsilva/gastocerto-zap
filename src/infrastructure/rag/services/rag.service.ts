import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { PrismaService } from '@core/database/prisma.service';
import { CategoryMatch, RAGConfig, UserCategory } from './rag.interface';
import { FILTER_WORDS_FOR_TERM_DETECTION } from '@common/constants/nlp-keywords.constants';

/**
 * RAGService - Retrieval-Augmented Generation
 *
 * Implementação BM25 para matching semântico de categorias SEM embeddings vetoriais.
 *
 * FEATURES:
 * - Tokenização e normalização de texto (lowercase, remove acentos)
 * - Matching fuzzy com sinônimos
 * - Scoring BM25: term frequency (TF) + inverse document frequency (IDF)
 * - Cache de categorias por usuário (Redis ou Map)
 * - Sem dependências externas (OpenAI, pgvector, etc)
 * - ✨ Log de tentativas no banco para analytics
 *
 * CACHE:
 * - Se RAG_CACHE_REDIS=true (default): usa Redis (persistente, compartilhado)
 * - Se RAG_CACHE_REDIS=false: usa Map (em memória, não persistente)
 *
 * EXEMPLOS:
 * - "rotativo" → "Cartão Rotativo" (score: 0.95)
 * - "almoço" → "Alimentação > Restaurantes" (score: 0.75)
 * - "gasolina" → "Transporte > Combustível" (score: 0.88)
 */
@Injectable()
export class RAGService {
  private readonly logger = new Logger(RAGService.name);
  private readonly useRedisCache: boolean;
  private readonly cacheTTL: number = 86400; // 24 horas

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {
    this.useRedisCache = this.configService.get<boolean>('RAG_CACHE_REDIS', true);
    this.logger.log(
      `🧠 RAGService inicializado | Cache: ${this.useRedisCache ? 'Redis (✅ Persistente)' : 'Map (⚠️ Temporário)'}`,
    );
  }

  // Cache de categorias por usuário (Map como fallback)
  // Chave: userId (gastoCertoId do UserCache)
  private readonly categoryCache = new Map<string, UserCategory[]>();

  // Dicionário de sinônimos para melhorar matching
  // Expandido baseado em categorias reais do sistema
  private readonly synonyms = new Map<string, string[]>([
    // Cartão e Finanças
    ['cartao', ['credito', 'debito', 'fatura', 'anuidade', 'parcelamento']],
    ['credito', ['cartao', 'debito', 'fatura']],
    ['debito', ['cartao', 'credito', 'fatura']],
    ['fatura', ['cartao', 'credito', 'debito', 'pagamento']],
    ['anuidade', ['cartao', 'credito', 'debito']],
    ['rotativo', ['cartao', 'credito', 'fatura']],
    ['emprestimo', ['credito', 'financiamento', 'divida']],
    ['financiamento', ['emprestimo', 'credito', 'divida']],
    ['divida', ['emprestimo', 'financiamento', 'credito']],

    // Alimentação
    ['almoco', ['almoço', 'comida', 'refeicao', 'alimento']],
    ['jantar', ['janta', 'comida', 'refeicao']],
    ['supermercado', ['mercado', 'compras', 'alimentacao', 'feira', 'hortifruti']],
    ['mercado', ['supermercado', 'compras', 'alimentacao', 'feira']],
    ['compras', ['supermercado', 'mercado', 'alimentacao', 'mes', 'mês']],
    [
      'feira',
      ['supermercado', 'mercado', 'compras', 'alimentacao', 'hortifruti', 'verduras', 'frutas'],
    ],
    ['hortifruti', ['feira', 'frutas', 'verduras', 'legumes', 'fruta', 'verdura']],
    ['frutas', ['hortifruti', 'feira', 'fruta', 'banana', 'melancia', 'maca']],
    ['fruta', ['hortifruti', 'feira', 'frutas', 'banana', 'melancia', 'maca']],
    ['melancia', ['hortifruti', 'frutas', 'fruta', 'feira']],
    ['verduras', ['hortifruti', 'feira', 'verdura', 'legumes', 'salada']],
    ['verdura', ['hortifruti', 'feira', 'verduras', 'legumes', 'salada']],
    ['padaria', ['pao', 'pães', 'cafe']],
    ['pao', ['pães', 'padaria', 'paes']],
    ['restaurante', ['comida', 'refeicao', 'jantar', 'bar', 'restaurantes']],
    ['restaurantes', ['comida', 'refeicao', 'jantar', 'bar', 'restaurante']],
    ['lanche', ['lanches', 'salgado', 'coxinha', 'pastel', 'sanduiche']],
    ['lanches', ['lanche', 'salgado', 'coxinha', 'pastel', 'sanduiche']],
    ['marmita', ['marmitex', 'quentinha', 'comida', 'marmitas', 'pedi']],
    ['marmitex', ['marmita', 'quentinha', 'comida']],
    ['pedi', ['pedido', 'pedir', 'marmita', 'delivery']],
    ['sorvete', ['sorveteria', 'gelado', 'picole', 'picolé', 'acai', 'açai', 'tomei']],
    ['sorveteria', ['sorvete', 'gelado', 'picole', 'picolé', 'acai', 'tomei']],
    ['tomei', ['sorvete', 'sorveteria', 'gelado', 'tomar']],
    ['agua', ['água', 'bebida', 'liquido', 'líquido']],
    ['salgado', ['lanche', 'lanches', 'coxinha', 'pastel', 'esfirra']],
    ['ifood', ['delivery', 'entrega', 'comida', 'pedido', 'rappi']],
    ['delivery', ['entrega', 'pedido', 'ifood', 'rappi']],
    ['comida', ['alimentacao', 'alimentação', 'refeicao', 'refeição', 'restaurante', 'viagem']],

    // Investimentos e Financeiros
    ['financiamento', ['financiamentos', 'parcela', 'prestacao', 'emprestimo', 'credito']],
    ['financiamentos', ['financiamento', 'parcela', 'prestacao', 'emprestimo', 'credito']],
    ['emprestimo', ['empréstimo', 'financiamento', 'financiamentos', 'credito', 'parcela']],
    ['consorcio', ['consórcio', 'lance', 'contemplacao', 'cota']],
    ['aplicacao', ['aplicação', 'investimento', 'investir', 'render', 'cdb']],
    ['investimento', ['investir', 'aplicacao', 'aplicação', 'investimentos', 'reserva']],
    ['reserva', ['investimento', 'aplicacao', 'aplicação', 'guardar', 'poupanca']],
    ['caixinha', ['poupanca', 'poupança', 'guardar', 'reserva']],
    ['aluguel', ['aluguel-recebido', 'locacao', 'locação', 'recebi', 'renda', 'imovel']],
    ['recebi', ['recebido', 'renda', 'receber', 'aluguel', 'entrada']],

    // Taxas e Documentos
    ['ipva', ['imposto', 'carro', 'veiculo', 'veículo', 'licenciamento']],
    ['licenciamento', ['documento', 'carro', 'veiculo', 'veículo', 'detran']],
    ['documentacao', ['documentação', 'documento', 'documentos', 'papel', 'detran', 'carro']],
    ['cartorio', ['cartório', 'documento', 'reconhecer', 'firma', 'autenticar']],
    ['imposto', ['renda', 'ir', 'tributo', 'taxa']],
    ['juros', ['multa', 'atraso', 'mora', 'juros']],
    ['tarifa', ['bancaria', 'bancária', 'banco', 'taxa']],
    ['taxa', ['taxas', 'cobranca', 'cobrança', 'tarifa', 'tributo']],

    // Casa
    [
      'moveis',
      ['móveis', 'cadeira', 'mesa', 'armario', 'armário', 'sofa', 'sofá', 'estante', 'cadeiras'],
    ],
    ['móveis', ['moveis', 'cadeira', 'mesa', 'armario', 'sofa', 'estante', 'cadeiras', 'mobilia']],
    ['cadeira', ['moveis', 'móveis', 'mobilia', 'mobília', 'cadeiras', 'assento']],
    ['cadeiras', ['cadeira', 'moveis', 'móveis', 'mobilia']],
    ['mesa', ['moveis', 'móveis', 'mobilia', 'mobília']],
    ['armario', ['armário', 'moveis', 'móveis', 'mobilia']],
    ['reforma', ['reformar', 'construcao', 'construção', 'material', 'obra']],
    ['material', ['reforma', 'construcao', 'obra', 'tijolo', 'cimento']],
    ['utensilios', ['utensílios', 'cozinha', 'panela', 'prato', 'talher', 'faca']],
    ['cozinha', ['utensilios', 'utensílios', 'panela', 'talher']],
    ['panela', ['utensilios', 'cozinha', 'talher']],
    ['toalha', ['toalhas', 'cama', 'banho', 'lencol', 'lençol', 'roupa-cama']],
    ['toalhas', ['toalha', 'cama', 'banho', 'lencol', 'lençol', 'lençois', 'roupa-cama']],
    ['lencol', ['lençol', 'toalha', 'toalhas', 'cama', 'banho', 'edredom', 'lençois']],
    ['lençol', ['lencol', 'toalha', 'toalhas', 'cama', 'banho', 'lençois']],
    ['lençois', ['lençóis', 'lencol', 'lençol', 'toalhas', 'cama', 'banho']],
    ['cama', ['banho', 'toalhas', 'lençois', 'lençol', 'quarto']],
    ['banho', ['cama', 'toalhas', 'banheiro', 'lençol']],
    ['chave', ['fenda', 'ferramenta', 'ferramentas', 'chaves', 'chave-fenda']],
    ['fenda', ['chave', 'ferramenta', 'ferramentas', 'parafuso', 'chave-fenda']],
    ['chave-fenda', ['chave', 'fenda', 'ferramenta', 'ferramentas']],
    ['tecnico', ['técnico', 'manutencao', 'manutenção', 'conserto', 'consertar']],
    ['consertar', ['conserto', 'manutencao', 'manutenção', 'tecnico', 'técnico']],

    // Transporte
    ['gasolina', ['combustivel', 'posto', 'abastecimento', 'gas', 'alcool']],
    [
      'combustivel',
      ['combustível', 'gasolina', 'posto', 'abastecimento', 'gas', 'alcool', 'diesel'],
    ],
    ['posto', ['combustivel', 'gasolina', 'abastecimento']],
    ['abasteci', ['combustivel', 'gasolina', 'posto', 'abastecimento', 'abastecer']],
    ['abastecer', ['combustivel', 'gasolina', 'posto', 'abastecimento', 'abasteci']],
    ['uber', ['taxi', 'transporte', '99', 'corrida', 'app', 'mobilidade']],
    ['taxi', ['táxi', 'uber', '99', 'transporte', 'corrida']],
    ['corrida', ['uber', 'taxi', '99', 'transporte']],
    ['onibus', ['ônibus', 'transporte', 'passagem', 'coletivo']],
    ['pedagio', ['pedágio', 'estrada', 'rodovia']],
    ['estacionamento', ['parking', 'vaga', 'zona azul']],
    ['lavagem', ['lava-jato', 'lavar', 'lavou', 'carro', 'lavacao']],
    ['lava', ['lava-jato', 'lavagem', 'lavou', 'carro']],
    ['lavou', ['lava-jato', 'lavagem', 'lavar', 'carro']],
    ['lavei', ['lava', 'lavagem', 'lavar', 'lava-jato', 'carro']],
    ['jato', ['lava-jato', 'lavagem', 'lavar', 'carro']],
    ['oficina', ['manutencao', 'manutenção', 'carro', 'mecanico', 'mecânico', 'conserto', 'levei']],
    ['mecanico', ['mecânico', 'oficina', 'carro', 'manutencao', 'conserto']],
    ['mecânico', ['mecanico', 'oficina', 'carro', 'manutencao']],
    ['levei', ['oficina', 'manutencao', 'manutenção', 'carro', 'conserto', 'mecanico']],
    ['carro', ['veiculo', 'veículo', 'automovel', 'automóvel']],
    ['multa', ['multas', 'infração', 'transito', 'trânsito']],

    // Educação
    ['escolar', ['escola', 'educacao', 'educação', 'taxa', 'material', 'taxas']],
    ['escola', ['escolar', 'educacao', 'educação', 'ensino', 'particular', 'taxa']],
    ['taxa', ['taxas', 'escolar', 'escola', 'cobranca', 'cobrança', 'educacao', 'educação']],
    ['taxas', ['taxa', 'escolar', 'escola', 'cobranca', 'educacao']],
    ['livro', ['livros', 'leitura', 'literatura', 'educacao']],
    ['caderno', ['cadernos', 'material', 'escolar', 'escola']],

    // Eletrônicos
    ['eletronico', ['eletrônico', 'eletronicos', 'eletrônicos', 'item', 'aparelho']],
    ['cabo', ['cabos', 'fio', 'carregador', 'acessorio', 'acessório', 'capinha']],
    ['capinha', ['capa', 'case', 'protecao', 'proteção', 'acessorio', 'acessório', 'cabo']],
    ['acessorio', ['acessório', 'cabo', 'capinha', 'fone', 'carregador']],
    ['acessório', ['acessorio', 'cabo', 'capinha', 'fone', 'carregador']],
    ['cafeteira', ['cafe', 'café', 'eletrodomestico', 'eletrodoméstico']],
    ['pilha', ['pilhas', 'bateria', 'baterias', 'suprimento', 'suprimentos']],
    ['pilhas', ['pilha', 'bateria', 'baterias', 'suprimento', 'suprimentos']],
    ['bateria', ['baterias', 'pilha', 'pilhas', 'suprimento']],
    ['baterias', ['bateria', 'pilha', 'pilhas', 'suprimento']],
    ['suprimento', ['suprimentos', 'pilha', 'pilhas', 'bateria']],
    ['suprimentos', ['suprimento', 'pilha', 'pilhas', 'bateria']],

    // Investimentos
    ['consorcio', ['consórcio', 'cota', 'lance', 'parcela', 'contemplacao']],
    ['aplicacao', ['aplicação', 'aplicar', 'investir', 'investimento', 'render']],
    ['transferi', ['transferir', 'transferencia', 'transferência', 'reserva', 'investimento']],

    // Pessoal
    ['crianca', ['criança', 'crianças', 'criancas', 'filho', 'filhos', 'infantil']],
    ['filho', ['filhos', 'crianca', 'criança', 'infantil']],
    ['brinquedo', ['brinquedos', 'crianca', 'criança', 'infantil', 'criancas']],
    ['brinquedos', ['brinquedo', 'crianca', 'criança', 'infantil']],
    ['unha', ['unhas', 'manicure', 'esmalte', 'pedicure', 'fiz']],
    ['unhas', ['unha', 'manicure', 'esmalte', 'pedicure', 'fiz']],
    ['manicure', ['unha', 'unhas', 'esmalte', 'pedicure', 'fiz']],
    ['fiz', ['unhas', 'manicure', 'unha', 'esmalte', 'fiz-as']],
    ['cinto', ['cintos', 'acessorio', 'acessório', 'roupa', 'vestuario', 'vestuário']],
    ['cintos', ['cinto', 'acessorio', 'roupa', 'vestuario']],
    ['tenis', ['tênis', 'sapato', 'calcado', 'calçado', 'roupa', 'vestuario', 'calçados']],
    ['tênis', ['tenis', 'sapato', 'calcado', 'calçado', 'roupa', 'vestuario', 'calçados']],
    ['sapato', ['sapatos', 'calcado', 'calçado', 'tenis', 'tênis', 'calçados']],
    ['calcado', ['calçado', 'sapato', 'tenis', 'tênis', 'sapatos', 'calçados']],
    ['calçado', ['calcado', 'sapato', 'tenis', 'tênis', 'calçados']],
    ['calçados', ['calçado', 'calcado', 'sapato', 'tenis', 'tênis', 'vestuario']],

    // Recreação
    ['cinema', ['filme', 'filmes', 'ingresso', 'sessao', 'sessão']],
    ['filme', ['cinema', 'filmes', 'ingresso', 'sessao']],
    ['ingresso', ['ingressos', 'entrada', 'ticket', 'cinema', 'show', 'evento']],
    ['ingressos', ['ingresso', 'entrada', 'ticket', 'cinema', 'show']],
    ['parque', ['parques', 'entrada', 'lazer', 'diversao', 'diversão']],
    ['lazer', ['diversao', 'diversão', 'entretenimento', 'passeio', 'recreacao']],
    ['diversao', ['diversão', 'lazer', 'entretenimento', 'passeio']],
    ['festa', ['festas', 'comemoração', 'comemoracao', 'evento', 'aniversario']],
    ['jogo', ['jogos', 'game', 'games', 'video-game', 'videogame']],
    ['passeio', ['passeios', 'lazer', 'diversao', 'diversão', 'saida', 'sai', 'saiu', 'recreacao']],
    ['sai', ['saiu', 'saida', 'passeio', 'saindo', 'sair']],
    ['saiu', ['sai', 'saida', 'passeio', 'saindo']],
    ['saida', ['sai', 'saiu', 'passeio', 'recreacao']],

    // Saúde
    ['farmacia', ['remedio', 'medicamento', 'drogaria', 'saude', 'medicação', 'farmácia']],
    ['farmácia', ['farmacia', 'remedio', 'medicamento', 'drogaria']],
    ['remedio', ['remédio', 'medicamento', 'farmacia', 'drogaria', 'saude', 'viagem']],
    ['remédio', ['remedio', 'medicamento', 'farmacia', 'viagem']],
    ['medicamento', ['remedio', 'remédio', 'farmacia', 'drogaria', 'saude']],
    ['medico', ['médico', 'consulta', 'doutor', 'saude']],
    ['consulta', ['consultas', 'medico', 'médico', 'doutor', 'clinica', 'saude']],
    ['consultas', ['consulta', 'medico', 'médico', 'doutor', 'clinica', 'saude']],
    ['medica', ['médica', 'medico', 'médico', 'consulta']],
    ['dentista', ['odontologia', 'dente', 'clinica', 'odonto']],
    ['exame', ['exames', 'laboratorio', 'laboratório', 'clinica', 'saude', 'analise']],
    ['exames', ['exame', 'laboratorio', 'laboratório', 'clinica', 'saude', 'analise']],
    ['fisioterapia', ['fisio', 'fisioterapeuta', 'reabilitacao']],
    ['plano', ['saude', 'saúde', 'plano-saude', 'convenio', 'funerario', 'funerário']],
    ['saude', ['saúde', 'plano', 'convenio', 'medico']],
    ['funerario', ['funerário', 'plano', 'funeral', 'cemiterio']],
    ['funerário', ['funerario', 'plano', 'funeral', 'cemiterio']],
    ['seguro', ['vida', 'seguro-vida', 'proteção', 'carro', 'automovel']],
    ['whey', ['suplemento', 'suplementos', 'suplementacao', 'suplementação', 'proteina']],
    ['vitamina', ['vitaminas', 'suplemento', 'suplementacao', 'suplementação']],
    ['suplementacao', ['suplementação', 'suplemento', 'suplementos', 'whey', 'vitamina']],
    ['terapia', ['terapeuta', 'psicologo', 'psicólogo', 'psicologia']],
    ['oculos', ['óculos', 'otica', 'ótica', 'lente', 'lentes', 'armacao', 'armação', 'grau']],
    ['óculos', ['oculos', 'otica', 'ótica', 'lente', 'lentes', 'armacao', 'grau']],
    ['otica', ['ótica', 'oculos', 'óculos', 'lente', 'lentes', 'grau']],
    ['ótica', ['otica', 'oculos', 'óculos', 'lente', 'lentes']],
    ['lente', ['lentes', 'oculos', 'óculos', 'otica', 'grau']],
    ['lentes', ['lente', 'oculos', 'óculos', 'otica', 'contato']],
    ['suplementacao', ['suplementação', 'suplemento', 'suplementos', 'whey', 'vitamina']],
    ['terapia', ['terapeuta', 'psicologo', 'psicólogo', 'psicologia']],
    ['oculos', ['óculos', 'otica', 'ótica', 'lente', 'armacao']],
    ['óculos', ['oculos', 'otica', 'ótica', 'lente', 'armacao']],
    ['otica', ['ótica', 'oculos', 'óculos', 'lente']],

    // Casa
    ['aluguel', ['moradia', 'casa', 'apartamento', 'imovel', 'locacao']],
    ['agua', ['água', 'conta', 'saneamento', 'abastecimento', 'copasa', 'sabesp']],
    ['luz', ['energia', 'eletricidade', 'conta', 'cemig']],
    ['gas', ['gás', 'botijao', 'botijão', 'cozinha']],
    ['internet', ['wifi', 'banda larga', 'provedor', 'net', 'vivo']],
    ['condominio', ['condomínio', 'taxa', 'sindico']],
    ['mobilia', ['móveis', 'movel', 'estante', 'sofa']],
    ['moveis', ['móveis', 'mobilia', 'cadeira', 'mesa', 'estante', 'sofa']],
    ['móveis', ['moveis', 'mobilia', 'cadeira', 'mesa', 'estante', 'sofa']],
    ['cadeira', ['moveis', 'móveis', 'mobilia', 'cadeiras']],
    ['cadeiras', ['cadeira', 'moveis', 'móveis', 'mobilia']],
    ['eletrodomestico', ['eletrodomésticos', 'geladeira', 'fogao', 'microondas']],
    ['toalha', ['toalhas', 'cama', 'banho', 'roupa-cama', 'lencol', 'lençol']],
    ['toalhas', ['toalha', 'cama', 'banho', 'roupa-cama', 'lencol', 'lençol', 'lençois']],
    ['lencol', ['lençol', 'lencois', 'lençois', 'cama', 'toalhas', 'banho']],
    ['lençol', ['lencol', 'lencois', 'lençois', 'cama', 'toalhas', 'banho']],
    ['lençois', ['lençóis', 'lencol', 'lençol', 'cama', 'toalhas']],
    ['lençóis', ['lençois', 'lencol', 'lençol', 'cama', 'toalhas']],
    ['chave', ['ferramenta', 'ferramentas', 'chave-fenda', 'parafuso']],
    ['fenda', ['chave-fenda', 'ferramenta', 'ferramentas']],
    ['tecnico', ['técnico', 'manutencao', 'manutenção', 'conserto', 'reparo']],
    ['consertar', ['conserto', 'manutencao', 'manutenção', 'reparo', 'arrumar']],
    ['reforma', ['reformas', 'obra', 'construcao', 'construção', 'pedreiro', 'material']],
    ['material', ['reforma', 'obra', 'construcao', 'pedreiro', 'caderno', 'escolar']],
    ['utensilios', ['utensílios', 'cozinha', 'panela', 'prato', 'talher', 'cozinhar']],
    ['utensílios', ['utensilios', 'cozinha', 'panela', 'prato', 'talher', 'cozinhar']],
    ['cozinha', ['utensilios', 'utensílios', 'panela', 'cozinhar']],

    // Eletrônicos
    ['cabo', ['acessorio', 'acessórios', 'carregador', 'usb']],
    ['capinha', ['case', 'capa', 'acessorio', 'acessórios', 'celular']],
    ['cafeteira', ['eletrodomestico', 'eletrodomésticos', 'cafe']],
    ['pilha', ['pilhas', 'bateria', 'baterias', 'suprimento', 'suprimentos']],
    ['pilhas', ['pilha', 'bateria', 'baterias', 'suprimento', 'suprimentos']],
    ['eletronico', ['eletrônico', 'eletronicos', 'eletrônicos', 'aparelho']],

    // Serviços
    ['netflix', ['streaming', 'assinatura', 'filme', 'serie', 'prime']],
    ['spotify', ['musica', 'streaming', 'assinatura']],
    ['academia', ['gym', 'ginastica', 'treino', 'musculacao', 'fitness']],
    ['celular', ['telefone', 'recarga', 'conta', 'tim', 'claro', 'vivo']],
    ['lavanderia', ['lavar', 'roupa', 'lavagem', 'lavanderia']],
    ['ar-condicionado', ['refrigeracao', 'refrigeração', 'ar', 'clima']],
    ['assistencia', ['assistência', 'tecnico', 'técnico', 'tecnica', 'técnica', 'suporte']],
    [
      'arrumar',
      ['arrumo', 'conserto', 'consertar', 'reparo', 'reparar', 'manutencao', 'manutenção'],
    ],

    // Educação
    ['escola', ['educacao', 'educação', 'ensino', 'colegio', 'aula', 'particular']],
    ['escolar', ['escola', 'educacao', 'educação', 'material', 'taxa']],
    ['curso', ['cursos', 'educacao', 'aula', 'treinamento', 'online']],
    ['livro', ['livros', 'leitura', 'literatura', 'apostila']],
    ['caderno', ['cadernos', 'material', 'escolar', 'escola']],
    ['material', ['material escolar', 'escolar', 'caderno', 'caneta', 'lapis']],

    // Lazer e Recreação
    ['cinema', ['filme', 'sessao', 'ingresso', 'entertainment']],
    ['filme', ['cinema', 'sessao', 'netflix']],
    ['brinquedo', ['brinquedos', 'toy', 'crianca', 'criancas']],
    ['brinquedos', ['brinquedo', 'toy', 'crianca', 'criancas']],
    ['ingresso', ['ingressos', 'entrada', 'ticket', 'bilhete']],
    ['escolinha', ['esporte', 'atividade', 'aula', 'treino']],
    ['esportiva', ['esporte', 'atividade', 'escolinha']],
    ['passeio', ['lazer', 'passear', 'sair']],
    ['parque', ['diversao', 'diversão', 'passeio', 'lazer', 'entrada']],
    ['ontem', ['dia', 'anterior', 'passado']],
    ['anteontem', ['dia', 'anterior', 'passado', 'ontem']],
    ['semana', ['passada', 'anterior', 'ultima']],
    ['jogo', ['jogos', 'game', 'videogame', 'playstation', 'xbox']],
    ['festa', ['festas', 'comemoracao', 'comemoração', 'evento', 'aniversario', 'aniversário']],

    ['unha', ['unhas', 'manicure', 'esmalte', 'pedicure', 'fiz']],
    ['unhas', ['unha', 'manicure', 'esmalte', 'pedicure', 'fiz']],
    ['manicure', ['unha', 'unhas', 'esmalte', 'pedicure', 'fiz']],
    ['fiz', ['unhas', 'manicure', 'unha', 'esmalte']],
    ['cinto', ['cintos', 'acessorio', 'acessório', 'roupa', 'vestuario', 'vestuário']],
    ['cintos', ['cinto', 'acessorio', 'roupa', 'vestuario']],
    ['tenis', ['tênis', 'sapato', 'calcado', 'calçado', 'roupa', 'vestuario', 'calçados']],
    ['tênis', ['tenis', 'sapato', 'calcado', 'calçado', 'roupa', 'vestuario', 'calçados']],
    ['sapato', ['sapatos', 'calcado', 'calçado', 'tenis', 'tênis', 'calçados']],
    ['calcado', ['calçado', 'sapato', 'tenis', 'tênis', 'sapatos', 'calçados']],
    ['calçado', ['calcado', 'sapato', 'tenis', 'tênis', 'calçados']],
    ['calçados', ['calçado', 'calcado', 'sapato', 'tenis', 'tênis']],

    // Receitas/Income
    ['salario', ['salário', 'vencimento', 'pagamento', 'recebi', 'recebimento']],
    ['salário', ['salario', 'vencimento', 'pagamento', 'recebi']],
    ['recebimentos', ['recebi', 'recebimento', 'entrada', 'receita', 'income']],
    ['recebi', ['recebimento', 'recebimentos', 'entrada', 'salario', 'salário']],
    ['recebimento', ['recebi', 'recebimentos', 'entrada', 'receita']],
    ['aluguel', ['aluguel recebido', 'locacao', 'locação', 'renda']],
    ['reembolso', ['devolucao', 'devolução', 'estorno', 'reembolso recebido']],
    ['freelance', ['freela', 'extra', 'bico', 'trabalho extra', 'servico']],
    ['brinquedo', ['brinquedos', 'crianca', 'criancas', 'toy']],
    ['parque', ['diversao', 'passeio', 'lazer']],
    ['festa', ['festas', 'aniversario', 'comemoracao', 'celebracao']],

    // Vestuário
    ['roupa', ['roupas', 'vestuario', 'vestuário', 'blusa', 'calca']],
    ['roupas', ['roupa', 'vestuario', 'vestuário', 'blusa', 'calca']],
    ['cinto', ['acessorio', 'acessórios', 'vestuario']],
    ['tenis', ['tênis', 'calcado', 'calçado', 'calcados', 'sapato']],
    ['calcado', ['calçado', 'calcados', 'sapato', 'tenis', 'sandalia']],
    ['calçado', ['calcado', 'calcados', 'sapato', 'tenis', 'sandalia']],
    ['calcados', ['calçados', 'calcado', 'sapato', 'tenis', 'sandalia', 'sapatos']],
    ['calçados', ['calcados', 'calcado', 'sapato', 'tenis', 'sandalia', 'sapatos']],
    ['sapato', ['calcado', 'calcados', 'tenis', 'sandalia']],

    // Viagem
    ['viagem', ['viajem', 'viagens', 'trip', 'turismo', 'passeio', 'durante']],
    ['durante', ['viagem', 'na', 'no']],
    ['hotel', ['hospedagem', 'pousada', 'hostel', 'estadia']],
    ['passagem', ['passagens', 'bilhete', 'ticket', 'aviao', 'onibus']],
    ['estrada', ['viagem', 'combustivel', 'pedagio', 'pedágio', 'abasteci']],
    ['sapatos', ['calcado', 'calcados', 'tenis', 'sandalia', 'sapato']],
    ['tenis', ['tênis', 'calcado', 'sapato', 'nike', 'adidas']],

    // Pessoal
    ['cabelo', ['cabeleireiro', 'salao', 'salão', 'corte', 'barbeiro', 'barba']],
    ['corte', ['cortei', 'cabelo', 'cortar', 'barbeiro']],
    ['cortei', ['corte', 'cabelo', 'cortar', 'barbeiro', 'cabeleireiro']],
    ['unha', ['unhas', 'manicure', 'pedicure', 'esmalte']],
    ['unhas', ['unha', 'manicure', 'pedicure', 'esmalte']],
    ['manicure', ['unha', 'unhas', 'pedicure', 'esmalte']],
    ['crianca', ['criança', 'criancas', 'crianças', 'filho', 'filha']],
    ['criancas', ['crianças', 'crianca', 'criança', 'filho', 'filha']],
    ['crianças', ['criancas', 'crianca', 'filho', 'filha']],
    ['presente', ['presentes', 'gift', 'mimo', 'lembranca', 'ganhei', 'ganho']],
    ['presentes', ['presente', 'gift', 'mimo', 'lembranca', 'ganhei', 'ganho']],
    ['ganhei', ['presente', 'presentes', 'recebi', 'gift', 'pai', 'mae', 'amigo']],
    ['ganho', ['presente', 'presentes', 'recebi', 'gift', 'ganhei']],
    ['pai', ['presente', 'ganhei', 'recebi', 'familia', 'parente']],
    ['mae', ['mãe', 'presente', 'ganhei', 'recebi', 'familia', 'parente']],

    // Delivery e Apps
    ['ifood', ['delivery', 'entrega', 'comida', 'pedido', 'rappi']],
    ['rappi', ['delivery', 'entrega', 'comida', 'pedido', 'ifood']],
    ['delivery', ['entrega', 'ifood', 'rappi', 'pedido']],

    // INCOMES
    ['salario', ['salário', 'remuneração', 'pagamento', 'provento']],
    ['receber', ['entrada', 'deposito', 'recebimento', 'credito', 'caiu']],
    ['freela', ['freelance', 'servico', 'bico', 'trabalho extra', 'extra']],
    ['freelance', ['freela', 'servico', 'bico', 'trabalho extra', 'extra']],
    ['vale', ['beneficio', 'vr', 'vt', 'vale-alimentacao', 'vale-refeicao', 'benefícios']],
    ['alimentacao', ['vale-alimentacao', 'vale-refeicao', 'vr']], // Quando tem "alimentacao", buscar vale
    ['vale-alimentacao', ['vale', 'alimentacao', 'vr', 'beneficio', 'benefícios']],
    ['vale-refeicao', ['vale', 'refeicao', 'vr', 'beneficio', 'benefícios']],
    ['beneficio', ['vale', 'vr', 'vt', 'benefícios', 'beneficios']],
    ['benefícios', ['vale', 'vr', 'vt', 'beneficio', 'beneficios']],
    ['beneficios', ['vale', 'vr', 'vt', 'beneficio', 'benefícios']],
    ['receita', ['entrada', 'deposito', 'recebimento', 'credito']],
    ['recebimento', ['entrada', 'deposito', 'receita', 'credito']],
    ['devolvido', ['reembolso', 'estornado', 'retorno']],
    ['reembolso', ['devolvido', 'estornado', 'retorno']],
    ['servico', ['freelance', 'bico', 'trabalho avulso']],
  ]);

  private readonly defaultConfig: RAGConfig = {
    minScore: 0.25, // Reduzido de 0.6 para permitir matches parciais válidos (ex: "restaurante" em frases longas)
    maxResults: 3,
    boostExactMatch: 2.0,
    boostStartsWith: 1.5,
  };

  /**
   * Indexa categorias do usuário no cache (Redis ou Map)
   */
  async indexUserCategories(userId: string, categories: UserCategory[]): Promise<void> {
    this.logger.log(`📚 Indexando ${categories.length} categorias para usuário ${userId}`);

    if (this.useRedisCache) {
      // Salvar no Redis com TTL de 24h
      const cacheKey = `rag:categories:${userId}`;
      await this.cacheManager.set(cacheKey, JSON.stringify(categories), this.cacheTTL * 1000);
      this.logger.debug(`✅ Categorias salvas no Redis: ${cacheKey}`);
    } else {
      // Fallback: Map em memória
      this.categoryCache.set(userId, categories);
      this.logger.debug(`⚠️ Categorias salvas no Map (temporário)`);
    }
  }

  /**
   * Retorna categorias do cache (formato expandido usado pelo RAG)
   * Útil para resolver IDs de categoria/subcategoria após match do RAG
   */
  async getCachedCategories(userId: string): Promise<UserCategory[]> {
    if (this.useRedisCache) {
      const cacheKey = `rag:categories:${userId}`;
      const cached = await this.cacheManager.get<string>(cacheKey);
      if (cached) {
        const categories = JSON.parse(cached);
        this.logger.debug(`✅ Retornando ${categories.length} categorias do cache RAG`);
        return categories;
      }
    } else {
      const categories = this.categoryCache.get(userId) || [];
      this.logger.debug(`⚠️ Retornando ${categories.length} categorias do Map`);
      return categories;
    }

    return [];
  }

  /**
   * Busca categorias similares usando BM25 + Sinônimos Personalizados
   */
  async findSimilarCategories(
    text: string,
    userId: string,
    config: Partial<RAGConfig> & { skipLogging?: boolean } = {},
  ): Promise<CategoryMatch[]> {
    const startTime = Date.now();
    const { skipLogging, ...configRest } = config;
    const finalConfig = { ...this.defaultConfig, ...configRest };

    // Buscar categorias do cache (Redis ou Map)
    let categories: UserCategory[] = [];

    if (this.useRedisCache) {
      const cacheKey = `rag:categories:${userId}`;
      const cached = await this.cacheManager.get<string>(cacheKey);
      if (cached) {
        categories = JSON.parse(cached);
        this.logger.debug(`✅ Categorias carregadas do Redis: ${categories.length} itens`);
      }
    } else {
      categories = this.categoryCache.get(userId) || [];
      this.logger.debug(`⚠️ Categorias carregadas do Map: ${categories.length} itens`);
    }

    if (categories.length === 0) {
      this.logger.warn(`⚠️ Nenhuma categoria indexada para usuário ${userId}`);
      return [];
    }

    // 🆕 FILTRAR POR TIPO DE TRANSAÇÃO (INCOME ou EXPENSES)
    if (finalConfig.transactionType) {
      const beforeFilter = categories.length;
      categories = categories.filter((cat) => cat.type === finalConfig.transactionType);
      this.logger.log(
        `🔍 Filtrando por tipo ${finalConfig.transactionType}: ${beforeFilter} → ${categories.length} categorias`,
      );

      if (categories.length === 0) {
        this.logger.warn(
          `⚠️ Nenhuma categoria do tipo ${finalConfig.transactionType} encontrada para usuário ${userId}`,
        );
        return [];
      }
    }

    // Normalizar texto de busca
    const normalizedQuery = this.normalize(text);
    const queryTokens = this.tokenize(normalizedQuery);

    // 🆕 BUSCAR SINÔNIMOS PERSONALIZADOS DO USUÁRIO
    const userSynonyms = await this.getUserSynonyms(userId, normalizedQuery);

    if (userSynonyms.length > 0) {
      this.logger.log(
        `🎯 Encontrados ${userSynonyms.length} sinônimos personalizados para "${text}"`,
      );
    }

    this.logger.debug(`🔍 Buscando por: "${text}" → tokens: [${queryTokens.join(', ')}]`);

    // Calcular score para cada categoria
    const matches: CategoryMatch[] = [];

    for (const category of categories) {
      // Incluir nome da categoria e subcategoria no texto de busca
      const categoryText = `${category.name} ${category.subCategory?.name || ''}`;
      const normalizedCategory = this.normalize(categoryText);
      const categoryTokens = this.tokenize(normalizedCategory);

      // DEBUG: Log tokenização
      if (category.subCategory?.name) {
        this.logger.debug(
          `🔤 Tokenização "${category.name}" + "${category.subCategory.name}" → ` +
            `normalized: "${normalizedCategory}" → tokens: [${categoryTokens.join(', ')}]`,
        );
      }

      // Também tokenizar subcategoria separadamente para melhor matching
      const subCategoryTokens = category.subCategory?.name
        ? this.tokenize(this.normalize(category.subCategory.name))
        : [];

      // Calcular similaridade BM25
      let score = this.calculateBM25Score(queryTokens, categoryTokens);

      // 🔥 BOOST MÁXIMO: Se a subcategoria normalizada aparece EXATAMENTE na query
      if (category.subCategory?.name) {
        const normalizedSubCat = this.normalize(category.subCategory.name);
        const subCatOnlyTokens = this.tokenize(normalizedSubCat);

        // 🚨 CORREÇÃO: Verificar se tokens têm tamanho mínimo (>= 3 chars) para evitar matches espúrios
        // Exemplo: "Gás" normaliza para "gas" (3 chars OK), mas "cartão" contém "a" que não é suficiente
        const validSubCatTokens = subCatOnlyTokens.filter((t) => t.length >= 3);

        // Verificar se TODOS os tokens válidos da subcategoria aparecem na query
        const allTokensMatch =
          validSubCatTokens.length > 0 &&
          validSubCatTokens.every((sct) => queryTokens.includes(sct));

        // Match direto: subcategoria completa aparece como PALAVRA COMPLETA na query
        // Usa word boundaries para evitar matches parciais (ex: "gas" em "gastei")
        const subCatRegex = new RegExp(`\\b${normalizedSubCat}\\b`, 'i');
        const isDirectMatch = normalizedSubCat.length >= 3 && subCatRegex.test(normalizedQuery);

        if (isDirectMatch) {
          score += 10.0; // Boost GIGANTE para match direto de subcategoria
          this.logger.debug(
            `🔥 MATCH DIRETO SUBCATEGORIA: "${category.subCategory.name}" na query (boost +10.0)`,
          );
        } else if (allTokensMatch) {
          score += 8.0; // Boost alto se todos tokens válidos da subcategoria estão presentes
          this.logger.debug(
            `🔥 TOKENS SUBCATEGORIA PRESENTES: "${category.subCategory.name}" (boost +8.0)`,
          );
        }
      }

      // 🆕 BOOST PARA SINÔNIMOS PERSONALIZADOS (prioritário - maior confiança)
      // Para sinônimos GLOBAIS: match por NOME (categoryName/subCategoryName)
      // Para sinônimos de USUÁRIO: match por ID (mais preciso)
      const userSynonymMatch = userSynonyms.find((syn) => {
        if (syn.isGlobal) {
          // Sinônimo GLOBAL (userId null): match por NOME (normalizado)
          const synCatNorm = this.normalize(syn.categoryName);
          const catNorm = this.normalize(category.name);

          const categoryMatches = synCatNorm === catNorm;

          if (syn.subCategoryName && category.subCategory?.name) {
            const synSubCatNorm = this.normalize(syn.subCategoryName);
            const subCatNorm = this.normalize(category.subCategory.name);
            return categoryMatches && synSubCatNorm === subCatNorm;
          }

          return categoryMatches;
        } else {
          // Sinônimo de USUÁRIO: match por ID (mais preciso)
          return (
            syn.categoryId === category.id &&
            (!syn.subCategoryId || syn.subCategoryId === category.subCategory?.id)
          );
        }
      });

      if (userSynonymMatch) {
        // Boost diferenciado: subcategoria = 5.0x, categoria = 3.0x
        const isSubcategoryMatch = userSynonymMatch.subCategoryName && category.subCategory?.name;
        const baseBoost = isSubcategoryMatch ? 5.0 : 3.0;
        const userSynonymBoost = baseBoost * userSynonymMatch.confidence;

        score += userSynonymBoost;

        const synonymType = userSynonymMatch.isGlobal ? 'GLOBAL' : 'USER';
        const matchLevel = isSubcategoryMatch ? 'subcategoria' : 'categoria';

        this.logger.log(
          `🎯 MATCH SINÔNIMO ${synonymType} (${matchLevel}): "${userSynonymMatch.keyword}" → "${category.name}"${category.subCategory ? ' > ' + category.subCategory.name : ''} (boost +${userSynonymBoost.toFixed(2)})`,
        );
      }

      // Aplicar boosts padrão
      if (normalizedQuery === normalizedCategory) {
        score *= finalConfig.boostExactMatch;
        this.logger.debug(
          `✅ Match exato: "${category.name}" (boost ${finalConfig.boostExactMatch}x)`,
        );
      } else if (normalizedCategory.startsWith(normalizedQuery)) {
        score *= finalConfig.boostStartsWith;
        this.logger.debug(
          `✅ Começa com: "${category.name}" (boost ${finalConfig.boostStartsWith}x)`,
        );
      }

      // Verificar sinônimos com categoria
      const synonymScore = this.checkSynonyms(queryTokens, categoryTokens);

      // DEBUG: Log score inicial (depois de calcular synonymScore)
      if (score > 0 || synonymScore > 0) {
        this.logger.debug(
          `📊 Score BM25 para "${category.name}": ${score.toFixed(3)} | ` +
            `Sinônimos: ${synonymScore.toFixed(3)} | ` +
            `Tokens query: [${queryTokens.join(', ')}] | ` +
            `Tokens doc: [${categoryTokens.join(', ')}]`,
        );
      }

      if (synonymScore > 0) {
        score += synonymScore * 0.8; // Sinônimos valem 80% (aumentado de 50%)
        this.logger.debug(
          `🔄 Sinônimos encontrados na categoria: +${(synonymScore * 0.8).toFixed(2)}`,
        );
      }

      // Verificar sinônimos com subcategoria (se existir)
      if (subCategoryTokens.length > 0) {
        const subCategorySynonymScore = this.checkSynonyms(queryTokens, subCategoryTokens);
        if (subCategorySynonymScore > 0) {
          score += subCategorySynonymScore * 3.5; // Subcategoria vale MUITO mais (350%) para priorizar forte
          this.logger.debug(
            `🔄 Sinônimos encontrados na subcategoria "${category.subCategory?.name}": +${(subCategorySynonymScore * 3.5).toFixed(2)}`,
          );
        }

        // BOOST EXTRA: Se algum token da query é EXATAMENTE uma palavra da subcategoria
        const exactSubCatMatch = queryTokens.some((qt) => subCategoryTokens.includes(qt));
        if (exactSubCatMatch) {
          score += 2.5; // Boost adicional para match exato de palavra
          this.logger.debug(
            `✅ Match exato de palavra na subcategoria "${category.subCategory?.name}": +2.5`,
          );
        }
      }

      // NÃO normalizar mais - score pode ser > 1 para priorizar melhor match

      if (score >= finalConfig.minScore) {
        matches.push({
          categoryId: category.id,
          categoryName: category.name,
          subCategoryId: category.subCategory?.id,
          subCategoryName: category.subCategory?.name,
          score,
          matchedTerms: this.findMatchedTerms(queryTokens, categoryTokens),
        });
      }
    }

    // Ordenar por score (maior primeiro)
    matches.sort((a, b) => b.score - a.score);

    // Limitar resultados
    const results = matches.slice(0, finalConfig.maxResults);
    const responseTime = Date.now() - startTime;

    // 🔧 Normalizar scores para máximo de 1.0 (100%)
    // Se passou de 1.0 devido a boosts, limitar a 1.0
    results.forEach((match) => {
      if (match.score > 1.0) {
        this.logger.debug(
          `🔧 Score normalizado: ${match.categoryName} ${(match.score * 100).toFixed(1)}% → 100.0%`,
        );
        match.score = 1.0;
      }
    });

    this.logger.log(
      `✅ Encontradas ${results.length} categorias similares:` +
        results.map((m) => ` "${m.categoryName}" (${(m.score * 100).toFixed(1)}%)`).join(','),
    );

    // Registrar tentativa para analytics (banco de dados) - APENAS SE NÃO FOR skipLogging
    if (!skipLogging) {
      const success = results.length > 0 && results[0].score >= finalConfig.minScore;
      await this.recordSearchAttempt(
        userId,
        text,
        results,
        success,
        finalConfig.minScore,
        'BM25', // Por enquanto sempre BM25, depois terá AI
        responseTime,
      );
    }

    return results;
  }

  /**
   * Busca categorias similares usando embeddings de IA (busca vetorial)
   * Usa similaridade de cosseno entre embeddings
   */
  async findSimilarCategoriesWithEmbeddings(
    text: string,
    userId: string,
    aiProvider: any, // IAIProvider com método generateEmbedding
    config: Partial<RAGConfig> = {},
  ): Promise<CategoryMatch[]> {
    const startTime = Date.now();
    const finalConfig = { ...this.defaultConfig, ...config };

    try {
      // Buscar categorias do cache
      let categories: UserCategory[] = [];

      if (this.useRedisCache) {
        const cacheKey = `rag:categories:${userId}`;
        const cached = await this.cacheManager.get<string>(cacheKey);
        if (cached) {
          categories = JSON.parse(cached);
        }
      } else {
        categories = this.categoryCache.get(userId) || [];
      }

      if (categories.length === 0) {
        this.logger.warn(`⚠️ Nenhuma categoria indexada para usuário ${userId}`);
        return [];
      }

      // Gerar embedding da query
      this.logger.debug(`🔍 [AI] Gerando embedding para: "${text}"`);
      const queryEmbedding = await aiProvider.generateEmbedding(text);

      // Calcular similaridade com cada categoria
      const matches: CategoryMatch[] = [];

      for (const category of categories) {
        if (!category.embedding) {
          this.logger.debug(
            `⚠️ Categoria "${category.name}" sem embedding - pulando busca vetorial`,
          );
          continue;
        }

        // Similaridade de cosseno
        const score = this.cosineSimilarity(queryEmbedding, category.embedding);

        if (score >= finalConfig.minScore) {
          matches.push({
            categoryId: category.id,
            categoryName: category.name,
            subCategoryId: category.subCategory?.id,
            subCategoryName: category.subCategory?.name,
            score,
            matchedTerms: ['[embedding match]'], // Não há termos específicos em busca vetorial
          });
        }
      }

      // Ordenar por score
      matches.sort((a, b) => b.score - a.score);
      const results = matches.slice(0, finalConfig.maxResults);
      const responseTime = Date.now() - startTime;

      // 🔧 Normalizar scores para máximo de 1.0 (100%)
      results.forEach((match) => {
        if (match.score > 1.0) {
          this.logger.debug(
            `🔧 Score normalizado: ${match.categoryName} ${(match.score * 100).toFixed(1)}% → 100.0%`,
          );
          match.score = 1.0;
        }
      });

      this.logger.log(
        `✅ [AI] Encontradas ${results.length} categorias similares em ${responseTime}ms:` +
          results.map((m) => ` "${m.categoryName}" (${(m.score * 100).toFixed(1)}%)`).join(','),
      );

      // Registrar tentativa no banco
      const success = results.length > 0 && results[0].score >= finalConfig.minScore;
      await this.recordSearchAttempt(
        userId,
        text,
        results,
        success,
        finalConfig.minScore,
        'AI', // Modo AI (embeddings)
        responseTime,
      );

      return results;
    } catch (error) {
      this.logger.error('Erro na busca vetorial com IA:', error);
      // Fallback para BM25
      this.logger.warn('⚠️ Fallback para BM25...');
      return this.findSimilarCategories(text, userId, config);
    }
  }

  /**
   * Calcula similaridade de cosseno entre dois vetores
   * Retorna valor entre 0 e 1 (1 = idênticos)
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) {
      throw new Error(`Vetores com dimensões diferentes: ${vecA.length} vs ${vecB.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  /**
   * Limpa cache de categorias (útil para testes)
   */
  async clearCache(userId?: string): Promise<void> {
    if (this.useRedisCache) {
      if (userId) {
        const cacheKey = `rag:categories:${userId}`;
        await this.cacheManager.del(cacheKey);
        this.logger.debug(`🗑️ Cache Redis limpo para usuário ${userId}`);
      } else {
        // Limpar todos os caches RAG (buscar todas as chaves rag:*)
        this.logger.warn(
          `⚠️ Não há forma genérica de limpar todos caches Redis. Use admin endpoint.`,
        );
      }
    } else {
      if (userId) {
        this.categoryCache.delete(userId);
        this.logger.debug(`🗑️ Cache Map limpo para usuário ${userId}`);
      } else {
        this.categoryCache.clear();
        this.logger.debug(`🗑️ Todo cache Map limpo`);
      }
    }
  }

  /**
   * Registra tentativa de busca para analytics
   */
  private async recordSearchAttempt(
    userId: string,
    query: string,
    matches: CategoryMatch[],
    success: boolean,
    threshold: number,
    ragMode: string,
    responseTime: number,
    options?: {
      flowStep?: number;
      totalSteps?: number;
      aiProvider?: string;
      aiModel?: string;
      aiConfidence?: number;
      aiCategoryId?: string;
      aiCategoryName?: string;
      finalCategoryId?: string;
      finalCategoryName?: string;
      wasAiFallback?: boolean;
    },
  ): Promise<string | null> {
    try {
      // Se prisma não estiver disponível (ex: testes), retornar null
      if (!this.prisma) {
        this.logger.warn('⚠️ Prisma não disponível, pulando log RAG');
        return null;
      }

      const bestMatch = matches.length > 0 ? matches[0] : null;

      this.logger.log(
        `💾 Salvando RAG log: userId=${userId}, query="${query}", matches=${matches.length}, success=${success}`,
      );

      // Salvar no banco de dados com novos campos de tracking
      const log = await this.prisma.rAGSearchLog.create({
        data: {
          userId,
          query,
          queryNormalized: this.normalize(query),
          matches: matches as any,
          bestMatch: bestMatch?.categoryName || null,
          bestScore: bestMatch?.score || null,
          threshold,
          success,
          ragMode,
          responseTime,
          // 🆕 Novos campos de tracking
          flowStep: options?.flowStep || 1,
          totalSteps: options?.totalSteps || 1,
          aiProvider: options?.aiProvider,
          aiModel: options?.aiModel,
          aiConfidence: options?.aiConfidence,
          aiCategoryId: options?.aiCategoryId,
          aiCategoryName: options?.aiCategoryName,
          finalCategoryId: options?.finalCategoryId || bestMatch?.categoryId,
          finalCategoryName: options?.finalCategoryName || bestMatch?.categoryName,
          ragInitialScore: bestMatch?.score,
          ragFinalScore: options?.finalCategoryId ? bestMatch?.score : null,
          wasAiFallback: options?.wasAiFallback || false,
        },
      });

      this.logger.debug(
        `📊 RAG log salvo: userId=${userId}, query="${query}", success=${success}, ` +
          `step=${options?.flowStep || 1}/${options?.totalSteps || 1}, ` +
          `wasAiFallback=${options?.wasAiFallback || false}`,
      );

      return log?.id || null;
    } catch (error) {
      // Não lançar erro - logging não deve quebrar fluxo
      this.logger.error(`❌ Erro ao salvar log RAG (userId: ${userId}, query: "${query}"):`, error);
      this.logger.error(`Stack trace:`, error.stack);
      return null;
    }
  }

  /**
   * Retorna tentativas de busca para analytics
   * Útil para identificar queries que não deram match
   */
  async getSearchAttempts(
    userId?: string,
    failedOnly: boolean = false,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{
    logs: Array<{
      id: string;
      userId: string;
      query: string;
      queryNormalized: string;
      matches: any;
      bestMatch: string | null;
      bestScore: number | null;
      threshold: number;
      success: boolean;
      ragMode: string;
      responseTime: number;
      createdAt: Date;
    }>;
    total: number;
    limit: number;
    offset: number;
  }> {
    const where: any = {};

    if (userId) {
      where.userId = userId;
    }

    if (failedOnly) {
      where.success = false;
    }

    // Buscar total de registros
    const total = await this.prisma.rAGSearchLog.count({ where });

    // Buscar logs com paginação
    const logs = await this.prisma.rAGSearchLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        userId: true,
        query: true,
        queryNormalized: true,
        matches: true,
        bestMatch: true,
        bestScore: true,
        threshold: true,
        success: true,
        ragMode: true,
        responseTime: true,
        createdAt: true,
      },
    });

    return {
      logs: logs.map((log) => ({
        ...log,
        bestScore: log.bestScore ? Number(log.bestScore) : null,
        threshold: log.threshold ? Number(log.threshold) : 0,
      })),
      total,
      limit,
      offset,
    };
  }

  /**
   * Deleta logs de busca RAG por IDs
   */
  async deleteSearchLogs(ids: string[]): Promise<{ deletedCount: number }> {
    this.logger.log(`🗑️ [RAG] Deletando ${ids.length} logs...`);

    const result = await this.prisma.rAGSearchLog.deleteMany({
      where: {
        id: {
          in: ids,
        },
      },
    });

    this.logger.log(`✅ [RAG] Deletados ${result.count} logs do banco`);
    return { deletedCount: result.count };
  }

  /**
   * Normaliza texto: lowercase, remove acentos, trim
   */
  private normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .replace(/[^\w\s]/g, ' ') // Remove pontuação
      .trim();
  }

  /**
   * Tokeniza texto em palavras
   */
  private tokenize(text: string): string[] {
    const tokens = text.split(/\s+/).filter((token) => token.length > 2); // Ignora tokens muito curtos

    // Normalizar plurais simples para melhorar matching
    return tokens.map((token) => {
      // Remove plural simples: "financiamentos" → "financiamento"
      if (token.endsWith('s') && token.length > 4) {
        const singular = token.slice(0, -1);
        // Evitar remover 's' de palavras como "mas", "tras", "pais"
        if (!['ma', 'tra', 'pai', 'de', 've', 'me'].includes(singular)) {
          return singular;
        }
      }
      return token;
    });
  }

  /**
   * Calcula score BM25 simplificado
   *
   * BM25 = Σ(IDF * TF * boost)
   * - TF (Term Frequency): quantas vezes o termo aparece
   * - IDF (Inverse Document Frequency): raridade do termo
   * - boost: relevância baseada em posição/contexto
   *
   * MODIFICAÇÃO: Não divide por queryTokens.length para não penalizar frases longas
   * Score final varia de 0 a número de matches
   */
  private calculateBM25Score(queryTokens: string[], docTokens: string[]): number {
    let score = 0;
    const docLength = docTokens.length;
    const avgDocLength = 3; // Média de tokens em categorias (estimativa)
    const k1 = 1.2; // Parâmetro BM25
    const b = 0.75; // Parâmetro BM25

    for (const queryToken of queryTokens) {
      // Term Frequency (TF)
      const tf = docTokens.filter((t) => t === queryToken).length;

      if (tf > 0) {
        // IDF simplificado (assumindo corpus pequeno)
        const idf = 1.0;

        // BM25 formula
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));

        score += idf * (numerator / denominator);
      }
    }

    // NÃO dividir por queryTokens.length - permite frases longas terem score decente
    return score;
  }

  /**
   * Verifica se há sinônimos entre query e documento
   * Retorna número de matches de sinônimos (não normalizado)
   */
  private checkSynonyms(queryTokens: string[], docTokens: string[]): number {
    let synonymMatches = 0;

    for (const queryToken of queryTokens) {
      const synonyms = this.synonyms.get(queryToken) || [];

      for (const docToken of docTokens) {
        if (synonyms.includes(docToken)) {
          synonymMatches++;
        }

        // Verificar sinônimos reversos (docToken → queryToken)
        const reverseSynonyms = this.synonyms.get(docToken) || [];
        if (reverseSynonyms.includes(queryToken)) {
          synonymMatches++;
        }
      }
    }

    // NÃO dividir por queryTokens.length - permite frases longas terem score decente
    return synonymMatches;
  }

  /**
   * Encontra termos que deram match
   */
  private findMatchedTerms(queryTokens: string[], docTokens: string[]): string[] {
    const matched: string[] = [];

    for (const queryToken of queryTokens) {
      if (docTokens.includes(queryToken)) {
        matched.push(queryToken);
      }

      // Verificar sinônimos
      const synonyms = this.synonyms.get(queryToken) || [];
      for (const docToken of docTokens) {
        if (synonyms.includes(docToken)) {
          matched.push(`${queryToken}→${docToken}`);
        }
      }
    }

    return matched;
  }

  /**
   * 🆕 Busca sinônimos personalizados do usuário
   * Retorna lista de keywords que batem com a query normalizada
   */
  private async getUserSynonyms(
    userId: string,
    normalizedQuery: string,
  ): Promise<
    Array<{
      keyword: string;
      categoryId: string;
      categoryName: string;
      subCategoryId?: string;
      subCategoryName?: string;
      confidence: number;
      isGlobal?: boolean;
    }>
  > {
    try {
      // Se prisma não estiver disponível (ex: testes), retornar array vazio
      if (!this.prisma) {
        return [];
      }

      // Tokenizar query para buscar matches parciais
      const queryTokens = this.tokenize(normalizedQuery);

      // Buscar sinônimos do usuário E globais
      const synonyms = await this.prisma.userSynonym.findMany({
        where: {
          OR: [
            {
              // Sinônimos do usuário
              userId,
              OR: queryTokens.map((token) => ({
                keyword: {
                  contains: token,
                },
              })),
            },
            {
              // Sinônimos globais (aplicados a todos)
              userId: null,
              OR: queryTokens.map((token) => ({
                keyword: {
                  contains: token,
                },
              })),
            },
          ],
        },
        orderBy: [
          { userId: 'asc' }, // Prioriza usuário sobre GLOBAL
          { confidence: 'desc' }, // Depois por confiança
        ],
      });

      // Atualizar usageCount e lastUsedAt para os sinônimos encontrados
      if (synonyms.length > 0) {
        await this.prisma.userSynonym.updateMany({
          where: {
            id: {
              in: synonyms.map((s) => s.id),
            },
          },
          data: {
            usageCount: {
              increment: 1,
            },
            lastUsedAt: new Date(),
          },
        });

        this.logger.log(
          `📚 Encontrados ${synonyms.length} sinônimos (${synonyms.filter((s) => s.userId === userId).length} do usuário, ${synonyms.filter((s) => s.userId === null).length} globais)`,
        );
      }

      return synonyms.map((s) => ({
        keyword: s.keyword,
        categoryId: s.categoryId,
        categoryName: s.categoryName,
        subCategoryId: s.subCategoryId || undefined,
        subCategoryName: s.subCategoryName || undefined,
        confidence: s.confidence,
        isGlobal: s.userId === null,
      }));
    } catch (error) {
      this.logger.error('Erro ao buscar sinônimos personalizados:', error);
      return [];
    }
  }

  /**
   * 🆕 Adiciona novo sinônimo personalizado para o usuário
   */
  async addUserSynonym(params: {
    userId: string;
    keyword: string;
    categoryId: string;
    categoryName: string;
    subCategoryId?: string;
    subCategoryName?: string;
    confidence?: number;
    source?: 'USER_CONFIRMED' | 'AI_SUGGESTED' | 'AUTO_LEARNED' | 'IMPORTED' | 'ADMIN_APPROVED';
  }): Promise<void> {
    try {
      const normalizedKeyword = this.normalize(params.keyword);

      await this.prisma.userSynonym.upsert({
        where: {
          userId_keyword: {
            userId: params.userId,
            keyword: normalizedKeyword,
          },
        },
        create: {
          userId: params.userId,
          keyword: normalizedKeyword,
          categoryId: params.categoryId,
          categoryName: params.categoryName,
          subCategoryId: params.subCategoryId,
          subCategoryName: params.subCategoryName,
          confidence: params.confidence ?? 1.0,
          source: params.source ?? 'USER_CONFIRMED',
        },
        update: {
          categoryId: params.categoryId,
          categoryName: params.categoryName,
          subCategoryId: params.subCategoryId,
          subCategoryName: params.subCategoryName,
          confidence: params.confidence ?? 1.0,
          source: params.source ?? 'USER_CONFIRMED',
          updatedAt: new Date(),
        },
      });

      this.logger.log(
        `✅ Sinônimo adicionado: "${params.keyword}" → ${params.categoryName}${params.subCategoryName ? ' → ' + params.subCategoryName : ''}`,
      );
    } catch (error) {
      this.logger.error('Erro ao adicionar sinônimo personalizado:', error);
      throw error;
    }
  }

  /**
   * 🆕 Método público para registrar busca RAG com contexto completo
   * Usado por serviços externos (AIService, CategoryResolutionService)
   */
  async logSearchWithContext(params: {
    userId: string;
    query: string;
    matches: CategoryMatch[];
    success: boolean;
    threshold: number;
    ragMode: string;
    responseTime: number;
    flowStep?: number;
    totalSteps?: number;
    aiProvider?: string;
    aiModel?: string;
    aiConfidence?: number;
    aiCategoryId?: string;
    aiCategoryName?: string;
    finalCategoryId?: string;
    finalCategoryName?: string;
    wasAiFallback?: boolean;
  }): Promise<string | null> {
    return this.recordSearchAttempt(
      params.userId,
      params.query,
      params.matches,
      params.success,
      params.threshold,
      params.ragMode,
      params.responseTime,
      {
        flowStep: params.flowStep,
        totalSteps: params.totalSteps,
        aiProvider: params.aiProvider,
        aiModel: params.aiModel,
        aiConfidence: params.aiConfidence,
        aiCategoryId: params.aiCategoryId,
        aiCategoryName: params.aiCategoryName,
        finalCategoryId: params.finalCategoryId,
        finalCategoryName: params.finalCategoryName,
        wasAiFallback: params.wasAiFallback,
      },
    );
  }

  /**
   * 🆕 Lista todos sinônimos de um usuário
   */
  async listUserSynonyms(userId: string): Promise<
    Array<{
      id: string;
      keyword: string;
      categoryName: string;
      subCategoryName?: string;
      confidence: number;
      usageCount: number;
      source: string;
    }>
  > {
    const synonyms = await this.prisma.userSynonym.findMany({
      where: { userId },
      orderBy: [{ usageCount: 'desc' }, { confidence: 'desc' }],
    });

    return synonyms.map((s) => ({
      id: s.id,
      keyword: s.keyword,
      categoryName: s.categoryName,
      subCategoryName: s.subCategoryName || undefined,
      confidence: s.confidence,
      usageCount: s.usageCount,
      source: s.source,
    }));
  }

  /**
   * 🆕 Remove sinônimo personalizado
   */
  async removeUserSynonym(userId: string, keyword: string): Promise<void> {
    const normalizedKeyword = this.normalize(keyword);

    await this.prisma.userSynonym.delete({
      where: {
        userId_keyword: {
          userId,
          keyword: normalizedKeyword,
        },
      },
    });

    this.logger.log(`🗑️ Sinônimo removido: "${keyword}" para usuário ${userId}`);
  }

  /**
   * 🆕 Detecta termos desconhecidos e sugere melhor alternativa
   *
   * Quando usuário menciona termo que não tem subcategoria exata:
   * 1. Identifica a categoria correta (ex: "Alimentação")
   * 2. Busca subcategorias similares dentro dessa categoria
   * 3. Retorna sugestão para confirmação do usuário
   *
   * Exemplo: "gastei 40 com marmita"
   * - Detecta: "marmita" não é subcategoria conhecida
   * - Categoria: "Alimentação" (via sinônimos: marmita → comida)
   * - Sugestão: "Restaurante" (subcategoria mais similar em Alimentação)
   */
  async detectUnknownTerm(
    text: string,
    userId: string,
  ): Promise<{
    detectedTerm: string;
    isKnownSubcategory: boolean;
    suggestedCategory?: string;
    suggestedCategoryId?: string;
    suggestedSubcategory?: string;
    suggestedSubcategoryId?: string;
    confidence: number;
    reason: string;
  } | null> {
    try {
      this.logger.debug(`🔍 [detectUnknownTerm] Iniciando para userId=${userId}, text="${text}"`);

      // Buscar categorias do usuário
      const categories = await this.getCachedCategories(userId);
      if (categories.length === 0) {
        this.logger.warn(
          `⚠️ [detectUnknownTerm] Nenhuma categoria encontrada para userId=${userId}`,
        );
        return null;
      }

      this.logger.debug(
        `📦 [detectUnknownTerm] ${categories.length} categorias carregadas para análise`,
      );

      // Normalizar e tokenizar
      const normalized = this.normalize(text);
      const tokens = this.tokenize(normalized);

      this.logger.debug(`🔤 [detectUnknownTerm] Tokens extraídos: [${tokens.join(', ')}]`);

      // Buscar melhor match (sem salvar log - já foi salvo no fluxo principal)
      const matches = await this.findSimilarCategories(text, userId, {
        maxResults: 3,
        minScore: 0.25,
        skipLogging: true, // ⚠️ Evita log duplicado (já foi salvo no fluxo principal)
      });

      this.logger.debug(`🔍 [detectUnknownTerm] ${matches.length} matches encontrados`);

      if (matches.length === 0) {
        return null;
      }

      const bestMatch = matches[0];

      // 🔥 VERIFICAR SE É CATEGORIA GENÉRICA (Outros, Geral)
      const isGenericCategory =
        bestMatch.categoryName === 'Outros' || bestMatch.categoryName === 'Geral';
      const isGenericSubcategory =
        !bestMatch.subCategoryName ||
        bestMatch.subCategoryName === 'Outros' ||
        bestMatch.subCategoryName === 'Geral';

      // 🔥 VERIFICAR SE SCORE É BAIXO (< 0.65)
      const isLowConfidence = bestMatch.score < 0.65;

      // Verificar se o match é exato na subcategoria
      const hasExactSubcategoryMatch = tokens.some((token) => {
        if (!bestMatch.subCategoryName) return false;
        const normalizedSub = this.normalize(bestMatch.subCategoryName);
        return normalizedSub.includes(token) || token.includes(normalizedSub);
      });

      this.logger.debug(
        `🔍 [detectUnknownTerm] hasExactSubcategoryMatch=${hasExactSubcategoryMatch}`,
      );

      // Filtrar palavras temporais/verbos antes de extrair termo
      const filteredTokens = tokens.filter(
        (t) => !FILTER_WORDS_FOR_TERM_DETECTION.includes(t) && !/^\d+$/.test(t),
      );

      this.logger.debug(
        `🔍 [detectUnknownTerm] filteredTokens AFTER filter: [${filteredTokens.join(', ')}] (removed: ${tokens.filter((t) => FILTER_WORDS_FOR_TERM_DETECTION.includes(t)).join(', ')})`,
      );

      // Identificar termo principal da query (palavra mais relevante)
      const detectedTerm = this.extractMainTerm(filteredTokens, categories);

      this.logger.debug(
        `🔍 [detectUnknownTerm] detectedTerm="${detectedTerm}" (from filteredTokens: ${filteredTokens.join(', ')})`,
      );
      this.logger.debug(
        `🎯 [detectUnknownTerm] Análise de decisão: ` +
          `isGenericCategory=${isGenericCategory}, ` +
          `isGenericSubcategory=${isGenericSubcategory}, ` +
          `isLowConfidence=${isLowConfidence}, ` +
          `hasExactSubcategoryMatch=${hasExactSubcategoryMatch}, ` +
          `detectedTerm="${detectedTerm}"`,
      );

      // 🎯 DECIDIR SE PRECISA CONFIRMAÇÃO DE APRENDIZADO:
      // 1. Categoria/subcategoria genérica (Outros)
      // 2. Score baixo (< 0.65)
      // 3. Sem match exato de subcategoria
      const needsLearning =
        (isGenericCategory || isGenericSubcategory || isLowConfidence) &&
        !hasExactSubcategoryMatch &&
        detectedTerm;

      this.logger.log(
        `🎯 [detectUnknownTerm] DECISÃO: needsLearning=${needsLearning} | ` +
          `Match: "${bestMatch.categoryName} > ${bestMatch.subCategoryName || 'null'}" (score: ${(bestMatch.score * 100).toFixed(1)}%)`,
      );

      if (!needsLearning) {
        // Match bom o suficiente - não precisa sugestão
        this.logger.debug(`✅ [detectUnknownTerm] Match suficiente - não precisa aprendizado`);
        return {
          detectedTerm: detectedTerm || tokens[0],
          isKnownSubcategory: true,
          suggestedCategory: bestMatch.categoryName,
          suggestedCategoryId: bestMatch.categoryId,
          suggestedSubcategory: bestMatch.subCategoryName,
          suggestedSubcategoryId: bestMatch.subCategoryId,
          confidence: bestMatch.score,
          reason: 'Match exato encontrado',
        };
      }

      // 🎓 Termo desconhecido - sugerir melhor alternativa
      const reason =
        isGenericCategory || isGenericSubcategory
          ? `Categoria genérica detectada: "${bestMatch.categoryName} > ${bestMatch.subCategoryName || 'Outros'}"`
          : isLowConfidence
            ? `Score baixo (${(bestMatch.score * 100).toFixed(1)}%) para termo "${detectedTerm}"`
            : `Termo "${detectedTerm}" não encontrado como subcategoria`;

      this.logger.log(
        `🎓 [detectUnknownTerm] SUGERINDO APRENDIZADO: termo="${detectedTerm}", razão="${reason}"`,
      );

      return {
        detectedTerm,
        isKnownSubcategory: false,
        suggestedCategory: bestMatch.categoryName,
        suggestedCategoryId: bestMatch.categoryId,
        suggestedSubcategory: bestMatch.subCategoryName,
        suggestedSubcategoryId: bestMatch.subCategoryId,
        confidence: bestMatch.score,
        reason: `${reason}. Sugerindo "${bestMatch.subCategoryName || 'Outros'}" em "${bestMatch.categoryName}"`,
      };
    } catch (error) {
      this.logger.error('Erro ao detectar termo desconhecido:', error);
      return null;
    }
  }

  /**
   * Extrai o termo principal da query (palavra mais significativa)
   * Ignora stopwords e tokens muito genéricos
   */
  private extractMainTerm(tokens: string[], categories: UserCategory[]): string | null {
    // Stopwords comuns em português (expandir conforme necessário)
    const stopwords = new Set([
      'com',
      'para',
      'gastei',
      'paguei',
      'comprei',
      'fui',
      'uma',
      'uns',
      'umas',
      'na',
      'no',
      'da',
      'do',
      'em',
      'ao',
      'pelo',
      'pela',
      'reais',
      'real',
    ]);

    // 🔥 Palavras muito genéricas que devem ser ignoradas
    const genericWords = new Set([
      'outro',
      'outra',
      'outros',
      'outras',
      'coisa',
      'coisas',
      'negocio',
      'negócio',
      'item',
      'produto',
    ]);

    // Buscar tokens que não são stopwords nem genéricos
    const significantTokens = tokens.filter(
      (token) => !stopwords.has(token) && !genericWords.has(token),
    );

    if (significantTokens.length === 0) {
      return null;
    }

    // 🎯 NOVA LÓGICA: Dar prioridade a termos mais específicos
    // 1. Ordenar por tamanho (termos mais longos tendem a ser mais específicos)
    // 2. Filtrar termos que NÃO são subcategorias conhecidas
    const tokensWithScore = significantTokens.map((token) => {
      const isKnownSubcategory = categories.some((cat) => {
        if (!cat.subCategory?.name) return false;
        const normalizedSub = this.normalize(cat.subCategory.name);
        return normalizedSub.includes(token) || token.includes(normalizedSub);
      });

      return {
        token,
        length: token.length,
        isKnownSubcategory,
      };
    });

    // Priorizar termos DESCONHECIDOS e mais longos
    const unknownTokens = tokensWithScore.filter((t) => !t.isKnownSubcategory);

    if (unknownTokens.length > 0) {
      // Ordenar por tamanho (maior primeiro)
      unknownTokens.sort((a, b) => b.length - a.length);
      return unknownTokens[0].token;
    }

    // Se todos são conhecidos, retornar o mais longo
    tokensWithScore.sort((a, b) => b.length - a.length);
    return tokensWithScore[0].token;
  }

  /**
   * 🆕 Confirma sugestão e aprende para o futuro
   *
   * Quando usuário confirma que "marmita" → "Restaurante" está correto:
   * 1. Salva em UserSynonym com alta confiança
   * 2. Próximas vezes, "marmita" já vai direto para "Restaurante"
   *
   * @param userId ID do usuário
   * @param originalTerm Termo original mencionado ("marmita")
   * @param confirmedCategoryId ID da categoria confirmada
   * @param confirmedCategoryName Nome da categoria confirmada
   * @param confirmedSubcategoryId ID da subcategoria confirmada
   * @param confirmedSubcategoryName Nome da subcategoria confirmada
   * @param confidence Nível de confiança (0-1), default 0.9 para confirmações do usuário
   */
  async confirmAndLearn(params: {
    userId: string;
    originalTerm: string;
    confirmedCategoryId: string;
    confirmedCategoryName: string;
    confirmedSubcategoryId?: string;
    confirmedSubcategoryName?: string;
    confidence?: number;
  }): Promise<void> {
    await this.addUserSynonym({
      userId: params.userId,
      keyword: params.originalTerm,
      categoryId: params.confirmedCategoryId,
      categoryName: params.confirmedCategoryName,
      subCategoryId: params.confirmedSubcategoryId,
      subCategoryName: params.confirmedSubcategoryName,
      confidence: params.confidence ?? 0.9, // Alta confiança para confirmação manual
      source: 'USER_CONFIRMED',
    });

    this.logger.log(
      `✅ Aprendizado confirmado: "${params.originalTerm}" → ${params.confirmedCategoryName}${params.confirmedSubcategoryName ? ' → ' + params.confirmedSubcategoryName : ''} (confiança: ${params.confidence ?? 0.9})`,
    );
  }

  /**
   * 🆕 Rejeita sugestão e permite correção
   *
   * Quando usuário rejeita sugestão, pode fornecer a categoria/subcategoria correta
   * Sistema aprende com a correção
   */
  async rejectAndCorrect(params: {
    userId: string;
    originalTerm: string;
    rejectedCategoryId?: string;
    rejectedCategoryName?: string;
    correctCategoryId: string;
    correctCategoryName: string;
    correctSubcategoryId?: string;
    correctSubcategoryName?: string;
  }): Promise<void> {
    // ⚠️ NÃO salvar sinônimo se a categoria corrigida for genérica
    const isGenericCategory =
      params.correctCategoryName === 'Outros' || params.correctCategoryName === 'Geral';
    const isGenericSubcategory =
      !params.correctSubcategoryName ||
      params.correctSubcategoryName === 'Outros' ||
      params.correctSubcategoryName === 'Geral';

    if (isGenericCategory || isGenericSubcategory) {
      this.logger.log(
        `⚠️ Correção para categoria genérica - NÃO salvando sinônimo: "${params.originalTerm}" → ${params.correctCategoryName}`,
      );
      return;
    }

    // Salvar correção como sinônimo com alta confiança
    await this.addUserSynonym({
      userId: params.userId,
      keyword: params.originalTerm,
      categoryId: params.correctCategoryId,
      categoryName: params.correctCategoryName,
      subCategoryId: params.correctSubcategoryId,
      subCategoryName: params.correctSubcategoryName,
      confidence: 0.95, // Confiança muito alta para correção manual
      source: 'USER_CONFIRMED',
    });

    this.logger.log(
      `✅ Correção aprendida: "${params.originalTerm}" → ${params.correctCategoryName}${params.correctSubcategoryName ? ' → ' + params.correctSubcategoryName : ''} (rejeitou: ${params.rejectedCategoryName || 'N/A'})`,
    );
  }

  /**
   * 🆕 Busca sinônimos personalizados para sugestões inteligentes
   *
   * Verifica se usuário já tem sinônimo cadastrado para o termo
   * Útil para evitar perguntar novamente algo que usuário já confirmou
   */
  async hasUserSynonym(
    userId: string,
    term: string,
  ): Promise<{
    hasSynonym: boolean;
    categoryId?: string;
    categoryName?: string;
    subCategoryId?: string;
    subCategoryName?: string;
    confidence?: number;
  }> {
    const normalized = this.normalize(term);

    const synonym = await this.prisma.userSynonym.findUnique({
      where: {
        userId_keyword: {
          userId,
          keyword: normalized,
        },
      },
    });

    if (!synonym) {
      return { hasSynonym: false };
    }

    return {
      hasSynonym: true,
      categoryId: synonym.categoryId,
      categoryName: synonym.categoryName,
      subCategoryId: synonym.subCategoryId || undefined,
      subCategoryName: synonym.subCategoryName || undefined,
      confidence: synonym.confidence,
    };
  }
}
