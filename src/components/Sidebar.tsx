import { cn } from '@/lib/utils';
import { LayoutDashboard, Shield, AlertTriangle, Settings, Bot } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface SidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
}

const menuItems = [
  { id: 'overview',       label: 'Overview',        icon: LayoutDashboard },
  { id: 'certificates',   label: 'Certificates',    icon: Shield },
  { id: 'alerts',         label: 'Alerts',          icon: AlertTriangle },
  { id: 'agent-activity', label: 'Agent Activity',  icon: Bot },
  { id: 'settings',       label: 'Settings',        icon: Settings },
];

export const Sidebar = ({ activeSection, onSectionChange }: SidebarProps) => {
  const navigate = useNavigate();

  return (
    <aside className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
      {/* Brand */}
      <div className="p-6 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Shield className="h-6 w-6 text-blue-400" />
          <div>
            <h2 className="text-sm font-bold text-white leading-tight">C.A.I.R.O</h2>
            <p className="text-xs text-gray-400">Mississippi ITS · MDA</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => {
                onSectionChange(item.id);
              }}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors text-sm',
                activeSection === item.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700">
        <p className="text-xs text-gray-500 text-center">AI Innovation Hub · PoC</p>
      </div>
    </aside>
  );
};
