export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSES = 'EXPENSES',
}

export enum TransactionOrigin {
  MANUAL = 'MANUAL',
  CARD = 'CARD',
  TRANSFER = 'TRANSFER',
}

export enum TransactionStatus {
  PENDING = 'PENDING',
  DONE = 'DONE',
  OVERDUE = 'OVERDUE',
}

export enum TransactionFrequency {
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  ANNUAL = 'ANNUAL',
  BIENNIAL = 'BIENNIAL',
}

export enum TransactionInstallmentValue {
  INSTALLMENT_VALUE = 'INSTALLMENT_VALUE',
  GROSS_VALUE = 'GROSS_VALUE',
}

export enum TransactionActionOption {
  ONLY_THIS = 'ONLY_THIS',
  ALL_PENDING = 'ALL_PENDING',
  THIS_AND_FUTURE = 'THIS_AND_FUTURE',
  ALL = 'ALL',
}
