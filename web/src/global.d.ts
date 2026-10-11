import type { ElectronAPI } from '../../src/main/preload';
declare global { interface Window { electron?: ElectronAPI; } }
export {};
