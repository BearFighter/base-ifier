import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import './ui/cutter/cutter.css';
import './ui/theme.css';

if (import.meta.env.DEV && new URLSearchParams(location.search).has('autotest')) void import('./dev/autotest');

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
