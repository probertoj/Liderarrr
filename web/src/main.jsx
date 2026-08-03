import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

// Aplica el tema antes de pintar, para que no haya parpadeo oscuro al cargar en claro.
document.documentElement.classList.toggle('light', localStorage.getItem('theme') === 'light');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
