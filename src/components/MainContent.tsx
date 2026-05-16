import { OverviewDashboard } from './sections/OverviewDashboard';
import { SecurityView } from './sections/SecurityView';
import { AlertsView } from './sections/AlertsView';
import { AgentActivityView } from './sections/AgentActivityView';
import { SettingsView } from './sections/SettingsView';

interface MainContentProps {
  activeSection: string;
  onSectionChange?: (section: string) => void;
}

export const MainContent = ({ activeSection, onSectionChange }: MainContentProps) => {
  const renderContent = () => {
    switch (activeSection) {
      case 'overview':
        return <OverviewDashboard onSectionChange={onSectionChange} />;
      case 'certificates':
        return <SecurityView />;
      case 'alerts':
        return <AlertsView />;
      case 'agent-activity':
        return <AgentActivityView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <OverviewDashboard />;
    }
  };

  return (
    <main className="flex-1 p-6 bg-gray-900">
      {renderContent()}
    </main>
  );
};
