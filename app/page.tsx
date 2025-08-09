import { QuickLog } from '@/app/components/QuickLog-Simple';
import { Button } from '@/components/ui/button';
import { FileText, History, Settings } from 'lucide-react';
import { Toaster } from 'sonner';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <Toaster position="top-center" richColors closeButton />
      
      <div className="max-w-md mx-auto p-4 pt-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">myHealthyAgent</h1>
          <p className="text-gray-600">Track symptoms in 7 seconds</p>
        </div>

        <QuickLog />

        <div className="mt-8 space-y-3">
          <Button variant="outline" className="w-full h-14 justify-start" disabled>
            <FileText className="mr-3 h-5 w-5" />
            Generate Report (Day 3)
          </Button>
          
          <Button variant="outline" className="w-full h-14 justify-start" disabled>
            <History className="mr-3 h-5 w-5" />
            View History (Day 2)
          </Button>
          
          <Button variant="outline" className="w-full h-14 justify-start" disabled>
            <Settings className="mr-3 h-5 w-5" />
            Settings (Day 4)
          </Button>
        </div>

        <div className="mt-12 text-center text-sm text-gray-500">
          <p>Your data stays on this device</p>
          <p className="mt-1">No account needed • 100% private</p>
        </div>
      </div>
    </div>
  );
}
