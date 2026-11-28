import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { applyLook, savedLookLocal } from './lib/looks.js';

// Paint the last look used on this device right away, before sign-in finishes.
applyLook(savedLookLocal('last'));

// After an update goes live, a tab that was already open can ask for a file the new version
// renamed (the PDF maker, for one). Reload once to pick up the new files instead of failing.
window.addEventListener('vite:preloadError', (e) => {
  try {
    if (sessionStorage.getItem('reloaded-for-update')) return;
    sessionStorage.setItem('reloaded-for-update', '1');
  } catch { return; }
  e.preventDefault();
  window.location.reload();
});
window.addEventListener('load', () => setTimeout(() => { try { sessionStorage.removeItem('reloaded-for-update'); } catch { /* private mode */ } }, 10000));

createRoot(document.getElementById('root')).render(<App />);
