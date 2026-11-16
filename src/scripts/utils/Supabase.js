import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './Catalog.js';

// Client partagé: garde la session dans le localStorage (on reste connecté).
// `detectSessionInUrl`: au retour du lien reçu par courriel, la session est lue dans l'adresse.
let client = null;

export function supabase() {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    });
  }
  return client;
}

export async function currentSession() {
  const { data } = await supabase().auth.getSession();
  return data.session;
}

// Envoie un lien de connexion par courriel. Aucun compte n'est créé depuis le site:
// seul un compte déjà créé dans Supabase le reçoit (les inscriptions sont fermées).
export async function sendLink(email) {
  const { error } = await supabase().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
}

// Vrai si le compte connecté est autorisé à ajouter (voir is_admin dans supabase/setup.sql)
export async function isAdmin() {
  const { data, error } = await supabase().rpc('is_admin');
  if (error) throw error;
  return data === true;
}

// Retour du lien de connexion: la session est enregistrée, puis l'adresse est nettoyée
export async function finishSignIn() {
  const session = await currentSession();
  history.replaceState(null, '', location.pathname + location.search);
  return session;
}
