import { createRoot } from 'react-dom/client';
import App from './App';
import { ContextMenuProvider } from './components/ContextMenu';
import { registerServiceWorker } from './pwa';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <ContextMenuProvider>
    <App />
  </ContextMenuProvider>,
);
registerServiceWorker();
