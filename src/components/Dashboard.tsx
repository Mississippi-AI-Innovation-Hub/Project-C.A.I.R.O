import { useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { MainContent } from '@/components/MainContent';
import { Header } from '@/components/Header';

export const Dashboard = () => {
  const [activeSection, setActiveSection] = useState(() => {
    return localStorage.getItem('activeSection') || 'overview';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const handleSectionChange = (section: string) => {
    setActiveSection(section);
    localStorage.setItem('activeSection', section);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white flex">
      <Sidebar
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
      />
      <div className="flex-1 flex flex-col">
        <Header
          toggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          sidebarCollapsed={sidebarCollapsed}
          onSectionChange={handleSectionChange}
        />
        <MainContent activeSection={activeSection} onSectionChange={handleSectionChange} />
      </div>
    </div>
  );
};
