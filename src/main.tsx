import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { Buffer } from 'buffer'

// Needed by amazon-cognito-identity-js in the browser (Vite doesn't polyfill Node globals)
;(globalThis as unknown as { Buffer?: typeof Buffer }).Buffer = Buffer

createRoot(document.getElementById("root")!).render(<App />);
