import './style.css';
import { ReviewStore } from './storage/store.ts';
import { App } from './ui/app.ts';

const root = document.getElementById('app')!;

ReviewStore.open()
  .then((store) => new App(root, store).start())
  .catch((err: unknown) => {
    root.textContent = `This browser could not open local storage (${(err as Error).message}). Private browsing modes may block it.`;
  });
