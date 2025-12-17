import { TransactionsRelations } from '@/models/transactions.entity';
import { MonthlyBalance } from '../models/monthly-balance.entity';
import { PaginationResponseDto } from './dto/pagination.dto';

export class ITransactionsResponseDto extends TransactionsRelations {
  isGrouped?: boolean;
}

// Composto
export class ListTransactionsResponseDto {
  success: boolean;
  data?: PaginationResponseDto<ITransactionsResponseDto> & { resume: MonthlyBalance };
  error?: string;
}
