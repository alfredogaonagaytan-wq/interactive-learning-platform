import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ConfirmProvider } from './ui/dialog';
import './styles/app.css';
import { applyRetention } from './storage/retention';

// Recording retention runs once per start-up (deletes recordings older than the configured age).
void applyRetention().catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </StrictMode>,
);
