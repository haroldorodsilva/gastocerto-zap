import { AsyncLocalStorage } from 'async_hooks';

/**
 * 🆕 [AI2] Contexto assíncrono que carrega a credencial de IA atual durante uma chamada.
 *
 * Permite que `AIProviderFactory` selecione uma credencial e cada `*.provider.ts`
 * recupere a `apiKey` correta sem precisar mudar a assinatura dos métodos
 * (concorrência-segura graças ao AsyncLocalStorage).
 */
export interface AICredentialContextValue {
  credentialId: string;
  apiKey: string;
  provider: string;
  label: string;
}

export const aiCredentialContext = new AsyncLocalStorage<AICredentialContextValue>();

/**
 * Retorna a credencial atual ou lança erro se nenhuma estiver no contexto.
 * (Esperado quando uma chamada ao provider acontece fora do wrapper do factory.)
 */
export function requireCurrentCredential(): AICredentialContextValue {
  const cred = aiCredentialContext.getStore();
  if (!cred) {
    throw new Error(
      'Nenhuma credencial de IA disponível no contexto. ' +
        'Chamadas a providers devem ser feitas via AIProviderFactory.runWithCredential()',
    );
  }
  return cred;
}
