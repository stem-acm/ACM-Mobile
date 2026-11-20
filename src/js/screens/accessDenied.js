// Screen 1b "Role not allowed" (plan M10): lock icon, the two texts, "Signed in as <username>"
// with the role chip (when the account is known), "Sign in with another account" → Login.
// The token is already deleted when the screen opens (auth.js).
import { go } from '../nav.js';
import { isSessionActive, signOut } from '../auth.js';
import { renderTemplate } from './dom.js';

/** `intern` → `Intern`. */
export function roleLabel(role) {
  if (typeof role !== 'string' || !role) return '';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function mount(root, params = {}) {
  const refs = renderTemplate(root, 'accessDenied');
  const user = params.user;
  if (user && user.username) {
    refs.username.textContent = user.username;
    refs.role.textContent = roleLabel(user.role);
    refs.role.hidden = !user.role;
    refs.account.hidden = false;
  }
  refs.again.addEventListener('click', () => {
    // The "simulate a scan" box of the local build opens this screen during a session: the
    // button then signs out, as after a real refusal.
    if (isSessionActive()) signOut();
    else go('login');
  });
}

export function unmount() {}
