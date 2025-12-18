import { TransactionsRelations } from '@/models/transactions.entity';
import { MonthlyBalance } from '../models/monthly-balance.entity';
import { PaginationResponseDto } from './dto/pagination.dto';
import {
  CreditCardInvoice,
  CreditCardInvoiceRelations,
} from '@/models/credit-card-invoices.entity';
import { Banks } from '@/models/banks.entity';
import { CreditCardRelations } from '@/models/credit-card.entity';

export class ITransactionsResponseDto extends TransactionsRelations {
  isGrouped?: boolean;
}

// Composto
export class ListTransactionsResponseDto {
  success: boolean;
  data?: PaginationResponseDto<ITransactionsResponseDto> & { resume: MonthlyBalance };
  error?: string;
}

export class CreditCardResponseDto extends CreditCardRelations {
  resume?: {
    amountTotal: number;
    amountPaid: number;
  };

  error?: string;
  message?: string;
}
