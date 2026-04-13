import { createApp } from './app';
import { APP_NAME } from './config/appMeta';

const app = createApp();

console.log('Starting server...');
// eslint-disable-next-line no-console
console.log('PORT from env:', process.env.PORT);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`${APP_NAME} backend listening on :${PORT}`);
});

