import { TRANSACTION_USER_PROMPT_TEMPLATE } from '../../../src/features/transactions/contexts/registration/prompts/transaction-extraction.prompt';

describe('Transaction Extraction Prompt', () => {
  describe('TRANSACTION_USER_PROMPT_TEMPLATE', () => {
    it('deve gerar prompt básico sem categorias', () => {
      // Act
      const prompt = TRANSACTION_USER_PROMPT_TEMPLATE('gastei 50 reais');

      // Assert
      expect(prompt).toContain('gastei 50 reais');
      expect(prompt).toContain('Retorne APENAS um objeto JSON');
      expect(prompt).not.toContain('Categorias disponíveis');
    });

    it('deve incluir categorias simples sem subcategorias', () => {
      // Arrange
      const categories = [
        {
          id: 'cat-1',
          name: 'Alimentação',
          subCategories: [],
        },
        {
          id: 'cat-2',
          name: 'Transporte',
          subCategories: [],
        },
      ];

      // Act
      const prompt = TRANSACTION_USER_PROMPT_TEMPLATE('gastei 50 reais', categories);

      // Assert
      expect(prompt).toContain('📂 **Categorias disponíveis do usuário:**');
      expect(prompt).toContain('- Alimentação');
      expect(prompt).toContain('- Transporte');
      expect(prompt).not.toContain('subcategorias:');
    });

    describe('🔥 Novo comportamento - CategoryWithSubs', () => {
      it('deve listar subcategorias quando disponíveis', () => {
        // Arrange - Estrutura CategoryWithSubs[]
        const categories = [
          {
            id: 'cat-1',
            name: 'Alimentação',
            subCategories: [
              { id: 'sub-1', name: 'Supermercado' },
              { id: 'sub-2', name: 'Restaurantes' },
              { id: 'sub-3', name: 'Lanches' },
            ],
          },
          {
            id: 'cat-2',
            name: 'Transporte',
            subCategories: [
              { id: 'sub-4', name: 'Combustível' },
              { id: 'sub-5', name: 'Uber' },
            ],
          },
        ];

        // Act
        const prompt = TRANSACTION_USER_PROMPT_TEMPLATE('gastei 56,89 no supermercado', categories);

        // Assert
        expect(prompt).toContain('📂 **Categorias disponíveis do usuário:**');
        expect(prompt).toContain('- Alimentação (subcategorias: Supermercado, Restaurantes, Lanches)');
        expect(prompt).toContain('- Transporte (subcategorias: Combustível, Uber)');
      });

      it('deve incluir instruções específicas sobre subcategorias', () => {
        // Arrange
        const categories = [
          {
            id: 'cat-1',
            name: 'Alimentação',
            subCategories: [
              { id: 'sub-1', name: 'Supermercado' },
            ],
          },
        ];

        // Act
        const prompt = TRANSACTION_USER_PROMPT_TEMPLATE('compras no mercado', categories);

        // Assert
        expect(prompt).toContain('⚠️ **IMPORTANTE:**');
        expect(prompt).toContain('Use EXATAMENTE o nome da categoria e subcategoria listadas acima');
        expect(prompt).toContain('Para "supermercado" ou "mercado", use categoria="Alimentação" e subCategory="Supermercado"');
        expect(prompt).toContain('Sempre tente identificar a subcategoria quando houver');
      });

      it('deve misturar categorias com e sem subcategorias', () => {
        // Arrange
        const categories = [
          {
            id: 'cat-1',
            name: 'Alimentação',
            subCategories: [
              { id: 'sub-1', name: 'Supermercado' },
            ],
          },
          {
            id: 'cat-2',
            name: 'Saúde',
            subCategories: [], // Sem subcategorias
          },
          {
            id: 'cat-3',
            name: 'Transporte',
            subCategories: [
              { id: 'sub-2', name: 'Uber' },
            ],
          },
        ];

        // Act
        const prompt = TRANSACTION_USER_PROMPT_TEMPLATE('texto', categories);

        // Assert
        expect(prompt).toContain('- Alimentação (subcategorias: Supermercado)');
        expect(prompt).toContain('- Saúde\n'); // Sem subcategorias
        expect(prompt).toContain('- Transporte (subcategorias: Uber)');
      });

      it('deve lidar com múltiplas subcategorias formatadas corretamente', () => {
        // Arrange
        const categories = [
          {
            id: 'cat-1',
            name: 'Casa',
            subCategories: [
              { id: 'sub-1', name: 'Aluguel' },
              { id: 'sub-2', name: 'Água' },
              { id: 'sub-3', name: 'Luz' },
              { id: 'sub-4', name: 'Internet' },
            ],
          },
        ];

        // Act
        const prompt = TRANSACTION_USER_PROMPT_TEMPLATE('paguei conta de luz', categories);

        // Assert
        expect(prompt).toContain('- Casa (subcategorias: Aluguel, Água, Luz, Internet)');
      });

      it('deve validar estrutura esperada pela IA', () => {
        // Arrange - Cenário real do sistema
        const categories = [
          {
            id: 'a8b32f38-c557-4076-9892-c1e029e8a0cf',
            name: 'Alimentação',
            subCategories: [
              { id: 'sub-1', name: 'Supermercado' },
              { id: 'sub-2', name: 'Restaurantes' },
              { id: 'sub-3', name: 'Delivery' },
              { id: 'sub-4', name: 'Lanches' },
            ],
          },
        ];

        // Act
        const prompt = TRANSACTION_USER_PROMPT_TEMPLATE('gastei 56,89 no supermercado', categories);

        // Assert - Verificar estrutura completa
        expect(prompt).toContain('Extraia os dados da seguinte mensagem: "gastei 56,89 no supermercado"');
        expect(prompt).toContain('📂 **Categorias disponíveis do usuário:**');
        expect(prompt).toContain('- Alimentação (subcategorias: Supermercado, Restaurantes, Delivery, Lanches)');
        expect(prompt).toContain('Use EXATAMENTE o nome da categoria e subcategoria listadas acima');
        expect(prompt).toContain('Para "supermercado" ou "mercado", use categoria="Alimentação" e subCategory="Supermercado"');
        expect(prompt).toContain('Para "restaurante", use categoria="Alimentação" e subCategory="Restaurantes"');
        expect(prompt).toContain('Se não houver subcategoria específica, deixe subCategory como null');
        expect(prompt).toContain('Retorne APENAS um objeto JSON');
        expect(prompt).toContain('"subCategory": "nome da subcategoria(opcional)"');
      });
    });

    describe('Edge cases', () => {
      it('deve lidar com categoria sem subcategorias (undefined)', () => {
        // Arrange
        const categories = [
          {
            id: 'cat-1',
            name: 'Outros',
            subCategories: undefined, // Explicitamente undefined
          },
        ];

        // Act
        const prompt = TRANSACTION_USER_PROMPT_TEMPLATE('texto', categories);

        // Assert
        expect(prompt).toContain('- Outros\n');
        expect(prompt).not.toContain('(subcategorias:');
      });

      it('deve lidar com array vazio de categorias', () => {
        // Act
        const prompt = TRANSACTION_USER_PROMPT_TEMPLATE('texto', []);

        // Assert
        expect(prompt).not.toContain('Categorias disponíveis');
        expect(prompt).toContain('Retorne APENAS um objeto JSON');
      });

      it('deve escapar caracteres especiais no texto', () => {
        // Act
        const prompt = TRANSACTION_USER_PROMPT_TEMPLATE('gastei R$ 1.500,00 em "teste"');

        // Assert
        expect(prompt).toContain('gastei R$ 1.500,00 em "teste"');
      });

      it('deve lidar com categoria com subcategorias vazias (array vazio)', () => {
        // Arrange
        const categories = [
          {
            id: 'cat-1',
            name: 'Lazer',
            subCategories: [], // Array vazio
          },
        ];

        // Act
        const prompt = TRANSACTION_USER_PROMPT_TEMPLATE('texto', categories);

        // Assert
        expect(prompt).toContain('- Lazer\n');
        expect(prompt).not.toContain('(subcategorias:');
      });
    });

    describe('Prompt completeness', () => {
      it('deve sempre incluir estrutura JSON esperada', () => {
        // Act
        const prompt = TRANSACTION_USER_PROMPT_TEMPLATE('teste');

        // Assert
        expect(prompt).toContain('Retorne APENAS um objeto JSON com esta estrutura:');
        expect(prompt).toContain('"type": "EXPENSES ou INCOME"');
        expect(prompt).toContain('"amount": 150.50');
        expect(prompt).toContain('"category": "nome da categoria"');
        expect(prompt).toContain('"subCategory": "nome da subcategoria(opcional)"');
        expect(prompt).toContain('"description": "string ou null"');
        expect(prompt).toContain('"date": "2025-12-12T10:00:00.000Z ou null (formato ISO 8601)"');
        expect(prompt).toContain('"merchant": "string ou null"');
        expect(prompt).toContain('"confidence": 0.95');
      });

      it('deve incluir todas as instruções importantes quando há categorias', () => {
        // Arrange
        const categories = [
          {
            id: 'cat-1',
            name: 'Alimentação',
            subCategories: [
              { id: 'sub-1', name: 'Supermercado' },
            ],
          },
        ];

        // Act
        const prompt = TRANSACTION_USER_PROMPT_TEMPLATE('texto', categories);

        // Assert - Todas as instruções críticas
        const instructions = [
          'Use EXATAMENTE o nome da categoria e subcategoria listadas acima',
          'Para "supermercado" ou "mercado", use categoria="Alimentação" e subCategory="Supermercado"',
          'Para "restaurante", use categoria="Alimentação" e subCategory="Restaurantes"',
          'Sempre tente identificar a subcategoria quando houver',
          'Se não houver subcategoria específica, deixe subCategory como null',
        ];

        instructions.forEach((instruction) => {
          expect(prompt).toContain(instruction);
        });
      });
    });
  });
});
