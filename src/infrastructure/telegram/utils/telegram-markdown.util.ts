/**
 * Utilitário para escapar texto no formato Telegram MarkdownV2.
 *
 * O MarkdownV2 exige que caracteres especiais sejam escapados com `\`
 * quando não fazem parte de formatação Markdown.
 *
 * Caracteres que precisam de escape:
 *   _ * [ ] ( ) ~ ` > # + - = | { } . ! \
 *
 * Esta função preserva blocos `*bold*` (único formato
 * utilizado pelo GastoCerto) e escapa todo o resto.
 *
 * @see https://core.telegram.org/bots/api#markdownv2-style
 */

// Caracteres especiais do MarkdownV2 (exceto `*` que é tratado à parte)
const SPECIAL_CHARS = /([_\[\]()~`>#+\-=|{}.!\\])/g;

/**
 * Escapa texto para Telegram MarkdownV2, preservando *bold*.
 *
 * @example
 * escapeMarkdownV2('*Valor:* R$ 50.00')
 * // => '*Valor:*  R\\$ 50\\.00'   ($ não precisa escape, . sim)
 *
 * escapeMarkdownV2('3 transação(ões)')
 * // => '3 transação\\(ões\\)'
 */
export function escapeMarkdownV2(text: string): string {
  if (!text) return text;

  // Dividir em segmentos: blocos *bold* vs texto normal
  // O regex captura *conteúdo* (grupo de captura → preservado no split)
  const parts = text.split(/(\*[^*]+\*)/g);

  return parts
    .map((part) => {
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        // Bloco bold: escapar apenas o conteúdo interno, manter asteriscos
        const inner = part.slice(1, -1);
        return '*' + inner.replace(SPECIAL_CHARS, '\\$1') + '*';
      }
      // Texto normal: escapar todos os caracteres especiais
      return part.replace(SPECIAL_CHARS, '\\$1');
    })
    .join('');
}
