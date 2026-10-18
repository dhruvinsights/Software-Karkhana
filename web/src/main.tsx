import { createRoot } from 'react-dom/client';
import App from './App';
import { installApiBase } from './lib/apiBase';
import './index.css';

installApiBase();
createRoot(document.getElementById('root')!).render(<App />);
