import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { installDomSafetyPatch } from './domSafety';

installDomSafetyPatch();

const root = document.getElementById('root');
if (!root) {
  document.body.innerHTML = '<h1 style="color:red;padding:20px">ERROR: #root element not found</h1>';
} else {
  createRoot(root).render(<App />);
}
