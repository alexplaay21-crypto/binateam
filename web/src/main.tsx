import { createRoot } from 'react-dom/client';
import { App } from './App';
import { tg } from './tg';
import './styles.css';

tg?.ready?.();
tg?.expand?.();
if (tg?.colorScheme) document.documentElement.dataset.theme = tg.colorScheme;
tg?.onEvent?.('themeChanged', () => { document.documentElement.dataset.theme = tg.colorScheme; });
createRoot(document.getElementById('root')!).render(<App />);
