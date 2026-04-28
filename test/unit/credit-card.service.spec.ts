/**
 * Unit tests for CreditCardService
 *
 * Tests all 7 public methods:
 * 1. listCreditCards        — empty list, multiple cards, no active account, API error
 * 2. setDefaultCreditCard   — card found, card not found, no account
 * 3. showDefaultCreditCard  — no default set, default found, default not in list
 * 4. showInvoiceByCardName  — card found with open invoice, card not found, no invoices
 * 5. listInvoices           — multiple invoices, empty, no account
 * 6. showInvoiceDetails     — invoice in context, not in context, no account
 * 7. payInvoice             — success, not in context, API failure
 */

import { Test, TestingModule } from '@nestjs/testing';
import { CreditCardService } from '@features/credit-cards/credit-card.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { UserCacheService } from '@features/users/user-cache.service';
import { ListContextService } from '@features/transactions/list-context.service';

// ─── Factories de dados de teste ─────────────────────────────────────────

const buildUser = (overrides: Partial<any> = {}) => ({
  id: 'user-1',
  phoneNumber: '+5511999990001',
  gastoCertoId: 'gc-user-1',
  defaultCreditCardId: null,
  activeAccountId: null,
  ...overrides,
});

const buildAccount = (overrides: Partial<any> = {}) => ({
  id: 'acc-1',
  name: 'Conta Principal',
  ...overrides,
});

const buildCard = (overrides: Partial<any> = {}) => ({
  id: 'card-1',
  name: 'Nubank',
  limit: 500000, // R$ 5.000,00 em centavos
  closingDay: 5,
  dueDay: 12,
  bank: { id: 'bank-1', name: 'Nubank' },
  resume: { amountTotal: 100000 }, // R$ 1.000,00 usado
  ...overrides,
});

const buildInvoice = (overrides: Partial<any> = {}) => ({
  id: 'inv-1',
  creditCardId: 'card-1',
  yearMonth: '2024-01',
  amountTotal: 150000, // R$ 1.500,00
  dueDate: '2024-01-12T00:00:00.000Z',
  status: 'OPEN',
  creditCard: { id: 'card-1', name: 'Nubank' },
  transactionCount: 3,
  transactions: [],
  ...overrides,
});

// ─── Mocks ───────────────────────────────────────────────────────────────

const buildApiMock = () => ({
  listCreditCards: jest.fn(),
  listCreditCardInvoices: jest.fn(),
  getInvoiceDetails: jest.fn(),
  payInvoice: jest.fn(),
});

const buildUserCacheMock = () => ({
  getActiveAccountByUserId: jest.fn(),
  setDefaultCreditCard: jest.fn(),
});

const buildListContextMock = () => ({
  setListContext: jest.fn(),
  getItemByNumber: jest.fn(),
  clearContext: jest.fn(),
});

// ─── Suite ───────────────────────────────────────────────────────────────

describe('CreditCardService', () => {
  let service: CreditCardService;
  let api: ReturnType<typeof buildApiMock>;
  let userCache: ReturnType<typeof buildUserCacheMock>;
  let listContext: ReturnType<typeof buildListContextMock>;

  beforeEach(async () => {
    api = buildApiMock();
    userCache = buildUserCacheMock();
    listContext = buildListContextMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditCardService,
        { provide: GastoCertoApiService, useValue: api },
        { provide: UserCacheService, useValue: userCache },
        { provide: ListContextService, useValue: listContext },
      ],
    }).compile();

    service = module.get<CreditCardService>(CreditCardService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── 1. listCreditCards ──────────────────────────────────────────────

  describe('listCreditCards', () => {
    it('returns formatted list when user has cards', async () => {
      const user = buildUser();
      const account = buildAccount();
      const cards = [
        buildCard({ id: 'card-1', name: 'Nubank' }),
        buildCard({ id: 'card-2', name: 'Itaú Platinum', bank: { id: 'b2', name: 'Itaú' } }),
      ];

      userCache.getActiveAccountByUserId.mockResolvedValue(account);
      api.listCreditCards.mockResolvedValue({ success: true, data: cards });

      const result = await service.listCreditCards(user as any);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Nubank');
      expect(result.message).toContain('Itaú Platinum');
      expect(result.message).toContain('R$');
      expect(listContext.setListContext).toHaveBeenCalledWith(
        user.phoneNumber,
        'credit_cards',
        expect.arrayContaining([
          expect.objectContaining({ id: 'card-1', type: 'credit_card' }),
        ]),
      );
    });

    it('returns empty message when no cards found', async () => {
      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.listCreditCards.mockResolvedValue({ success: true, data: [] });

      const result = await service.listCreditCards(buildUser() as any);

      expect(result.success).toBe(true);
      expect(result.message).toContain('não tem cartões cadastrados');
    });

    it('returns error when API returns success=false', async () => {
      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.listCreditCards.mockResolvedValue({ success: false, data: null });

      const result = await service.listCreditCards(buildUser() as any);

      expect(result.success).toBe(true); // empty state, not error
      expect(result.message).toContain('não tem cartões cadastrados');
    });

    it('returns error when no active account found', async () => {
      userCache.getActiveAccountByUserId.mockResolvedValue(null);

      const result = await service.listCreditCards(buildUser() as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('conta ativa');
    });

    it('returns error on exception', async () => {
      userCache.getActiveAccountByUserId.mockRejectedValue(new Error('DB down'));

      const result = await service.listCreditCards(buildUser() as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Erro ao buscar cartões');
    });

    it('shows limit and available balance for each card', async () => {
      const user = buildUser();
      const card = buildCard({ limit: 1000000, resume: { amountTotal: 200000 } });

      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.listCreditCards.mockResolvedValue({ success: true, data: [card] });

      const result = await service.listCreditCards(user as any);

      expect(result.message).toContain('10.000'); // limit R$10.000
      expect(result.message).toContain('8.000');  // available R$8.000
    });
  });

  // ─── 2. setDefaultCreditCard ─────────────────────────────────────────

  describe('setDefaultCreditCard', () => {
    it('sets card as default when found by name', async () => {
      const user = buildUser();
      const cards = [buildCard({ id: 'card-1', name: 'Nubank' })];

      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.listCreditCards.mockResolvedValue({ success: true, data: cards });
      userCache.setDefaultCreditCard.mockResolvedValue({ ...user, defaultCreditCardId: 'card-1' });

      const result = await service.setDefaultCreditCard(user as any, 'usar nubank');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Nubank');
      expect(userCache.setDefaultCreditCard).toHaveBeenCalledWith(user.phoneNumber, 'card-1');
    });

    it('sets card as default when found by bank name', async () => {
      const user = buildUser();
      const cards = [buildCard({ id: 'card-1', name: 'Platinum', bank: { id: 'b1', name: 'Bradesco' } })];

      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.listCreditCards.mockResolvedValue({ success: true, data: cards });
      userCache.setDefaultCreditCard.mockResolvedValue({ ...user, defaultCreditCardId: 'card-1' });

      const result = await service.setDefaultCreditCard(user as any, 'usar cartão bradesco');

      expect(result.success).toBe(true);
      expect(userCache.setDefaultCreditCard).toHaveBeenCalledWith(user.phoneNumber, 'card-1');
    });

    it('returns card list when name not matched', async () => {
      const user = buildUser();
      const cards = [buildCard({ name: 'Nubank' })];

      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.listCreditCards.mockResolvedValue({ success: true, data: cards });

      const result = await service.setDefaultCreditCard(user as any, 'usar cartão xyz');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Qual cartão');
      expect(result.message).toContain('Nubank');
      expect(userCache.setDefaultCreditCard).not.toHaveBeenCalled();
    });

    it('returns error when no cards exist', async () => {
      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.listCreditCards.mockResolvedValue({ success: true, data: [] });

      const result = await service.setDefaultCreditCard(buildUser() as any, 'usar nubank');

      expect(result.success).toBe(false);
      expect(result.message).toContain('não tem cartões cadastrados');
    });

    it('returns error when no active account', async () => {
      userCache.getActiveAccountByUserId.mockResolvedValue(null);

      const result = await service.setDefaultCreditCard(buildUser() as any, 'usar nubank');

      expect(result.success).toBe(false);
    });

    it('returns error on exception', async () => {
      userCache.getActiveAccountByUserId.mockRejectedValue(new Error('timeout'));

      const result = await service.setDefaultCreditCard(buildUser() as any, 'nubank');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Erro ao definir cartão padrão');
    });
  });

  // ─── 3. showDefaultCreditCard ────────────────────────────────────────

  describe('showDefaultCreditCard', () => {
    it('returns informational message when no default set', async () => {
      const user = buildUser({ defaultCreditCardId: null });

      const result = await service.showDefaultCreditCard(user as any);

      expect(result.success).toBe(true);
      expect(result.message).toContain('não definiu um cartão padrão');
      expect(userCache.getActiveAccountByUserId).not.toHaveBeenCalled();
    });

    it('returns card details when default is set and found', async () => {
      const user = buildUser({ defaultCreditCardId: 'card-1' });
      const card = buildCard({ id: 'card-1', name: 'Nubank' });

      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.listCreditCards.mockResolvedValue({ success: true, data: [card] });

      const result = await service.showDefaultCreditCard(user as any);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Nubank');
      expect(result.message).toContain('Cartão Padrão');
    });

    it('returns warning when default card not found in list', async () => {
      const user = buildUser({ defaultCreditCardId: 'card-deleted' });

      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.listCreditCards.mockResolvedValue({ success: true, data: [buildCard({ id: 'card-1' })] });

      const result = await service.showDefaultCreditCard(user as any);

      expect(result.success).toBe(true);
      expect(result.message).toContain('não foi encontrado');
    });

    it('returns error when no active account', async () => {
      const user = buildUser({ defaultCreditCardId: 'card-1' });
      userCache.getActiveAccountByUserId.mockResolvedValue(null);

      const result = await service.showDefaultCreditCard(user as any);

      expect(result.success).toBe(false);
    });
  });

  // ─── 4. showInvoiceByCardName ────────────────────────────────────────

  describe('showInvoiceByCardName', () => {
    it('returns invoice details for matched card with open invoice', async () => {
      const user = buildUser();
      const card = buildCard({ id: 'card-1', name: 'Nubank' });
      const invoice = buildInvoice({ status: 'OPEN', yearMonth: '2024-01' });
      const invoiceDetails = {
        ...invoice,
        transactions: [
          {
            id: 't1',
            description: 'Uber',
            amount: 3500,
            dueDate: '2024-01-05T00:00:00.000Z',
            category: { id: 'c1', name: 'Transporte' },
            subCategory: null,
          },
        ],
      };

      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.listCreditCards.mockResolvedValue({ success: true, data: [card] });
      api.listCreditCardInvoices.mockResolvedValue({ success: true, invoices: [invoice] });
      api.getInvoiceDetails.mockResolvedValue({ success: true, invoice: invoiceDetails });

      const result = await service.showInvoiceByCardName(user as any, 'ver fatura nubank');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Nubank');
      expect(result.message).toContain('Uber');
    });

    it('returns error when card name not found', async () => {
      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.listCreditCards.mockResolvedValue({ success: true, data: [buildCard({ name: 'Nubank' })] });

      const result = await service.showInvoiceByCardName(buildUser() as any, 'ver fatura bradesco');

      expect(result.success).toBe(false);
      expect(result.message).toContain('não encontrado');
    });

    it('returns empty message when no invoices for card', async () => {
      const card = buildCard({ id: 'card-1', name: 'Nubank' });

      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.listCreditCards.mockResolvedValue({ success: true, data: [card] });
      api.listCreditCardInvoices.mockResolvedValue({ success: true, invoices: [] });

      const result = await service.showInvoiceByCardName(buildUser() as any, 'fatura nubank');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Não há faturas abertas');
    });

    it('returns error when no active account', async () => {
      userCache.getActiveAccountByUserId.mockResolvedValue(null);

      const result = await service.showInvoiceByCardName(buildUser() as any, 'fatura nubank');

      expect(result.success).toBe(false);
    });

    it('returns error on exception', async () => {
      userCache.getActiveAccountByUserId.mockRejectedValue(new Error('network'));

      const result = await service.showInvoiceByCardName(buildUser() as any, 'fatura nubank');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Erro ao buscar fatura');
    });
  });

  // ─── 5. listInvoices ─────────────────────────────────────────────────

  describe('listInvoices', () => {
    it('returns formatted invoices list', async () => {
      const user = buildUser();
      const invoices = [
        buildInvoice({ id: 'inv-1', yearMonth: '2024-01', creditCard: { id: 'c1', name: 'Nubank' } }),
        buildInvoice({ id: 'inv-2', yearMonth: '2024-02', creditCard: { id: 'c2', name: 'Itaú' }, status: 'PAID' }),
      ];

      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.listCreditCardInvoices.mockResolvedValue({ success: true, invoices });

      const result = await service.listInvoices(user as any);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Nubank');
      expect(result.message).toContain('Itaú');
      expect(listContext.setListContext).toHaveBeenCalledWith(
        user.phoneNumber,
        'invoices',
        expect.arrayContaining([
          expect.objectContaining({ id: 'inv-1', type: 'invoice' }),
        ]),
      );
    });

    it('returns empty state when no invoices', async () => {
      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.listCreditCardInvoices.mockResolvedValue({ success: true, invoices: [] });

      const result = await service.listInvoices(buildUser() as any);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Não há faturas');
    });

    it('returns error when no active account', async () => {
      userCache.getActiveAccountByUserId.mockResolvedValue(null);

      const result = await service.listInvoices(buildUser() as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('conta ativa');
    });

    it('returns error on exception', async () => {
      userCache.getActiveAccountByUserId.mockRejectedValue(new Error('DB error'));

      const result = await service.listInvoices(buildUser() as any);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Erro ao buscar faturas');
    });

    it('includes invoice amounts in reais format', async () => {
      const invoices = [buildInvoice({ amountTotal: 250000 })]; // R$2500

      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.listCreditCardInvoices.mockResolvedValue({ success: true, invoices });

      const result = await service.listInvoices(buildUser() as any);

      expect(result.message).toContain('2500');
    });
  });

  // ─── 6. showInvoiceDetails ───────────────────────────────────────────

  describe('showInvoiceDetails', () => {
    it('returns invoice details when found in context', async () => {
      const user = buildUser();
      const contextItem = {
        id: 'inv-1',
        type: 'invoice',
        description: 'Nubank - Janeiro/2024',
        amount: 1500,
        category: 'Nubank',
        metadata: { yearMonth: '2024-01', cardId: 'card-1', status: 'OPEN', dueDate: '2024-01-12' },
      };
      const invoiceDetails = {
        ...buildInvoice(),
        creditCard: { id: 'card-1', name: 'Nubank' },
        transactions: [
          {
            id: 't1',
            description: 'Netflix',
            amount: 4490,
            dueDate: '2024-01-10T00:00:00.000Z',
            category: { id: 'c1', name: 'Entretenimento' },
            subCategory: null,
          },
        ],
      };

      listContext.getItemByNumber.mockReturnValue({ found: true, item: contextItem });
      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.getInvoiceDetails.mockResolvedValue({ success: true, invoice: invoiceDetails });

      const result = await service.showInvoiceDetails(user as any, 1);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Nubank');
      expect(result.message).toContain('Netflix');
      expect(api.getInvoiceDetails).toHaveBeenCalledWith('acc-1', '2024-01', 'card-1');
    });

    it('returns error when invoice not in context', async () => {
      listContext.getItemByNumber.mockReturnValue({ found: false, item: null });

      const result = await service.showInvoiceDetails(buildUser() as any, 5);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Fatura não encontrada');
    });

    it('returns error when context item is not type invoice', async () => {
      const contextItem = { id: 'tx-1', type: 'transaction', description: 'Wrong type' };
      listContext.getItemByNumber.mockReturnValue({ found: true, item: contextItem });

      const result = await service.showInvoiceDetails(buildUser() as any, 1);

      expect(result.success).toBe(false);
    });

    it('returns error when no active account', async () => {
      listContext.getItemByNumber.mockReturnValue({
        found: true,
        item: {
          id: 'inv-1',
          type: 'invoice',
          metadata: { yearMonth: '2024-01', cardId: 'c1' },
        },
      });
      userCache.getActiveAccountByUserId.mockResolvedValue(null);

      const result = await service.showInvoiceDetails(buildUser() as any, 1);

      expect(result.success).toBe(false);
    });

    it('returns error when API fails to get details', async () => {
      listContext.getItemByNumber.mockReturnValue({
        found: true,
        item: {
          id: 'inv-1',
          type: 'invoice',
          metadata: { yearMonth: '2024-01', cardId: 'c1' },
        },
      });
      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.getInvoiceDetails.mockResolvedValue({ success: false, invoice: null });

      const result = await service.showInvoiceDetails(buildUser() as any, 1);

      expect(result.success).toBe(false);
      expect(result.message).toContain('detalhes da fatura');
    });
  });

  // ─── 7. payInvoice ───────────────────────────────────────────────────

  describe('payInvoice', () => {
    it('pays invoice successfully and clears context', async () => {
      const user = buildUser();
      const contextItem = {
        id: 'inv-1',
        type: 'invoice',
        description: 'Nubank - Jan/2024',
        amount: 1500.0,
        category: 'Nubank',
        metadata: { yearMonth: '2024-01', cardId: 'card-1', status: 'OPEN', dueDate: '2024-01-12' },
      };

      listContext.getItemByNumber.mockReturnValue({ found: true, item: contextItem });
      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.payInvoice.mockResolvedValue({ success: true, message: 'Fatura paga' });

      const result = await service.payInvoice(user as any, 1);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Fatura paga com sucesso');
      expect(api.payInvoice).toHaveBeenCalledWith(
        user.gastoCertoId,
        'acc-1',
        'inv-1',
        150000, // R$1500.00 → 150000 centavos
      );
      expect(listContext.clearContext).toHaveBeenCalledWith(user.phoneNumber);
    });

    it('returns error when invoice not in context', async () => {
      listContext.getItemByNumber.mockReturnValue({ found: false, item: null });

      const result = await service.payInvoice(buildUser() as any, 99);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Fatura não encontrada');
      expect(api.payInvoice).not.toHaveBeenCalled();
    });

    it('returns error when context item is not type invoice', async () => {
      listContext.getItemByNumber.mockReturnValue({
        found: true,
        item: { id: 'tx-1', type: 'transaction', amount: 100 },
      });

      const result = await service.payInvoice(buildUser() as any, 1);

      expect(result.success).toBe(false);
    });

    it('returns error when no active account', async () => {
      listContext.getItemByNumber.mockReturnValue({
        found: true,
        item: { id: 'inv-1', type: 'invoice', amount: 500, metadata: {} },
      });
      userCache.getActiveAccountByUserId.mockResolvedValue(null);

      const result = await service.payInvoice(buildUser() as any, 1);

      expect(result.success).toBe(false);
    });

    it('returns error when API pay call fails', async () => {
      const contextItem = {
        id: 'inv-1',
        type: 'invoice',
        amount: 800,
        category: 'Nubank',
        metadata: { yearMonth: '2024-01' },
      };

      listContext.getItemByNumber.mockReturnValue({ found: true, item: contextItem });
      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.payInvoice.mockResolvedValue({ success: false, message: 'Fatura já paga' });

      const result = await service.payInvoice(buildUser() as any, 1);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Fatura já paga');
      expect(listContext.clearContext).not.toHaveBeenCalled();
    });

    it('does not clear context when payment fails', async () => {
      const contextItem = {
        id: 'inv-1',
        type: 'invoice',
        amount: 100,
        metadata: {},
      };

      listContext.getItemByNumber.mockReturnValue({ found: true, item: contextItem });
      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.payInvoice.mockRejectedValue(new Error('Gateway timeout'));

      const result = await service.payInvoice(buildUser() as any, 1);

      expect(result.success).toBe(false);
      expect(listContext.clearContext).not.toHaveBeenCalled();
    });

    it('converts amount to centavos correctly', async () => {
      const contextItem = {
        id: 'inv-1',
        type: 'invoice',
        amount: 99.99,
        category: 'Visa',
        metadata: { yearMonth: '2024-01' },
      };

      listContext.getItemByNumber.mockReturnValue({ found: true, item: contextItem });
      userCache.getActiveAccountByUserId.mockResolvedValue(buildAccount());
      api.payInvoice.mockResolvedValue({ success: true, message: 'Ok' });

      await service.payInvoice(buildUser() as any, 1);

      expect(api.payInvoice).toHaveBeenCalledWith(
        expect.any(String),
        'acc-1',
        'inv-1',
        9999, // R$99.99 → 9999 centavos
      );
    });
  });
});
