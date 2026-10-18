import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installApiBase } from './lib/apiBase';
import { installFriendlyErrors } from './lib/friendlyErrors';
import './index.css';

// Screens are switched in-app, so the browser's remembered scroll only lands people mid-page.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

installApiBase();
installFriendlyErrors();
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
