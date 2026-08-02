import { createClient } from '@supabase/supabase-js';

// Only the project URL and the publishable (anon) key are used here.
// The secret key must never appear anywhere in this repo.
const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(url, anonKey);
