import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { SessionProvider } from './shared/api';
import './base.css';
createRoot(document.getElementById('root')).render(<SessionProvider><App /></SessionProvider>);
