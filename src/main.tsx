import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from '@/app/App';
import { AppProviders } from '@/app/providers';
import '@/index.css';

registerSW({ immediate: true });

const root = document.getElementById('root');
if (!root) throw new Error('Brak elementu #root');

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>
);
