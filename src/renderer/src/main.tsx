import React from 'react'
import ReactDOM from 'react-dom/client'
import './App.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ThemeProvider } from './contexts/ThemeContext'
import { installGlobalErrorHandlers } from './lib/globalErrors'

// Install before render so an error thrown during early mount is still caught.
installGlobalErrorHandlers()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </ErrorBoundary>
)
