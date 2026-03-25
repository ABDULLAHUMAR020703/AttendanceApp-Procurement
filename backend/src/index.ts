import { createApp } from './app';

const app = createApp();

console.log('Starting server...');
// eslint-disable-next-line no-console
console.log('PORT from env:', process.env.PORT);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`PMS backend listening on :${PORT}`);
});

