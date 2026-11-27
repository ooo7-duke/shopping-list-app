import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { applyLook, savedLookLocal } from './lib/looks.js';

// Paint the last look used on this device right away, before sign-in finishes.
applyLook(savedLookLocal('last'));

createRoot(document.getElementById('root')).render(<App />);
