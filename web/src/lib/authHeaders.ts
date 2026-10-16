import { factoryStore } from '../store/factoryStore';

/** JSON headers plus the signed-in user's bearer token (when there is one). */
export function authJsonHeaders(): Record<string, string> {
  const token = factoryStore.getState().token;
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}
