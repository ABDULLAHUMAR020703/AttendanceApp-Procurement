import type { Metadata } from 'next';
import { APP_NAME } from '@/lib/appMeta';

export const metadata: Metadata = {
  title: `${APP_NAME} · Print`,
  description: `Printable documents from ${APP_NAME}`,
};

export default function PrintSectionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
