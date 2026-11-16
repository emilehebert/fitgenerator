import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './Catalog.js';

// Client partagé: garde la session dans le localStorage (on reste connecté)
let client = null;

export function supabase() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return client;
}

export async function currentSession() {
  const { data } = await supabase().auth.getSession();
  return data.session;
}

// Envoie un code à 6 chiffres par courriel (pas de lien: un lien ouvrirait
// Safari au lieu de l'app installée sur l'iPhone)
export async function sendCode(email) {
  // Aucun compte n'est créé depuis le site: seul un compte déjà créé dans Supabase reçoit un code
  const { error } = await supabase().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) throw error;
}

export async function verifyCode(email, token) {
  const { data, error } = await supabase().auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
  return data.session;
}

// Vrai si le compte connecté est dans la table admins (voir supabase/setup.sql)
export async function isAdmin() {
  const { data, error } = await supabase().rpc('is_admin');
  if (error) throw error;
  return data === true;
}
