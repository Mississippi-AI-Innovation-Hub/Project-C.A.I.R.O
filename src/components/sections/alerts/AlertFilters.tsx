
import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Download } from 'lucide-react';

interface AlertFiltersProps {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  severityFilter: string;
  setSeverityFilter: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
}

export const AlertFilters = ({
  searchTerm,
  setSearchTerm,
  severityFilter,
  setSeverityFilter,
  statusFilter,
  setStatusFilter
}: AlertFiltersProps) => {
  return (
    <div className="flex flex-col space-y-3 lg:flex-row lg:items-center lg:justify-between lg:space-y-0 lg:space-x-3">
      <div className="relative flex-1 max-w-sm lg:max-w-md">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
        <Input
          placeholder="Search alerts..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 bg-gray-700 border-gray-600 text-white placeholder:text-gray-400 w-full text-sm"
        />
      </div>

      <div className="flex flex-col space-y-2 sm:flex-row sm:space-y-0 sm:space-x-2 lg:space-x-3">
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-full sm:w-36 lg:w-40 bg-gray-700 border-gray-600 text-white text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-gray-800 border-gray-700 z-50">
            <SelectItem value="all" className="text-white hover:bg-gray-700 text-sm">All Severity</SelectItem>
            <SelectItem value="critical" className="text-white hover:bg-gray-700 text-sm">Critical</SelectItem>
            <SelectItem value="warning" className="text-white hover:bg-gray-700 text-sm">Warning</SelectItem>
            <SelectItem value="info" className="text-white hover:bg-gray-700 text-sm">Info</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-36 lg:w-40 bg-gray-700 border-gray-600 text-white text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-gray-800 border-gray-700 z-50">
            <SelectItem value="all" className="text-white hover:bg-gray-700 text-sm">All Status</SelectItem>
            <SelectItem value="active" className="text-white hover:bg-gray-700 text-sm">Active</SelectItem>
            <SelectItem value="acknowledged" className="text-white hover:bg-gray-700 text-sm">Acknowledged</SelectItem>
            <SelectItem value="resolved" className="text-white hover:bg-gray-700 text-sm">Resolved</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" className="bg-gray-700 border-gray-600 text-white hover:bg-gray-600 w-full sm:w-auto text-sm">
          <Download className="h-4 w-4 mr-2 text-white" />
          Export
        </Button>
      </div>
    </div>
  );
};
