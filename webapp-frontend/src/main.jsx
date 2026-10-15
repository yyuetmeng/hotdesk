import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { applyTheme, readTheme, watchSystemTheme } from './theme.js';
import './styles.css';

// Apply the saved theme before the first render (no flash), and follow system changes.
applyTheme(readTheme());
watchSystemTheme(() => applyTheme(readTheme()));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
