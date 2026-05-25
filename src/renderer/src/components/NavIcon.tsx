import { Bot, House, PackageCheck, RefreshCw, ScrollText, Server, Settings, Star } from 'lucide-react';

export type NavIconName = 'home' | 'skills' | 'mcps' | 'agents' | 'plugins' | 'audit' | 'settings' | 'rescan';

export function NavIcon({ icon }: { icon: NavIconName }) {
  switch (icon) {
    case 'home':
      return <House strokeWidth={1.8} />;
    case 'skills':
      return <Star strokeWidth={1.8} />;
    case 'mcps':
      return <Server strokeWidth={1.8} />;
    case 'agents':
      return <Bot strokeWidth={1.8} />;
    case 'plugins':
      return <PackageCheck strokeWidth={1.8} />;
    case 'audit':
      return <ScrollText strokeWidth={1.8} />;
    case 'settings':
      return <Settings strokeWidth={1.8} />;
    case 'rescan':
      return <RefreshCw strokeWidth={1.8} />;
  }
}
