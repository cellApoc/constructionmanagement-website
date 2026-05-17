/**
 * @file Application entry point. Mounts the React app into the DOM.
 * Wraps the root App component with React.StrictMode and BrowserRouter
 * for client-side routing.
 * @module client/main
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './App.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
