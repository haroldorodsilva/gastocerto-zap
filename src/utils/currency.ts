export const formatCurrency = (text: string | number): string => {
  if (text === 'undefined') return '0,00';

  let value = typeof text === 'number' ? text.toFixed(2) : text;
  const isNegative = value.startsWith('-');

  value = value.replace('-', '');
  value = value.replace(/\D/g, '');
  value = value.replace(/(\d)(\d{2})$/, '$1,$2');
  value = value.replace(/(?=(\d{3})+(\D))\B/g, '.');

  return isNegative ? `-${value}` : value;
};

/**
 * Formata valores em centavos para moeda brasileira
 * @param amountInCents - Valor em centavos (ex: 10000 = R$ 100,00)
 * @returns String formatada (ex: "R$ 100,00")
 */
export const formatCurrencyFromCents = (amountInCents: number): string => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amountInCents / 100);
};
