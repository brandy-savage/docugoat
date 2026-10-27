import '@docugoat/reviewer/style.css';
import { ReviewStore } from '@docugoat/reviewer/storage/store';
import { App } from '@docugoat/reviewer/ui/app';

const root = document.getElementById('app')!;

ReviewStore.open()
  .then((store) => new App(root, store).start())
  .catch((err: unknown) => {
    root.textContent = `This browser could not open local storage (${(err as Error).message}). Private browsing modes may block it.`;
  });
