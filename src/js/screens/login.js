// Screen 1 "Login" (plan M10): logo, "iPass Badge Check", "Sign in with your iPass account",
// Username, Password with the show-password button, message box, "Sign in". Non-production
// builds show the environment name (ENV_NAME). The texts of the errors are in auth.js.
import { go } from '../nav.js';
import { LoginError, login } from '../auth.js';
import { renderTemplate } from './dom.js';

let view = null;

function showMessage(text, tone) {
  if (!view) return;
  const { message, messageText } = view.refs;
  messageText.textContent = text || '';
  message.hidden = !text;
  message.classList.toggle('message-info', tone === 'info');
}

function setPasswordVisible(visible) {
  const { password, toggle, eyeOpen, eyeClosed } = view.refs;
  password.type = visible ? 'text' : 'password';
  toggle.setAttribute('aria-pressed', String(visible));
  toggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  // SVG elements have no `hidden` property: set the attribute.
  eyeOpen.toggleAttribute('hidden', visible);
  eyeClosed.toggleAttribute('hidden', !visible);
}

export function mount(root, params = {}) {
  const refs = renderTemplate(root, 'login');
  view = { refs, busy: false };

  const { ENV_NAME } = window.APP_CONFIG;
  if (ENV_NAME && ENV_NAME !== 'production') {
    refs.env.textContent = ENV_NAME;
    refs.env.hidden = false;
  }
  // "Session expired" and other messages given by the session rules.
  if (params.message) showMessage(params.message, 'info');

  refs.toggle.addEventListener('click', () => {
    setPasswordVisible(refs.password.type === 'password');
    refs.password.focus();
  });

  refs.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!view || view.busy) return;
    const v = view;
    // The server allows 5 login requests in 15 minutes per IP address: one request at a time.
    v.busy = true;
    refs.submit.disabled = true;
    refs.submit.textContent = 'Signing in…';
    showMessage('');
    try {
      const next = await login(refs.username.value.trim(), refs.password.value);
      if (view === v) await go(next.screen, next.params);
    } catch (error) {
      if (view !== v) return;
      showMessage(error instanceof LoginError ? error.message : 'Something went wrong. Try again.', 'error');
      v.busy = false;
      refs.submit.disabled = false;
      refs.submit.textContent = 'Sign in';
    }
  });
}

export function unmount() {
  view = null;
}
