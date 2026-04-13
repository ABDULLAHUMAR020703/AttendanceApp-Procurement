'use client';

import { motion } from 'framer-motion';
import { Card } from '../ui/Card';

type Props = {
  title: string;
  value: number;
  onClick: () => void;
  accentClass?: string;
};

export function DashboardCard({ title, value, onClick, accentClass = 'from-purple-500/20 to-transparent' }: Props) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.98 }}
      className="h-full"
    >
      <button
        type="button"
        onClick={onClick}
        className={[
          'w-full h-full text-left cursor-pointer rounded-xl transition-all duration-300',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f1a]',
          'hover:shadow-[0_0_24px_rgba(147,51,234,0.25)]',
        ].join(' ')}
      >
        <Card
          className={`p-4 h-full border border-white/10 bg-gradient-to-br ${accentClass} hover:border-purple-500/40 relative overflow-hidden group`}
        >
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-purple-500/10 to-transparent pointer-events-none" />
          <div className="relative">
            <div className="text-sm text-muted-foreground">{title}</div>
            <div className="text-2xl font-semibold mt-1 text-foreground tabular-nums">{value}</div>
            <div className="text-[10px] uppercase tracking-wider text-purple-300/80 mt-2">Click to drill down</div>
          </div>
        </Card>
      </button>
    </motion.div>
  );
}
